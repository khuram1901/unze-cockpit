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
  // Field names as returned by GetEmployeeAttendance — update if API differs
  employeeCode:   string;
  employeeName:   string;
  attendanceDate: string;   // raw string from API (likely MM/DD/YYYY or YYYY-MM-DD)
  inTime:         string | null;
  outTime:        string | null;
  status:         string;   // Present | Absent | Late | HalfDay | Leave | OFF
  department:     string | null;
  designation:    string | null;
  shift:          string | null;
};

export type FlwLeaveRequest = {
  // Field names as returned by GetLeaveRequest — update if API differs
  id:           string;
  employeeCode: string;
  employeeName: string;
  leaveType:    string;
  fromDate:     string;
  toDate:       string;
  days:         number;
  status:       string;   // Approved | Pending | Rejected
  department:   string | null;
  remarks:      string | null;
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

  // API may return a bare array or wrap it: { data: [...] } / { records: [...] }
  if (Array.isArray(json))          return json as T[];
  if (Array.isArray(json?.data))    return json.data as T[];
  if (Array.isArray(json?.records)) return json.records as T[];
  if (Array.isArray(json?.result))  return json.result as T[];

  // Single object — wrap in array
  if (json && typeof json === "object") return [json] as T[];

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
      employeegroup: GROUP,
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
      employeegroup: GROUP,
    });
  },

  // ── Stubs for future endpoints ──────────────────────────────────────────────
  // These will be implemented once FlowHCM provides the remaining API collections.

  async getEmployees():          Promise<FlwEmployee[]>           { return []; },
  async getPayroll(_month?: string): Promise<FlwPayrollRecord[]>   { return []; },
  async getPerformanceReviews(): Promise<FlwPerformanceReview[]>  { return []; },
  async getTrainingRecords():    Promise<FlwTrainingRecord[]>     { return []; },
  async getDisciplinary():       Promise<FlwDisciplinaryAction[]> { return []; },
  async getLoans():              Promise<FlwLoan[]>               { return []; },
  async getCandidates():         Promise<FlwJobCandidate[]>       { return []; },
  async getJobRequests():        Promise<FlwJobRequest[]>         { return []; },
};
