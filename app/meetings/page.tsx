"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { useRequireCapability } from "../lib/useRouteGuard";
import {
  COLOURS,
  RADII,
  cardStyle,
  SectionTitle,
  PageHeader,
  PriorityBadge,
  StatusBadge,
  CountCard,
  primaryButtonStyle,
  labelStyle,
  inputStyle,
  useConfirm,
  TASK_DESCRIPTION_LIMIT,
  TASK_COMPANY_CODES,
} from "../lib/SharedUI";

type ExtractedMinutes = {
  meeting_title: string;
  meeting_date: string;
  company: string;
  department: string;
  attendees: string[];
  executive_summary: string;
  decisions: string[];
  risks: string[];
  opportunities: string[];
  action_items: {
    description: string;
    owner_name: string;
    due_date?: string;
    priority: string;
    department?: string;
    company_id?: string;
  }[];
};

type Meeting = {
  id: string;
  meeting_date: string;
  title: string;
  executive_summary: string | null;
  decisions: string[] | null;
  risks: string[] | null;
  opportunities: string[] | null;
  attendees: string[] | null;
  department: string | null;
  company: string | null;
  created_at: string;
};

type PendingMinute = {
  id: string;
  gmail_message_id: string;
  subject: string | null;
  from_address: string | null;
  email_date: string | null;
  raw_text: string;
  status: string;
  created_at: string;
};

type MeetingTask = {
  id: string;
  description: string;
  assigned_to: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  meeting_id: string | null;
};

const DEPT_ACCENT: Record<string, string> = {
  "Finance": COLOURS.GREEN,
  "HR": COLOURS.AMBER,
  "Admin": COLOURS.SLATE,
  "Audit": COLOURS.RED,
  "Taxation": COLOURS.RED,
  "IT": COLOURS.BLUE,
  "Unze Trading Ops": COLOURS.BLUE,
  "Executive Office": COLOURS.NAVY,
};
function deptAccent(dept: string) { return DEPT_ACCENT[dept] || COLOURS.SLATE; }

function taskDotColour(status: string) {
  if (status === "Completed") return COLOURS.GREEN;
  if (status === "In Progress") return COLOURS.RED;
  return COLOURS.AMBER;
}

