import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

const UTPL = "15884c2d-48a4-4d43-be90-0ef6e130790c";
const IFPL = "77921705-8a15-4406-847a-b234f84b5ec3";
const RECIPIENTS = ["k.saleem@unzegroup.com", "khuram1901@gmail.com", "pa.ceo@unze.co.uk"];

function fmtPKR(n: number) { return "PKR " + Math.round(n).toLocaleString(); }
function fmtDate(d: string) { const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; }

function calendarDaysSince(dateStr: string): number {
  const start = new Date(dateStr + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [utplCash, ifplCash, overdueTasks, waitingTasks, machinesDown, stagesRes, billsRes, prodRes] = await Promise.all([
    supabase.from("daily_cash_position").select("closing_balance, closing_after_post_dated, position_date").eq("company_id", UTPL).order("position_date", { ascending: false }).limit(1),
    supabase.from("daily_cash_position").select("closing_balance, closing_after_post_dated, position_date").eq("company_id", IFPL).order("position_date", { ascending: false }).limit(1),
    supabase.from("tasks").select("description, assigned_to, due_date").in("status", ["Not Started", "In Progress", "Waiting Reply"]).lt("due_date", today).order("due_date").limit(5),
    supabase.from("tasks").select("id").eq("status", "Waiting Reply"),
    supabase.from("machine_issues").select("plant_name, machine_name").eq("issue_status", "Down"),
    supabase.from("receivable_stages").select("*").order("stage_order"),
    supabase.from("receivables").select("*").neq("status", "Collected"),
    supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").eq("entry_date", yesterday),
  ]);

  const utpl = utplCash.data?.[0];
  const ifpl = ifplCash.data?.[0];
  const overdue = overdueTasks.data || [];
  const waiting = waitingTasks.data || [];
  const machines = machinesDown.data || [];
  const stages = stagesRes.data || [];
  const bills = billsRes.data || [];
  const prod = prodRes.data || [];

  const yesterdayProd = prod.reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);

  // Stuck bills
  const stuckBills = bills.filter((b) => {
    const stage = stages.find((s: { stage_order: number }) => s.stage_order === b.current_stage_order);
    if (!stage) return false;
    let count = 0;
    const start = new Date(b.current_stage_entered_date + "T00:00:00");
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const cur = new Date(start);
    while (cur <= now) { const d = cur.getDay(); if (d !== 0 && d !== 6) count++; cur.setDate(cur.getDate() + 1); }
    return Math.max(0, count - 1) >= (stage as { working_day_budget: number }).working_day_budget;
  });

  // Bill aging
  const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const b of bills) {
    const days = calendarDaysSince(b.date_submitted);
    const amt = Number(b.amount) || 0;
    if (days <= 30) aging["0-30"] += amt;
    else if (days <= 60) aging["31-60"] += amt;
    else if (days <= 90) aging["61-90"] += amt;
    else aging["90+"] += amt;
  }

  const g = (v: string) => `<span style="color:#16a34a;font-weight:700">${v}</span>`;
  const r = (v: string) => `<span style="color:#dc2626;font-weight:700">${v}</span>`;
  const a = (v: string) => `<span style="color:#d97706;font-weight:700">${v}</span>`;

  let html = `<h2 style="color:#1e293b;margin:0 0 16px">Daily Report — ${fmtDate(today)}</h2>`;

  // Cash Position
  html += `<h3 style="color:#1e293b;border-bottom:2px solid #1e293b;padding-bottom:4px">Cash Position</h3>`;
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tr style="background:#f8fafc"><th style="text-align:left;padding:6px 10px;font-size:14px;color:#64748b">Company</th><th style="text-align:right;padding:6px 10px;font-size:14px;color:#64748b">Closing</th><th style="text-align:right;padding:6px 10px;font-size:14px;color:#64748b">Net Position</th><th style="text-align:right;padding:6px 10px;font-size:14px;color:#64748b">As of</th></tr>
    <tr><td style="padding:6px 10px;font-weight:700;color:#1e293b">Unze Trading</td><td style="padding:6px 10px;text-align:right">${utpl ? fmtPKR(utpl.closing_balance) : "—"}</td><td style="padding:6px 10px;text-align:right;font-weight:700;color:${utpl && utpl.closing_after_post_dated >= 0 ? "#16a34a" : "#dc2626"}">${utpl ? fmtPKR(utpl.closing_after_post_dated) : "—"}</td><td style="padding:6px 10px;text-align:right;color:#64748b">${utpl ? fmtDate(utpl.position_date) : "—"}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:700;color:#1e293b">Imperial Footwear</td><td style="padding:6px 10px;text-align:right">${ifpl ? fmtPKR(ifpl.closing_balance) : "—"}</td><td style="padding:6px 10px;text-align:right;font-weight:700;color:${ifpl && ifpl.closing_after_post_dated >= 0 ? "#16a34a" : "#dc2626"}">${ifpl ? fmtPKR(ifpl.closing_after_post_dated) : "—"}</td><td style="padding:6px 10px;text-align:right;color:#64748b">${ifpl ? fmtDate(ifpl.position_date) : "—"}</td></tr>
  </table>`;

  // Overdue Tasks
  html += `<h3 style="color:#1e293b;border-bottom:2px solid #1e293b;padding-bottom:4px">Overdue Tasks (${overdue.length})</h3>`;
  if (overdue.length === 0) {
    html += `<p style="color:#16a34a;font-weight:700">No overdue tasks</p>`;
  } else {
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">`;
    for (const t of overdue) {
      html += `<tr><td style="padding:4px 10px;color:#1e293b">${t.description}</td><td style="padding:4px 10px;color:#64748b">${t.assigned_to || "Unassigned"}</td><td style="padding:4px 10px;color:#dc2626;font-weight:700">${t.due_date ? fmtDate(t.due_date) : "—"}</td></tr>`;
    }
    html += `</table>`;
  }

  // Machines Down
  html += `<h3 style="color:#1e293b;border-bottom:2px solid #1e293b;padding-bottom:4px">Machines Down (${machines.length})</h3>`;
  if (machines.length === 0) {
    html += `<p style="color:#16a34a;font-weight:700">All machines operational</p>`;
  } else {
    for (const m of machines) {
      html += `<p style="color:#dc2626;font-weight:600;margin:4px 0">${m.plant_name} — ${m.machine_name}</p>`;
    }
  }

  // Stuck Bills
  html += `<h3 style="color:#1e293b;border-bottom:2px solid #1e293b;padding-bottom:4px">Stuck Receivable Bills (${stuckBills.length})</h3>`;
  if (stuckBills.length === 0) {
    html += `<p style="color:#16a34a;font-weight:700">No stuck bills</p>`;
  } else {
    for (const b of stuckBills.slice(0, 5)) {
      html += `<p style="margin:4px 0">${r(b.utility)} — ${fmtPKR(b.amount)}</p>`;
    }
  }

  // Bill Aging
  html += `<h3 style="color:#1e293b;border-bottom:2px solid #1e293b;padding-bottom:4px">Bill Aging</h3>`;
  html += `<p style="margin:4px 0">${g(fmtPKR(aging["0-30"]))} (0-30d) · ${a(fmtPKR(aging["31-60"]))} (31-60d) · ${r(fmtPKR(aging["61-90"]))} (61-90d) · <span style="color:#991b1b;font-weight:700">${fmtPKR(aging["90+"])}</span> (90+d)</p>`;

  // Waiting Reply + Production
  html += `<h3 style="color:#1e293b;border-bottom:2px solid #1e293b;padding-bottom:4px">Other</h3>`;
  html += `<p style="margin:4px 0">Tasks waiting reply: <strong>${waiting.length}</strong></p>`;
  html += `<p style="margin:4px 0">Yesterday's production: <strong>${yesterdayProd.toLocaleString()} units</strong></p>`;

  // Send to all recipients
  let sent = 0;
  for (const recipient of RECIPIENTS) {
    try {
      await sendNotificationEmail({
        to: recipient,
        subject: `Daily Report — ${fmtDate(today)}`,
        heading: "Daily Report",
        body: html,
        linkUrl: "https://pulse.unze.co.uk/home",
        linkLabel: "Open Dashboard",
        triggerType: "daily_report",
        recipientName: recipient,
      });
      sent++;
    } catch (e) {
      console.error(`Failed to send daily report to ${recipient}:`, e);
    }
  }

  return Response.json({ ok: true, sent, date: today });
}
