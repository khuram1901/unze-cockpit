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
  FlwTransfer,
  FlwExemption,
  FlwEmployeeExit,
  FlwAdvanceSalary,
  FlwAllowance,
  FlwDeduction,
  FlwPFData,
  FlwOvertime,
  FlwSalarySetup,
  FlwTaxAdjustment,
} from "../../../../lib/flowhcm-client";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * FlowHCM returns dates as MM/DD/YYYY in requests — convert to YYYY-MM-DD for Postgres.
 * If the string is already YYYY-MM-DD, return it as-is.
 */
function parseFlwDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return raw.slice(0, 10);
}

/** Parse leave date format: "29-June-2026" → "2026-06-29" */
const MONTH_MAP: Record<string, string> = {
  January:"01", February:"02", March:"03",    April:"04",
  May:"05",     June:"06",     July:"07",      August:"08",
  September:"09", October:"10", November:"11", December:"12",
};
function parseLeaveDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
  if (m) {
    const mon = MONTH_MAP[m[2]] ?? "01";
    return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
  }
  return parseFlwDate(raw);
}

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

  // DEBUG: log raw keys + first record so we can identify correct field names
  if (employees.length > 0 && employees[0]) {
    const keys = Object.keys(employees[0]).join(", ");
    const sample = JSON.stringify(employees[0]).slice(0, 500);
    await logSync(db, "employees_debug", "error", employees.length, 0,
      `keys: ${keys} | sample: ${sample}`);
  } else {
    await logSync(db, "employees_debug", "error", 0, 0, "API returned empty array");
  }

  const rows = employees
    .map(e => ({
      // FlowHCM returns PascalCase — fall back through common variants
      employee_code:  e.EmployeeCode  ?? e.employeeCode  ?? e.EmpCode     ?? e.empCode     ?? String(e.EmployeeRefNo ?? e.employeeRefNo ?? ""),
      full_name:      e.FullName      ?? e.fullName      ?? e.EmpName      ?? e.empName     ?? e.Name ?? null,
      designation:    e.Designation   ?? e.designation   ?? null,
      department:     e.Department    ?? e.department    ?? null,
      sub_department: e.SubDepartment ?? e.subDepartment ?? null,
      station:        e.Station       ?? e.station       ?? null,
      division:       e.Division      ?? e.division      ?? null,
      company:        e.Company       ?? e.company       ?? null,
      status:         e.Status        ?? e.status        ?? null,
      joining_date:   parseFlwDate(e.JoiningDate ?? e.joiningDate ?? e.DateOfJoining ?? null),
      cnic:           e.CNIC          ?? e.cnic          ?? e.NIC          ?? null,
      email:          e.Email         ?? e.email         ?? e.OfficialEmail ?? null,
      mobile:         e.Mobile        ?? e.mobile        ?? e.MobileNo      ?? null,
      grade:          e.Grade         ?? e.grade         ?? null,
      reports_to:     e.ReportsTo     ?? e.reportsTo     ?? e.ManagerCode  ?? null,
      synced_at:      new Date().toISOString(),
    }))
    .filter(r => r.employee_code && r.employee_code !== "");

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

  const allRows = records.map(r => ({
    employee_code:   String(r.EmployeeRefNo),
    employee_name:   null,
    attendance_date: r.ActualInDate ?? toDate,
    status:          r.SignIn ? "Present" : "Absent",
    check_in:        r.ActualInTime  ?? null,
    check_out:       r.ActualOutTime ?? null,
    department:      null,
    station:         r.Station ?? null,
    synced_at:       new Date().toISOString(),
  }));

  // Deduplicate on (employee_code, attendance_date) — last record wins
  const seen = new Map<string, typeof allRows[0]>();
  for (const row of allRows) {
    seen.set(`${row.employee_code}__${row.attendance_date}`, row);
  }
  const rows = [...seen.values()];

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

  const allLeaveRows = requests.map(r => {
    const flw_id = `${r.EmployeeCode ?? "?"}_${r.FromDate ?? "?"}_${r.LeaveType ?? "?"}`;
    return {
      flw_id,
      employee_code: r.EmployeeCode,
      employee_name: null,
      leave_type:    r.LeaveType,
      from_date:     parseLeaveDate(r.FromDate),
      to_date:       parseLeaveDate(r.ToDate),
      days:          r.LeaveDays,
      status:        r.Status,
      department:    null,
      station:       null,
      synced_at:     new Date().toISOString(),
    };
  });

  // Deduplicate on flw_id — last record wins
  const leaveMap = new Map<string, typeof allLeaveRows[0]>();
  for (const row of allLeaveRows) leaveMap.set(row.flw_id, row);
  const rows = [...leaveMap.values()];

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
  const rows = loans.map((r: FlwLoan) => {
    const code      = r.EmployeeCode   ?? r.employeeCode   ?? "";
    const loanType  = r.LoanType       ?? r.loanType       ?? "";
    const startDate = parseFlwDate(r.StartDate ?? r.startDate ?? r.IssueDate ?? r.issueDate) ?? "";
    return {
      // Synthetic flw_id — stable composite key since API has no natural ID
      flw_id:             `${code}_${loanType}_${startDate}`.replace(/\s/g, "_"),
      employee_code:      code || null,
      employee_name:      r.EmployeeName      ?? r.employeeName      ?? null,
      department:         r.Department        ?? r.department        ?? null,
      loan_type:          loanType || null,
      principal_amount:   r.PrincipalAmount   ?? r.principalAmount   ?? 0,
      outstanding_amount: r.OutstandingAmount ?? r.outstandingAmount ?? 0,
      monthly_deduction:  r.MonthlyDeduction  ?? r.monthlyDeduction  ?? 0,
      start_date:         startDate || null,
      expected_end_date:  parseFlwDate(r.ExpectedEndDate ?? r.expectedEndDate ?? r.EndDate),
      status:             r.Status ?? r.status ?? null,
      synced_at:          new Date().toISOString(),
    };
  })
  .filter(r => r.flw_id && r.flw_id !== "__");
  if (rows.length > 0) {
    const { error } = await db
      .from("flw_loans")
      .upsert(rows, { onConflict: "flw_id" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "loans", "success", rows.length, Date.now() - t0);
  return rows.length;
}

// ── New module syncs (from extended Postman collection) ───────────────────────

async function syncTransfers(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getTransfers();
  const rows = records.map((r: FlwTransfer) => ({
    employee_code:  r.employeeCode ?? r.EmployeeCode ?? null,
    employee_name:  r.employeeName ?? r.EmployeeName ?? null,
    from_department: r.fromDepartment ?? r.FromDepartment ?? null,
    to_department:  r.toDepartment ?? r.ToDepartment ?? null,
    from_company:   r.fromCompany ?? r.FromCompany ?? null,
    to_company:     r.toCompany ?? r.ToCompany ?? null,
    transfer_date:  parseFlwDate(r.transferDate ?? r.TransferDate),
    effective_date: parseFlwDate(r.effectiveDate ?? r.EffectiveDate),
    transfer_type:  r.transferType ?? r.TransferType ?? null,
    reason:         r.reason ?? r.Reason ?? null,
    status:         r.status ?? r.Status ?? null,
    raw:            r,
    synced_at:      new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db.from("flw_transfers").upsert(rows, {
      onConflict: "employee_code,transfer_date,to_department",
    });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "transfers", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncExemptions(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getExemptions();
  const rows = records.map((r: FlwExemption) => ({
    employee_code:  r.employeeCode ?? r.EmployeeCode ?? null,
    employee_name:  r.employeeName ?? r.EmployeeName ?? null,
    exemption_date: parseFlwDate(r.exemptionDate ?? r.ExemptionDate ?? r.Date),
    exemption_type: r.exemptionType ?? r.ExemptionType ?? r.Type ?? null,
    reason:         r.reason ?? r.Reason ?? null,
    status:         r.status ?? r.Status ?? null,
    approved_by:    r.approvedBy ?? r.ApprovedBy ?? null,
    raw:            r,
    synced_at:      new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db.from("flw_exemptions").upsert(rows, {
      onConflict: "employee_code,exemption_date,exemption_type",
    });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "exemptions", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncEmployeeExits(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getEmployeeExits();
  const rows = records.map((r: FlwEmployeeExit) => ({
    employee_code:      r.employeeCode ?? r.EmployeeCode ?? null,
    employee_name:      r.employeeName ?? r.EmployeeName ?? null,
    department:         r.department ?? r.Department ?? null,
    designation:        r.designation ?? r.Designation ?? null,
    joining_date:       parseFlwDate(r.joiningDate ?? r.JoiningDate),
    leaving_date:       parseFlwDate(r.leavingDate ?? r.LeavingDate ?? r.ExitDate),
    exit_type:          r.exitType ?? r.ExitType ?? r.LeavingType ?? null,
    reason:             r.reason ?? r.Reason ?? null,
    notice_period_days: r.noticePeriodDays ?? r.NoticePeriodDays ?? null,
    clearance_status:   r.clearanceStatus ?? r.ClearanceStatus ?? null,
    raw:                r,
    synced_at:          new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db.from("flw_employee_exits").upsert(rows, {
      onConflict: "employee_code",
    });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "employee_exits", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncAdvanceSalary(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getAdvanceSalary();
  const rows = records.map((r: FlwAdvanceSalary) => ({
    employee_code:   r.employeeCode ?? r.EmployeeCode ?? null,
    employee_name:   r.employeeName ?? r.EmployeeName ?? null,
    request_date:    parseFlwDate(r.requestDate ?? r.RequestDate),
    amount:          r.amount ?? r.Amount ?? 0,
    approved_amount: r.approvedAmount ?? r.ApprovedAmount ?? 0,
    repayment_months: r.repaymentMonths ?? r.RepaymentMonths ?? null,
    status:          r.status ?? r.Status ?? null,
    approved_by:     r.approvedBy ?? r.ApprovedBy ?? null,
    remarks:         r.remarks ?? r.Remarks ?? null,
    raw:             r,
    synced_at:       new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db.from("flw_advance_salary").upsert(rows, {
      onConflict: "employee_code,request_date,amount",
    });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "advance_salary", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncAllowancesAndDeductions(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const now = new Date();
  // Sync current month + previous 2 months to catch late processing
  const monthsToSync = [0, 1, 2].map(offset => {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return {
      year:  String(d.getFullYear()),
      month: String(d.getMonth() + 1).padStart(2, "0"),
    };
  });

  let totalAllowances = 0;
  let totalDeductions = 0;

  for (const { year, month } of monthsToSync) {
    const [allowances, deductions] = await Promise.all([
      flowhcm.getAllowances(year, month),
      flowhcm.getDeductions(year, month),
    ]);

    // Build rows and deduplicate on conflict key (last row wins)
    const allowanceMap = new Map<string, Record<string, any>>();
    for (const r of allowances as FlwAllowance[]) {
      const code = r.employeeCode ?? r.EmployeeCode ?? null;
      const type = r.allowanceType ?? r.AllowanceType ?? r.Type ?? null;
      const key  = `${code}__${year}__${month}__${type}`;
      allowanceMap.set(key, {
        employee_code:  code,
        employee_name:  r.employeeName ?? r.EmployeeName ?? null,
        year:           parseInt(year),
        month:          parseInt(month),
        allowance_type: type,
        amount:         r.amount ?? r.Amount ?? 0,
        status:         r.status ?? r.Status ?? null,
        raw:            r,
        synced_at:      new Date().toISOString(),
      });
    }
    const allowanceRows = [...allowanceMap.values()];

    const deductionMap = new Map<string, Record<string, any>>();
    for (const r of deductions as FlwDeduction[]) {
      const code = r.employeeCode ?? r.EmployeeCode ?? null;
      const type = r.deductionType ?? r.DeductionType ?? r.Type ?? null;
      const key  = `${code}__${year}__${month}__${type}`;
      deductionMap.set(key, {
        employee_code:  code,
        employee_name:  r.employeeName ?? r.EmployeeName ?? null,
        year:           parseInt(year),
        month:          parseInt(month),
        deduction_type: type,
        amount:         r.amount ?? r.Amount ?? 0,
        status:         r.status ?? r.Status ?? null,
        raw:            r,
        synced_at:      new Date().toISOString(),
      });
    }
    const deductionRows = [...deductionMap.values()];

    if (allowanceRows.length > 0) {
      const { error: ae } = await db.from("flw_allowances").upsert(allowanceRows, {
        onConflict: "employee_code,year,month,allowance_type",
      });
      if (ae) throw new Error(`allowances upsert: ${ae.message}`);
    }
    if (deductionRows.length > 0) {
      const { error: de } = await db.from("flw_deductions").upsert(deductionRows, {
        onConflict: "employee_code,year,month,deduction_type",
      });
      if (de) throw new Error(`deductions upsert: ${de.message}`);
    }
    totalAllowances += allowanceRows.length;
    totalDeductions += deductionRows.length;
  }

  await logSync(db, "allowances", "success", totalAllowances, Date.now() - t0);
  await logSync(db, "deductions", "success", totalDeductions, Date.now() - t0);
  return totalAllowances + totalDeductions;
}

async function syncPFData(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getPFData();
  const rows = records.map((r: FlwPFData) => ({
    employee_code:            r.employeeCode ?? r.EmployeeCode ?? null,
    employee_name:            r.employeeName ?? r.EmployeeName ?? null,
    pf_type:                  r.pfType ?? r.PFType ?? r.Type ?? null,
    employee_contribution:    r.employeeContribution ?? r.EmployeeContribution ?? 0,
    employer_contribution:    r.employerContribution ?? r.EmployerContribution ?? 0,
    effective_date:           parseFlwDate(r.effectiveDate ?? r.EffectiveDate),
    status:                   r.status ?? r.Status ?? null,
    raw:                      r,
    synced_at:                new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db.from("flw_pf_data").upsert(rows, {
      onConflict: "employee_code,pf_type,effective_date",
    });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "pf_data", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncOvertime(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getOvertime();
  const rows = records.map((r: FlwOvertime) => ({
    employee_code:   r.employeeCode ?? r.EmployeeCode ?? null,
    employee_name:   r.employeeName ?? r.EmployeeName ?? null,
    overtime_date:   parseFlwDate(r.overtimeDate ?? r.OvertimeDate ?? r.Date),
    hours:           r.hours ?? r.Hours ?? 0,
    rate_multiplier: r.rateMultiplier ?? r.RateMultiplier ?? 1.5,
    amount:          r.amount ?? r.Amount ?? 0,
    status:          r.status ?? r.Status ?? null,
    approved_by:     r.approvedBy ?? r.ApprovedBy ?? null,
    raw:             r,
    synced_at:       new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db.from("flw_overtime").upsert(rows, {
      onConflict: "employee_code,overtime_date",
    });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "overtime", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncSalarySetup(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getSalarySetup();
  const rows = records.map((r: FlwSalarySetup) => ({
    employee_code:  r.employeeCode ?? r.EmployeeCode ?? null,
    employee_name:  r.employeeName ?? r.EmployeeName ?? null,
    grade:          r.grade ?? r.Grade ?? null,
    basic_salary:   r.basicSalary ?? r.BasicSalary ?? 0,
    gross_salary:   r.grossSalary ?? r.GrossSalary ?? 0,
    currency:       r.currency ?? r.Currency ?? "PKR",
    effective_date: parseFlwDate(r.effectiveDate ?? r.EffectiveDate),
    raw:            r,
    synced_at:      new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db.from("flw_salary_setup").upsert(rows, {
      onConflict: "employee_code",
    });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "salary_setup", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncTaxAdjustments(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getTaxAdjustments();
  const now = new Date();
  const rows = records.map((r: FlwTaxAdjustment) => ({
    employee_code:    r.employeeCode ?? r.EmployeeCode ?? null,
    employee_name:    r.employeeName ?? r.EmployeeName ?? null,
    tax_year:         r.taxYear ?? r.TaxYear ?? now.getFullYear(),
    adjustment_type:  r.adjustmentType ?? r.AdjustmentType ?? r.Type ?? null,
    amount:           r.amount ?? r.Amount ?? 0,
    reason:           r.reason ?? r.Reason ?? null,
    status:           r.status ?? r.Status ?? null,
    raw:              r,
    synced_at:        new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await db.from("flw_tax_adjustments").upsert(rows, {
      onConflict: "employee_code,tax_year,adjustment_type",
    });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "tax_adjustments", "success", rows.length, Date.now() - t0);
  return rows.length;
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Allow Vercel cron (CRON_SECRET) OR any authenticated request (no secret = open for manual triggers)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization") ?? "";
    // Accept either the cron secret OR a valid Supabase Bearer token (non-empty)
    if (authHeader !== `Bearer ${secret}` && !authHeader.startsWith("Bearer ey")) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
  }

  // Check FlowHCM is configured
  if (!flowhcm.isConfigured()) {
    return NextResponse.json({
      status:  "not_configured",
      message: "FlowHCM env vars missing. Add FLOWHCM_EMAIL, FLOWHCM_PASSWORD, and FLOWHCM_LOGIN_TOKEN in Vercel → Settings → Environment Variables.",
    }, { status: 200 });
  }

  const db      = createServiceClient();
  const results: Record<string, number | string> = {};
  const errors:  string[] = [];
  const t0 = Date.now();

  // Parse which modules to sync (default: all)
  const body = await request.json().catch(() => ({})) as { modules?: string[] };
  const ALL_MODULES = [
    // Core (confirmed implemented)
    "employees", "attendance", "leave",
    // New extended modules
    "transfers", "exemptions", "employee_exits", "advance_salary",
    "allowances_deductions", "pf_data", "overtime", "salary_setup", "tax_adjustments",
    // Loans (now confirmed endpoint)
    "loans",
    // Stubs — no FlowHCM endpoint yet; kept so manual triggers still work
    "recruitment", "payroll", "performance", "training_records", "disciplinary",
  ];
  const modules = body.modules ?? ALL_MODULES;

  for (const mod of modules) {
    try {
      if (mod === "employees")             results.employees             = await syncEmployees(db);
      if (mod === "attendance")            results.attendance            = await syncAttendance(db);
      if (mod === "leave")                 results.leave                 = await syncLeave(db);
      if (mod === "transfers")             results.transfers             = await syncTransfers(db);
      if (mod === "exemptions")            results.exemptions            = await syncExemptions(db);
      if (mod === "employee_exits")        results.employee_exits        = await syncEmployeeExits(db);
      if (mod === "advance_salary")        results.advance_salary        = await syncAdvanceSalary(db);
      if (mod === "allowances_deductions") results.allowances_deductions = await syncAllowancesAndDeductions(db);
      if (mod === "pf_data")              results.pf_data               = await syncPFData(db);
      if (mod === "overtime")              results.overtime              = await syncOvertime(db);
      if (mod === "salary_setup")          results.salary_setup          = await syncSalarySetup(db);
      if (mod === "tax_adjustments")       results.tax_adjustments       = await syncTaxAdjustments(db);
      if (mod === "loans")                 results.loans                 = await syncLoans(db);
      if (mod === "recruitment")           results.recruitment           = await syncRecruitment(db);
      if (mod === "payroll")               results.payroll               = await syncPayroll(db);
      if (mod === "performance")           results.performance           = await syncPerformance(db);
      if (mod === "training_records")      results.training_records      = await syncTrainingRecords(db);
      if (mod === "disciplinary")          results.disciplinary          = await syncDisciplinary(db);
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
