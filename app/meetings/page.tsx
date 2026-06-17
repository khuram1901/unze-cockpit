"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
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
  const [message, setMessage] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email || null;
    setCurrentUserEmail(email);

    if (email) {
      const { data: member } = await supabase
        .from("members")
        .select("role")
        .eq("email", email)
        .maybeSingle();
      if (member) setCurrentUserRole(member.role);
    }

    const { data: members } = await supabase
      .from("members")
      .select("first_name, last_name, name");
    if (members) {
      setMemberNames(members.map((m) => {
        const full = `${m.first_name || ""} ${m.last_name || ""}`.trim();
        return full || m.name || "";
      }).filter(Boolean));
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
      }
    } catch {
      setMessage("Error: Network error during extraction");
    }
    setExtracting(false);
  }

  async function handleSave() {
    if (!extracted) return;
    setSaving(true);

    // Convert DD/MM/YYYY to YYYY-MM-DD
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
      const { data: task } = await supabase
        .from("tasks")
        .insert({
          description: item.description,
          assigned_to: item.owner_name,
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
        tasksCreated++;
      }
    }

    setMessage(`Meeting saved and ${tasksCreated} task${tasksCreated !== 1 ? "s" : ""} created.`);
    setExtracted(null);
    setTranscript("");
    setSaving(false);
    loadData();
  }

  const canAccess = currentUserRole === "Admin" || currentUserRole === "Executive";

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader
          title="Meeting Minutes"
          subtitle="Paste a transcript or meeting notes — AI extracts structured minutes and creates tasks"
        />

        {message && (
          <div style={{
            border: `1px solid ${COLOURS.BORDER}`,
            borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
            borderRadius: "6px",
            padding: "10px 14px",
            marginBottom: "14px",
            backgroundColor: "white",
            fontSize: "16px",
            color: COLOURS.NAVY,
          }}>
            {message}
          </div>
        )}

        {/* Input section */}
        {!extracted && (
          <div style={{
            border: `1px solid ${COLOURS.BORDER}`,
            borderRadius: "8px",
            padding: "16px",
            backgroundColor: "white",
            marginBottom: "16px",
          }}>
            <SectionTitle title="Paste Transcript or Upload" />
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Paste the meeting transcript, raw notes, or pre-written minutes here..."
              style={{
                ...inputStyle,
                height: "200px",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={handleExtract}
              disabled={extracting || !transcript.trim()}
              style={{
                ...primaryButtonStyle,
                width: "100%",
                marginTop: "8px",
                opacity: extracting || !transcript.trim() ? 0.5 : 1,
              }}
            >
              {extracting ? "Extracting with AI..." : "Extract Meeting Minutes"}
            </button>
          </div>
        )}

        {/* Review section */}
        {extracted && (
          <div style={{
            border: `1px solid ${COLOURS.BORDER}`,
            borderRadius: "8px",
            padding: "16px",
            backgroundColor: "white",
            marginBottom: "16px",
          }}>
            <SectionTitle title="Review Extracted Minutes" />

            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Title</label>
              <input
                value={extracted.meeting_title}
                onChange={(e) => setExtracted({ ...extracted, meeting_title: e.target.value })}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div>
                <label style={labelStyle}>Date</label>
                <input value={extracted.meeting_date} onChange={(e) => setExtracted({ ...extracted, meeting_date: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Attendees</label>
                <input value={extracted.attendees.join(", ")} onChange={(e) => setExtracted({ ...extracted, attendees: e.target.value.split(",").map((s) => s.trim()) })} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Executive Summary</label>
              <textarea
                value={extracted.executive_summary}
                onChange={(e) => setExtracted({ ...extracted, executive_summary: e.target.value })}
                style={{ ...inputStyle, height: "80px", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div>
                <label style={labelStyle}>Decisions ({extracted.decisions.length})</label>
                {extracted.decisions.map((d, i) => (
                  <div key={i} style={{ fontSize: "15px", color: COLOURS.NAVY, padding: "4px 0", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                    {d}
                  </div>
                ))}
              </div>
              <div>
                <label style={labelStyle}>Risks ({extracted.risks.length})</label>
                {extracted.risks.map((r, i) => (
                  <div key={i} style={{ fontSize: "15px", color: COLOURS.RED, padding: "4px 0", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                    {r}
                  </div>
                ))}
              </div>
              <div>
                <label style={labelStyle}>Opportunities ({extracted.opportunities.length})</label>
                {extracted.opportunities.map((o, i) => (
                  <div key={i} style={{ fontSize: "15px", color: COLOURS.GREEN, padding: "4px 0", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                    {o}
                  </div>
                ))}
              </div>
            </div>

            <SectionTitle title={`Action Items (${extracted.action_items.length})`} />
            {extracted.action_items.map((item, i) => (
              <div key={i} style={{
                border: `1px solid ${COLOURS.BORDER}`,
                borderRadius: "6px",
                padding: "10px 12px",
                marginBottom: "8px",
                backgroundColor: "#f8fafc",
              }}>
                <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY, marginBottom: "4px" }}>
                  {item.description}
                </div>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "15px", color: COLOURS.SLATE }}>
                  <span>Owner: <strong>{item.owner_name}</strong></span>
                  {item.due_date && <span>Due: {item.due_date}</span>}
                  <PriorityBadge priority={item.priority} />
                  {item.department && <span>{item.department}</span>}
                </div>
              </div>
            ))}

            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button
                onClick={() => { setExtracted(null); }}
                style={{
                  ...primaryButtonStyle,
                  backgroundColor: "white",
                  color: COLOURS.NAVY,
                  border: `1px solid ${COLOURS.BORDER}`,
                  flex: 1,
                }}
              >
                Back to Edit
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ ...primaryButtonStyle, flex: 2, opacity: saving ? 0.5 : 1 }}
              >
                {saving ? "Saving..." : "Save & Create Tasks"}
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
              <div key={m.id} style={{
                border: `1px solid ${COLOURS.BORDER}`,
                borderRadius: "8px",
                padding: "10px 12px",
                backgroundColor: "white",
                marginBottom: "6px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY }}>{m.title}</div>
                    <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      {formatDateUK(m.meeting_date)}
                    </div>
                  </div>
                </div>
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
