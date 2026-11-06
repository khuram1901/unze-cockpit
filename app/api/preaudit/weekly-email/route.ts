// Cron endpoint: POST /api/preaudit/weekly-email
// Called weekly (Friday or Monday) to send Shahid a team pre-audit status email.
// Secured by CRON_SECRET header.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";
import { formatDateUK } from "../../../lib/dateUtils";

const SHAHID_EMAIL = "shahid@unze.co.uk";
const SHAHID_NAME  = "Shahid Masaud";

function prevMonday(): string {
  const d = new Date();
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

function statusBadge(is_complete: boolean, is_late: boolean): string {
  if (is_complete && is_late) return '<span style="color:#B4791F;font-weight:600;">Done (late)</span>';
  if (is_complete)             return '<span style="color:#0F7B5F;font-weight:600;">Done</span>';
  return '<span style="color:#B3261E;font-weight:600;">Overdue</span>';
}

export async function GET(request: NextRequest) {
  // Verify cron secret (matches existing cron pattern: Authorization: Bearer <CRON_SECRET>)
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Week start = last Monday
  const weekStart = prevMonday();

  const sb = createServiceClient();
  const { data: rows, error } = await sb.rpc("get_preaudit_weekly_email_data", {
    p_week_start: weekStart,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ sent: false, reason: "No data for week" });
  }

  // Group by member → company → day
  const members = Array.from(new Set(rows.map((r: { member_name: string }) => r.member_name))).sort() as string[];
  const days    = Array.from(new Set(rows.map((r: { task_date: string }) => r.task_date))).sort() as string[];

  const totalRows = rows.length;
  const doneCount = rows.filter((r: { is_complete: boolean }) => r.is_complete).length;
  const overdueCount = rows.filter((r: { is_complete: boolean; task_date: string }) => !r.is_complete).length;
  const pct = totalRows > 0 ? Math.round((doneCount / totalRows) * 100) : 100;

  // Build HTML table
  const colCount = members.length;

  let tableRows = "";
  for (const day of days) {
    const cells = members.map(mName => {
      const memberRows = rows.filter((r: { member_name: string; task_date: string }) => r.member_name === mName && r.task_date === day);
      if (!memberRows.length) return "<td style='padding:6px 10px;text-align:center;'>—</td>";
      const badges = memberRows.map((r: { company_name: string; is_complete: boolean; is_late: boolean }) =>
        `<div style="margin-bottom:2px;font-size:11px;">${r.company_name}: ${statusBadge(r.is_complete, r.is_late)}</div>`
      ).join("");
      return `<td style="padding:6px 10px;vertical-align:top;">${badges}</td>`;
    }).join("");
    tableRows += `<tr><td style="padding:6px 10px;white-space:nowrap;font-weight:500;">${formatDateUK(day)}</td>${cells}</tr>`;
  }

  const memberHeaders = members.map(m => `<th style="padding:8px 10px;text-align:left;">${m.split(" ")[0]}</th>`).join("");

  const bodyHtml = `
<div style="font-family:Arial,sans-serif;font-size:13px;color:#0F1720;">
  <p>Pre-audit trail summary for the week of <strong>${formatDateUK(weekStart)}</strong>.</p>

  <table style="border-collapse:collapse;margin-bottom:16px;">
    <tr>
      <td style="padding:8px 16px;background:#F8FAFC;border:1px solid #EEF0F3;text-align:center;">
        <div style="font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">Done</div>
        <div style="font-size:22px;font-weight:700;color:#0F7B5F;">${doneCount}/${totalRows}</div>
      </td>
      <td style="padding:8px 16px;background:#F8FAFC;border:1px solid #EEF0F3;text-align:center;">
        <div style="font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">Overdue</div>
        <div style="font-size:22px;font-weight:700;color:${overdueCount > 0 ? "#B3261E" : "#0F7B5F"};">${overdueCount}</div>
      </td>
      <td style="padding:8px 16px;background:#F8FAFC;border:1px solid #EEF0F3;text-align:center;">
        <div style="font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">Compliance</div>
        <div style="font-size:22px;font-weight:700;color:${pct >= 95 ? "#0F7B5F" : pct >= 80 ? "#B4791F" : "#B3261E"};">${pct}%</div>
      </td>
    </tr>
  </table>

  <table style="border-collapse:collapse;font-size:12px;">
    <thead>
      <tr style="border-bottom:2px solid #EEF0F3;">
        <th style="padding:8px 10px;text-align:left;">Date</th>
        ${memberHeaders}
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <p style="margin-top:16px;font-size:11px;color:#64748B;">
    View full details: <a href="https://pulse.unze.co.uk/department/audit" style="color:#0F7B5F;">pulse.unze.co.uk/department/audit</a>
  </p>
</div>`;

  const result = await sendNotificationEmail({
    to:              SHAHID_EMAIL,
    subject:         `Pre-Audit Weekly — w/c ${formatDateUK(weekStart)} — ${pct}% compliance`,
    heading:         "Pre-Audit Trail — Weekly Status",
    body:            bodyHtml,
    linkUrl:         "https://pulse.unze.co.uk/department/audit",
    linkLabel:       "View Pre-Audit Tab",
    triggerType:     "preaudit_weekly",
    recipientName:   SHAHID_NAME,
  });

  return NextResponse.json({ sent: true, weekStart, doneCount, overdueCount, pct, result });
}
