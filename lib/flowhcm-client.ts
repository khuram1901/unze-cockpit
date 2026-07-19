/**
 * FlowHCM API Client
 * ─────────────────────────────────────────────────────────────────
 * Base URL  : https://api40.flowhcm.com/api  (FLOWHCM_API_URL)
 * Auth      : Bearer JWT token               (FLOWHCM_TOKEN)
 *
 * To activate: add these two env vars in Vercel dashboard:
 *   FLOWHCM_API_URL = https://api40.flowhcm.com/api
 *   FLOWHCM_TOKEN   = <service account token from FlowHCM support>
 *
 * All endpoints follow the pattern:
 *   POST /Module/FillGrid  → paginated list
 *   GET  /Module/GetXFieldData → dropdown/filter options
 *
 * NOTE: Request body shape is based on observed FlowHCM .NET Web API
 * patterns. Verify field names with FlowHCM's API documentation once
 * the service account token is provided.
 * ─────────────────────────────────────────────────────────────────
 */

const BASE_URL = process.env.FLOWHCM_API_URL ?? "https://api40.flowhcm.com/api";
const TOKEN    = process.env.FLOWHCM_TOKEN ?? "";

// ── Types ──────────────────────────────────────────────────────────────────────

export type FillGridBody = {
  pageNo?:    number;   // 0-based
  pageSize?:  number;
  searchText?: string;
  fromDate?:  string;   // YYYY-MM-DD
  toDate?:    string;
  filters?:   Record<string, string | null>;
};

export type FillGridResponse<T> = {
  data:       T[];
  totalCount: number;
  pageNo:     number;
  pageSize:   number;
};

export type FlwEmployee = {
  employeeCode:  string;
  fullName:      string;
  designation:   string;
  department:    string;
  subDepartment: string;
  station:       string;
  division:      string;
  company:       string;
  status:        string;
  joiningDate:   string | null;
  cnic:          string | null;
  email:         string | null;
  mobile:        string | null;
  grade:         string | null;
  reportsTo:     string | null;
};

export type FlwAttendanceRecord = {
  employeeCode:   string;
  employeeName:   string;
  attendanceDate: string;   // YYYY-MM-DD
  status:         string;   // Present | Absent | Late | HalfDay | EarlyLeave | OFF
  checkIn:        string | null;
  checkOut:       string | null;
  department:     string | null;
  station:        string | null;
};

export type FlwLeaveRequest = {
  id:           string;
  employeeCode: string;
  employeeName: string;
  leaveType:    string;
  fromDate:     string;
  toDate:       string;
  days:         number;
  status:       string;   // Pending | Approved | Rejected
  department:   string | null;
  station:      string | null;
};

export type FlwJobCandidate = {
  id:              string;
  name:            string;
  email:           string | null;
  mobile:          string | null;
  gender:          string | null;
  jobTitle:        string | null;
  jobField:        string | null;
  department:      string | null;
  station:         string | null;
  experience:      string | null;
  pipelineStatus:  string | null;
  resumeExist:     boolean;
  addedOn:         string | null;
};

export type FlwJobRequest = {
  id:            string;
  code:          string;
  jobTitle:      string;
  station:       string | null;
  jobType:       string | null;
  department:    string | null;
  noOfPositions: number;
  salaryRange:   string | null;
  addedOn:       string | null;
  status:        string;
};

export type FlwPayrollRecord = {
  employeeCode:      string;
  employeeName:      string;
  department:        string | null;
  station:           string | null;
  designation:       string | null;
  payMonth:          string;       // YYYY-MM-DD (first of month)
  basicSalary:       number;
  grossSalary:       number;
  netSalary:         number;
  totalDeductions:   number;
  totalAllowances:   number;
  status:            string;       // Processed | Draft | Cancelled
};

export type FlwPerformanceReview = {
  id:              string;
  employeeCode:    string;
  employeeName:    string;
  department:      string | null;
  station:         string | null;
  reviewPeriod:    string | null;  // e.g. "2025-H1"
  reviewType:      string | null;  // Annual | Mid-Year | Probation | Confirmation
  status:          string;         // Pending | Submitted | Approved | Overdue
  rating:          number | null;
  dueDate:         string | null;
  completedDate:   string | null;
  reviewerName:    string | null;
  reviewerCode:    string | null;
  remarks:         string | null;
};

export type FlwTrainingRecord = {
  id:            string;
  employeeCode:  string;
  employeeName:  string;
  department:    string | null;
  trainingTitle: string;
  trainingDate:  string | null;
  trainingType:  string | null;  // Internal | External | Online
  status:        string;         // Attended | Absent | Pending
  score:         number | null;
  trainer:       string | null;
  venue:         string | null;
};

export type FlwDisciplinaryAction = {
  id:              string;
  employeeCode:    string;
  employeeName:    string;
  department:      string | null;
  station:         string | null;
  noticeType:      string;         // Verbal Warning | Written Warning | Show Cause | Suspension | Termination
  issueDate:       string | null;
  responseDueDate: string | null;
  status:          string;         // Open | Closed | Appealed | Pending Response
  description:     string | null;
  issuedBy:        string | null;
};

