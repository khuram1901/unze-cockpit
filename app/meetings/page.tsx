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
  created_at: string;
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

  // Step tracking: extract → review → approve → send
  const [step, setStep] = useState<"input" | "review" | "approved">("input");
  const [showMinutesFlow, setShowMinutesFlow] = useState(false);

  // Input method tab
  const [inputMethod, setInputMethod] = useState<"paste" | "upload" | "email">("paste");
  const [uploading, setUploading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [emailResults, setEmailResults] = useState<{ id: string; subject: string; from: string; date: string; text: string }[]>([]);

  // External attendee emails
  const [externalEmails, setExternalEmails] = useState("");

  // Selected recipients for sending minutes
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());

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
        setMessage(`Found ${data.emails.length} unread minutes email${data.emails.length !== 1 ? "s" : ""}.`);
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

    // Link meeting to HOD attendees
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

    logAction("Created", "meetings", `${extracted.meeting_title} - ${tasksCreated} tasks created`, meeting.id);
    setMessage(`Approved: meeting saved and ${tasksCreated} task${tasksCreated !== 1 ? "s" : ""} created.`);
    setSaving(false);

    // Pre-select all matched attendee emails + external emails
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
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader
            title="Meeting Minutes"
            subtitle="Paste, upload, or email minutes → AI extracts → Review → Approve → Send"
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

        {/* Step 1: Input */}
        {showMinutesFlow && step === "input" && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "16px", backgroundColor: "white", marginBottom: "16px" }}>
            <SectionTitle title="Step 1: Add Minutes" />

            {/* Input method tabs */}
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

            {/* Paste tab */}
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

            {/* Upload tab */}
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
                  {uploading ? "..." : "⬆️"}
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

            {/* Email tab */}
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

              {/* Internal attendees */}
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

              {/* External emails */}
              {externalEmails.trim() && externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).map((ext) => (
                <label key={ext} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", fontSize: "14px", color: COLOURS.NAVY, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedRecipients.has(ext)}
                    onChange={() => toggleRecipient(ext)} style={{ width: "16px", height: "16px" }} />
                  <span style={{ fontWeight: 600 }}>{ext}</span>
                  <span style={{ fontSize: "12px", color: COLOURS.BLUE }}>(external)</span>
                </label>
              ))}

              {/* Add extra recipient */}
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