function MeetingCard({
  m, mTasks, completedTasks, openTaskCount, isOpen, setExpandedId, downloadMinutesPDF, isMobile,
}: {
  m: Meeting;
  mTasks: MeetingTask[];
  completedTasks: number;
  openTaskCount: number;
  isOpen: boolean;
  setExpandedId: (id: string | null) => void;
  downloadMinutesPDF: (m: Meeting, tasks: MeetingTask[]) => void;
  isMobile: boolean;
  showDept: boolean;
}) {
  const pct = mTasks.length ? Math.round((completedTasks / mTasks.length) * 100) : 0;
  const barColour = pct === 100 ? COLOURS.GREEN : pct > 0 ? COLOURS.AMBER : COLOURS.BORDER;

  return (
    <div style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD }}>
      {/* Compact meeting row */}
      <div onClick={() => setExpandedId(isOpen ? null : m.id)} style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "8px 14px", cursor: "pointer",
        backgroundColor: isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
      }}>
        <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px" }}>{formatDateUK(m.meeting_date)}</span>
        <span style={{ flex: 1, fontSize: "12px", fontWeight: 500, color: COLOURS.NAVY, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</span>
        {m.company && (
          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>{m.company}</span>
        )}
        {mTasks.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <div style={{ width: "48px", height: "4px", backgroundColor: COLOURS.TRACK, borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, backgroundColor: barColour, borderRadius: "2px", transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: "11px", color: COLOURS.SLATE, minWidth: "28px", textAlign: "right" }}>{completedTasks}/{mTasks.length}</span>
          </div>
        ) : (
          <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>no tasks</span>
        )}
        <span style={{ fontSize: "10px", color: COLOURS.SLATE, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
      </div>

      {/* Expanded meeting panel */}
      {isOpen && (
        <div style={{ borderTop: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD_ALT }}>
          {/* Summary + meta strip */}
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: m.executive_summary ? "8px" : "0" }}>
              {m.attendees && m.attendees.length > 0 && (
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", flex: 1 }}>
                  {m.attendees.map((a, i) => (
                    <span key={i} style={{ fontSize: "11px", padding: "2px 8px", backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.PILL, color: COLOURS.SLATE }}>{a}</span>
                  ))}
                </div>
              )}
              <button onClick={() => downloadMinutesPDF(m, mTasks)} style={{ ...primaryButtonStyle, padding: "4px 10px", fontSize: "11px", flexShrink: 0 }}>PDF</button>
            </div>
            {m.executive_summary && (
              <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.6 }}>{m.executive_summary}</div>
            )}
          </div>

          {/* Decisions / Risks / Opps — compact inline lists */}
          {((m.decisions?.length ?? 0) > 0 || (m.risks?.length ?? 0) > 0 || (m.opportunities?.length ?? 0) > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "0", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
              {m.decisions && m.decisions.length > 0 && (
                <div style={{ borderRight: isMobile ? "none" : `1px solid ${COLOURS.BORDER}`, padding: "10px 14px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.GREEN, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "6px" }}>Decisions ({m.decisions.length})</div>
                  {m.decisions.map((d, i) => (
                    <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                      <span style={{ color: COLOURS.GREEN, flexShrink: 0 }}>•</span>{d}
                    </div>
                  ))}
                </div>
              )}
              {m.risks && m.risks.length > 0 && (
                <div style={{ borderRight: isMobile ? "none" : `1px solid ${COLOURS.BORDER}`, padding: "10px 14px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.RED, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "6px" }}>Risks ({m.risks.length})</div>
                  {m.risks.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                      <span style={{ color: COLOURS.RED, flexShrink: 0 }}>•</span>{r}
                    </div>
                  ))}
                </div>
              )}
              {m.opportunities && m.opportunities.length > 0 && (
                <div style={{ padding: "10px 14px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.BLUE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "6px" }}>Opportunities ({m.opportunities.length})</div>
                  {m.opportunities.map((o, i) => (
                    <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                      <span style={{ color: COLOURS.BLUE, flexShrink: 0 }}>•</span>{o}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action Items — compact task rows */}
          <div>
            <div style={{ padding: "8px 14px", fontSize: "10px", fontWeight: 600, color: COLOURS.AMBER, textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
              Action Items ({mTasks.length})
            </div>
            {mTasks.length > 0 ? mTasks.map((t) => (
              <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "7px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                textDecoration: "none", backgroundColor: COLOURS.CARD,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD_ALT; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD; }}>
                <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: taskDotColour(t.status), flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: "12px", color: COLOURS.NAVY, minWidth: 0 }}>{t.description}</span>
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>{t.assigned_to || "—"}</span>
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px", textAlign: "right" }}>{t.due_date ? formatDateUK(t.due_date) : "—"}</span>
                <StatusBadge status={t.status} />
                <span style={{ fontSize: "11px", color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>Open →</span>
              </a>
            )) : (
              <div style={{ padding: "10px 14px", fontSize: "12px", color: COLOURS.SLATE }}>No action items recorded.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function bestMatch(name: string, members: { name: string; email: string }[]): { name: string; email: string } | undefined {
  const lower = name.toLowerCase().trim();
  const exact = members.find((m) => m.name.toLowerCase() === lower);
  if (exact) return exact;
  const fullContains = members.find((m) => m.name.toLowerCase() === lower || lower === m.name.toLowerCase());
  if (fullContains) return fullContains;
  const parts = lower.split(/\s+/);
  const lastWord = parts[parts.length - 1];
  const firstWord = parts[0];
  const byLastName = members.filter((m) => {
    const mParts = m.name.toLowerCase().split(/\s+/);
    return mParts[mParts.length - 1] === lastWord;
  });
  if (byLastName.length === 1) return byLastName[0];
  const byFirstName = members.filter((m) => {
    const mParts = m.name.toLowerCase().split(/\s+/);
    return mParts[0] === firstWord || mParts[mParts.length - 1] === firstWord;
  });
  if (byFirstName.length === 1) return byFirstName[0];
  const partial = members.find((m) => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()));
  return partial;
}

export default function MeetingsPage() {
  const { checking } = useRequireCapability("meetings_admin");
  const isMobile = useMobile();
  const dlg = useConfirm();
  const [transcript, setTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedMinutes | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [memberEmails, setMemberEmails] = useState<{ name: string; email: string }[]>([]);
  const [memberDetails, setMemberDetails] = useState<{ name: string; role: string; department: string | null }[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; short_code: string | null }[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const [step, setStep] = useState<"input" | "review" | "approved">("input");
  const [showMinutesFlow, setShowMinutesFlow] = useState(false);

  const [inputMethod, setInputMethod] = useState<"paste" | "upload" | "email">("paste");
  const [uploading, setUploading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [emailResults, setEmailResults] = useState<{ id: string; subject: string; from: string; date: string; text: string }[]>([]);

  const [externalEmails, setExternalEmails] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());

  const [pendingMinutes, setPendingMinutes] = useState<PendingMinute[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState<MeetingTask[]>([]);
  const [activePendingId, setActivePendingId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"date" | "department">("department");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const [view, setView] = useState<"meetings" | "decisions">("meetings");
  const [decisionSearch, setDecisionSearch] = useState("");
  const [decisionDeptFilter, setDecisionDeptFilter] = useState("All");
  const [showOpenTasksPanel, setShowOpenTasksPanel] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserEmail(user?.email || null);

    const { data: members } = await supabase
      .from("members")
      .select("first_name, last_name, name, email, role, department");
    if (members) {
      setMemberNames(members.map((m) => {
        const full = `${m.first_name || ""} ${m.last_name || ""}`.trim();
        return full || m.name || "";
      }).filter(Boolean));
      setMemberEmails(members.map((m) => ({
        name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "",
        email: m.email || "",
      })).filter((m) => m.email));
      setMemberDetails(members.map((m) => ({
        name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "",
        role: m.role || "Member",
        department: m.department || null,
      })).filter((m) => m.name));
    }

    const { data: companiesData } = await supabase
      .from("companies")
      .select("id, name, short_code")
      .in("short_code", TASK_COMPANY_CODES)
      .order("name", { ascending: true });
    setCompanies(companiesData || []);

    const { data: meetingsData } = await supabase
      .from("meetings")
      .select("id, meeting_date, title, executive_summary, decisions, risks, opportunities, attendees, department, company, created_at")
      .order("meeting_date", { ascending: false })
      .limit(50);
    setMeetings(meetingsData || []);

    const { data: pendingData } = await supabase
      .from("pending_minutes")
      .select("id, gmail_message_id, subject, from_address, email_date, raw_text, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setPendingMinutes(pendingData || []);

    const { data: taskData } = await supabase
      .from("tasks")
      .select("id, description, assigned_to, due_date, priority, status, meeting_id")
      .not("meeting_id", "is", null);
    setAllTasks(taskData || []);
  }

  function getTasksForMeeting(meetingId: string): MeetingTask[] {
    return allTasks.filter((t) => t.meeting_id === meetingId);
  }

  async function handleExtract() {
    if (!transcript.trim()) return;
    setExtracting(true);
    setExtracted(null);
    setMessage("");

    try {
      const res = await authFetch("/api/meetings/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, memberNames, memberDetails }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage("Error: " + (data.error || "Extraction failed"));
      } else {
        setExtracted(data.extracted);
        setStep("review");
      }
    } catch {
      setMessage("Error: Network error during extraction");
    }
    setExtracting(false);
  }

  async function processFile(file: File) {
    setUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch("/api/meetings/parse-file", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setMessage("Error: " + (data.error || "File parsing failed"));
      } else {
        setTranscript(data.text);
        setInputMethod("paste");
        setMessage(`Extracted text from ${file.name} — review below and click Extract.`);
      }
    } catch {
      setMessage("Error: Network error uploading file");
    }
    setUploading(false);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = "";
  }

  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  async function handleCheckEmail() {
    setCheckingEmail(true);
    setMessage("");
    setEmailResults([]);

    try {
      const res = await authFetch("/api/meetings/check-inbox", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage("Error: " + (data.error || "Inbox check failed"));
      } else if (data.emails && data.emails.length > 0) {
        setEmailResults(data.emails);
        setMessage(`Found ${data.emails.length} minutes email${data.emails.length !== 1 ? "s" : ""}.`);
      } else {
        setMessage(data.message || "No new minutes emails found.");
      }
    } catch {
      setMessage("Error: Network error checking inbox");
    }
    setCheckingEmail(false);
  }

  function selectEmailMinutes(text: string) {
    setTranscript(text);
    setInputMethod("paste");
    setEmailResults([]);
    setMessage("Email content loaded — review below and click Extract.");
  }

  async function handleReviewPending(pending: PendingMinute) {
    setTranscript(pending.raw_text);
    setInputMethod("paste");
    setShowMinutesFlow(true);
    setStep("input");
    setActivePendingId(pending.id);
    setMessage(`Loaded: "${pending.subject || "Untitled"}". Click Extract to process with AI.`);

    await supabase
      .from("pending_minutes")
      .update({ status: "processing", reviewed_by: currentUserEmail })
      .eq("id", pending.id);
  }

  async function handleDismissPending(pendingId: string) {
    if (!await dlg.confirm("Dismiss this minute? It won't appear in the pending list again.")) return;
    await supabase
      .from("pending_minutes")
      .update({ status: "dismissed", reviewed_by: currentUserEmail, reviewed_at: new Date().toISOString() })
      .eq("id", pendingId);
    setPendingMinutes((prev) => prev.filter((p) => p.id !== pendingId));
  }

  async function handleApprove() {
    if (!extracted) return;

    const missingDue = extracted.action_items.filter((a) => !a.due_date);
    const missingDesc = extracted.action_items.filter((a) => !a.description.trim());
    const missingOwner = extracted.action_items.filter((a) => !a.owner_name);
    const missingCompany = extracted.action_items.filter((a) => !a.company_id);
    if (missingDesc.length > 0) { setMessage(`Error: ${missingDesc.length} action item${missingDesc.length > 1 ? "s" : ""} missing a description.`); return; }
    if (missingOwner.length > 0) { setMessage(`Error: ${missingOwner.length} action item${missingOwner.length > 1 ? "s" : ""} missing an owner.`); return; }
    if (missingDue.length > 0) { setMessage(`Error: ${missingDue.length} action item${missingDue.length > 1 ? "s" : ""} missing a due date. Every task must have a deadline.`); return; }
    if (missingCompany.length > 0) { setMessage(`Error: ${missingCompany.length} action item${missingCompany.length > 1 ? "s" : ""} missing a company.`); return; }

    setSaving(true);

    const dateParts = extracted.meeting_date.split("/");
    const isoDate = dateParts.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : new Date().toISOString().slice(0, 10);

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .insert({
        meeting_date: isoDate,
        title: extracted.meeting_title,
        executive_summary: extracted.executive_summary,
        decisions: extracted.decisions,
        risks: extracted.risks,
        opportunities: extracted.opportunities,
        attendees: extracted.attendees,
        department: extracted.department || "Executive Office",
        company: extracted.company || "Executive Office",
        raw_transcript: transcript,
        created_by: currentUserEmail,
      })
      .select("id")
      .single();

    if (meetingError) {
      setMessage("Error saving meeting: " + meetingError.message);
      setSaving(false);
      return;
    }

    // Routes through the shared task-creation gate (see
    // TASK_NOTIFICATION_AUDIT.md) instead of inserting directly — fixes
    // "assigned by" to the real person approving the minutes instead of
    // the hardcoded "Meeting Minutes" label, and enforces the same
    // company/character-limit rules as every other creation path.
    let tasksCreated = 0;
    for (const item of extracted.action_items) {
      const memberMatch = bestMatch(item.owner_name, memberEmails);

      const res = await authFetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: item.description.slice(0, TASK_DESCRIPTION_LIMIT),
          companyId: item.company_id,
          assignedTo: item.owner_name,
          assignedToEmail: memberMatch?.email || null,
          assignedToDepartment: item.department || null,
          dueDate: item.due_date || null,
          priority: item.priority,
          status: "Not Started",
          project: extracted.meeting_title,
          meetingId: meeting.id,
          taskType: "Task",
        }),
      });
      const result = await res.json().catch(() => ({}));

      if (res.ok && !result?.error && result?.taskId) {
        await supabase.from("meeting_tasks").insert({
          meeting_id: meeting.id,
          task_id: result.taskId,
        });
        tasksCreated++;
      }
    }

    for (const attendee of extracted.attendees) {
      const match = bestMatch(attendee, memberEmails);
      if (match?.email) {
        await supabase.from("meeting_attendees").upsert({
          meeting_id: meeting.id,
          member_email: match.email,
          member_name: match.name,
        }, { onConflict: "meeting_id,member_email" });
      }
    }

    if (activePendingId) {
      await supabase
        .from("pending_minutes")
        .update({ status: "approved", meeting_id: meeting.id, reviewed_at: new Date().toISOString() })
        .eq("id", activePendingId);
      setActivePendingId(null);
    }

    logAction("Created", "meetings", `${extracted.meeting_title} - ${tasksCreated} tasks created`, meeting.id);
    setMessage(`Approved: meeting saved and ${tasksCreated} task${tasksCreated !== 1 ? "s" : ""} created. Company attendees will see these minutes in the app.`);
    setSaving(false);

    const externalOnly = new Set<string>();
    if (externalEmails.trim()) {
      externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).forEach((e) => externalOnly.add(e));
    }
    setSelectedRecipients(externalOnly);

    setStep("approved");
    loadData();
  }

  async function handleSendMinutes() {
    if (!extracted) return;
    setSending(true);

    const uniqueEmails = Array.from(selectedRecipients);

    if (uniqueEmails.length === 0) {
      setMessage("No recipients selected. Tick at least one person to send to.");
      setSending(false);
      return;
    }

    try {
      const res = await authFetch("/api/meetings/send-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingTitle: extracted.meeting_title,
          meetingDate: extracted.meeting_date,
          executiveSummary: extracted.executive_summary,
          decisions: extracted.decisions,
          actionItems: extracted.action_items,
          attendeeEmails: uniqueEmails,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Minutes sent to ${data.sent} attendee${data.sent !== 1 ? "s" : ""}.`);
      } else {
        setMessage("Error sending minutes: " + (data.error || "Failed"));
      }
    } catch {
      setMessage("Error: Network error sending minutes");
    }
    setSending(false);
  }

  function downloadMinutesPDF(m: Meeting, mTasks: MeetingTask[]) {
    const html = `
      <html><head><title>${m.title}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; max-width: 800px; margin: 0 auto; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .meta { font-size: 13px; color: #64748b; margin-bottom: 16px; }
        h2 { font-size: 15px; margin: 16px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
        .summary { font-size: 14px; line-height: 1.6; color: #475569; }
        .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 8px; background: #f1f5f9; margin-right: 4px; }
        ul { padding-left: 20px; margin: 4px 0; }
        li { font-size: 14px; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
        th { background: #f8fafc; font-weight: 700; }
        @media print { body { padding: 10px; } }
      </style></head><body>
      <h1>${m.title}</h1>
      <div class="meta">
        ${formatDateUK(m.meeting_date)}
        ${m.department ? ` · ${m.department}` : ""}
        ${m.company ? ` · ${m.company}` : ""}
      </div>
      ${m.attendees?.length ? `<h2>Attendees</h2><div>${m.attendees.map((a) => `<span class="badge">${a}</span>`).join(" ")}</div>` : ""}
      ${m.executive_summary ? `<h2>Executive Summary</h2><div class="summary">${m.executive_summary}</div>` : ""}
      ${m.decisions?.length ? `<h2>Decisions</h2><ul>${m.decisions.map((d) => `<li>${d}</li>`).join("")}</ul>` : ""}
      ${m.risks?.length ? `<h2>Risks</h2><ul>${m.risks.map((r) => `<li>${r}</li>`).join("")}</ul>` : ""}
      ${m.opportunities?.length ? `<h2>Opportunities</h2><ul>${m.opportunities.map((o) => `<li>${o}</li>`).join("")}</ul>` : ""}
      ${mTasks.length ? `<h2>Action Items (${mTasks.length})</h2>
        <table><tr><th>Task</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th></tr>
        ${mTasks.map((t) => `<tr><td>${t.description}</td><td>${t.assigned_to || "—"}</td><td>${t.due_date ? formatDateUK(t.due_date) : "—"}</td><td>${t.priority || "Normal"}</td><td>${t.status}</td></tr>`).join("")}
        </table>` : ""}
      <div style="margin-top:20px;font-size:11px;color:#94a3b8;text-align:center">Generated from Unze Group · ${new Date().toLocaleDateString("en-GB")}</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  function resetAll() {
    setExtracted(null);
    setTranscript("");
    setStep("input");
    setExternalEmails("");
    setMessage("");
    setShowMinutesFlow(false);
    setActivePendingId(null);
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const thisMonthMeetings = meetings.filter((m) => m.meeting_date.slice(0, 7) === currentMonth);
  const openTasks = allTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");

  const formatMonthLabel = (ym: string) => {
    const [y, m] = ym.split("-");
    const months = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${months[parseInt(m)]} ${y}`;
  };

  const groupedMeetings: [string, Meeting[]][] = (() => {
    if (groupBy === "department") {
      const groups = new Map<string, Meeting[]>();
      for (const m of meetings) {
        const dept = m.department || m.company || "Executive Office";
        if (!groups.has(dept)) groups.set(dept, []);
        groups.get(dept)!.push(m);
      }
      return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
    }
    const groups = new Map<string, Meeting[]>();
    for (const m of meetings) {
      const mo = m.meeting_date.slice(0, 7);
      if (!groups.has(mo)) groups.set(mo, []);
      groups.get(mo)!.push(m);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  })();

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleDept = (dept: string) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  };

  const toggleMonth = (key: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  function getTaskStatsFor(meetingList: Meeting[]) {
    const ts = meetingList.flatMap((m) => getTasksForMeeting(m.id));
    return {
      total: ts.length,
      open: ts.filter((t) => t.status === "In Progress").length,
      pending: ts.filter((t) => t.status === "Not Started" || t.status === "Waiting Reply").length,
      completed: ts.filter((t) => t.status === "Completed").length,
    };
  }

  const deptMonthGroups: [string, [string, Meeting[]][]][] = (() => {
    const deptMap = new Map<string, Map<string, Meeting[]>>();
    for (const m of meetings) {
      const dept = m.department || m.company || "Executive Office";
      const mo = m.meeting_date.slice(0, 7);
      if (!deptMap.has(dept)) deptMap.set(dept, new Map());
      const monthMap = deptMap.get(dept)!;
      if (!monthMap.has(mo)) monthMap.set(mo, []);
      monthMap.get(mo)!.push(m);
    }
    return Array.from(deptMap.entries())
      .map(([dept, monthMap]) => [
        dept,
        Array.from(monthMap.entries()).sort(([a], [b]) => b.localeCompare(a)),
      ] as [string, [string, Meeting[]][]])
      .sort(([a], [b]) => a.localeCompare(b));
  })();

  // Auto-expand latest group on first render
  if (groupBy === "date" && expandedGroups.size === 0 && groupedMeetings.length > 0) {
    expandedGroups.add(groupedMeetings[0][0]);
  }
  if (groupBy === "department" && expandedDepts.size === 0 && deptMonthGroups.length > 0) {
    expandedDepts.add(deptMonthGroups[0][0]);
    if (deptMonthGroups[0][1].length > 0) {
      expandedMonths.add(`${deptMonthGroups[0][0]}:${deptMonthGroups[0][1][0][0]}`);
    }
  }

  const allDecisions = meetings.flatMap((m) =>
    (m.decisions || []).map((text) => ({
      text,
      meetingTitle: m.title,
      meetingDate: m.meeting_date,
      department: m.department || m.company || "Executive Office",
      meetingId: m.id,
    }))
  );

  const decisionDepts = Array.from(new Set(allDecisions.map((d) => d.department))).sort();
  const lowerSearch = decisionSearch.toLowerCase();
  const filteredDecisions = allDecisions.filter((d) => {
    if (decisionDeptFilter !== "All" && d.department !== decisionDeptFilter) return false;
    if (lowerSearch && !d.text.toLowerCase().includes(lowerSearch) && !d.meetingTitle.toLowerCase().includes(lowerSearch)) return false;
    return true;
  });

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: COLOURS.SLATE }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
      {dlg.element}
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader />
          <button onClick={() => setShowMinutesFlow(!showMinutesFlow)} style={{
            ...primaryButtonStyle,
            display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
          }} title="Add minutes">
            {showMinutesFlow ? "✕ Close" : "+ Add Minutes"}
          </button>
        </div>

        {message && (
          <div style={{
            border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.CARD, padding: "10px 14px", marginBottom: "14px",
            backgroundColor: message.startsWith("Error") ? COLOURS.DANGER_SOFT : COLOURS.SUCCESS_SOFT,
            fontSize: "13px", color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN,
          }}>
            {message}
          </div>
        )}

        {/* Summary strip */}
        {!showMinutesFlow && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: showOpenTasksPanel ? "0" : "14px" }}>
              <CountCard label="Pending Review" value={pendingMinutes.length} color={pendingMinutes.length > 0 ? COLOURS.AMBER : COLOURS.SLATE} />
              <CountCard label="This Month" value={thisMonthMeetings.length} color={COLOURS.NAVY} />
              {/* Clickable Open Tasks card */}
              <div onClick={() => setShowOpenTasksPanel((p) => !p)} style={{
                ...cardStyle as React.CSSProperties,
                padding: "16px 20px",
                borderTop: `3px solid ${openTasks.length > 0 ? COLOURS.RED : COLOURS.GREEN}`,
                cursor: "pointer",
                outline: showOpenTasksPanel ? `2px solid ${COLOURS.RED}` : "none",
                outlineOffset: "-1px",
                position: "relative",
              }}>
                <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: COLOURS.SLATE, marginBottom: "10px" }}>Open Tasks</div>
                <div style={{ fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em", color: openTasks.length > 0 ? COLOURS.RED : COLOURS.GREEN }}>{openTasks.length.toLocaleString()}</div>
                {showOpenTasksPanel && <div style={{ position: "absolute", bottom: "6px", right: "8px", fontSize: "10px", color: COLOURS.RED }}>▼ showing</div>}
              </div>
              <CountCard label="Total Meetings" value={meetings.length} color={COLOURS.BLUE} />
            </div>

            {/* Open Tasks panel */}
            {showOpenTasksPanel && (() => {
              const panelTasks = openTasks
                .map((t) => ({ ...t, meetingTitle: meetings.find((m) => m.id === t.meeting_id)?.title || "Unknown" }))
                .sort((a, b) => {
                  if (!a.due_date && !b.due_date) return 0;
                  if (!a.due_date) return 1;
                  if (!b.due_date) return -1;
                  return a.due_date.localeCompare(b.due_date);
                });
              return (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: "14px", marginTop: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD_ALT }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.RED }}>{panelTasks.length} Open Task{panelTasks.length !== 1 ? "s" : ""}</span>
                    <button onClick={() => setShowOpenTasksPanel(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: COLOURS.SLATE, padding: "0 4px", lineHeight: 1 }}>×</button>
                  </div>
                  {panelTasks.length === 0 ? (
                    <div style={{ padding: "16px 14px", fontSize: "12px", color: COLOURS.SLATE }}>No open tasks.</div>
                  ) : panelTasks.map((t) => (
                    <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                      textDecoration: "none", backgroundColor: COLOURS.CARD,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD_ALT; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD; }}>
                      <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: taskDotColour(t.status), flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: "12px", color: COLOURS.NAVY, minWidth: 0 }}>{t.description}</span>
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, maxWidth: "140px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.meetingTitle}</span>
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>{t.assigned_to || "—"}</span>
                      <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px", textAlign: "right" }}>{t.due_date ? formatDateUK(t.due_date) : "—"}</span>
                      <StatusBadge status={t.status} />
                      <span style={{ fontSize: "11px", color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                    </a>
                  ))}
                </div>
              );
            })()}
          </>
        )}

        {/* Pending Review */}
        {pendingMinutes.length > 0 && !showMinutesFlow && (
          <div style={{ marginBottom: "16px" }}>
            <SectionTitle title={`Pending Review (${pendingMinutes.length})`} />
            {pendingMinutes.map((p) => (
              <div key={p.id} style={{
                ...cardStyle,
                backgroundColor: COLOURS.WARNING_SOFT,
                padding: "12px 14px", marginBottom: "8px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: COLOURS.NAVY }}>
                      {p.subject || "Untitled Minutes"}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      From: {p.from_address || "Unknown"}{p.email_date ? ` · ${p.email_date}` : ""}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                      {p.raw_text.slice(0, 150)}{p.raw_text.length > 150 ? "..." : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button onClick={() => handleReviewPending(p)} style={{
                      ...primaryButtonStyle, padding: "6px 14px",
                    }}>Review</button>
                    <button onClick={() => handleDismissPending(p.id)} style={{
                      ...primaryButtonStyle, padding: "6px 14px",
                      backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, border: `1px solid ${COLOURS.BORDER}`,
                    }}>Dismiss</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 1: Input */}
        {showMinutesFlow && step === "input" && (
          <div style={{ ...cardStyle, padding: "16px", marginBottom: "16px" }}>
            <SectionTitle title="Step 1: Add Minutes" />

            <div style={{ display: "inline-flex", backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "3px", gap: "2px", marginBottom: "16px" }}>
              {([
                { key: "paste" as const, label: "Paste Text" },
                { key: "upload" as const, label: "Upload File" },
                { key: "email" as const, label: "From Email" },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setInputMethod(tab.key)}
                  style={{
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: inputMethod === tab.key ? 600 : 400,
                    color: inputMethod === tab.key ? COLOURS.CARD : COLOURS.SLATE,
                    backgroundColor: inputMethod === tab.key ? COLOURS.NAVY : "transparent",
                    border: "none",
                    borderRadius: RADII.PILL,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {inputMethod === "paste" && (
              <>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Paste the meeting transcript, raw notes, or pre-written minutes here..."
                  style={{ ...inputStyle, height: "200px", resize: "vertical", fontFamily: "inherit" }}
                />
                <button onClick={handleExtract} disabled={extracting || !transcript.trim()}
                  style={{ ...primaryButtonStyle, width: "100%", marginTop: "8px", opacity: extracting || !transcript.trim() ? 0.5 : 1 }}>
                  {extracting ? "Extracting with AI..." : "Extract Meeting Minutes"}
                </button>
              </>
            )}

            {inputMethod === "upload" && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  border: `2px dashed ${dragging ? COLOURS.NAVY : COLOURS.BORDER}`,
                  borderRadius: RADII.CARD,
                  backgroundColor: dragging ? COLOURS.TRACK : COLOURS.CARD_ALT,
                  transition: "all 0.2s ease",
                  cursor: uploading ? "wait" : "pointer",
                }}
              >
                <div style={{ fontSize: "36px", marginBottom: "10px", opacity: 0.5 }}>
                  {uploading ? "..." : ""}
                </div>
                <p style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "6px" }}>
                  {uploading ? "Reading file..." : dragging ? "Drop your file here" : "Drag & drop your file here"}
                </p>
                <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "16px" }}>
                  or
                </p>
                <label style={{
                  display: "inline-block",
                  ...primaryButtonStyle,
                  padding: "10px 24px",
                  cursor: uploading ? "wait" : "pointer",
                  opacity: uploading ? 0.5 : 1,
                }}>
                  Browse Files
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    style={{ display: "none" }}
                  />
                </label>
                <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "14px" }}>
                  Supported: PDF, Word (.docx), Plain text (.txt)
                </p>
              </div>
            )}

            {inputMethod === "email" && (
              <div style={{ padding: "8px 0" }}>
                <div style={{ backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, padding: "14px", marginBottom: "16px" }}>
                  <p style={{ fontSize: "13px", color: COLOURS.NAVY, fontWeight: 600, marginBottom: "6px" }}>
                    How it works
                  </p>
                  <ol style={{ fontSize: "13px", color: COLOURS.SLATE, margin: 0, paddingLeft: "20px", lineHeight: 1.8 }}>
                    <li>Forward your minutes email to <strong>k.saleem@unzegroup.com</strong></li>
                    <li>In Gmail, create a label called <strong>minutes-of-meeting</strong> and set up a filter to auto-label these emails</li>
                    <li>Click the button below to check for new minutes</li>
                  </ol>
                </div>

                <button onClick={handleCheckEmail} disabled={checkingEmail}
                  style={{ ...primaryButtonStyle, width: "100%", opacity: checkingEmail ? 0.5 : 1 }}>
                  {checkingEmail ? "Checking inbox..." : "Check for Minutes Emails"}
                </button>

                {emailResults.length > 0 && (
                  <div style={{ marginTop: "14px" }}>
                    <p style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "8px" }}>
                      Select an email to extract:
                    </p>
                    {emailResults.map((email) => (
                      <div key={email.id} style={{
                        border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, padding: "10px 12px",
                        marginBottom: "6px", backgroundColor: COLOURS.CARD, cursor: "pointer",
                      }}
                        onClick={() => selectEmailMinutes(email.text)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = COLOURS.NAVY; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = COLOURS.BORDER; }}
                      >
                        <div style={{ fontWeight: 600, fontSize: "13px", color: COLOURS.NAVY }}>{email.subject}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                          From: {email.from} · {email.date}
                        </div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                          {email.text.slice(0, 150)}{email.text.length > 150 ? "..." : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Review & Edit */}
        {showMinutesFlow && step === "review" && extracted && (() => {
          const updateActionItem = (index: number, updates: Partial<ExtractedMinutes["action_items"][0]>) => {
            const items = [...extracted.action_items];
            items[index] = { ...items[index], ...updates };
            setExtracted({ ...extracted, action_items: items });
          };
          const removeActionItem = (index: number) => {
            setExtracted({ ...extracted, action_items: extracted.action_items.filter((_, i) => i !== index) });
          };
          const addActionItem = () => {
            setExtracted({ ...extracted, action_items: [...extracted.action_items, { description: "", owner_name: "", priority: "Medium", due_date: "", department: "", company_id: "" }] });
          };
          const smallField: React.CSSProperties = { ...inputStyle, fontSize: "12px", padding: "6px 8px" };

          return (
          <div style={{ ...cardStyle, padding: "16px", marginBottom: "16px" }}>
            <SectionTitle title="Step 2: Review & Approve" />
            <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "12px" }}>
              Review and edit everything below. Change task owners, descriptions, priorities — then approve.
            </p>

            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Title</label>
              <input value={extracted.meeting_title} onChange={(e) => setExtracted({ ...extracted, meeting_title: e.target.value })} style={inputStyle} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div>
                <label style={labelStyle}>Date</label>
                <input value={extracted.meeting_date} onChange={(e) => setExtracted({ ...extracted, meeting_date: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Company</label>
                <select value={extracted.company} onChange={(e) => setExtracted({ ...extracted, company: e.target.value })} style={inputStyle}>
                  {["Executive Office", "Unze Trading", "Imperial Footwear", "Haute Dolci", "Barahn", "K&K Jhang"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Department</label>
                <select value={extracted.department} onChange={(e) => setExtracted({ ...extracted, department: e.target.value })} style={inputStyle}>
                  {["Executive Office", "Unze Trading Ops", "Finance", "HR", "Audit", "Taxation", "Admin"].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Attendees (comma-separated)</label>
                <input value={extracted.attendees.join(", ")} onChange={(e) => setExtracted({ ...extracted, attendees: e.target.value.split(",").map((s) => s.trim()) })} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Executive Summary</label>
              <textarea value={extracted.executive_summary} onChange={(e) => setExtracted({ ...extracted, executive_summary: e.target.value })}
                style={{ ...inputStyle, height: "80px", resize: "vertical" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={labelStyle}>Decisions ({extracted.decisions.length})</label>
                  <button onClick={() => setExtracted({ ...extracted, decisions: [...extracted.decisions, ""] })}
                    style={{ fontSize: "12px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>+ Add</button>
                </div>
                {extracted.decisions.map((d, i) => (
                  <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                    <input value={d} onChange={(e) => { const arr = [...extracted.decisions]; arr[i] = e.target.value; setExtracted({ ...extracted, decisions: arr }); }}
                      style={{ ...smallField, flex: 1 }} />
                    <button onClick={() => setExtracted({ ...extracted, decisions: extracted.decisions.filter((_, j) => j !== i) })}
                      style={{ fontSize: "12px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer" }}>×</button>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={labelStyle}>Risks ({extracted.risks.length})</label>
                  <button onClick={() => setExtracted({ ...extracted, risks: [...extracted.risks, ""] })}
                    style={{ fontSize: "12px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>+ Add</button>
                </div>
                {extracted.risks.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                    <input value={r} onChange={(e) => { const arr = [...extracted.risks]; arr[i] = e.target.value; setExtracted({ ...extracted, risks: arr }); }}
                      style={{ ...smallField, flex: 1 }} />
                    <button onClick={() => setExtracted({ ...extracted, risks: extracted.risks.filter((_, j) => j !== i) })}
                      style={{ fontSize: "12px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer" }}>×</button>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={labelStyle}>Opportunities ({extracted.opportunities.length})</label>
                  <button onClick={() => setExtracted({ ...extracted, opportunities: [...extracted.opportunities, ""] })}
                    style={{ fontSize: "12px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>+ Add</button>
                </div>
                {extracted.opportunities.map((o, i) => (
                  <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                    <input value={o} onChange={(e) => { const arr = [...extracted.opportunities]; arr[i] = e.target.value; setExtracted({ ...extracted, opportunities: arr }); }}
                      style={{ ...smallField, flex: 1 }} />
                    <button onClick={() => setExtracted({ ...extracted, opportunities: extracted.opportunities.filter((_, j) => j !== i) })}
                      style={{ fontSize: "12px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer" }}>×</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", padding: "8px 0", borderTop: `2px solid ${COLOURS.NAVY}`, marginTop: "12px" }}>
              <SectionTitle title={`Action Items (${extracted.action_items.length})`} />
              <button onClick={addActionItem} style={{ ...primaryButtonStyle, padding: "8px 16px" }}>
                + Add Task
              </button>
            </div>

            {extracted.action_items.map((item, i) => (
              <div key={i} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, padding: "12px", marginBottom: "8px", backgroundColor: COLOURS.CARD_ALT }}>
                <div style={{ marginBottom: "8px" }}>
                  <input value={item.description} onChange={(e) => updateActionItem(i, { description: e.target.value.slice(0, TASK_DESCRIPTION_LIMIT) })}
                    maxLength={TASK_DESCRIPTION_LIMIT}
                    placeholder="Task description *" required style={{ ...inputStyle, fontWeight: 600, borderColor: !item.description.trim() ? COLOURS.RED : undefined }} />
                  <span style={{ fontSize: "10.5px", color: item.description.length > TASK_DESCRIPTION_LIMIT - 20 ? COLOURS.AMBER : COLOURS.SLATE }}>{item.description.length}/{TASK_DESCRIPTION_LIMIT}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr 1fr auto", gap: "8px", alignItems: "end" }}>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px", color: !item.owner_name ? COLOURS.RED : undefined }}>Owner *</label>
                    <select value={item.owner_name} onChange={(e) => updateActionItem(i, { owner_name: e.target.value })}
                      style={{ ...smallField, borderColor: !item.owner_name ? COLOURS.RED : undefined }}>
                      <option value="">Select owner</option>
                      {memberDetails.filter((m) => m.role === "Manager" || m.role === "Executive" || m.role === "Admin" || m.role === "CEO").map((m) => (
                        <option key={m.name} value={m.name}>{m.name} ({m.role})</option>
                      ))}
                      {item.owner_name && !memberDetails.find((m) => m.name === item.owner_name) && (
                        <option value={item.owner_name}>{item.owner_name} (not matched)</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px", color: !item.company_id ? COLOURS.RED : undefined }}>Company *</label>
                    <select value={item.company_id || ""} onChange={(e) => updateActionItem(i, { company_id: e.target.value })}
                      style={{ ...smallField, borderColor: !item.company_id ? COLOURS.RED : undefined }}>
                      <option value="">Select company</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px" }}>Priority</label>
                    <select value={item.priority} onChange={(e) => updateActionItem(i, { priority: e.target.value })} style={smallField}>
                      {["Low", "Medium", "High", "Urgent"].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px", color: !item.due_date ? COLOURS.RED : undefined }}>Due Date *</label>
                    <DateInputWithCalendar value={item.due_date || ""} onChange={(e) => updateActionItem(i, { due_date: e.target.value })} required
                      style={{ ...smallField, borderColor: !item.due_date ? COLOURS.RED : undefined }} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px" }}>Department</label>
                    <select value={item.department || ""} onChange={(e) => updateActionItem(i, { department: e.target.value })} style={smallField}>
                      <option value="">None</option>
                      {["Unze Trading Ops", "Finance", "HR", "Audit", "Taxation", "Admin"].map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => removeActionItem(i)}
                    style={{ backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.RED}`, color: COLOURS.RED, borderRadius: RADII.XS, padding: "6px 10px", fontSize: "13px", cursor: "pointer", height: "fit-content" }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}

            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>External Attendee Emails (comma-separated, optional)</label>
              <input value={externalEmails} onChange={(e) => setExternalEmails(e.target.value)}
                placeholder="e.g. john@external.com, jane@supplier.com" style={inputStyle} />
              <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                These people will receive the minutes email but no tasks will be created for them.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button onClick={() => { setStep("input"); setMessage(""); }}
                style={{ ...primaryButtonStyle, backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`, flex: 1 }}>
                Back
              </button>
              <button onClick={handleApprove} disabled={saving}
                style={{ ...primaryButtonStyle, flex: 2, backgroundColor: COLOURS.GREEN, opacity: saving ? 0.5 : 1 }}>
                {saving ? "Saving..." : "Approve & Create Tasks"}
              </button>
            </div>
          </div>
          );
        })()}

        {/* Step 3: Approved — send to attendees */}
        {showMinutesFlow && step === "approved" && extracted && (() => {
          const toggleRecipient = (email: string) => {
            setSelectedRecipients((prev) => {
              const next = new Set(prev);
              if (next.has(email)) next.delete(email);
              else next.add(email);
              return next;
            });
          };
          const selectAll = () => {
            const all = new Set<string>();
            extracted.attendees.forEach((a) => {
              const match = bestMatch(a, memberEmails);
              if (match?.email) all.add(match.email);
            });
            if (externalEmails.trim()) externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).forEach((e) => all.add(e));
            setSelectedRecipients(all);
          };
          const deselectAll = () => setSelectedRecipients(new Set());

          return (
          <div style={{ ...cardStyle, padding: "16px", marginBottom: "16px" }}>
            <SectionTitle title="Step 3: Notify Attendees" />

            <div style={{
              border: `1px solid ${COLOURS.HAIRLINE}`,
              borderRadius: RADII.CARD, padding: "10px 14px", marginBottom: "14px",
              backgroundColor: COLOURS.SUCCESS_SOFT, fontSize: "13px", color: COLOURS.GREEN,
            }}>
              Company attendees will see these minutes in <strong>My Minutes</strong> within the app. Only check people below if you also want to send an email copy (typically for external attendees who don't have app access).
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={labelStyle}>Email Recipients ({selectedRecipients.size} selected)</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={selectAll} style={{ fontSize: "12px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Select All</button>
                  <button onClick={deselectAll} style={{ fontSize: "12px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Deselect All</button>
                </div>
              </div>

              <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px", marginTop: "6px" }}>Company Attendees (view in app — tick to also email)</div>
              {extracted.attendees.map((a) => {
                const match = bestMatch(a, memberEmails);
                if (!match?.email) return (
                  <div key={a} style={{ padding: "4px 0", fontSize: "13px", color: COLOURS.SLATE }}>
                    {a} <span style={{ fontSize: "12px", color: COLOURS.AMBER }}>(no email match)</span>
                  </div>
                );
                return (
                  <label key={a} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", fontSize: "13px", color: COLOURS.NAVY, cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedRecipients.has(match.email)}
                      onChange={() => toggleRecipient(match.email)} style={{ width: "16px", height: "16px" }} />
                    <span style={{ fontWeight: 600 }}>{a}</span>
                    <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{match.email}</span>
                  </label>
                );
              })}

              {externalEmails.trim() && (
                <>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px", marginTop: "10px" }}>External Attendees (email only)</div>
                  {externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).map((ext) => (
                    <label key={ext} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", fontSize: "13px", color: COLOURS.NAVY, cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedRecipients.has(ext)}
                        onChange={() => toggleRecipient(ext)} style={{ width: "16px", height: "16px" }} />
                      <span style={{ fontWeight: 600 }}>{ext}</span>
                      <span style={{ fontSize: "12px", color: COLOURS.BLUE }}>(external)</span>
                    </label>
                  ))}
                </>
              )}

              <div style={{ marginTop: "8px", display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="email" placeholder="Add external email..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val.includes("@")) {
                        setSelectedRecipients((prev) => new Set(prev).add(val));
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                  style={{ ...inputStyle, flex: "1 1 200px", maxWidth: "280px", fontSize: "14px", padding: "6px 8px" }}
                />
                <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Press Enter to add</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              {selectedRecipients.size > 0 ? (
                <button onClick={handleSendMinutes} disabled={sending}
                  style={{ ...primaryButtonStyle, flex: 2, opacity: sending ? 0.5 : 1 }}>
                  {sending ? "Sending..." : `Email to ${selectedRecipients.size} Recipient${selectedRecipients.size !== 1 ? "s" : ""}`}
                </button>
              ) : null}
              <button onClick={resetAll}
                style={{ ...primaryButtonStyle, backgroundColor: selectedRecipients.size === 0 ? COLOURS.GREEN : COLOURS.CARD, color: selectedRecipients.size === 0 ? "white" : COLOURS.NAVY, border: selectedRecipients.size === 0 ? "none" : `1px solid ${COLOURS.BORDER}`, flex: selectedRecipients.size === 0 ? 2 : 1 }}>
                {selectedRecipients.size === 0 ? "Done — Attendees Notified in App" : "Skip Email & Done"}
              </button>
            </div>
          </div>
          );
        })()}

        {/* Past meetings / Decision Log */}
        {!showMinutesFlow && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "inline-flex", backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "3px", gap: "2px" }}>
                {(["meetings", "decisions"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} style={{
                    padding: "6px 14px", fontSize: "12px", fontWeight: view === v ? 600 : 400,
                    color: view === v ? COLOURS.CARD : COLOURS.SLATE,
                    backgroundColor: view === v ? COLOURS.NAVY : "transparent",
                    border: "none", borderRadius: RADII.PILL, cursor: "pointer",
                  }}>
                    {v === "meetings" ? "Past Meetings" : `Decision Log (${allDecisions.length})`}
                  </button>
                ))}
              </div>
              {view === "meetings" && (
                <div style={{ display: "flex", gap: "4px" }}>
                  {(["date", "department"] as const).map((g) => (
                    <button key={g} onClick={() => { setGroupBy(g); setExpandedGroups(new Set()); setExpandedDepts(new Set()); setExpandedMonths(new Set()); }} style={{
                      padding: "4px 12px", fontSize: "12px", fontWeight: groupBy === g ? 600 : 400, borderRadius: RADII.PILL,
                      border: `1px solid ${groupBy === g ? COLOURS.NAVY : COLOURS.BORDER}`,
                      backgroundColor: groupBy === g ? COLOURS.NAVY : COLOURS.CARD,
                      color: groupBy === g ? "white" : COLOURS.SLATE, cursor: "pointer",
                    }}>
                      {g === "date" ? "By Date" : "By Department"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {view === "decisions" && (
              <div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                  <input
                    value={decisionSearch}
                    onChange={(e) => setDecisionSearch(e.target.value)}
                    placeholder="Search decisions..."
                    style={{ ...inputStyle, flex: "1 1 200px", maxWidth: "320px", padding: "7px 10px" }}
                  />
                  <select
                    value={decisionDeptFilter}
                    onChange={(e) => setDecisionDeptFilter(e.target.value)}
                    style={{ ...inputStyle, width: "auto", flex: "0 0 auto", padding: "7px 10px" }}
                  >
                    <option value="All">All Departments</option>
                    {decisionDepts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                {filteredDecisions.length === 0 ? (
                  <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>
                    {allDecisions.length === 0 ? "No decisions recorded yet." : "No decisions match your filters."}
                  </p>
                ) : (
                  <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
                    {filteredDecisions.map((d, i) => (
                      <div key={`${d.meetingId}-${i}`} style={{
                        display: "flex", alignItems: "flex-start", gap: "10px",
                        padding: "8px 14px",
                        borderBottom: i < filteredDecisions.length - 1 ? `1px solid ${COLOURS.BORDER}` : "none",
                        backgroundColor: COLOURS.CARD,
                      }}>
                        <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: COLOURS.GREEN, flexShrink: 0, marginTop: "5px" }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12px", color: COLOURS.NAVY, marginBottom: "2px" }}>{d.text}</div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "11px", color: COLOURS.SLATE, alignItems: "center" }}>
                            <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{formatDateUK(d.meetingDate)}</span>
                            <span>{d.meetingTitle}</span>
                            <span style={{ padding: "1px 6px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: COLOURS.NAVY, fontWeight: 600 }}>{d.department}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: "8px", fontSize: "13px", color: COLOURS.SLATE }}>
                  {filteredDecisions.length} decision{filteredDecisions.length !== 1 ? "s" : ""}
                  {decisionSearch || decisionDeptFilter !== "All" ? ` (filtered from ${allDecisions.length} total)` : ""}
                </div>
              </div>
            )}

            {view === "meetings" && meetings.length === 0 ? (
              <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No meetings recorded yet.</p>

            ) : view === "meetings" && groupBy === "date" ? (
              /* ── By Date view (flat month groups) ── */
              groupedMeetings.map(([groupKey, groupMeetings]) => {
                const isGroupOpen = expandedGroups.has(groupKey);
                const groupTasks = groupMeetings.flatMap((m) => getTasksForMeeting(m.id));
                const groupOpen = groupTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;
                return (
                  <div key={groupKey} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: "10px" }}>
                    <div onClick={() => toggleGroup(groupKey)} style={{
                      padding: "10px 14px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "10px",
                      backgroundColor: isGroupOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                      borderLeft: `3px solid ${COLOURS.SLATE}`,
                      borderBottom: isGroupOpen ? `1px solid ${COLOURS.BORDER}` : "none",
                    }}>
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>📅</span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, flex: 1 }}>{formatMonthLabel(groupKey)}</span>
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                        {groupMeetings.length} meeting{groupMeetings.length !== 1 ? "s" : ""}
                        {groupOpen > 0 && <span style={{ color: COLOURS.AMBER }}> · {groupOpen} open</span>}
                      </span>
                      <span style={{ color: COLOURS.SLATE, fontSize: "10px", flexShrink: 0 }}>{isGroupOpen ? "▲" : "▼"}</span>
                    </div>
                    {isGroupOpen && (
                      <div>
                        {groupMeetings.map((m) => {
                          const isOpen = expandedId === m.id;
                          const mTasks = getTasksForMeeting(m.id);
                          const completedTasks = mTasks.filter((t) => t.status === "Completed").length;
                          const openTaskCount = mTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;
                          return <MeetingCard key={m.id} m={m} mTasks={mTasks} completedTasks={completedTasks} openTaskCount={openTaskCount} isOpen={isOpen} setExpandedId={setExpandedId} downloadMinutesPDF={downloadMinutesPDF} isMobile={isMobile} showDept />;
                        })}
                      </div>
                    )}
                  </div>
                );
              })

            ) : view === "meetings" && groupBy === "department" ? (
              /* ── By Department view (dept → month → meeting) ── */
              deptMonthGroups.map(([dept, months]) => {
                const isDeptOpen = expandedDepts.has(dept);
                const allDeptMeetings = months.flatMap(([, ms]) => ms);
                const stats = getTaskStatsFor(allDeptMeetings);

                return (
                  <div key={dept} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: "10px" }}>

                    {/* Department header — compact left-accent row */}
                    <div onClick={() => toggleDept(dept)} style={{
                      padding: "10px 14px", cursor: "pointer",
                      backgroundColor: isDeptOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                      display: "flex", alignItems: "center", gap: "10px",
                      borderLeft: `3px solid ${deptAccent(dept)}`,
                      borderBottom: isDeptOpen ? `1px solid ${COLOURS.BORDER}` : "none",
                    }}>
                      <div style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: deptAccent(dept), flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>{dept}</span>
                        <span style={{ fontSize: "11px", color: COLOURS.SLATE, marginLeft: "8px" }}>
                          {allDeptMeetings.length} meeting{allDeptMeetings.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {/* Task stats pills */}
                      <div style={{ display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }}>
                        {stats.open > 0 && (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: RADII.PILL, backgroundColor: COLOURS.DANGER_SOFT, color: COLOURS.RED }}>
                            {stats.open} in progress
                          </span>
                        )}
                        {stats.pending > 0 && (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: RADII.PILL, backgroundColor: COLOURS.WARNING_SOFT, color: COLOURS.AMBER }}>
                            {stats.pending} pending
                          </span>
                        )}
                        {stats.completed > 0 && (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: RADII.PILL, backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN }}>
                            {stats.completed} done
                          </span>
                        )}
                        {stats.total === 0 && (
                          <span style={{ fontSize: "10px", color: COLOURS.SLATE }}>no tasks</span>
                        )}
                      </div>
                      <span style={{ color: COLOURS.SLATE, fontSize: "10px", flexShrink: 0 }}>{isDeptOpen ? "▲" : "▼"}</span>
                    </div>

                    {/* Month sub-groups */}
                    {isDeptOpen && (
                      <div>
                        {months.map(([month, monthMeetings]) => {
                          const monthKey = `${dept}:${month}`;
                          const isMonthOpen = expandedMonths.has(monthKey);
                          const monthStats = getTaskStatsFor(monthMeetings);

                          return (
                            <div key={monthKey} style={{ borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                              {/* Month header — indented compact row */}
                              <div onClick={() => toggleMonth(monthKey)} style={{
                                padding: "7px 14px 7px 28px", cursor: "pointer",
                                display: "flex", alignItems: "center", gap: "8px",
                                backgroundColor: isMonthOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                                borderBottom: isMonthOpen ? `1px solid ${COLOURS.BORDER}` : "none",
                              }}>
                                <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>📅</span>
                                <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, flex: 1 }}>{formatMonthLabel(month)}</span>
                                <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                                  {monthMeetings.length} mtg{monthMeetings.length !== 1 ? "s" : ""}
                                  {monthStats.open > 0 && <span style={{ color: COLOURS.RED }}> · {monthStats.open} in progress</span>}
                                  {monthStats.pending > 0 && <span style={{ color: COLOURS.AMBER }}> · {monthStats.pending} pending</span>}
                                  {monthStats.completed > 0 && <span style={{ color: COLOURS.GREEN }}> · {monthStats.completed} done</span>}
                                </span>
                                <span style={{ color: COLOURS.SLATE, fontSize: "10px", flexShrink: 0 }}>{isMonthOpen ? "▲" : "▼"}</span>
                              </div>

                              {/* Individual meetings within month */}
                              {isMonthOpen && (
                                <div style={{ paddingLeft: "14px" }}>
                                  {monthMeetings.map((m) => {
                                    const isOpen = expandedId === m.id;
                                    const mTasks = getTasksForMeeting(m.id);
                                    const completedTasks = mTasks.filter((t) => t.status === "Completed").length;
                                    const openTaskCount = mTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;
                                    return <MeetingCard key={m.id} m={m} mTasks={mTasks} completedTasks={completedTasks} openTaskCount={openTaskCount} isOpen={isOpen} setExpandedId={setExpandedId} downloadMinutesPDF={downloadMinutesPDF} isMobile={isMobile} showDept={false} />;
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })

            ) : null}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
