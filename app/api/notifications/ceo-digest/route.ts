import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

// Khuram's two identities in the members table — tasks/approvals can be
// assigned to either, so the digest checks both, but the email itself only
// ever goes to his personal address (see the sendNotificationEmail call
// below), per his explicit instruction.
const CEO_EMAILS = ["k.saleem@unzegroup.com", "khuram1901@gmail.com"];
const CEO_DIGEST_RECIPIENT = "khuram1901@gmail.com";

// ── Types for get_ceo_daily_digest ──────────────────────────────────
type DigestTask = { id: string; description: string | null; priority: string | null; due_date: string | null; assigned_by: string | null; is_overdue: boolean };
type DigestEscalation = { id: string; description: string | null; exception_type: string | null; due_date: string | null };
type DigestMeetingApproval = { id: string; meeting_title: string | null; requested_by_name: string | null; requested_date: string | null; preferred_time: string | null };
type DigestPayload = {
  tasks_open: DigestTask[]; tasks_open_count: number; tasks_overdue_count: number;
  escalations: DigestEscalation[];
  meeting_approvals: DigestMeetingApproval[];
  folderit_approval_count: number; folderit_company_inbox_count: number;
};

// ── Types for get_daily_ops_snapshot ────────────────────────────────
type CashRow = { closing_balance: number; closing_after_post_dated: number; position_date: string } | null;
type OpsSnapshot = {
  utpl_cash: CashRow; ifpl_cash: CashRow;
  overdue_tasks_count: number; overdue_tasks_top5: { description: string | null; assigned_to: string | null; due_date: string | null }[];
  waiting_reply_count: number;
  machines_down_count: number; machines_down: { plant_name: string; machine_name: string }[];
  stuck_bills_count: number; stuck_bills_top5: { utility: string; amount: number }[];
  aging_0_30: number; aging_31_60: number; aging_61_90: number; aging_90_plus: number;
  yesterday_production: number;
};

// ── Types for get_weekly_ops_snapshot ───────────────────────────────
type WeekSnapshot = {
  created_this_week: number; completed_this_week: number; open_total: number; overdue_count: number;
  waiting_reply_count: number; escalations_count: number;
  top_people: { name: string; open: number; overdue: number }[];
  produced_this_week: number; dispatched_this_week: number; machines_down_count: number;
  cash_balance: number | null; week_receipts: number; week_payments: number;
  total_receivables: number; collected_receivables: number;
};

// ── Types for get_monthly_po_snapshot ───────────────────────────────
type MonthSnapshot = {
  total_ordered: number; total_produced: number; total_dispatched: number;
  month_produced: number; month_dispatched: number;
  near_exhausted_count: number;
  near_exhausted_items: { letter_number: string; contractor_name: string | null; customer_name: string }[];
};

// ── Types for get_portfolio_daily_summary (existing RPC) ───────────
type PortfolioStock = { ticker: string; company_name: string; gain_loss: number | null; gain_loss_pct: number | null };
type PortfolioDiv = { ticker: string; dividend_per_share: number; ex_dividend_date: string; days_to_ex: number; estimated_payout?: number };
type PortfolioSummary = {
  totals?: { total_value?: number; total_cost?: number; gain_loss?: number; gain_loss_pct?: number; day_change?: number; day_change_pct?: number; prev_value?: number; stock_count?: number };
  alerts?: PortfolioStock[];
  best?: PortfolioStock | null;
  worst?: PortfolioStock | null;
  dividends?: { confirmed?: PortfolioDiv[]; unconfirmed?: PortfolioDiv[] };
};

type TaxAlertRow = { alert_message: string; tier: number; overdue_count: number };

