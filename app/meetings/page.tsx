"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import MyTasks from "../lib/MyTasks";
import {
  COLOURS,
  SectionTitle,
  PageHeader,
  PriorityBadge,
  primaryButtonStyle,
  labelStyle,
  inputStyle,
} from "../lib/SharedUI";

type ExtractedMinutes = {
  meeting_title: string;
  meeting_date: string;
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
  created_at: string;
};

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
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Step tracking: extract → review → approve → send
  const [step, setStep] = useState<"input" | "review" | "approved">("input");

  // External attendee emails
  const [externalEmails, setExternalEmails] = useState("");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserEmail(user?.email || null);

    const { data: members } = await supabase
      .from("members")
      .select("first_name, last_name, name, email");
    if (members) {
      setMemberNames(members.map((m) => {
        const full = `${m.first_name || ""} ${m.last_name || ""}`.trim();
        return full || m.name || "";
      }).filter(Boolean));
      setMemberEmails(members.map((m) => ({
        name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "",
        email: m.email || "",
      })).filter((m) => m.email));
    }

    const { data: meetingsData } = await supabase
      .from("meetings")
      .select("id, meeting_date, title, executive_summary, created_at")
      .order("meeting_date", { ascending: false })
      .limit(20);
    setMeetings(meetingsData || []);
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
        body: JSON.stringify({ transcript, memberNames }),
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
      const memberMatch = memberEmails.find((m) => m.name.toLowerCase().includes(item.owner_name.toLowerCase()) || item.owner_name.toLowerCase().includes(m.name.toLowerCase()));

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

        // Notify assignee
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

    logAction("Created", "meetings", `${extracted.meeting_title} - ${tasksCreated} tasks created`, meeting.id);
    setMessage(`Approved: meeting saved and ${tasksCreated} task${tasksCreated !== 1 ? "s" : ""} created.`);
    setSaving(false);
    setStep("approved");
    loadData();
  }

  async function handleSendMinutes() {
    if (!extracted) return;
    setSending(true);

    // Collect all emails: internal attendees + external
    const allEmails: string[] = [];

    // Match attendee names to member emails
    for (const attendee of extracted.attendees) {
      const match = memberEmails.find((m) => m.name.toLowerCase().includes(attendee.toLowerCase()) || attendee.toLowerCase().includes(m.name.toLowerCase()));
      if (match?.email) allEmails.push(match.email);
    }

    // Add external emails
    if (externalEmails.trim()) {
      const extras = externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@"));
      allEmails.push(...extras);
    }

    const uniqueEmails = Array.from(new Set(allEmails));

    if (uniqueEmails.length === 0) {
      setMessage("No attendee emails found. Add external emails or check attendee names match members.");
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
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader
          title="Meeting Minutes"
          subtitle="Paste transcript → AI extracts → Review → Approve → Send to attendees"
        />

        <MyTasks />

        {message && (
          <div style={{
            border: `1px solid ${COLOURS.BORDER}`,
            borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
            borderRadius: "6px", padding: "10px 14px", marginBottom: "14px",
            backgroundColor: "white", fontSize: "16px", color: COLOURS.NAVY,
          }}>
            {message}
          </div>
        )}

        {/* Step 1: Input */}
        {step === "input" && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "16px", backgroundColor: "white", marginBottom: "16px" }}>
            <SectionTitle title="Step 1: Paste Transcript" />
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
          </div>
        )}

        {/* Step 2: Review & Edit */}
        {step === "review" && extracted && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "16px", backgroundColor: "white", marginBottom: "16px" }}>
            <SectionTitle title="Step 2: Review & Approve" />
            <p style={{ fontSize: "15px", color: COLOURS.SLATE, marginBottom: "12px" }}>
              Review the extracted minutes below. Edit anything that needs changing, then approve to create tasks and save.
            </p>

            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Title</label>
              <input value={extracted.meeting_title} onChange={(e) => setExtracted({ ...extracted, meeting_title: e.target.value })} style={inputStyle} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div>
                <label style={labelStyle}>Date</label>
                <input value={extracted.meeting_date} onChange={(e) => setExtracted({ ...extracted, meeting_date: e.target.value })} style={inputStyle} />
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
                <label style={labelStyle}>Decisions ({extracted.decisions.length})</label>
                {extracted.decisions.map((d, i) => (
                  <div key={i} style={{ fontSize: "15px", color: COLOURS.NAVY, padding: "4px 0", borderBottom: `1px solid ${COLOURS.BORDER}` }}>{d}</div>
                ))}
              </div>
              <div>
                <label style={labelStyle}>Risks ({extracted.risks.length})</label>
                {extracted.risks.map((r, i) => (
                  <div key={i} style={{ fontSize: "15px", color: COLOURS.RED, padding: "4px 0", borderBottom: `1px solid ${COLOURS.BORDER}` }}>{r}</div>
                ))}
              </div>
              <div>
                <label style={labelStyle}>Opportunities ({extracted.opportunities.length})</label>
                {extracted.opportunities.map((o, i) => (
                  <div key={i} style={{ fontSize: "15px", color: COLOURS.GREEN, padding: "4px 0", borderBottom: `1px solid ${COLOURS.BORDER}` }}>{o}</div>
                ))}
              </div>
            </div>

            <SectionTitle title={`Action Items (${extracted.action_items.length})`} />
            {extracted.action_items.map((item, i) => (
              <div key={i} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "10px 12px", marginBottom: "8px", backgroundColor: "#f8fafc" }}>
                <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY, marginBottom: "4px" }}>{item.description}</div>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "15px", color: COLOURS.SLATE }}>
                  <span>Owner: <strong>{item.owner_name}</strong></span>
                  {item.due_date && <span>Due: {item.due_date}</span>}
                  <PriorityBadge priority={item.priority} />
                  {item.department && <span>{item.department}</span>}
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
        )}

        {/* Step 3: Approved — send to attendees */}
        {step === "approved" && extracted && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "16px", backgroundColor: "white", marginBottom: "16px" }}>
            <SectionTitle title="Step 3: Send Minutes to Attendees" />
            <p style={{ fontSize: "15px", color: COLOURS.NAVY, marginBottom: "12px" }}>
              Meeting saved and tasks created. Now send the minutes to all attendees.
            </p>

            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Internal attendees (matched to members)</label>
              <div style={{ fontSize: "15px", color: COLOURS.NAVY }}>
                {extracted.attendees.map((a) => {
                  const match = memberEmails.find((m) => m.name.toLowerCase().includes(a.toLowerCase()));
                  return (
                    <span key={a} style={{ display: "inline-block", padding: "3px 10px", margin: "2px 4px", borderRadius: "12px", fontSize: "14px", backgroundColor: match ? "#dcfce7" : "#fef3c7", color: match ? "#166534" : "#92400e" }}>
                      {a} {match ? `(${match.email})` : "(no email match)"}
                    </span>
                  );
                })}
              </div>
            </div>

            {externalEmails.trim() && (
              <div style={{ marginBottom: "12px" }}>
                <label style={labelStyle}>External attendees</label>
                <div style={{ fontSize: "15px", color: COLOURS.NAVY }}>
                  {externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).map((e) => (
                    <span key={e} style={{ display: "inline-block", padding: "3px 10px", margin: "2px 4px", borderRadius: "12px", fontSize: "14px", backgroundColor: "#dbeafe", color: "#1e40af" }}>
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={handleSendMinutes} disabled={sending}
                style={{ ...primaryButtonStyle, flex: 2, opacity: sending ? 0.5 : 1 }}>
                {sending ? "Sending..." : "Send Minutes to All Attendees"}
              </button>
              <button onClick={resetAll}
                style={{ ...primaryButtonStyle, backgroundColor: "white", color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`, flex: 1 }}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Past meetings */}
        <SectionTitle title="Past Meetings" />
        {meetings.length === 0 ? (
          <p style={{ color: COLOURS.SLATE, fontSize: "16px" }}>No meetings recorded yet.</p>
        ) : (
          <div>
            {meetings.map((m) => (
              <div key={m.id} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "10px 12px", backgroundColor: "white", marginBottom: "6px" }}>
                <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY }}>{m.title}</div>
                <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "2px" }}>{formatDateUK(m.meeting_date)}</div>
                {m.executive_summary && (
                  <div style={{ fontSize: "15px", color: COLOURS.SLATE, marginTop: "6px", lineHeight: 1.5 }}>
                    {m.executive_summary.slice(0, 200)}{m.executive_summary.length > 200 ? "..." : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}
