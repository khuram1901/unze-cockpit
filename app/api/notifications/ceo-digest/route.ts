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

type DigestTask = {
  id: string;
  description: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_by: string | null;
  is_overdue: boolean;
};

type DigestEscalation = {
  id: string;
  description: string | null;
  exception_type: string | null;
  due_date: string | null;
};

type DigestMeetingApproval = {
  id: string;
  meeting_title: string | null;
  requested_by_name: string | null;
  requested_date: string | null;
  preferred_time: string | null;
};

type DigestLeaveApproval = {
  id: string;
  member_name: string | null;
  leave_type: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number | null;
};

type DigestPayload = {
  tasks_open: DigestTask[];
  tasks_open_count: number;
  tasks_overdue_count: number;
  escalations: DigestEscalation[];
  meeting_approvals: DigestMeetingApproval[];
  leave_approvals: DigestLeaveApproval[];
  folderit_approval_count: number;
  folderit_company_inbox_count: number;
};

function ukDate(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}

function section(title: string, rows: string[], emptyText?: string): string {
  if (!rows.length) {
    return emptyText
      ? `<p style="font-size:13px;color:#64748b;margin:16px 0 4px"><strong style="color:#1e293b">${title}</strong> — ${emptyText}</p>`
      : "";
  }
  return `
    <p style="font-size:13px;color:#1e293b;font-weight:700;margin:16px 0 4px">${title}</p>
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

    const { data, error } = await supabase.rpc("get_ceo_daily_digest", { p_emails: CEO_EMAILS });
    if (error) {
      console.error("CEO digest RPC error:", error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    const digest = data as DigestPayload;

    // Always send, even on a quiet day with nothing outstanding — a
    // consistent daily email (rather than silently skipping) makes it
    // obvious the digest is actually running.
    const taskRows = digest.tasks_open.slice(0, 10).map(
      (t) =>
        `<li style="${t.is_overdue ? "color:#dc2626;font-weight:600" : ""}">${t.description?.slice(0, 90) ?? "Untitled task"} — ${ukDate(t.due_date)}${t.is_overdue ? " (overdue)" : ""}${t.assigned_by ? ` · from ${t.assigned_by}` : ""}</li>`
    );
    const escalationRows = digest.escalations.slice(0, 10).map(
      (e) => `<li style="color:#d97706;font-weight:600">${e.description?.slice(0, 90) ?? "Escalation"} — ${e.exception_type ?? "Exception"} (due ${ukDate(e.due_date)})</li>`
    );
    const meetingRows = digest.meeting_approvals.slice(0, 10).map(
      (m) => `<li>${m.meeting_title ?? "Meeting request"} — requested by ${m.requested_by_name ?? "someone"}${m.requested_date ? `, ${ukDate(m.requested_date)}` : ""}</li>`
    );
    const leaveRows = digest.leave_approvals.slice(0, 10).map(
      (l) => `<li>${l.member_name ?? "Team member"} — ${l.leave_type ?? "Leave"}, ${ukDate(l.start_date)} to ${ukDate(l.end_date)} (${l.days ?? "?"} day${l.days === 1 ? "" : "s"})</li>`
    );
    const folderitRows: string[] = [];
    if (digest.folderit_approval_count > 0) {
      folderitRows.push(`<li>${digest.folderit_approval_count} document${digest.folderit_approval_count > 1 ? "s" : ""} awaiting your approval in Folderit</li>`);
    }
    if (digest.folderit_company_inbox_count > 0) {
      folderitRows.push(`<li>${digest.folderit_company_inbox_count} document${digest.folderit_company_inbox_count > 1 ? "s" : ""} unfiled across company inboxes</li>`);
    }

    const summaryLine = `${digest.tasks_open_count} open task${digest.tasks_open_count === 1 ? "" : "s"}` +
      (digest.tasks_overdue_count > 0 ? `, ${digest.tasks_overdue_count} overdue` : "") +
      (digest.escalations.length > 0 ? `, ${digest.escalations.length} escalation${digest.escalations.length > 1 ? "s" : ""}` : "") +
      (digest.meeting_approvals.length + digest.leave_approvals.length + digest.folderit_approval_count > 0
        ? `, ${digest.meeting_approvals.length + digest.leave_approvals.length + digest.folderit_approval_count} approval${digest.meeting_approvals.length + digest.leave_approvals.length + digest.folderit_approval_count > 1 ? "s" : ""} waiting on you`
        : "");

    const body = `
      <p>${summaryLine}.</p>
      ${section("Open tasks", taskRows, digest.tasks_open_count > 10 ? undefined : "nothing outstanding")}
      ${digest.tasks_open.length > 10 ? `<p style="font-size:12px;color:#64748b">+ ${digest.tasks_open.length - 10} more — see the dashboard</p>` : ""}
      ${section("Escalations", escalationRows)}
      ${section("Meeting requests awaiting your approval", meetingRows)}
      ${section("Leave requests awaiting your approval", leaveRows)}
      ${section("Folderit", folderitRows)}
    `;

    const subject = digest.tasks_overdue_count > 0 || digest.escalations.length > 0
      ? `[!] Daily summary — ${digest.tasks_overdue_count} overdue, ${digest.escalations.length} escalation${digest.escalations.length === 1 ? "" : "s"}`
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
      meeting_approvals: digest.meeting_approvals.length,
      leave_approvals: digest.leave_approvals.length,
      folderit_approvals: digest.folderit_approval_count,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("CEO digest error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