function ukDate(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}
function fmtNum(n: number | null | undefined): string {
  return Math.round(n ?? 0).toLocaleString();
}
function fmtPKR(n: number | null | undefined): string {
  return "PKR " + fmtNum(n);
}
function fmtRs(n: number | null | undefined): string {
  const v = n ?? 0;
  return `${v < 0 ? "-" : ""}Rs ${Math.abs(Math.round(v)).toLocaleString("en-PK")}`;
}
function fmtPct(n: number | null | undefined): string {
  const v = n ?? 0;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function section(title: string, rows: string[], okText?: string): string {
  if (!rows.length) {
    return okText ? `<p style="font-size:13px;color:#16a34a;margin:16px 0 4px"><strong style="color:#1e293b">${title}</strong> — ${okText}</p>` : "";
  }
  return `
    <p style="font-size:13px;color:#1e293b;font-weight:700;margin:18px 0 4px;border-top:1px solid #e2e8f0;padding-top:12px">${title}</p>
    <ul style="padding-left:18px;margin:0 0 4px;font-size:13px;line-height:1.7;color:#334155">${rows.join("")}</ul>
  `;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + "-01";

    const [
      { data: digestData, error: digestErr },
      { data: opsData, error: opsErr },
      { data: weekData, error: weekErr },
      { data: monthData, error: monthErr },
      { data: portfolioData, error: portfolioErr },
      { data: taxAlerts },
    ] = await Promise.all([
      supabase.rpc("get_ceo_daily_digest", { p_emails: CEO_EMAILS }),
      supabase.rpc("get_daily_ops_snapshot", { p_today: today, p_yesterday: yesterday }),
      supabase.rpc("get_weekly_ops_snapshot", { p_since: weekAgo, p_today: today }),
      supabase.rpc("get_monthly_po_snapshot", { p_month_start: monthStart, p_month_end: today }),
      supabase.rpc("get_portfolio_daily_summary", { p_as_of: today, p_prev_date: yesterday, p_alert_pct: -3, p_div_days: 14 }),
      supabase.from("tax_deadline_alerts").select("alert_message, tier, overdue_count").eq("resolved", false).order("tier"),
    ]);

    const firstError = digestErr || opsErr || weekErr || monthErr || portfolioErr;
    if (firstError) {
      console.error("CEO digest RPC error:", firstError.message);
      return Response.json({ error: firstError.message }, { status: 500 });
    }

    const digest = digestData as DigestPayload;
    const ops = opsData as OpsSnapshot;
    const week = weekData as WeekSnapshot;
    const month = monthData as MonthSnapshot;
    const portfolio = (portfolioData ?? {}) as PortfolioSummary;
    const alerts = (taxAlerts ?? []) as TaxAlertRow[];

    // ── Tasks / escalations / approvals ──
    const taskRows = digest.tasks_open.slice(0, 8).map(
      (t) => `<li style="${t.is_overdue ? "color:#dc2626;font-weight:600" : ""}">${t.description?.slice(0, 90) ?? "Untitled task"} — ${ukDate(t.due_date)}${t.is_overdue ? " (overdue)" : ""}${t.assigned_by ? ` · from ${t.assigned_by}` : ""}</li>`
    );
    const escalationRows = digest.escalations.slice(0, 8).map(
      (e) => `<li style="color:#d97706;font-weight:600">${e.description?.slice(0, 90) ?? "Escalation"} — ${e.exception_type ?? "Exception"} (due ${ukDate(e.due_date)})</li>`
    );
    const meetingRows = digest.meeting_approvals.slice(0, 8).map(
      (m) => `<li>${m.meeting_title ?? "Meeting request"} — requested by ${m.requested_by_name ?? "someone"}${m.requested_date ? `, ${ukDate(m.requested_date)}` : ""}</li>`
    );
    const folderitRows: string[] = [];
    if (digest.folderit_approval_count > 0) folderitRows.push(`<li>${digest.folderit_approval_count} document${digest.folderit_approval_count > 1 ? "s" : ""} awaiting your approval</li>`);
    if (digest.folderit_company_inbox_count > 0) folderitRows.push(`<li>${digest.folderit_company_inbox_count} unfiled across company inboxes</li>`);

    // ── Operations (today) ──
    const opsRows: string[] = [];
    if (ops.utpl_cash || ops.ifpl_cash) {
      const utplNet = ops.utpl_cash ? fmtPKR(ops.utpl_cash.closing_after_post_dated) : "—";
      const ifplNet = ops.ifpl_cash ? fmtPKR(ops.ifpl_cash.closing_after_post_dated) : "—";
      opsRows.push(`<li>Cash — Unze Trading: <strong>${utplNet}</strong> · Imperial Footwear: <strong>${ifplNet}</strong> (net position)</li>`);
    }
    if (ops.overdue_tasks_count > 0) opsRows.push(`<li style="color:#dc2626;font-weight:600">${ops.overdue_tasks_count} overdue task${ops.overdue_tasks_count > 1 ? "s" : ""} company-wide</li>`);
    if (ops.machines_down_count > 0) opsRows.push(`<li style="color:#dc2626;font-weight:600">${ops.machines_down_count} machine${ops.machines_down_count > 1 ? "s" : ""} down: ${ops.machines_down.map((m) => `${m.plant_name} — ${m.machine_name}`).join(", ")}</li>`);
    if (ops.stuck_bills_count > 0) opsRows.push(`<li style="color:#d97706;font-weight:600">${ops.stuck_bills_count} receivable bill${ops.stuck_bills_count > 1 ? "s" : ""} stuck past their stage budget</li>`);
    if (ops.aging_90_plus > 0) opsRows.push(`<li style="color:#991b1b;font-weight:600">${fmtPKR(ops.aging_90_plus)} in receivables aged 90+ days</li>`);
    opsRows.push(`<li>Yesterday's production: <strong>${fmtNum(ops.yesterday_production)} units</strong></li>`);

    // ── This week ──
    const weekRows: string[] = [
      `<li>${week.produced_this_week ? fmtNum(week.produced_this_week) : 0} produced · ${fmtNum(week.dispatched_this_week)} dispatched</li>`,
      `<li>Cash balance: <strong>${fmtPKR(week.cash_balance)}</strong> · net this week: <strong style="color:${week.week_receipts - week.week_payments >= 0 ? "#16a34a" : "#dc2626"}">${fmtPKR(week.week_receipts - week.week_payments)}</strong></li>`,
      `<li>Receivables: ${fmtPKR(week.total_receivables)} (${week.total_receivables > 0 ? Math.round((week.collected_receivables / week.total_receivables) * 100) : 0}% collected)</li>`,
      `<li>Tasks: ${week.created_this_week} created, ${week.completed_this_week} completed, ${week.open_total} open${week.overdue_count > 0 ? `, <span style="color:#dc2626;font-weight:600">${week.overdue_count} overdue</span>` : ""}</li>`,
    ];
    if (week.machines_down_count > 0) weekRows.push(`<li style="color:#dc2626">${week.machines_down_count} machine${week.machines_down_count > 1 ? "s" : ""} currently down</li>`);

    // ── This month (PO / production) ──
    const monthRows: string[] = [];
    const monthFulfilPct = month.total_ordered > 0 ? Math.round((month.total_dispatched / month.total_ordered) * 100) : 0;
    monthRows.push(`<li>Ordered ${fmtNum(month.total_ordered)} · produced ${fmtNum(month.total_produced)} · dispatched ${fmtNum(month.total_dispatched)} (${monthFulfilPct}% fulfilled, all-time cumulative)</li>`);
    monthRows.push(`<li>This month so far: +${fmtNum(month.month_produced)} produced, +${fmtNum(month.month_dispatched)} dispatched</li>`);
    if (month.near_exhausted_count > 0) {
      monthRows.push(`<li style="color:#dc2626;font-weight:600">${month.near_exhausted_count} authority letter${month.near_exhausted_count > 1 ? "s" : ""} nearly exhausted: ${month.near_exhausted_items.map((i) => `#${i.letter_number}${i.contractor_name ? ` (${i.contractor_name})` : ""}`).join(", ")}</li>`);
    }

    // ── Investments ──
    const investRows: string[] = [];
    const totals = portfolio.totals ?? {};
    if (totals.total_value !== undefined) {
      investRows.push(`<li>Portfolio value: <strong>${fmtRs(totals.total_value)}</strong> · gain/loss: <strong style="color:${(totals.gain_loss ?? 0) >= 0 ? "#16a34a" : "#dc2626"}">${fmtRs(totals.gain_loss)} (${fmtPct(totals.gain_loss_pct)})</strong></li>`);
      if (totals.prev_value) {
        investRows.push(`<li>Day change: <strong style="color:${(totals.day_change ?? 0) >= 0 ? "#16a34a" : "#dc2626"}">${fmtRs(totals.day_change)} (${fmtPct(totals.day_change_pct)})</strong></li>`);
      }
    }
    const invAlerts = portfolio.alerts ?? [];
    if (invAlerts.length > 0) investRows.push(`<li style="color:#dc2626;font-weight:600">${invAlerts.length} stock${invAlerts.length > 1 ? "s" : ""} below -3%: ${invAlerts.map((s) => s.ticker).join(", ")}</li>`);
    const confirmedDivs = portfolio.dividends?.confirmed ?? [];
    if (confirmedDivs.length > 0) investRows.push(`<li>${confirmedDivs.length} dividend${confirmedDivs.length > 1 ? "s" : ""} in the next 14 days: ${confirmedDivs.map((d) => `${d.ticker} (${ukDate(d.ex_dividend_date)})`).join(", ")}</li>`);

    // ── Tax ──
    const taxRows = alerts.slice(0, 5).map((a) => `<li style="color:${a.tier === 2 ? "#dc2626" : "#d97706"};font-weight:600">${a.alert_message}</li>`);

    // ── Assemble ──
    const approvalTotal = digest.meeting_approvals.length + digest.folderit_approval_count;
    const summaryLine = `${digest.tasks_open_count} open task${digest.tasks_open_count === 1 ? "" : "s"}` +
      (digest.tasks_overdue_count > 0 ? `, ${digest.tasks_overdue_count} overdue` : "") +
      (digest.escalations.length > 0 ? `, ${digest.escalations.length} escalation${digest.escalations.length > 1 ? "s" : ""}` : "") +
      (approvalTotal > 0 ? `, ${approvalTotal} approval${approvalTotal > 1 ? "s" : ""} waiting on you` : "") +
      (ops.machines_down_count > 0 ? `, ${ops.machines_down_count} machine${ops.machines_down_count > 1 ? "s" : ""} down` : "") +
      (alerts.length > 0 ? `, ${alerts.length} tax alert${alerts.length > 1 ? "s" : ""}` : "");

    const body = `
      <p>${summaryLine}.</p>
      ${section("Open tasks", taskRows, digest.tasks_open_count > 8 ? undefined : "nothing outstanding")}
      ${digest.tasks_open.length > 8 ? `<p style="font-size:12px;color:#64748b">+ ${digest.tasks_open.length - 8} more — see the dashboard</p>` : ""}
      ${section("Escalations", escalationRows)}
      ${section("Meeting requests awaiting your approval", meetingRows)}
      ${section("Folderit", folderitRows)}
      ${section("Operations — today", opsRows)}
      ${section("This week", weekRows)}
      ${section("This month — production &amp; dispatch", monthRows)}
      ${section("Investments", investRows)}
      ${section("Tax deadlines", taxRows)}
    `;

    const urgentCount = digest.tasks_overdue_count + digest.escalations.length + ops.machines_down_count + alerts.filter((a) => a.tier === 2).length;
    const subject = urgentCount > 0
      ? `[!] Daily summary — ${urgentCount} need attention`
      : `Daily summary — ${digest.tasks_open_count} open, all on track`;

    await sendNotificationEmail({
      to: CEO_DIGEST_RECIPIENT,
      subject,
      heading: "Your daily summary",
      body,
      linkUrl: `${APP_URL}/home`,
      linkLabel: "Open Dashboard",
      triggerType: "ceo_daily_digest",
      recipientName: "Khuram",
    });

    return Response.json({
      ok: true,
      tasks_open: digest.tasks_open_count,
      tasks_overdue: digest.tasks_overdue_count,
      escalations: digest.escalations.length,
      approvals: approvalTotal,
      machines_down: ops.machines_down_count,
      tax_alerts: alerts.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("CEO digest error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
