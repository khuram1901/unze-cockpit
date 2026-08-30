/**
 * FlowHCM Integration API Client
 * ─────────────────────────────────────────────────────────────────
 * Base URL : https://api40.flowhcm.com/api  (FLOWHCM_API_URL)
 *
 * Auth flow (per Postman collection):
 *   1. POST /IntegrationSettings/IntegrationLogin
 *      body: { email, password, Token }
 *      → returns a session token string
 *   2. All subsequent calls send that session token as the `token` header,
 *      and ALSO include email + password in the request body.
 *
 * Environment variables required (add in Vercel → Settings → Env Vars):
 *   FLOWHCM_API_URL      = https://api40.flowhcm.com/api
 *   FLOWHCM_EMAIL        = integration@unze.com
 *   FLOWHCM_PASSWORD     = <password>
 *   FLOWHCM_LOGIN_TOKEN  = <static Token key used during login>
 *   FLOWHCM_GROUP        = Head Group  (optional — filters by employee group)
 *
 * NOTE: All endpoints confirmed from Postman collection provided by FlowHCM.
 *       Field names in response types are best-guess until real responses
 *       are seen — update mappings in sync/route.ts if field names differ.
 * ─────────────────────────────────────────────────────────────────
 */

const BASE_URL     = (process.env.FLOWHCM_API_URL ?? "https://api40.flowhcm.com/api").replace(/\/$/, "");
const EMAIL        = process.env.FLOWHCM_EMAIL        ?? "";
const PASSWORD     = process.env.FLOWHCM_PASSWORD     ?? "";
const LOGIN_TOKEN  = process.env.FLOWHCM_LOGIN_TOKEN  ?? "";
const GROUP        = process.env.FLOWHCM_GROUP        ?? "";   // e.g. "Head Group" — leave blank for all

// ── Types ──────────────────────────────────────────────────────────────────────

export type FlwAttendanceRecord = {
  // Confirmed field names from live API response (GetEmployeeAttendance)
  EmployeeRefNo:    number;
  ShiftCode:        string | null;
  ActualInDate:     string | null;   // YYYY-MM-DD
  ActualOutDate:    string | null;   // YYYY-MM-DD
  ActualInTime:     string | null;   // HH:MM:SS
  ActualOutTime:    string | null;   // HH:MM:SS
  ScheduleInDate:   string | null;
  ScheduleOutDate:  string | null;
  GazzettedHoliday: string | null;   // "Yes" | "No"
  Station:          string | null;
  SignIn:           string | null;   // "YYYY-MM-DD HH:MM:SS"
  SignOut:          string | null;
  TimeZone:         string | null;
  StationCode:      string | null;
};

export type FlwLeaveRequest = {
  // Confirmed field names from live API response (GetLeaveRequest)
  EmployeeCode: string;
  FromDate:     string;   // "DD-Month-YYYY" e.g. "29-June-2026"
  ToDate:       string;
  LeaveDays:    number;
  LeaveType:    string;
  Status:       string;   // Approved | Rejected
};

// Placeholder types for future endpoints (recruitment, payroll, etc.)
// These will be updated when FlowHCM provides those API collections.
export type FlwEmployee          = Record<string, any>;
export type FlwPayrollRecord     = Record<string, any>;
export type FlwPerformanceReview = Record<string, any>;
export type FlwTrainingRecord    = Record<string, any>;
export type FlwDisciplinaryAction = Record<string, any>;
export type FlwLoan              = Record<string, any>;
export type FlwJobCandidate      = Record<string, any>;
export type FlwJobRequest        = Record<string, any>;

