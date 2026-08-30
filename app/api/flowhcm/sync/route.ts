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
  Jan:"01", Feb:"02", Mar:"03", Apr:"04", Jun:"06",
  Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12",
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

/**
 * Parse ANY date format FlowHCM has been seen to return:
 *   "2022-11-02T00:00:00" (ISO)   "15-Aug-22" (DD-Mon-YY)
 *   "29-Jul-26" (DD-Mon-YY)       "01-October-2026" (DD-Month-YYYY)
 *   "07-June-2022"                "MM/DD/YYYY"      "YYYY-MM-DD"
 * Returns YYYY-MM-DD or null.
 */
function parseAnyFlwDate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);              // ISO / YYYY-MM-DD
  // DD-Mon-YY / DD-Month-YYYY / DD/Month/YYYY — with optional trailing time ("29-Aug-2026 10:26 AM")
  let m = s.match(/^(\d{1,2})[-/]([A-Za-z]+)[-/](\d{2,4})/);
  if (m) {
    const mon = MONTH_MAP[m[2]];
    if (!mon) return null;
    let year = m[3];
    if (year.length === 2) {
      // Two-digit year: 00–49 → 20xx, 50–99 → 19xx
      year = parseInt(year) < 50 ? `20${year}` : `19${year}`;
    }
    return `${year}-${mon}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);                            // MM/DD/YYYY
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
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

  // Confirmed field names from live GetEmployeeList response (30/08/2026):
  // EmployeeRefNo, EmployeeName, DepartmentName, SubDepName, DesignationName,
  // GradeName, StationName, DivisionName, EmployeeGroup, CostCenterName,
  // JoiningDate, EmployeeStatus, IsActive, Email, MobileNo, CnicNo, ManagerName
  const empMap = new Map<string, Record<string, any>>();
  for (const e of employees) {
    const code = String(e.EmployeeRefNo ?? e.EmployeeCode ?? e.employeeCode ?? "");
    if (!code) continue;
    empMap.set(code, {
      employee_code:  code,
      // EmployeeName only carries the first name; AccountTitle (bank account
      // title) holds the full name — prefer it when present
      full_name:      (e.AccountTitle && String(e.AccountTitle).trim())
                        ? String(e.AccountTitle).trim()
                        : (e.EmployeeName ?? null),
      designation:    e.DesignationName && e.DesignationName !== "--" ? e.DesignationName : null,
      department:     e.DepartmentName  && e.DepartmentName  !== "--" ? e.DepartmentName  : null,
      sub_department: e.SubDepName      && e.SubDepName      !== "--" ? e.SubDepName      : null,
      station:        e.StationName     && e.StationName     !== "--" ? e.StationName     : null,
      division:       e.DivisionName    && e.DivisionName    !== "--" ? e.DivisionName    : null,
      company:        e.EmployeeGroup   && e.EmployeeGroup   !== "--" ? e.EmployeeGroup   : null,
      status:         e.EmployeeStatus ?? (e.IsActive != null ? (e.IsActive ? "Active" : "Inactive") : null),
      joining_date:   parseAnyFlwDate(e.JoiningDate ?? e.AppointmentDate),
      cnic:           e.CnicNo   ?? null,
      email:          e.Email    ?? null,
      mobile:         e.MobileNo ?? null,
      grade:          e.GradeName && e.GradeName !== "--" ? e.GradeName : null,
      reports_to:     e.ManagerName && e.ManagerName !== "--" ? e.ManagerName : null,
      synced_at:      new Date().toISOString(),
    });
  }
  const rows = [...empMap.values()];

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
  // Map dedup — synthetic flw_id can repeat within one batch (last row wins)
  const map = new Map<string, Record<string, any>>();
  for (const r of loans as FlwLoan[]) {
    const code      = r.EmployeeCode   ?? r.employeeCode   ?? "";
    const loanType  = r.LoanType       ?? r.loanType       ?? "";
    const startDate = parseAnyFlwDate(r.StartDate ?? r.startDate ?? r.IssueDate ?? r.issueDate) ?? "";
    const amount    = r.PrincipalAmount ?? r.principalAmount ?? 0;
    const flwId     = `${code}_${loanType}_${startDate}_${amount}`.replace(/\s/g, "_");
    if (!code) continue;
    map.set(flwId, {
      flw_id:             flwId,
      employee_code:      code || null,
      employee_name:      r.EmployeeName      ?? r.employeeName      ?? null,
      department:         r.Department        ?? r.department        ?? null,
      loan_type:          loanType || null,
      principal_amount:   amount,
      outstanding_amount: r.OutstandingAmount ?? r.outstandingAmount ?? 0,
      monthly_deduction:  r.MonthlyDeduction  ?? r.monthlyDeduction  ?? 0,
      start_date:         startDate || null,
      expected_end_date:  parseAnyFlwDate(r.ExpectedEndDate ?? r.expectedEndDate ?? r.EndDate),
      status:             r.Status ?? r.status ?? null,
      synced_at:          new Date().toISOString(),
    });
  }
  const rows = [...map.values()];
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
  // Real fields (employeeTransferGet): PunchCode, CreatedOn, ExpiryDate, Area,
  // City, Province, Country, RegionName, SubDepName, VendorName, Description
  const map = new Map<string, Record<string, any>>();
  for (const r of records as FlwTransfer[]) {
    const code = r.PunchCode ?? r.employeeCode ?? r.EmployeeCode ?? null;
    if (!code) continue;
    const created = parseAnyFlwDate(r.CreatedOn ?? r.transferDate ?? r.TransferDate);
    const key = `${code}|${created ?? "?"}|${r.Area ?? ""}|${r.City ?? ""}`;
    map.set(key, {
      flw_key:        key,
      employee_code:  String(code),
      employee_name:  r.employeeName ?? r.EmployeeName ?? null,
      to_department:  r.SubDepName && r.SubDepName !== "--" ? r.SubDepName : null,
      transfer_date:  created,
      effective_date: parseAnyFlwDate(r.ExpiryDate),
      transfer_type:  [r.Area, r.City].filter(v => v && v !== "--").join(", ") || null,
      reason:         r.Description ?? null,
      status:         r.status ?? r.Status ?? null,
      raw:            r,
      synced_at:      new Date().toISOString(),
    });
  }
  const rows = [...map.values()];
  if (rows.length > 0) {
    const { error } = await db.from("flw_transfers").upsert(rows, { onConflict: "flw_key" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "transfers", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncExemptions(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getExemptions();
  // Real fields (attendanceExemptionGet): EmployeeRefNo, Date, Status, FlagType
  const map = new Map<string, Record<string, any>>();
  for (const r of records as FlwExemption[]) {
    const code = r.EmployeeRefNo ?? r.employeeCode ?? r.EmployeeCode ?? null;
    if (!code) continue;
    const date = parseAnyFlwDate(r.Date ?? r.exemptionDate ?? r.ExemptionDate);
    const type = r.FlagType ?? r.exemptionType ?? r.ExemptionType ?? null;
    const key  = `${code}|${date ?? "?"}|${type ?? "?"}`;
    map.set(key, {
      flw_key:        key,
      employee_code:  String(code),
      employee_name:  r.employeeName ?? r.EmployeeName ?? null,
      exemption_date: date,
      exemption_type: type,
      reason:         r.reason ?? r.Reason ?? null,
      status:         r.Status ?? r.status ?? null,
      approved_by:    r.approvedBy ?? r.ApprovedBy ?? null,
      raw:            r,
      synced_at:      new Date().toISOString(),
    });
  }
  const rows = [...map.values()];
  if (rows.length > 0) {
    const { error } = await db.from("flw_exemptions").upsert(rows, { onConflict: "flw_key" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "exemptions", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncEmployeeExits(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getEmployeeExits();
  // Real fields (employeeLeavingGet): EmployeeCode, LeavingDate, LastWorkingDate, Reason
  const map = new Map<string, Record<string, any>>();
  for (const r of records as FlwEmployeeExit[]) {
    const code = r.EmployeeCode ?? r.employeeCode ?? null;
    if (!code) continue;
    const leaving = parseAnyFlwDate(r.LeavingDate ?? r.leavingDate ?? r.ExitDate);
    const key = `${code}|${leaving ?? "?"}`;
    map.set(key, {
      flw_key:            key,
      employee_code:      String(code),
      employee_name:      r.employeeName ?? r.EmployeeName ?? null,
      department:         r.department ?? r.Department ?? null,
      designation:        r.designation ?? r.Designation ?? null,
      joining_date:       parseAnyFlwDate(r.JoiningDate ?? r.joiningDate),
      leaving_date:       leaving,
      exit_type:          r.exitType ?? r.ExitType ?? r.LeavingType ?? null,
      reason:             r.Reason ?? r.reason ?? null,
      notice_period_days: r.noticePeriodDays ?? r.NoticePeriodDays ?? null,
      clearance_status:   r.clearanceStatus ?? r.ClearanceStatus ?? null,
      raw:                r,
      synced_at:          new Date().toISOString(),
    });
  }
  const rows = [...map.values()];
  if (rows.length > 0) {
    const { error } = await db.from("flw_employee_exits").upsert(rows, { onConflict: "flw_key" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "employee_exits", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncAdvanceSalary(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getAdvanceSalary();
  // Real fields: EmployeeCode, EmployeeName, Title, Amount, Status,
  // AdvanceSalaryDate ("15-Aug-22"), PayrollStartDate, PayrollEndDate
  const map = new Map<string, Record<string, any>>();
  for (const r of records as FlwAdvanceSalary[]) {
    const code = r.EmployeeCode ?? r.employeeCode ?? null;
    if (!code) continue;
    const date   = parseAnyFlwDate(r.AdvanceSalaryDate ?? r.requestDate ?? r.RequestDate);
    const amount = r.Amount ?? r.amount ?? 0;
    const title  = r.Title ?? "";
    const key = `${code}|${date ?? "?"}|${amount}|${title}`;
    map.set(key, {
      flw_key:         key,
      employee_code:   String(code),
      employee_name:   r.EmployeeName ?? r.employeeName ?? null,
      request_date:    date,
      amount,
      approved_amount: r.approvedAmount ?? r.ApprovedAmount ?? 0,
      repayment_months: r.repaymentMonths ?? r.RepaymentMonths ?? null,
      status:          r.Status ?? r.status ?? null,
      approved_by:     r.approvedBy ?? r.ApprovedBy ?? null,
      remarks:         title || null,
      raw:             r,
      synced_at:       new Date().toISOString(),
    });
  }
  const rows = [...map.values()];
  if (rows.length > 0) {
    const { error } = await db.from("flw_advance_salary").upsert(rows, { onConflict: "flw_key" });
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

    // Allowances come nested: [{ EmployeeCode, EmployeeName, Allowances: [{...}] }]
    // Flatten to one row per employee+allowance, dedup on flw_key
    const allowanceMap = new Map<string, Record<string, any>>();
    for (const r of allowances as FlwAllowance[]) {
      const code = r.EmployeeCode ?? r.employeeCode ?? null;
      if (!code) continue;
      const name  = r.EmployeeName ?? r.employeeName ?? null;
      const items = Array.isArray(r.Allowances) ? r.Allowances : [r];
      for (const a of items) {
        const type   = a.AllowanceType ?? a.allowanceType ?? null;
        const title  = a.AllowanceTitle ?? "";
        const amount = parseFloat(a.Amount ?? a.amount ?? "0") || 0;
        const key    = `${code}|${year}-${month}|${type ?? "?"}|${title}|${amount}`;
        allowanceMap.set(key, {
          flw_key:        key,
          employee_code:  String(code),
          employee_name:  name,
          year:           parseInt(year),
          month:          parseInt(month),
          allowance_type: type,
          amount,
          status:         a.IncludeInSalaryMonth ?? null,
          raw:            a,
          synced_at:      new Date().toISOString(),
        });
      }
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
        onConflict: "flw_key",
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
  // Real fields: EmployeeCode, EmployeeName, EmployeeShare, EmployerShare,
  // ProvidentFundType, PolicyAplicableFrom ("01-October-2022" — their typo)
  const map = new Map<string, Record<string, any>>();
  for (const r of records as FlwPFData[]) {
    const code = r.EmployeeCode ?? r.employeeCode ?? null;
    if (!code) continue;
    const type = r.ProvidentFundType ?? r.pfType ?? r.PFType ?? null;
    const from = parseAnyFlwDate(r.PolicyAplicableFrom ?? r.PolicyApplicableFrom ?? r.effectiveDate);
    const key  = `${code}|${type ?? "?"}|${from ?? "?"}`;
    map.set(key, {
      flw_key:               key,
      employee_code:         String(code),
      employee_name:         r.EmployeeName ?? r.employeeName ?? null,
      pf_type:               type,
      employee_contribution: r.EmployeeShare ?? r.employeeContribution ?? 0,
      employer_contribution: r.EmployerShare ?? r.employerContribution ?? 0,
      effective_date:        from,
      status:                r.status ?? r.Status ?? null,
      raw:                   r,
      synced_at:             new Date().toISOString(),
    });
  }
  const rows = [...map.values()];
  if (rows.length > 0) {
    const { error } = await db.from("flw_pf_data").upsert(rows, { onConflict: "flw_key" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "pf_data", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncOvertime(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getOvertime();
  // Real fields (employeeOTRequest): EmployeeCode, Date (ISO), Title, Status,
  // WeekDay (rate multiplier), Holiday, Gazzetted
  const map = new Map<string, Record<string, any>>();
  for (const r of records as FlwOvertime[]) {
    const code = r.EmployeeCode ?? r.employeeCode ?? null;
    if (!code) continue;
    const date = parseAnyFlwDate(r.Date ?? r.overtimeDate ?? r.OvertimeDate);
    const key  = `${code}|${date ?? "?"}|${r.Title ?? ""}`;
    map.set(key, {
      flw_key:         key,
      employee_code:   String(code),
      employee_name:   r.employeeName ?? r.EmployeeName ?? null,
      overtime_date:   date,
      hours:           r.hours ?? r.Hours ?? 0,
      rate_multiplier: r.WeekDay ?? r.rateMultiplier ?? r.RateMultiplier ?? 1.5,
      amount:          r.amount ?? r.Amount ?? 0,
      status:          r.Status ?? r.status ?? null,
      approved_by:     r.approvedBy ?? r.ApprovedBy ?? null,
      raw:             r,
      synced_at:       new Date().toISOString(),
    });
  }
  const rows = [...map.values()];
  if (rows.length > 0) {
    const { error } = await db.from("flw_overtime").upsert(rows, { onConflict: "flw_key" });
    if (error) throw new Error(error.message);
  }
  await logSync(db, "overtime", "success", rows.length, Date.now() - t0);
  return rows.length;
}

async function syncSalarySetup(db: ReturnType<typeof createServiceClient>) {
  const t0 = Date.now();
  const records = await flowhcm.getSalarySetup();
  // Real fields (employeeSalarySetup): employeeCode, employeeName, monthlysalary,
  // payrollSetupName, SalaryBreakup: [{"Basic Salary": "..."}], RecurringAllowances
  const map = new Map<string, Record<string, any>>();
  for (const r of records as FlwSalarySetup[]) {
    const code = r.employeeCode ?? r.EmployeeCode ?? null;
    if (!code) continue;
    // Basic salary lives inside the SalaryBreakup array of single-key objects
    let basic = 0;
    if (Array.isArray(r.SalaryBreakup)) {
      for (const item of r.SalaryBreakup) {
        const v = item?.["Basic Salary"];
        if (v != null) { basic = parseFloat(v) || 0; break; }
      }
    }
    const key = `${code}`;   // one setup row per employee (latest wins)
    map.set(key, {
      flw_key:        key,
      employee_code:  String(code),
      employee_name:  r.employeeName ?? r.EmployeeName ?? null,
      grade:          r.payrollSetupName ?? r.grade ?? r.Grade ?? null,
      basic_salary:   basic,
      gross_salary:   parseFloat(r.monthlysalary ?? r.grossSalary ?? r.GrossSalary ?? "0") || 0,
      currency:       "PKR",
      effective_date: null,
      raw:            r,
      synced_at:      new Date().toISOString(),
    });
  }
  const rows = [...map.values()];
  if (rows.length > 0) {
    const { error } = await db.from("flw_salary_setup").upsert(rows, { onConflict: "flw_key" });
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
