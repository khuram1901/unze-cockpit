"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import {
  COLOURS,
  SectionTitle,
  PageHeader,
  PriorityBadge,
  StatusBadge,
  CountCard,
  primaryButtonStyle,
  labelStyle,
  inputStyle,
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
  const isMobile = useMobile();
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
  const [groupBy, setGroupBy] = useState<"date" | "department">("date");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

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

    const { data: meetingsData } = await supabase
      .from("meetings")
      .select("id, meeting_date, title, executive_summary, decisions, risks, opportunities, attendees, department, company, created_at")
      .order("meeting_date", { ascending: false })
      .limit(50);
    setMeetings(meetingsData || []);

    const { data: pendingData } = await supabase
      .from("pending_minutes")
      .select("*")
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
      const res = await fetch("/api/meetings/extract", {
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
      const res = await fetch("/api/meetings/parse-file", { method: "POST", body: formData });
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
      const res = await fetch("/api/meetings/check-inbox", { method: "POST" });
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
    if (!confirm("Dismiss this minute? It won't appear in the pending list again.")) return;
    await supabase
      .from("pending_minutes")
      .update({ status: "dismissed", reviewed_by: currentUserEmail, reviewed_at: new Date().toISOString() })
      .eq("id", pendingId);
    setPendingMinutes((prev) => prev.filter((p) => p.id !== pendingId));
  }

  async function handleApprove() {
    if (!extracted) return;
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
        department: extracted.department || "General",
        company: extracted.company || "General",
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

    let tasksCreated = 0;
    for (const item of extracted.action_items) {
      const memberMatch = bestMatch(item.owner_name, memberEmails);

      const { data: task } = await supabase
        .from("tasks")
        .insert({
          description: item.description,
          assigned_to: item.owner_name,
          assigned_to_email: memberMatch?.email || null,
          assigned_by: "Meeting Minutes",
          assigned_date: isoDate,
          due_date: item.due_date || null,
          priority: item.priority,
          status: "Not Started",
          project: extracted.meeting_title,
          assigned_to_department: item.department || null,
          meeting_id: meeting.id,
        })
        .select("id")
        .single();

      if (task) {
        await supabase.from("meeting_tasks").insert({
          meeting_id: meeting.id,
          task_id: task.id,
        });

        if (memberMatch?.email) {
          fetch("/api/notifications/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "task_assigned", taskId: task.id, recipientEmail: memberMatch.email }),
          }).catch(() => {});
        }

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
    setMessage(`Approved: meeting saved and ${tasksCreated} task${tasksCreated !== 1 ? "s" : ""} created.`);
    setSaving(false);

    const allRecipients = new Set<string>();
    for (const attendee of extracted.attendees) {
      const match = bestMatch(attendee, memberEmails);
      if (match?.email) allRecipients.add(match.email);
    }
    if (externalEmails.trim()) {
      externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).forEach((e) => allRecipients.add(e));
    }
    setSelectedRecipients(allRecipients);

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
      const res = await fetch("/api/meetings/send-minutes", {
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
        const dept = m.department || m.company || "General";
        if (!groups.has(dept)) groups.set(dept, []);
        groups.get(dept)!.push(m);
      }
      return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
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

  // Auto-expand latest group on first render
  if (expandedGroups.size === 0 && groupedMeetings.length > 0) {
    expandedGroups.add(groupedMeetings[0][0]);
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader
            title="Meeting Minutes"
            subtitle="Paste, upload, or email minutes — AI extracts — Review — Approve — Send"
          />
          <button onClick={() => setShowMinutesFlow(!showMinutesFlow)} style={{
            backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }} title="Add minutes">{showMinutesFlow ? "×" : "+"}</button>
        </div>

        {message && (
          <div style={{
            border: `1px solid ${COLOURS.BORDER}`,
            borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
            borderRadius: "6px", padding: "10px 14px", marginBottom: "14px",
            backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY,
          }}>
            {message}
          </div>
        )}

        {/* Summary strip */}
        {!showMinutesFlow && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: "8px", marginBottom: "14px" }}>
            <CountCard label="Pending Review" value={pendingMinutes.length} color={pendingMinutes.length > 0 ? "#d97706" : COLOURS.SLATE} />
            <CountCard label="This Month" value={thisMonthMeetings.length} color={COLOURS.NAVY} />
            <CountCard label="Open Tasks" value={openTasks.length} color={openTasks.length > 0 ? COLOURS.RED : COLOURS.GREEN} />
            <CountCard label="Total Meetings" value={meetings.length} color={COLOURS.BLUE} />
          </div>
        )}

        {/* Pending Review */}
        {pendingMinutes.length > 0 && !showMinutesFlow && (
          <div style={{ marginBottom: "16px" }}>
            <SectionTitle title={`Pending Review (${pendingMinutes.length})`} />
            {pendingMinutes.map((p) => (
              <div key={p.id} style={{
                border: `1px solid ${COLOURS.BORDER}`,
                borderLeft: `4px solid #d97706`,
                borderRadius: "8px", padding: "12px 14px", backgroundColor: "white", marginBottom: "8px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "15px", color: COLOURS.NAVY }}>
                      {p.subject || "Untitled Minutes"}
                    </div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      From: {p.from_address || "Unknown"}{p.email_date ? ` · ${p.email_date}` : ""}
                    </div>
                    <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "4px" }}>
                      {p.raw_text.slice(0, 150)}{p.raw_text.length > 150 ? "..." : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button onClick={() => handleReviewPending(p)} style={{
                      ...primaryButtonStyle, padding: "6px 14px", fontSize: "14px",
                    }}>Review</button>
                    <button onClick={() => handleDismissPending(p.id)} style={{
                      ...primaryButtonStyle, padding: "6px 14px", fontSize: "14px",
                      backgroundColor: "white", color: COLOURS.SLATE, border: `1px solid ${COLOURS.BORDER}`,
                    }}>Dismiss</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 1: Input */}
        {showMinutesFlow && step === "input" && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "16px", backgroundColor: "white", marginBottom: "16px" }}>
            <SectionTitle title="Step 1: Add Minutes" />

            <div style={{ display: "flex", gap: "0", marginBottom: "16px", borderBottom: `2px solid ${COLOURS.BORDER}` }}>
              {([
                { key: "paste" as const, label: "Paste Text" },
                { key: "upload" as const, label: "Upload File" },
                { key: "email" as const, label: "From Email" },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setInputMethod(tab.key)}
                  style={{
                    padding: "10px 20px",
                    fontSize: "15px",
                    fontWeight: inputMethod === tab.key ? 700 : 500,
                    color: inputMethod === tab.key ? COLOURS.NAVY : COLOURS.SLATE,
                    backgroundColor: "transparent",
                    border: "none",
                    borderBottom: inputMethod === tab.key ? `3px solid ${COLOURS.NAVY}` : "3px solid transparent",
                    cursor: "pointer",
                    marginBottom: "-2px",
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
                  borderRadius: "10px",
                  backgroundColor: dragging ? "#f0f4ff" : "#fafbfc",
                  transition: "all 0.2s ease",
                  cursor: uploading ? "wait" : "pointer",
                }}
              >
                <div style={{ fontSize: "36px", marginBottom: "10px", opacity: 0.5 }}>
                  {uploading ? "..." : ""}
                </div>
                <p style={{ fontSize: "17px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "6px" }}>
                  {uploading ? "Reading file..." : dragging ? "Drop your file here" : "Drag & drop your file here"}
                </p>
                <p style={{ fontSize: "15px", color: COLOURS.SLATE, marginBottom: "16px" }}>
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
                <p style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "14px" }}>
                  Supported: PDF, Word (.docx), Plain text (.txt)
                </p>
              </div>
            )}

            {inputMethod === "email" && (
              <div style={{ padding: "8px 0" }}>
                <div style={{ backgroundColor: "#f8fafc", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", marginBottom: "16px" }}>
                  <p style={{ fontSize: "15px", color: COLOURS.NAVY, fontWeight: 700, marginBottom: "6px" }}>
                    How it works
                  </p>
                  <ol style={{ fontSize: "15px", color: COLOURS.SLATE, margin: 0, paddingLeft: "20px", lineHeight: 1.8 }}>
                    <li>Forward your minutes email to <strong>unzegrouppk@gmail.com</strong></li>
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
                    <p style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>
                      Select an email to extract:
                    </p>
                    {emailResults.map((email) => (
                      <div key={email.id} style={{
                        border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "10px 12px",
                        marginBottom: "6px", backgroundColor: "white", cursor: "pointer",
                      }}
                        onClick={() => selectEmailMinutes(email.text)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = COLOURS.NAVY; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = COLOURS.BORDER; }}
                      >
                        <div style={{ fontWeight: 700, fontSize: "15px", color: COLOURS.NAVY }}>{email.subject}</div>
                        <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "2px" }}>
                          From: {email.from} · {email.date}
                        </div>
                        <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "4px" }}>
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
            setExtracted({ ...extracted, action_items: [...extracted.action_items, { description: "", owner_name: "", priority: "Medium", due_date: "", department: "" }] });
          };
          const smallField: React.CSSProperties = { ...inputStyle, fontSize: "14px", padding: "6px 8px" };

          return (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "16px", backgroundColor: "white", marginBottom: "16px" }}>
            <SectionTitle title="Step 2: Review & Approve" />
            <p style={{ fontSize: "15px", color: COLOURS.SLATE, marginBottom: "12px" }}>
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
                  {["General", "Unze Trading", "Imperial Footwear", "Haute Dolci", "Barahn", "K&K Jhang"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Department</label>
                <select value={extracted.department} onChange={(e) => setExtracted({ ...extracted, department: e.target.value })} style={inputStyle}>
                  {["General", "Unze Trading Ops", "Finance", "HR", "Audit", "Taxation", "Admin"].map((d) => (
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
              <button onClick={addActionItem} style={{
                backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
                padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer",
              }}>
                + Add Task
              </button>
            </div>

            {extracted.action_items.map((item, i) => (
              <div key={i} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "12px", marginBottom: "8px", backgroundColor: "#f8fafc" }}>
                <div style={{ marginBottom: "8px" }}>
                  <input value={item.description} onChange={(e) => updateActionItem(i, { description: e.target.value })}
                    placeholder="Task description" style={{ ...inputStyle, fontWeight: 600 }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr auto", gap: "8px", alignItems: "end" }}>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px" }}>Owner</label>
                    <select value={item.owner_name} onChange={(e) => updateActionItem(i, { owner_name: e.target.value })} style={smallField}>
                      <option value="">Select owner</option>
                      {memberDetails.filter((m) => m.role === "Manager" || m.role === "Executive" || m.role === "Admin").map((m) => (
                        <option key={m.name} value={m.name}>{m.name} ({m.role})</option>
                      ))}
                      {item.owner_name && !memberDetails.find((m) => m.name === item.owner_name) && (
                        <option value={item.owner_name}>{item.owner_name} (not matched)</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px" }}>Priority</label>
                    <select value={item.priority} onChange={(e) => updateActionItem(i, { priority: e.target.value })} style={smallField}>
                      {["Low", "Medium", "High", "Urgent"].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px" }}>Due Date</label>
                    <input type="date" value={item.due_date || ""} onChange={(e) => updateActionItem(i, { due_date: e.target.value })} style={smallField} />
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
                    style={{ backgroundColor: "white", border: `1px solid #dc2626`, color: "#dc2626", borderRadius: "6px", padding: "6px 10px", fontSize: "14px", cursor: "pointer", height: "fit-content" }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}

            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>External Attendee Emails (comma-separated, optional)</label>
              <input value={externalEmails} onChange={(e) => setExternalEmails(e.target.value)}
                placeholder="e.g. john@external.com, jane@supplier.com" style={inputStyle} />
              <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "-6px" }}>
                These people will receive the minutes email but no tasks will be created for them.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button onClick={() => { setStep("input"); setMessage(""); }}
                style={{ ...primaryButtonStyle, backgroundColor: "white", color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`, flex: 1 }}>
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
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "16px", backgroundColor: "white", marginBottom: "16px" }}>
            <SectionTitle title="Step 3: Send Minutes" />
            <p style={{ fontSize: "15px", color: COLOURS.NAVY, marginBottom: "12px" }}>
              Meeting saved and tasks created. Select who should receive the minutes email.
            </p>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={labelStyle}>Recipients ({selectedRecipients.size} selected)</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={selectAll} style={{ fontSize: "13px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Select All</button>
                  <button onClick={deselectAll} style={{ fontSize: "13px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Deselect All</button>
                </div>
              </div>

              {extracted.attendees.map((a) => {
                const match = bestMatch(a, memberEmails);
                if (!match?.email) return (
                  <div key={a} style={{ padding: "4px 0", fontSize: "14px", color: COLOURS.SLATE }}>
                    {a} <span style={{ fontSize: "12px", color: "#d97706" }}>(no email match)</span>
                  </div>
                );
                return (
                  <label key={a} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", fontSize: "14px", color: COLOURS.NAVY, cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedRecipients.has(match.email)}
                      onChange={() => toggleRecipient(match.email)} style={{ width: "16px", height: "16px" }} />
                    <span style={{ fontWeight: 600 }}>{a}</span>
                    <span style={{ color: COLOURS.SLATE }}>{match.email}</span>
                  </label>
                );
              })}

              {externalEmails.trim() && externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).map((ext) => (
                <label key={ext} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", fontSize: "14px", color: COLOURS.NAVY, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedRecipients.has(ext)}
                    onChange={() => toggleRecipient(ext)} style={{ width: "16px", height: "16px" }} />
                  <span style={{ fontWeight: 600 }}>{ext}</span>
                  <span style={{ fontSize: "12px", color: COLOURS.BLUE }}>(external)</span>
                </label>
              ))}

              <div style={{ marginTop: "8px", display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="email" placeholder="Add another email..."
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
              <button onClick={handleSendMinutes} disabled={sending || selectedRecipients.size === 0}
                style={{ ...primaryButtonStyle, flex: 2, opacity: sending || selectedRecipients.size === 0 ? 0.5 : 1 }}>
                {sending ? "Sending..." : `Send to ${selectedRecipients.size} Recipient${selectedRecipients.size !== 1 ? "s" : ""}`}
              </button>
              <button onClick={resetAll}
                style={{ ...primaryButtonStyle, backgroundColor: "white", color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`, flex: 1 }}>
                Done
              </button>
            </div>
          </div>
          );
        })()}

        {/* Past meetings */}
        {!showMinutesFlow && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <SectionTitle title="Past Meetings" />
              <div style={{ display: "flex", gap: "4px" }}>
                {(["date", "department"] as const).map((g) => (
                  <button key={g} onClick={() => { setGroupBy(g); setExpandedGroups(new Set()); }} style={{
                    padding: "4px 12px", fontSize: "13px", fontWeight: groupBy === g ? 700 : 500, borderRadius: "14px",
                    border: `1px solid ${groupBy === g ? COLOURS.NAVY : COLOURS.BORDER}`,
                    backgroundColor: groupBy === g ? COLOURS.NAVY : "white",
                    color: groupBy === g ? "white" : COLOURS.SLATE, cursor: "pointer",
                  }}>
                    {g === "date" ? "By Date" : "By Department"}
                  </button>
                ))}
              </div>
            </div>

            {meetings.length === 0 ? (
              <p style={{ color: COLOURS.SLATE, fontSize: "16px" }}>No meetings recorded yet.</p>
            ) : (
              groupedMeetings.map(([groupKey, groupMeetings]) => {
                const isGroupOpen = expandedGroups.has(groupKey);
                const groupLabel = groupBy === "date" ? formatMonthLabel(groupKey) : groupKey;
                const groupTasks = groupMeetings.flatMap((m) => getTasksForMeeting(m.id));
                const groupOpen = groupTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;

                return (
                <div key={groupKey} style={{
                  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "10px", backgroundColor: "white",
                  overflow: "hidden", marginBottom: "10px",
                }}>
                  <div onClick={() => toggleGroup(groupKey)} style={{
                    padding: "12px 16px", cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    backgroundColor: isGroupOpen ? COLOURS.NAVY : "white",
                    borderBottom: isGroupOpen ? `1px solid ${COLOURS.BORDER}` : "none",
                  }}>
                    <div>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: isGroupOpen ? "white" : COLOURS.NAVY }}>
                        {groupLabel}
                      </div>
                      <div style={{ fontSize: "12px", color: isGroupOpen ? "rgba(255,255,255,0.7)" : COLOURS.SLATE, marginTop: "1px" }}>
                        {groupMeetings.length} meeting{groupMeetings.length !== 1 ? "s" : ""}
                        {groupOpen > 0 && <span style={{ color: isGroupOpen ? "#fbbf24" : "#d97706", fontWeight: 700 }}> · {groupOpen} open task{groupOpen !== 1 ? "s" : ""}</span>}
                      </div>
                    </div>
                    <span style={{ color: isGroupOpen ? "white" : COLOURS.SLATE, fontSize: "14px" }}>{isGroupOpen ? "▲" : "▼"}</span>
                  </div>

                  {isGroupOpen && groupMeetings.map((m) => {
                    const isOpen = expandedId === m.id;
                    const mTasks = getTasksForMeeting(m.id);
                    const completedTasks = mTasks.filter((t) => t.status === "Completed").length;
                    const openTaskCount = mTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;

                    return (
                      <div key={m.id} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "6px" }}>
                        <div onClick={() => setExpandedId(isOpen ? null : m.id)} style={{
                          padding: "10px 14px", cursor: "pointer",
                          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                          backgroundColor: isOpen ? "#f8fafc" : "white",
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE, minWidth: "80px" }}>{formatDateUK(m.meeting_date)}</span>
                              <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>{m.title}</span>
                            </div>
                            {mTasks.length > 0 && (
                              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                                {completedTasks}/{mTasks.length} tasks done
                                {openTaskCount > 0 && <span style={{ color: "#d97706", fontWeight: 700 }}> · {openTaskCount} open</span>}
                              </div>
                            )}
                          </div>
                          <span style={{ color: COLOURS.SLATE, fontSize: "13px", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                        </div>

                        {isOpen && (
                          <div style={{ padding: "14px", borderTop: `1px solid ${COLOURS.BORDER}` }}>
                            {m.executive_summary && (
                              <div style={{ marginBottom: "12px" }}>
                                <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>Summary</div>
                                <div style={{ fontSize: "14px", color: COLOURS.SLATE, lineHeight: 1.6 }}>{m.executive_summary}</div>
                              </div>
                            )}

                            {m.attendees && m.attendees.length > 0 && (
                              <div style={{ marginBottom: "12px" }}>
                                <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>Attendees</div>
                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                  {m.attendees.map((a, i) => (
                                    <span key={i} style={{ fontSize: "12px", padding: "2px 8px", backgroundColor: COLOURS.LIGHT, borderRadius: "10px", color: COLOURS.NAVY }}>{a}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                              {m.decisions && m.decisions.length > 0 && (
                                <div>
                                  <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.GREEN, marginBottom: "4px" }}>Decisions ({m.decisions.length})</div>
                                  {m.decisions.map((d, i) => (
                                    <div key={i} style={{ fontSize: "13px", color: COLOURS.NAVY, padding: "3px 0", borderBottom: `1px solid ${COLOURS.LIGHT}` }}>• {d}</div>
                                  ))}
                                </div>
                              )}
                              {m.risks && m.risks.length > 0 && (
                                <div>
                                  <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.RED, marginBottom: "4px" }}>Risks ({m.risks.length})</div>
                                  {m.risks.map((r, i) => (
                                    <div key={i} style={{ fontSize: "13px", color: COLOURS.NAVY, padding: "3px 0", borderBottom: `1px solid ${COLOURS.LIGHT}` }}>• {r}</div>
                                  ))}
                                </div>
                              )}
                              {m.opportunities && m.opportunities.length > 0 && (
                                <div>
                                  <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.BLUE, marginBottom: "4px" }}>Opportunities ({m.opportunities.length})</div>
                                  {m.opportunities.map((o, i) => (
                                    <div key={i} style={{ fontSize: "13px", color: COLOURS.NAVY, padding: "3px 0", borderBottom: `1px solid ${COLOURS.LIGHT}` }}>• {o}</div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: "#d97706", marginBottom: "6px" }}>
                                Action Items ({mTasks.length})
                              </div>
                              {mTasks.length > 0 ? (
                                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", overflow: "hidden" }}>
                                  {mTasks.map((t) => (
                                    <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                                      display: "flex", justifyContent: "space-between", alignItems: "center",
                                      padding: "8px 12px", borderBottom: `1px solid ${COLOURS.LIGHT}`,
                                      textDecoration: "none", color: "inherit",
                                    }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{t.description}</div>
                                        <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                                          {t.assigned_to || "Unassigned"}{t.due_date ? ` · Due: ${formatDateUK(t.due_date)}` : ""}
                                        </div>
                                      </div>
                                      <StatusBadge status={t.status} />
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ fontSize: "14px", color: COLOURS.SLATE }}>No action items recorded.</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
