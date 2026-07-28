/**
 * GET /api/flowhcm/test
 * ─────────────────────────────────────────────────────────────────
 * Debug endpoint — shows env var status and tests the FlowHCM login.
 * Remove or restrict this once the integration is confirmed working.
 * ─────────────────────────────────────────────────────────────────
 */

import { NextResponse } from "next/server";

export async function GET() {
  const EMAIL       = process.env.FLOWHCM_EMAIL        ?? "";
  const PASSWORD    = process.env.FLOWHCM_PASSWORD     ?? "";
  const LOGIN_TOKEN = process.env.FLOWHCM_LOGIN_TOKEN  ?? "";
  const BASE_URL    = (process.env.FLOWHCM_API_URL ?? "https://api40.flowhcm.com/api").replace(/\/$/, "");
  const GROUP       = process.env.FLOWHCM_GROUP ?? "(not set)";

  // Show which vars are present (mask values for security)
  const envStatus = {
    FLOWHCM_API_URL:     process.env.FLOWHCM_API_URL    ? `✓ set (${BASE_URL})` : "✗ missing (using default)",
    FLOWHCM_EMAIL:       EMAIL       ? `✓ set (${EMAIL})` : "✗ missing",
    FLOWHCM_PASSWORD:    PASSWORD    ? `✓ set (${PASSWORD.slice(0, 4)}****)` : "✗ missing",
    FLOWHCM_LOGIN_TOKEN: LOGIN_TOKEN ? `✓ set (${LOGIN_TOKEN.slice(0, 4)}****)` : "✗ missing",
    FLOWHCM_GROUP:       GROUP,
  };

  const configured = Boolean(EMAIL && PASSWORD && LOGIN_TOKEN);

  if (!configured) {
    return NextResponse.json({
      configured: false,
      env: envStatus,
      message: "Env vars are missing — add them in Vercel and redeploy.",
    });
  }

  // Try to login
  let loginResult: unknown = null;
  let loginError:  string | null = null;
  let sessionToken: string | null = null;

  try {
    const loginRes = await fetch(`${BASE_URL}/IntegrationSettings/IntegrationLogin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, Token: LOGIN_TOKEN }),
      cache: "no-store",
    });

    const raw = await loginRes.text();
    loginResult = { status: loginRes.status, body: raw };

    if (loginRes.ok) {
      const json = JSON.parse(raw);
      sessionToken =
        typeof json === "string"
          ? json
          : (json?.informations?.[0]?.myToken
              ?? json?.token
              ?? json?.Token
              ?? json?.accessToken
              ?? json?.data
              ?? null);
    } else {
      loginError = `HTTP ${loginRes.status}: ${raw}`;
    }
  } catch (e) {
    loginError = e instanceof Error ? e.message : String(e);
  }

  // If login worked, try fetching 1 day of attendance for a single employee
  let attendanceResult: unknown = null;
  let attendanceError: string | null = null;

  if (sessionToken) {
    const today = new Date();
    const month = new Date(Date.now() - 30 * 86400_000);
    const fmt   = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

    // Test 1: Attendance — no group filter, last 30 days
    try {
      const r = await fetch(`${BASE_URL}/IntegrationSettings/GetEmployeeAttendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "token": sessionToken },
        body: JSON.stringify({
          email: EMAIL, password: PASSWORD,
          employeecode:  "",
          startdate:     fmt(month),
          enddate:       fmt(today),
          employeegroup: "",           // no filter
        }),
        cache: "no-store",
      });
      attendanceResult = { endpoint: "GetEmployeeAttendance (no group, 30 days)", status: r.status, body: (await r.text()).slice(0, 2000) };
    } catch (e) { attendanceError = String(e); }

    // Test 2: Leave — no group filter, last 30 days
    let leaveResult: unknown = null;
    let leaveError: string | null = null;
    try {
      const r = await fetch(`${BASE_URL}/IntegrationSettings/GetLeaveRequest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "token": sessionToken },
        body: JSON.stringify({
          email: EMAIL, password: PASSWORD,
          employeecode:  "",
          startdate:     fmt(month),
          enddate:       fmt(today),
          employeegroup: "",
        }),
        cache: "no-store",
      });
      leaveResult = { endpoint: "GetLeaveRequest (no group, 30 days)", status: r.status, body: (await r.text()).slice(0, 2000) };
    } catch (e) { leaveError = String(e); }

    attendanceResult = { attendance: attendanceResult, leave: leaveResult, leaveError };
  }

  return NextResponse.json({
    configured: true,
    env: envStatus,
    login: {
      success: Boolean(sessionToken),
      token_preview: sessionToken ? `${sessionToken.slice(0, 20)}...` : null,
      raw: loginResult,
      error: loginError,
    },
    attendance_test: sessionToken
      ? { result: attendanceResult, error: attendanceError }
      : "Skipped (login failed)",
  });
}
