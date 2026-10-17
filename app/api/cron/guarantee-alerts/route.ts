import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

// Daily guarantee expiry digest — Vercel cron 09:00 PKT (vercel.json "0 4 * * *").
// Per Khuram 17/10/2026: Shakeel gets the digest whenever anything is overdue
// or due within 30 days; Khuram is copied only once something is overdue by
// more than 15 days. All decisions (lists, counts, escalation flag) come from
// get_guarantee_alert_digest() — nothing is filtered or summed here.

const FINANCE_RECIPIENT = { email: "shakeel@unze.co.uk", name: "Muhammad Shakeel" };
const CEO_RECIPIENT     = { email: "k.saleem@unzegroup.com", name: "Khuram Saleem" };
const PAGE_URL          = "https://pulse.unze.co.uk/finance/guarantees";

type AlertRow = {
  customer_name: string; guarantee_number: string; bank_name: string;
  guarantee_type: string; amount: number; due_date: string | null;
  days_overdue?: number; days_left?: number;
};
type Digest = {
  overdue_count: number; due_soon_count: number;
  overdue: AlertRow[]; due_soon: AlertRow[];
  max_days_overdue: number; escalate_to_ceo: boolean; has_alerts: boolean;
};

const ukDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const pkr = (n: number) => "PKR " + Math.round(Number(n) || 0).toLocaleString("en-PK");

function table(rows: AlertRow[], lastCol: "days_overdue" | "days_left", lastLabel: string, colour: string) {
  const tr = rows.map((r) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #EEF0F3"><strong>${r.customer_name}</strong><br><span style="color:#64748B;font-size:12px">${r.guarantee_number} · ${r.bank_name} · ${r.guarantee_type}</span></td>
      <td style="padding:6px 8px;border-bottom:1px solid #EEF0F3;text-align:right;white-space:nowrap">${pkr(r.amount)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #EEF0F3;white-space:nowrap">${ukDate(r.due_date)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #EEF0F3;text-align:right;color:${colour};font-weight:700">${r[lastCol] ?? ""}</td>
    </tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 16px">
    <thead><tr style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:.04em">
      <th style="text-align:left;padding:4px 8px">Guarantee</th><th style="text-align:right;padding:4px 8px">Amount</th>
      <th style="text-align:left;padding:4px 8px">Due</th><th style="text-align:right;padding:4px 8px">${lastLabel}</th>
    </tr></thead><tbody>${tr}</tbody></table>`;
}

function buildBody(d: Digest, escalated: boolean) {
  let html = "";
  if (escalated) {
    html += `<p style="color:#B3261E;font-weight:700">Escalated: the oldest overdue guarantee is ${d.max_days_overdue} days past its due date.</p>`;
  }
  if (d.overdue.length) html += `<h3 style="color:#B3261E;margin:12px 0 4px">Overdue (${d.overdue_count})</h3>` + table(d.overdue, "days_overdue", "Days overdue", "#B3261E");
  if (d.due_soon.length) html += `<h3 style="color:#B4791F;margin:12px 0 4px">Due within 30 days (${d.due_soon_count})</h3>` + table(d.due_soon, "days_left", "Days left", "#B4791F");
  return html;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_guarantee_alert_digest");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const digest = data as Digest;
  if (!digest?.has_alerts) return Response.json({ sent: false, reason: "no alerts" });

  const today = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Karachi" });
  const subject = `Bank guarantees — ${digest.overdue_count} overdue, ${digest.due_soon_count} due soon (${today})`;
  const recipients = digest.escalate_to_ceo ? [FINANCE_RECIPIENT, CEO_RECIPIENT] : [FINANCE_RECIPIENT];

  const results = [];
  for (const r of recipients) {
    const res = await sendNotificationEmail({
      to: r.email,
      recipientName: r.name,
      subject,
      heading: "Bank guarantees needing action",
      body: buildBody(digest, digest.escalate_to_ceo && r.email === CEO_RECIPIENT.email),
      linkUrl: PAGE_URL,
      linkLabel: "Open Bank Facilities",
      triggerType: "guarantee_expiry_alert",
    });
    results.push({ to: r.email, ...res });
  }

  return Response.json({
    sent: true,
    overdue: digest.overdue_count,
    due_soon: digest.due_soon_count,
    escalated: digest.escalate_to_ceo,
    results,
  });
}