// New types from extended Postman collection
export type FlwTransfer         = Record<string, any>;
export type FlwExemption        = Record<string, any>;
export type FlwEmployeeExit     = Record<string, any>;
export type FlwAdvanceSalary    = Record<string, any>;
export type FlwAllowance        = Record<string, any>;
export type FlwDeduction        = Record<string, any>;
export type FlwPFData           = Record<string, any>;
export type FlwOvertime         = Record<string, any>;
export type FlwSalarySetup      = Record<string, any>;
export type FlwTaxAdjustment    = Record<string, any>;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert YYYY-MM-DD → MM/DD/YYYY (FlowHCM's expected date format) */
function toFlwDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** Returns true if all required env vars are set */
function isConfigured(): boolean {
  return Boolean(EMAIL && PASSWORD && LOGIN_TOKEN);
}

// ── Auth: login to get session token ──────────────────────────────────────────

/**
 * Calls IntegrationLogin and returns a session token string.
 * Called fresh at the start of each sync run — no caching needed since
 * syncs are infrequent (every 2 hours).
 */
async function login(): Promise<string> {
  if (!isConfigured()) {
    throw new Error(
      "FlowHCM not configured. Add FLOWHCM_EMAIL, FLOWHCM_PASSWORD, and FLOWHCM_LOGIN_TOKEN to Vercel env vars."
    );
  }

  const res = await fetch(`${BASE_URL}/IntegrationSettings/IntegrationLogin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email:    EMAIL,
      password: PASSWORD,
      Token:    LOGIN_TOKEN,
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`FlowHCM login failed (${res.status}): ${text}`);
  }

  const json = await res.json();

  // FlowHCM returns: { informations: [{ myToken: "..." }] }
  // Fallback to other common shapes just in case
  const token: string =
    typeof json === "string"
      ? json
      : (json?.informations?.[0]?.myToken
          ?? json?.token
          ?? json?.Token
          ?? json?.accessToken
          ?? json?.data
          ?? "");

  if (!token) {
    throw new Error(`FlowHCM login succeeded but no token in response: ${JSON.stringify(json)}`);
  }

  return token;
}

// ── Core POST helper ───────────────────────────────────────────────────────────

async function flwPost<T>(
  sessionToken: string,
  endpoint: string,
  body: Record<string, string>
): Promise<T[]> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "token":        sessionToken,
    },
    body: JSON.stringify({
      email:    EMAIL,
      password: PASSWORD,
      ...body,
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`FlowHCM ${endpoint} → ${res.status}: ${text}`);
  }

  const json = await res.json();

  // Attendance: { "APIResponeData": [[{...}]] }  (their typo: "Respone" not "Response")
  if (Array.isArray(json?.APIResponeData)) {
    const inner = json.APIResponeData[0];
    if (Array.isArray(inner)) return inner as T[];
  }

  // Leave: { "employeeLeaveRequest": [[{...}]] }
  if (Array.isArray(json?.employeeLeaveRequest)) {
    const inner = json.employeeLeaveRequest[0];
    if (Array.isArray(inner)) return inner as T[];
  }

  // Employee list: { "employeesGetRequest": [[{...}]] }
  if (Array.isArray(json?.employeesGetRequest)) {
    const inner = json.employeesGetRequest[0];
    if (Array.isArray(inner)) return inner as T[];
  }

  // Generic unwrap: FlowHCM wraps every response in a single named key,
  // e.g. { employeeLeavingGet: [[{...}]] }, { employeeSalarySetup: [{...}] },
  // { employeeOTRequest: [[{...}]] }, { attendanceExemptionGet: [[{...}]] },
  // { employeeTransferGet: [[{...}]] }, { employeeAllowances: [{...}] }.
  // Handle any object with exactly one array-valued property, flattening
  // one level of double-nesting ([[...]]) if present.
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const arrayValues = Object.values(json).filter(Array.isArray);
    if (arrayValues.length === 1) {
      const arr = arrayValues[0] as unknown[];
      if (arr.length > 0 && Array.isArray(arr[0])) {
        // Double-nested [[{...}]] — flatten one level
        return (arr as unknown[][]).flat() as T[];
      }
      return arr as T[];
    }
  }

  // Fallback shapes
  if (Array.isArray(json))          return json as T[];
  if (Array.isArray(json?.data))    return json.data as T[];
  if (Array.isArray(json?.records)) return json.records as T[];
  if (Array.isArray(json?.result))  return json.result as T[];

  // Do NOT wrap unknown objects in an array — that inserted junk rows.
  return [];
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const flowhcm = {
  isConfigured,

  /**
   * Fetch attendance records for a date range.
   * startDate / endDate: YYYY-MM-DD (we convert to MM/DD/YYYY for FlowHCM).
   * employeeCode: leave blank to fetch ALL employees.
   */
  async getAttendance(
    startDate: string,
    endDate:   string,
    employeeCode = ""
  ): Promise<FlwAttendanceRecord[]> {
    const token = await login();
    return flwPost<FlwAttendanceRecord>(token, "IntegrationSettings/GetEmployeeAttendance", {
      employeecode:  employeeCode,
      startdate:     toFlwDate(startDate),
      enddate:       toFlwDate(endDate),
      employeegroup: "",   // "Head Group" returns empty — fetch all employees
    });
  },

  /**
   * Fetch leave requests for a date range.
   * startDate / endDate: YYYY-MM-DD (we convert to MM/DD/YYYY for FlowHCM).
   * employeeCode: leave blank to fetch ALL employees.
   */
  async getLeaveRequests(
    startDate: string,
    endDate:   string,
    employeeCode = ""
  ): Promise<FlwLeaveRequest[]> {
    const token = await login();
    return flwPost<FlwLeaveRequest>(token, "IntegrationSettings/GetLeaveRequest", {
      employeecode:  employeeCode,
      startdate:     toFlwDate(startDate),
      enddate:       toFlwDate(endDate),
      employeegroup: "",   // fetch all employees
    });
  },

  // ── Implemented endpoints from Postman collection ───────────────────────────

  /** GetEmployeeList — full employee roster */
  async getEmployees(): Promise<FlwEmployee[]> {
    const token = await login();
    return flwPost<FlwEmployee>(token, "IntegrationSettings/GetEmployeeList", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /** GetEmployeeLoan — loan records per employee */
  async getLoans(): Promise<FlwLoan[]> {
    const token = await login();
    return flwPost<FlwLoan>(token, "IntegrationSettings/GetEmployeeLoan", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /** GetEmployeeTransfer — inter-department / inter-company transfers */
  async getTransfers(): Promise<FlwTransfer[]> {
    const token = await login();
    return flwPost<FlwTransfer>(token, "IntegrationSettings/GetEmployeeTransfer", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /** GetAttendanceExemptionAPI — attendance exemption/waiver requests */
  async getExemptions(): Promise<FlwExemption[]> {
    const token = await login();
    return flwPost<FlwExemption>(token, "IntegrationSettings/GetAttendanceExemptionAPI", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /** GetEmployeeLeaving — leavers / exits / offboarding records */
  async getEmployeeExits(): Promise<FlwEmployeeExit[]> {
    const token = await login();
    return flwPost<FlwEmployeeExit>(token, "IntegrationSettings/GetEmployeeLeaving", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /** GetEmployeeAdvanceSalary — salary advance requests */
  async getAdvanceSalary(): Promise<FlwAdvanceSalary[]> {
    const token = await login();
    return flwPost<FlwAdvanceSalary>(token, "IntegrationSettings/GetEmployeeAdvanceSalary", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /**
   * GetAllowanceRequestData — allowance requests for a given month.
   * year: four-digit string e.g. "2026"; month: two-digit string e.g. "08"
   */
  async getAllowances(year: string, month: string): Promise<FlwAllowance[]> {
    const token = await login();
    return flwPost<FlwAllowance>(token, "IntegrationSettings/GetAllowanceRequestData", {
      employeecode:  "",
      employeegroup: "",
      Year:          year,
      Month:         month,
    });
  },

  /**
   * GetEmployeeDeductionData — salary deductions for a given month.
   * year: four-digit string e.g. "2026"; month: two-digit string e.g. "08"
   */
  async getDeductions(year: string, month: string): Promise<FlwDeduction[]> {
    const token = await login();
    return flwPost<FlwDeduction>(token, "IntegrationSettings/GetEmployeeDeductionData", {
      employeecode:  "",
      employeegroup: "",
      Year:          year,
      Month:         month,
    });
  },

  /** GetEmployeePFData — provident fund / pension fund records */
  async getPFData(): Promise<FlwPFData[]> {
    const token = await login();
    return flwPost<FlwPFData>(token, "IntegrationSettings/GetEmployeePFData", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /** GetEmployeeOvertimeRequest — overtime requests */
  async getOvertime(): Promise<FlwOvertime[]> {
    const token = await login();
    return flwPost<FlwOvertime>(token, "IntegrationSettings/GetEmployeeOvertimeRequest", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /** GetEmployeeSalarySetup — salary structure / grading setup */
  async getSalarySetup(): Promise<FlwSalarySetup[]> {
    const token = await login();
    return flwPost<FlwSalarySetup>(token, "IntegrationSettings/GetEmployeeSalarySetup", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  /** GetTaxAdjustmentRequest — tax adjustment entries */
  async getTaxAdjustments(): Promise<FlwTaxAdjustment[]> {
    const token = await login();
    return flwPost<FlwTaxAdjustment>(token, "IntegrationSettings/GetTaxAdjustmentRequest", {
      employeecode:  "",
      employeegroup: "",
    });
  },

  // ── Stubs — no confirmed FlowHCM endpoint yet ───────────────────────────────

  async getPayroll(_month?: string): Promise<FlwPayrollRecord[]>   { return []; },
  async getPerformanceReviews(): Promise<FlwPerformanceReview[]>   { return []; },
  async getTrainingRecords():    Promise<FlwTrainingRecord[]>      { return []; },
  async getDisciplinary():       Promise<FlwDisciplinaryAction[]>  { return []; },
  async getCandidates():         Promise<FlwJobCandidate[]>        { return []; },
  async getJobRequests():        Promise<FlwJobRequest[]>          { return []; },
};
