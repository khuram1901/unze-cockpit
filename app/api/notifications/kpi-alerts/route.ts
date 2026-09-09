/**
 * /api/notifications/kpi-alerts
 *
 * Daily cron that checks cash and breakage KPI conditions and sends
 * WhatsApp notifications to the relevant person. No tasks are created —
 * these are alerts only. Escalation logic:
 *
 * Cash Receivables / Cash Payouts:
 *   UTPL (Unze Trading):     Day 0-2 → Sania Saleem  |  Day 3+ → Khuram
 *   IFPL / Baranh / HD:      Day 0-2 → Shahida       |  Day 3-5 → Shakeel  |  Day 6+ → Kamran
 *
 * Breakage (plant-level):
 *   All plants:              Day 0-2 → Nadeem Khan   |  Day 3+ → Khuram
 *
 * Escalation is measured from first_alerted_at in kpi_alert_log.
 * When a condition resolves, its log entry is marked resolved so it can
 * re-fire in a future period.
 *
 * Vercel cron: every weekday at 05:00 UTC (10:00 PKT).
 * Manual: GET with Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendWhatsAppPush } from "../../../lib/whatsapp-push";

// ── Company IDs ────────────────────────────────────────────────────────────
const UTPL_ID = "15884c2d-48a4-4d43-be90-0ef6e130790c";
const IFPL_ID = "77921705-8a15-4406-847a-b234f84b5ec3";
const BRNH_ID = "6401ba75-f297-4617-84c1-305bcaf35a50";
const HD_ID   = "16a92b7f-b3fa-4271-819b-c6befb534f12";

const IFPL_GROUP = new Set([IFPL_ID, BRNH_ID, HD_ID]);

// ── Escalation chains (emails; phone looked up from members table) ──────────
// UTPL cash: Sania → Khuram
const UTPL_CHAIN = ["sania.saleem", "k.saleem@unzegroup.com"];

// Imperial Footwear cash: Shahida → Shakeel → Kamran
const IFPL_CHAIN = ["shahida.naseem", "m.shakeel", "kamran@unze.co.uk"];

// Baranh / Haute Dolci cash: Shakeel → Kamran (skip Shahida)
const BRNH_HD_CHAIN = ["m.shakeel", "kamran@unze.co.uk"];

// Breakage: Nadeem → Khuram
const BREAKAGE_CHAIN = ["nadeem.khan@unze.co.uk", "k.saleem@unzegroup.com"];

// Days before moving to next escalation level
const ESCALATION_DAYS = 3;

// Breakage threshold (matches app/lib/kpiThresholds.ts BREAKAGE_RED_OVER)
const BREAKAGE_RED_OVER = 1.5;

// Cash thresholds (matches home/page.tsx)
const RECV_THRESHOLD = 85;   // below this % = alert
const PAY_THRESHOLD  = 115;  // above this % = alert

// ── Helpers ────────────────────────────────────────────────────────────────

function pktToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value || "00";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.floor((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86400000);
}

function fmt(iso: string | null) {
  if (!iso) return "no date";
  return iso.split("-").reverse().join("/");
}

// ── Member phone lookup ────────────────────────────────────────────────────
// For known emails, looks up phone_e164. For partial name keys (like "sania.saleem")
// it searches by name pattern. Returns null if no phone found.
async function getPhone(
  supabase: ReturnType<typeof createServiceClient>,
  emailOrKey: string
): Promise<{ phone: string | null; name: string }> {
  // Full email → direct lookup
  if (emailOrKey.includes("@")) {
    const { data } = await supabase
      .from("members")
      .select("first_name, last_name, name, phone_e164")
      .eq("email", emailOrKey)
      .maybeSingle();
    const name = data
      ? `${data.first_name || ""} ${data.last_name || ""}`.trim() || data.name || emailOrKey
      : emailOrKey;
    return { phone: data?.phone_e164 || null, name };
  }

  // Partial key: first.last pattern → search by first + last name
  const [first, last] = emailOrKey.split(".");
  const { data } = await supabase
    .from("members")
    .select("first_name, last_name, name, phone_e164")
    .ilike("first_name", `${first}%`)
    .ilike("last_name", `${last}%`)
    .not("phone_e164", "is", null)
    .limit(1)
    .maybeSingle();
  const name = data
    ? `${data.first_name || ""} ${data.last_name || ""}`.trim() || data.name || emailOrKey
    : emailOrKey;
  return { phone: data?.phone_e164 || null, name };
}

// ── Alert log helpers ──────────────────────────────────────────────────────

async function getOrCreateAlert(
  supabase: ReturnType<typeof createServiceClient>,
  sourceLabel: string,
  companyId: string | null,
  metric: string,
  detail: string
): Promise<{ id: string; escalation_level: number; first_alerted_at: string; is_new: boolean }> {
  // Try to find existing unresolved alert
  const { data: existing } = await supabase
    .from("kpi_alert_log")
    .select("id, escalation_level, first_alerted_at")
    .eq("source_label", sourceLabel)
    .eq("resolved", false)
    .maybeSingle();

  if (existing) return { ...existing, is_new: false };

  // Create new alert
  const { data: created } = await supabase
    .from("kpi_alert_log")
    .insert({ source_label: sourceLabel, company_id: companyId, metric, detail })
    .select("id, escalation_level, first_alerted_at")
    .single();

  return { ...created!, is_new: true };
}

async function updateAlert(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  escalation_level: number
) {
  await supabase
    .from("kpi_alert_log")
    .update({ last_alerted_at: new Date().toISOString(), escalation_level })
    .eq("id", id);
}

async function resolveAlert(
  supabase: ReturnType<typeof createServiceClient>,
  sourceLabel: string
) {
  await supabase
    .from("kpi_alert_log")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("source_label", sourceLabel)
    .eq("resolved", false);
}

// ── Send WhatsApp to the right person based on escalation level ────────────
async function notifyChain(
  supabase: ReturnType<typeof createServiceClient>,
  chain: string[],
  escalationLevel: number,
  message: string
): Promise<{ sent: boolean; to: string }> {
  const idx = Math.min(escalationLevel, chain.length - 1);
  const key = chain[idx];
  const { phone, name } = await getPhone(supabase, key);
  if (!phone) return { sent: false, to: key };
  const result = await sendWhatsAppPush(phone, message);
  return { sent: result.ok, to: name };
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = pktToday();
  const [year, month] = today.split("-");
  const planMonth = `${year}-${month}`;
  const nowDate = new Date();
  const dim = new Date(Number(year), Number(month), 0).getDate(); // days in month
  const de = nowDate.getDate(); // day elapsed

  const results: object[] = [];

  // ── Cash checks (per company) ─────────────────────────────────────────────
  const cashCompanies = [
    { id: UTPL_ID, name: "Unze Trading",    chain: UTPL_CHAIN },
    { id: IFPL_ID, name: "Imperial Footwear", chain: IFPL_CHAIN    },
    { id: BRNH_ID, name: "Baranh",           chain: BRNH_HD_CHAIN },
    { id: HD_ID,   name: "Haute Dolci",      chain: BRNH_HD_CHAIN },
  ];

  // Collect all currently-active source labels so we can resolve stale ones
  const activeLabels = new Set<string>();

  for (const co of cashCompanies) {
    // Fetch plan
    const { data: plan } = await supabase
      .from("monthly_cash_plan")
      .select("tentative_receivables, tentative_payouts")
      .eq("company_id", co.id)
      .eq("plan_month", planMonth)
      .maybeSingle();

    if (!plan) continue; // no plan → nothing to compare against

    // Fetch MTD cash positions
    const monthStart = `${planMonth}-01`;
    const { data: positions } = await supabase
      .from("daily_cash_position")
      .select("total_receipts, total_payments")
      .eq("company_id", co.id)
      .gte("position_date", monthStart)
      .lte("position_date", today);

    const recMTD = (positions || []).reduce((s, p) => s + (p.total_receipts || 0), 0);
    const payMTD = (positions || []).reduce((s, p) => s + (p.total_payments || 0), 0);

    const expRecv = plan.tentative_receivables > 0 ? (plan.tentative_receivables / dim) * de : 0;
    const expPay  = plan.tentative_payouts     > 0 ? (plan.tentative_payouts     / dim) * de : 0;
    const recvPct = expRecv > 0 ? (recMTD / expRecv) * 100 : 100;
    const payPct  = expPay  > 0 ? (payMTD / expPay)  * 100 : 100;

    const fmtM = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

    // ── Receivables alert ──
    const recvLabel = `kpi_escalation:cash_receivables:${planMonth}:${co.id}`;
    if (recvPct < RECV_THRESHOLD) {
      activeLabels.add(recvLabel);
      const detail = `${co.name}: Receivables pacing at ${Math.round(recvPct)}% — actual ${fmtM(recMTD)} vs expected ${fmtM(Math.round(expRecv))} by day ${de} of ${dim}.`;
      const alert = await getOrCreateAlert(supabase, recvLabel, co.id, "cash_receivables", detail);
      const daysOld = daysBetween(alert.first_alerted_at, today);
      const newLevel = Math.min(Math.floor(daysOld / ESCALATION_DAYS), co.chain.length - 1);

      const msg = [
        `🔴 *Cash Receivables Alert — ${co.name}*`,
        ``,
        `Receivables pacing at *${Math.round(recvPct)}%* of expected.`,
        `• Actual MTD:   ${fmtM(recMTD)}`,
        `• Expected by day ${de}: ${fmtM(Math.round(expRecv))}`,
        `• Plan (full month): ${fmtM(plan.tentative_receivables)}`,
        ``,
        daysOld > 0 ? `This has been below ${RECV_THRESHOLD}% for ${daysOld} day${daysOld !== 1 ? "s" : ""}.` : `First detected today (${fmt(today)}).`,
        ``,
        `Please review and advise.`,
        `https://unze-cockpit.vercel.app/`,
      ].join("\n");

      const r = await notifyChain(supabase, co.chain, newLevel, msg);
      await updateAlert(supabase, alert.id, newLevel);
      results.push({ metric: "cash_receivables", company: co.name, pct: Math.round(recvPct), daysOld, level: newLevel, ...r });
    } else {
      await resolveAlert(supabase, recvLabel);
    }

    // ── Payouts alert ──
    const payLabel = `kpi_escalation:cash_payouts:${planMonth}:${co.id}`;
    if (payPct > PAY_THRESHOLD) {
      activeLabels.add(payLabel);
      const detail = `${co.name}: Payouts pacing at ${Math.round(payPct)}% — actual ${fmtM(payMTD)} vs expected ${fmtM(Math.round(expPay))} by day ${de} of ${dim}.`;
      const alert = await getOrCreateAlert(supabase, payLabel, co.id, "cash_payouts", detail);
      const daysOld = daysBetween(alert.first_alerted_at, today);
      const newLevel = Math.min(Math.floor(daysOld / ESCALATION_DAYS), co.chain.length - 1);

      const msg = [
        `🔴 *Cash Payouts Alert — ${co.name}*`,
        ``,
        `Payouts pacing at *${Math.round(payPct)}%* of expected.`,
        `• Actual MTD:   ${fmtM(payMTD)}`,
        `• Expected by day ${de}: ${fmtM(Math.round(expPay))}`,
        `• Plan (full month): ${fmtM(plan.tentative_payouts)}`,
        ``,
        daysOld > 0 ? `This has been above ${PAY_THRESHOLD}% for ${daysOld} day${daysOld !== 1 ? "s" : ""}.` : `First detected today (${fmt(today)}).`,
        ``,
        `Please review and advise.`,
        `https://unze-cockpit.vercel.app/`,
      ].join("\n");

      const r = await notifyChain(supabase, co.chain, newLevel, msg);
      await updateAlert(supabase, alert.id, newLevel);
      results.push({ metric: "cash_payouts", company: co.name, pct: Math.round(payPct), daysOld, level: newLevel, ...r });
    } else {
      await resolveAlert(supabase, payLabel);
    }
  }

  // ── Breakage check (all plants) ───────────────────────────────────────────
  // Uses the same MTD produced/broken data the home page uses.
  const monthStart = `${planMonth}-01`;

  const { data: plants } = await supabase
    .from("plants")
    .select("id, name");

  const { data: prodRows } = await supabase
    .from("monthly_production")
    .select("plant_id, qty_31, qty_36, qty_45, qty_meter")
    .gte("entry_date", monthStart)
    .lte("entry_date", today);

  const { data: brknRows } = await supabase
    .from("monthly_breakage")
    .select("plant_id, qty_31, qty_36, qty_45, qty_meter")
    .gte("entry_date", monthStart)
    .lte("entry_date", today);

  for (const plant of (plants || [])) {
    const produced = (prodRows || [])
      .filter(r => r.plant_id === plant.id)
      .reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);

    const broken = (brknRows || [])
      .filter(r => r.plant_id === plant.id)
      .reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);

    if (produced === 0) continue;
    const rate = (broken / produced) * 100;

    const breakageLabel = `kpi_escalation:breakage:${plant.id}:${planMonth}`;
    if (rate > BREAKAGE_RED_OVER) {
      activeLabels.add(breakageLabel);
      const detail = `${plant.name}: Breakage rate ${rate.toFixed(2)}% (${broken} broken of ${produced} produced) exceeds ${BREAKAGE_RED_OVER}% limit.`;
      const alert = await getOrCreateAlert(supabase, breakageLabel, null, "breakage", detail);
      const daysOld = daysBetween(alert.first_alerted_at, today);
      const newLevel = Math.min(Math.floor(daysOld / ESCALATION_DAYS), BREAKAGE_CHAIN.length - 1);

      const msg = [
        `🔴 *Breakage Alert — ${plant.name}*`,
        ``,
        `Breakage rate at *${rate.toFixed(2)}%* (limit: ${BREAKAGE_RED_OVER}%).`,
        `• Broken: ${broken.toLocaleString()} units`,
        `• Produced: ${produced.toLocaleString()} units`,
        `• Period: ${fmt(monthStart)} – ${fmt(today)}`,
        ``,
        daysOld > 0 ? `This has been above limit for ${daysOld} day${daysOld !== 1 ? "s" : ""}.` : `First detected today (${fmt(today)}).`,
        ``,
        `Please investigate and advise.`,
        `https://unze-cockpit.vercel.app/`,
      ].join("\n");

      const r = await notifyChain(supabase, BREAKAGE_CHAIN, newLevel, msg);
      await updateAlert(supabase, alert.id, newLevel);
      results.push({ metric: "breakage", plant: plant.name, rate: rate.toFixed(2), daysOld, level: newLevel, ...r });
    } else {
      await resolveAlert(supabase, breakageLabel);
    }
  }

  return Response.json({ ok: true, date: today, checks: results });
}
