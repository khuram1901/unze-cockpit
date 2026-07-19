/**
 * POST /api/flowhcm/sync
 * ─────────────────────────────────────────────────────────────────
 * Called every 2 hours by Vercel cron (vercel.json).
 * Syncs employees, attendance, leave, and recruitment from FlowHCM
 * into Supabase tables (flw_*).
 *
 * Security: protected by CRON_SECRET header (set in Vercel env vars).
 * You can also trigger manually: POST /api/flowhcm/sync with the header.
 * ─────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import {
  flowhcm,
  FlwPayrollRecord,
  FlwPerformanceReview,
  FlwTrainingRecord,
  FlwDisciplinaryAction,
  FlwLoan,
} from "../../../../lib/flowhcm-client";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function logSync(
  db:      ReturnType<typeof createServiceClient>,
  module:  string,
  status:  "success" | "error",
  records: number,
  ms:      number,
  error?:  string
) {
  await db.from("flw_sync_log").insert({
    module,
    status,
    records_synced: records,
    duration_ms:    ms,
    error_message:  error ?? null,
  });
}

// ── Module syncs ───────────────────────────────────────────────────────────────

async function syncEmployees(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const employees = await flowhcm.getEmployees();

  const rows = employees.map(e => ({
    employee_code:  e.employeeCode,
    full_name:      e.fullName,
    designation:    e.designation,
    department:     e.department,
    sub_department: e.subDepartment,
    station:        e.station,
    division:       e.division,
    company:        e.company,
    status:         e.status,
    joining_date:   e.joiningDate ? e.joiningDate.slice(0, 10) : null,
    cnic:           e.cnic,
    email:          e.email,
    mobile:         e.mobile,
    grade:          e.grade,
    reports_to:     e.reportsTo,
    synced_at:      new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await db
      .from("flw_employees")
      .upsert(rows, { onConflict: "employee_code" });
    if (error) throw new Error(error.message);
  }

  await logSync(db, "employees", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncAttendance(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  // Sync last 7 days rolling window so we don't miss late entries
  const toDate   = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  const records = await flowhcm.getAttendance(fromDate, toDate);

  const rows = records.map(r => ({
    employee_code:   r.employeeCode,
    employee_name:   r.employeeName,
    attendance_date: r.attendanceDate?.slice(0, 10) ?? toDate,
    status:          r.status,
    check_in:        r.checkIn,
    check_out:       r.checkOut,
    department:      r.department,
    station:         r.station,
    synced_at:       new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await db
      .from("flw_attendance_daily")
      .upsert(rows, { onConflict: "employee_code,attendance_date" });
    if (error) throw new Error(error.message);
  }

  await logSync(db, "attendance", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncLeave(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  // Pull approved leave for the current month + next month
  const now      = new Date();
  const fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMo   = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const toDate   = nextMo.toISOString().slice(0, 10);

  const requests = await flowhcm.getLeaveRequests(fromDate, toDate);

  const rows = requests.map(r => ({
    flw_id:        r.id,
    employee_code: r.employeeCode,
    employee_name: r.employeeName,
    leave_type:    r.leaveType,
    from_date:     r.fromDate?.slice(0, 10),
    to_date:       r.toDate?.slice(0, 10),
    days:          r.days,
    status:        r.status,
    department:    r.department,
    station:       r.station,
    synced_at:     new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await db
      .from("flw_leave_requests")
      .upsert(rows, { onConflict: "flw_id" });
    if (error) throw new Error(error.message);
  }

  await logSync(db, "leave", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncRecruitment(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();

  // Sync job requests (positions) into our recruitment_positions table
  const jobRequests = await flowhcm.getJobRequests();
  const posRows = jobRequests.map(jr => ({
    position_title: jr.jobTitle,
    flw_company:    jr.station ?? "Unze Group",
    salary_range:   jr.salaryRange,
    date_opened:    jr.addedOn?.slice(0, 10) ?? null,
    status:         jr.status === "Approved" ? "Open" : "On Hold",
    required_count: jr.noOfPositions ?? 1,
    import_source:  "flowhcm_api",
    flw_remarks:    null,
  }));

  // Sync candidates into recruitment_candidates
  const candidates = await flowhcm.getCandidates();

  let posCount  = posRows.length;
  let candCount = candidates.length;

  if (posRows.length > 0) {
    const { error } = await db
      .from("recruitment_positions")
      .upsert(posRows, {
        onConflict:        "position_title,flw_company,date_opened",
        ignoreDuplicates:  false,
      });
    if (error) console.error("Positions upsert:", error.message);
  }

  // Map candidates → look up position IDs by job title
  if (candidates.length > 0) {
    const { data: positions } = await db
      .from("recruitment_positions")
      .select("id, position_title");

    const posMap = new Map((positions ?? []).map(p => [p.position_title?.toLowerCase(), p.id]));

    const candRows = candidates
      .map(c => {
        const posId = posMap.get(c.jobTitle?.toLowerCase() ?? "");
        if (!posId) return null;
        return {
          position_id:    posId,
          name:           c.name,
          contact:        c.mobile,
          email:          c.email,
          stage:          mapPipelineStage(c.pipelineStatus),
          cv_link:        null,
          feedback:       { gender: c.gender, experience: c.experience, station: c.station },
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    if (candRows.length > 0) {
      await db.from("recruitment_candidates").upsert(candRows, { onConflict: "position_id,name" });
    }
    candCount = candRows.length;
  }

  await logSync(db, "recruitment", "success", posCount + candCount, Date.now() - t0);
  return posCount + candCount;
}

function mapPipelineStage(pipelineStatus: string | null): string {
  const s = (pipelineStatus ?? "").toLowerCase();
  if (s.includes("hired") || s.includes("join"))   return "Offer Accepted";
  if (s.includes("offer"))                          return "Offer";
  if (s.includes("interview") || s.includes("eval")) return "Interviewed";
  if (s.includes("short"))                          return "Shortlisted";
  if (s.includes("screen"))                         return "Applied";
  return "Applied";
}

// ── Extended module syncs ──────────────────────────────────────────────────────

async function syncPayroll(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  // Current month + previous month to catch late processing
  const now  = new Date();
  const months = [
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`,
  ].filter(m => m.slice(5) !== "00"); // guard January edge case

  let total = 0;
  for (const month of months) {
    const records = await flowhcm.getPayroll(month);
    const rows = records.map((r: FlwPayrollRecord) => ({
      pay_month:         `${month}-01`,
      employee_code:     r.employeeCode,
      employee_name:     r.employeeName,
      department:        r.department,
      station:           r.station,
      designation:       r.designation,
      basic_salary:      r.basicSalary   ?? 0,
      gross_salary:      r.grossSalary   ?? 0,
      net_salary:        r.netSalary     ?? 0,
      total_deductions:  r.totalDeductions  ?? 0,
      total_allowances:  r.totalAllowances  ?? 0,
      status:            r.status,
      synced_at:         new Date().toISOString(),
    }));
    if (rows.length > 0) {
      const { error } = await db
        .from("flw_payroll_monthly")
        .upsert(rows, { onConflict: "pay_month,employee_code" });
      if (error) throw new Error(error.message);
    }
    total += rows.length;
  }
  await logSync(db, "payroll", "success", total, Date.now() - t0);
  return total;
}

async function syncPerformance(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const reviews = await flowhcm.getPerformanceReviews();
  const rows = reviews.map((r: FlwPerformanceReview) => ({
    flw_id:          r.id,
    employee_code:   r.employeeCode,
    employee_name:   r.employeeName,
    department:      r.department,
    station:         r.station,
    review_period:   r.reviewPeriod,
    review_type:     r.reviewType,
    status:          r.status,
    rating:          r.rating,
    due_date:        r.dueDate?.slice(0, 10) ?? null,
    completed_date:  r.completedDate?.slice(0, 10) ?? null,
    reviewer_name:   r.reviewerName,
    reviewer_code:   r.reviewerCode,
    remarks:         r.remarks,
    synced_at:       new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db
      .from("flw_performance_reviews")
      .upsert(rows, { onConflict: "flw_id" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "performance", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncTrainingRecords(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getTrainingRecords();
  const rows = records.map((r: FlwTrainingRecord) => ({
    flw_id:         r.id,
    employee_code:  r.employeeCode,
    employee_name:  r.employeeName,
    department:     r.department,
    training_title: r.trainingTitle,
    training_date:  r.trainingDate?.slice(0, 10) ?? null,
    training_type:  r.trainingType,
    status:         r.status,
    score:          r.score,
    trainer:        r.trainer,
    venue:          r.venue,
    synced_at:      new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db
      .from("flw_training_records")
      .upsert(rows, { onConflict: "flw_id" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "training_records", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncDisciplinary(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const actions = await flowhcm.getDisciplinary();
  const rows = actions.map((r: FlwDisciplinaryAction) => ({
    flw_id:            r.id,
    employee_code:     r.employeeCode,
    employee_name:     r.employeeName,
    department:        r.department,
    station:           r.station,
    notice_type:       r.noticeType,
    issue_date:        r.issueDate?.slice(0, 10) ?? null,
    response_due_date: r.responseDueDate?.slice(0, 10) ?? null,
    status:            r.status,
    description:       r.description,
    issued_by:         r.issuedBy,
    synced_at:         new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db
      .from("flw_disciplinary")
      .upsert(rows, { onConflict: "flw_id" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "disciplinary", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncLoans(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const loans = await flowhcm.getLoans();
  const rows = loans.map((r: FlwLoan) => ({
    flw_id:             r.id,
    employee_code:      r.employeeCode,
    employee_name:      r.employeeName,
    department:         r.department,
    loan_type:          r.loanType,
    principal_amount:   r.principalAmount   ?? 0,
    outstanding_amount: r.outstandingAmount ?? 0,
    monthly_deduction:  r.monthlyDeduction  ?? 0,
    start_date:         r.startDate?.slice(0, 10) ?? null,
    expected_end_date:  r.expectedEndDate?.slice(0, 10) ?? null,
    status:             r.status,
    synced_at:          new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db
      .from("flw_loans")
      .upsert(rows, { onConflict: "flw_id" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "loans", "success", rows.length, Date.now() - t0);
  return rows.length;
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Protect with CRON_SECRET (set this in Vercel env vars)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
  }

  // Check FlowHCM is configured
  if (!flowhcm.isConfigured()) {
    return NextResponse.json({
      status:  "not_configured",
      message: "FLOWHCM_TOKEN env var is not set. Add it in Vercel → Settings → Environment Variables.",
    }, { status: 200 });
  }

  const db      = createServiceClient();
  const results: Record<string, number | string> = {};
  const errors:  string[] = [];
  const t0 = Date.now();

  // Parse which modules to sync (default: all)
  const body = await request.json().catch(() => ({})) as { modules?: string[] };
  const ALL_MODULES = [
    "employees", "attendance", "leave", "recruitment",
    "payroll", "performance", "training_records", "disciplinary", "loans",
  ];
  const modules = body.modules ?? ALL_MODULES;

  for (const mod of modules) {
    try {
      if (mod === "employees")        results.employees        = await syncEmployees(db);
      if (mod === "attendance")       results.attendance       = await syncAttendance(db);
      if (mod === "leave")            results.leave            = await syncLeave(db);
      if (mod === "recruitment")      results.recruitment      = await syncRecruitment(db);
      if (mod === "payroll")          results.payroll          = await syncPayroll(db);
      if (mod === "performance")      results.performance      = await syncPerformance(db);
      if (mod === "training_records") results.training_records = await syncTrainingRecords(db);
      if (mod === "disciplinary")     results.disciplinary     = await syncDisciplinary(db);
      if (mod === "loans")            results.loans            = await syncLoans(db);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${mod}: ${msg}`);
      await logSync(db, mod, "error", 0, 0, msg);
    }
  }

  return NextResponse.json({
    status:    errors.length === 0 ? "ok" : "partial",
    duration_ms: Date.now() - t0,
    results,
    errors,
  });
}

// Vercel cron calls GET (not POST) — support both
export const GET = POST;
