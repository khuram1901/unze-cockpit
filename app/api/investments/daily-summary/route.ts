import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://pulse.unze.co.uk";
const ALERT_PCT = -3;       // red-flag threshold
const DIV_DAYS = 14;        // dividend look-ahead window
const SUMMARY_EMAIL = "khuram1901@gmail.com";

// Vercel Cron: runs at 05:00 UTC Mon–Fri (10:00 PKT) after the 04:30 price update.
// Also callable manually with the cron secret for testing.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // ── 1. Compute summary via DB RPC ────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const { data: summary, error } = await supabase.rpc("get_portfolio_daily_summary", {
    p_as_of:     today,
    p_prev_date: yesterday,
    p_alert_pct: ALERT_PCT,
    p_div_days:  DIV_DAYS,
  });

  if (error) {
    console.error("daily-summary RPC error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  // ── 2. Write portfolio snapshots (one row per ticker) ────────────────────
  const stocks: SummaryStock[] = summary?.stocks ?? [];
  if (stocks.length > 0) {
    const rows = stocks.map((s) => ({
      snapshot_date: today,
      ticker:        s.ticker,
      total_qty:     s.total_qty,
      total_cost:    s.total_cost,
      current_price: s.current_price,
      current_value: s.current_value,
      gain_loss:     s.gain_loss,
      gain_loss_pct: s.gain_loss_pct,
    }));
    const { error: snapErr } = await supabase
      .from("portfolio_snapshots")
      .upsert(rows, { onConflict: "snapshot_date,ticker" });
    if (snapErr) console.error("snapshot upsert error:", snapErr.message);
  }

  // ── 3. Send morning email ────────────────────────────────────────────────
  const totals: SummaryTotals = summary?.totals ?? {};
  const alerts: SummaryStock[] = summary?.alerts ?? [];
  const best: SummaryStock | null   = summary?.best ?? null;
  const worst: SummaryStock | null  = summary?.worst ?? null;
  const confirmedDivs: DivEntry[]   = summary?.dividends?.confirmed ?? [];
  const unconfirmedDivs: DivEntry[] = summary?.dividends?.unconfirmed ?? [];

  const emailBody = buildEmailBody({ totals, alerts, best, worst, confirmedDivs, unconfirmedDivs, today });

  await sendNotificationEmail({
    to:              SUMMARY_EMAIL,
    subject:         `Portfolio Update — ${formatDatePKT(today)}`,
    heading:         `Daily Investment Summary`,
    body:            emailBody,
    linkUrl:         `${APP_URL}/investments`,
    linkLabel:       "View Portfolio",
    triggerType:     "investment_daily_summary",
    triggerRecordId: today,
    recipientName:   "Khuram",
  });

  return Response.json({
    ok:       true,
    date:     today,
    stocks:   stocks.length,
    alerts:   alerts.length,
    divs_confirmed:   confirmedDivs.length,
    divs_unconfirmed: unconfirmedDivs.length,
  });
}

// ── Types ────────────────────────────────────────────────────────────────────

type SummaryTotals = {
  total_cost?:      number;
  total_value?:     number;
  gain_loss?:       number;
  gain_loss_pct?:   number;
  prev_value?:      number;
  day_change?:      number;
  day_change_pct?:  number;
  stock_count?:     number;
};

type SummaryStock = {
  ticker:        string;
  company_name:  string;
  total_qty:     number;
  total_cost:    number;
  current_price: number | null;
  current_value: number | null;
  gain_loss:     number | null;
  gain_loss_pct: number | null;
  price_date:    string | null;
};

type DivEntry = {
  ticker:            string;
  dividend_per_share: number;
  ex_dividend_date:  string;
  payment_date?:     string | null;
  days_to_ex:        number;
  estimated_payout?: number;
  source?:           string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtRs(n: number): string {
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}Rs ${abs.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatDatePKT(iso: string): string {
  return iso.split("-").reverse().join("/");
}

function buildEmailBody({
  totals, alerts, best, worst, confirmedDivs, unconfirmedDivs, today,
}: {
  totals: SummaryTotals;
  alerts: SummaryStock[];
  best: SummaryStock | null;
  worst: SummaryStock | null;
  confirmedDivs: DivEntry[];
  unconfirmedDivs: DivEntry[];
  today: string;
}): string {
  const lines: string[] = [];

  // Portfolio totals
  lines.push(`<b>Portfolio as of ${formatDatePKT(today)}</b><br>`);
  lines.push(`Current Value: <b>${fmtRs(totals.total_value ?? 0)}</b><br>`);
  lines.push(`Total Invested: ${fmtRs(totals.total_cost ?? 0)}<br>`);
  lines.push(`Overall Gain/Loss: <b style="color:${(totals.gain_loss ?? 0) >= 0 ? "#16a34a" : "#dc2626"}">${fmtRs(totals.gain_loss ?? 0)} (${fmtPct(totals.gain_loss_pct ?? 0)})</b><br>`);

  // Day change
  if (totals.prev_value && totals.prev_value > 0) {
    const dc = totals.day_change ?? 0;
    lines.push(`Day Change: <b style="color:${dc >= 0 ? "#16a34a" : "#dc2626"}">${fmtRs(dc)} (${fmtPct(totals.day_change_pct ?? 0)})</b><br>`);
  }
  lines.push("<br>");

  // Best / worst
  if (best) {
    lines.push(`Best performer: <b>${best.ticker}</b> — ${fmtPct(best.gain_loss_pct ?? 0)} (${fmtRs(best.gain_loss ?? 0)})<br>`);
  }
  if (worst) {
    lines.push(`Worst performer: <b>${worst.ticker}</b> — ${fmtPct(worst.gain_loss_pct ?? 0)} (${fmtRs(worst.gain_loss ?? 0)})<br>`);
  }
  if (best || worst) lines.push("<br>");

  // Alerts
  if (alerts.length > 0) {
    lines.push(`<b style="color:#dc2626">⚠ ${alerts.length} stock${alerts.length > 1 ? "s" : ""} below ${ALERT_PCT}% threshold</b><br>`);
    for (const s of alerts) {
      lines.push(`&nbsp;&nbsp;• <b>${s.ticker}</b> (${s.company_name}) — ${fmtPct(s.gain_loss_pct ?? 0)} | ${fmtRs(s.gain_loss ?? 0)}<br>`);
    }
    lines.push("<br>");
  }

  // Confirmed dividends
  if (confirmedDivs.length > 0) {
    lines.push(`<b style="color:#d97706">Upcoming Dividends (next 14 days)</b><br>`);
    for (const d of confirmedDivs) {
      const payoutStr = d.estimated_payout && d.estimated_payout > 0
        ? ` — Est. payout: ${fmtRs(d.estimated_payout)}`
        : "";
      lines.push(`&nbsp;&nbsp;• <b>${d.ticker}</b>: Rs ${d.dividend_per_share}/share | Ex-date: ${formatDatePKT(d.ex_dividend_date)} (${d.days_to_ex}d)${payoutStr}<br>`);
    }
    lines.push("<br>");
  }

  // Unconfirmed dividends
  if (unconfirmedDivs.length > 0) {
    lines.push(`<b style="color:#92400e">Unconfirmed Dividends — please verify</b><br>`);
    for (const d of unconfirmedDivs) {
      lines.push(`&nbsp;&nbsp;• <b>${d.ticker}</b>: Rs ${d.dividend_per_share}/share | Ex-date: ${formatDatePKT(d.ex_dividend_date)} | Source: ${d.source}<br>`);
    }
    lines.push(`<i>These are auto-fetched and unverified. Review on the investments page before acting.</i><br>`);
    lines.push("<br>");
  }

  lines.push(`<i>${totals.stock_count ?? 0} stocks tracked.</i>`);

  return lines.join("");
}