export type FlwLoan = {
  id:               string;
  employeeCode:     string;
  employeeName:     string;
  department:       string | null;
  loanType:         string;
  principalAmount:  number;
  outstandingAmount: number;
  monthlyDeduction: number;
  startDate:        string | null;
  expectedEndDate:  string | null;
  status:           string;  // Active | Completed | Cancelled
};

// ── Core fetch helper ──────────────────────────────────────────────────────────

function isConfigured(): boolean {
  return Boolean(TOKEN);
}

async function flwPost<T>(
  endpoint: string,
  body: FillGridBody = {}
): Promise<FillGridResponse<T>> {
  if (!isConfigured()) {
    throw new Error("FLOWHCM_TOKEN not set — FlowHCM integration not yet activated.");
  }

  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      pageNo:   0,
      pageSize: 5000,   // pull all records in one shot
      ...body,
    }),
    next: { revalidate: 0 },  // no caching — sync route always wants fresh data
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`FlowHCM ${endpoint} → ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Paginator: pulls all pages if totalCount > pageSize ───────────────────────

async function fetchAll<T>(
  endpoint: string,
  body: FillGridBody = {}
): Promise<T[]> {
  const PAGE = 1000;
  let page   = 0;
  const all: T[] = [];

  while (true) {
    const resp = await flwPost<T>(endpoint, { ...body, pageNo: page, pageSize: PAGE });
    all.push(...resp.data);
    if (all.length >= resp.totalCount || resp.data.length < PAGE) break;
    page++;
  }

  return all;
}

// ── Public API methods ─────────────────────────────────────────────────────────

export const flowhcm = {
  /**
   * Returns true if the FLOWHCM_TOKEN env var is set.
   * Use this to show "connected / not connected" status in UI.
   */
  isConfigured,

  /** Full active employee list */
  async getEmployees(): Promise<FlwEmployee[]> {
    return fetchAll<FlwEmployee>("Employee/FillGrid", {
      filters: { status: "Active" },
    });
  },

  /** Attendance for a date range (default: today) */
  async getAttendance(
    fromDate?: string,
    toDate?:   string
  ): Promise<FlwAttendanceRecord[]> {
    const today = new Date().toISOString().slice(0, 10);
    return fetchAll<FlwAttendanceRecord>("AttendanceRequest/FillGrid", {
      fromDate: fromDate ?? today,
      toDate:   toDate   ?? today,
    });
  },

  /** Leave requests in date range (default: current month) */
  async getLeaveRequests(
    fromDate?: string,
    toDate?:   string
  ): Promise<FlwLeaveRequest[]> {
    const now   = new Date();
    const month = now.toISOString().slice(0, 7);
    return fetchAll<FlwLeaveRequest>("LeaveRequest/FillGrid", {
      fromDate: fromDate ?? `${month}-01`,
      toDate:   toDate   ?? now.toISOString().slice(0, 10),
      filters:  { status: "Approved" },
    });
  },

  /** Job candidates (all pipeline stages) */
  async getCandidates(): Promise<FlwJobCandidate[]> {
    return fetchAll<FlwJobCandidate>("JobCandidate/FillGrid");
  },

  /** Job requests = open positions */
  async getJobRequests(): Promise<FlwJobRequest[]> {
    return fetchAll<FlwJobRequest>("JobRequest/FillGrid");
  },

  /**
   * Monthly payroll records.
   * month: "YYYY-MM" (default: current month)
   * NOTE: Endpoint name needs verification once API token is available.
   */
  async getPayroll(month?: string): Promise<FlwPayrollRecord[]> {
    const now  = new Date();
    const mon  = month ?? now.toISOString().slice(0, 7);
    return fetchAll<FlwPayrollRecord>("PayrollProcessing/FillGrid", {
      fromDate: `${mon}-01`,
      toDate:   new Date(parseInt(mon.slice(0,4)), parseInt(mon.slice(5,7)), 0)
                  .toISOString().slice(0, 10),
    });
  },

  /**
   * Performance / appraisal reviews (all statuses).
   * NOTE: Endpoint name needs verification once API token is available.
   */
  async getPerformanceReviews(): Promise<FlwPerformanceReview[]> {
    return fetchAll<FlwPerformanceReview>("PerformanceReview/FillGrid");
  },

  /**
   * Training attendance records for a date range.
   * Default: current year to today.
   * NOTE: Endpoint name needs verification once API token is available.
   */
  async getTrainingRecords(fromDate?: string, toDate?: string): Promise<FlwTrainingRecord[]> {
    const today = new Date().toISOString().slice(0, 10);
    const yearStart = `${today.slice(0, 4)}-01-01`;
    return fetchAll<FlwTrainingRecord>("TrainingAttendance/FillGrid", {
      fromDate: fromDate ?? yearStart,
      toDate:   toDate   ?? today,
    });
  },

  /**
   * Disciplinary actions (warnings, show-causes, suspensions).
   * NOTE: Endpoint name needs verification once API token is available.
   */
  async getDisciplinary(): Promise<FlwDisciplinaryAction[]> {
    return fetchAll<FlwDisciplinaryAction>("DisciplinaryAction/FillGrid");
  },

  /**
   * Employee loans — all active and historical.
   * NOTE: Endpoint name needs verification once API token is available.
   */
  async getLoans(): Promise<FlwLoan[]> {
    return fetchAll<FlwLoan>("LoanRequest/FillGrid");
  },
};
