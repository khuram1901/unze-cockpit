"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import {
  COLOURS,
  SectionTitle,
  PageHeader,
  StatusBadge,
  PriorityBadge,
  tableHeaderStyle,
  tableCellStyle,
  WARNING_BANNER_STYLE,
  WARNING_TITLE_COLOR,
} from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { canManageCalendarRequests, isAdminTier, type PermOverrides, type UserCtx } from "../lib/permissions";

type MeetingRequest = {
  id: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  requested_by_department: string | null;
  meeting_title: string;
  meeting_purpose: string | null;
  meeting_type: string | null;
  requested_date: string | null;
  preferred_time: string | null;
  duration_minutes: number | null;
  priority: string | null;
  status: string | null;
  attendees: string[] | null;
  decision_required: boolean | null;
  approved_by: string | null;
  calendar_event_id: string | null;
  created_at: string;
};

type Member = {
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  department: string | null;
  role: string | null;
  is_hod: boolean;
};

type BusySlot = { start: string; end: string; title?: string; account?: string };
type AccountResult = { email: string; status: string; busyCount: number; error?: string };

const MEETING_TYPES = ["Operations", "Strategy", "Finance", "Ad-hoc", "HR", "Legal"];
const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8am to 6pm

function getWeekDates(startDate: string): string[] {
  const d = new Date(startDate + "T00:00:00");
  const dayOfWeek = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

function displayMemberName(member: Member | null, email: string | null) {
  if (!member) return email || "User";
  const fullName = `${member.first_name || ""} ${member.last_name || ""}`.trim();
  return fullName || member.name || email || "User";
}

export default function CalendarPage() {
  const [requests, setRequests] = useState<MeetingRequest[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [meetingType, setMeetingType] = useState("Ad-hoc");
  const [requestedDate, setRequestedDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [priority, setPriority] = useState("Normal");
  const [decisionRequired, setDecisionRequired] = useState(false);
  const [selectedAttendees, setSelectedAttendees] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  // Week view
  const [weekStart, setWeekStart] = useState(new Date().toISOString().slice(0, 10));
  const [busySlots, setBusySlots] = useState<BusySlot[]>([]);
  const [busyLoading, setBusyLoading] = useState(false);
  const [calendarAccounts, setCalendarAccounts] = useState<AccountResult[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const isMobile = useMobile();
  const [permOverrides, setPermOverrides] = useState<PermOverrides | null>(null);
  const calCtx: UserCtx | null = member ? { email: member.email, role: member.role, department: member.department, overrides: permOverrides } : null;
  const canManageRequests = calCtx ? canManageCalendarRequests(calCtx) : false;
  const isAdmin = calCtx ? isAdminTier(calCtx) : false;

  async function loadData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const userEmail = userData.user?.email || null;
    setEmail(userEmail);

    if (userEmail) {
      const { data: memberData } = await supabase
        .from("members")
        .select("id, first_name, last_name, name, email, department, role, is_hod")
        .eq("email", userEmail)
        .single();
      if (memberData) {
        setMember(memberData);
        const perms = await loadMyPermissions();
        if (perms) setPermOverrides(perms as PermOverrides);
      }
    }

    const [reqRes, membersRes] = await Promise.all([
      supabase.from("meeting_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("members").select("first_name, last_name, name, email, department, role, is_hod"),
    ]);

    setRequests(reqRes.data || []);
    setAllMembers(membersRes.data || []);
    setLoading(false);
  }

  async function loadFreeBusy(date: string) {
    setBusyLoading(true);
    setCalendarError(null);
    try {
      const res = await fetch(`/api/calendar/freebusy?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setBusySlots(data.busy || []);
        setCalendarAccounts(data.accountResults || []);
        if (data.debug === "no_tokens") {
          setCalendarError("Google Calendar not connected. Ask an admin to connect via Finance → Connect Gmail.");
        } else if (data.accountResults) {
          const failed = (data.accountResults as AccountResult[]).filter((a) => a.status === "failed");
          if (failed.length > 0) {
            setCalendarError(`Calendar sync failed for ${failed.map((f) => f.email).join(", ")}: ${failed[0].error?.slice(0, 100)}`);
          }
        }
      } else {
        setCalendarError("Failed to load calendar data.");
      }
    } catch {
      setCalendarError("Could not reach calendar API.");
    }
    setBusyLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadFreeBusy(weekStart);
  }, [weekStart]);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const { error } = await supabase.from("meeting_requests").insert({
      requested_by_name: displayMemberName(member, email),
      requested_by_email: email,
      requested_by_department: member?.department || null,
      meeting_title: title,
      meeting_purpose: purpose || null,
      meeting_type: meetingType,
      requested_date: requestedDate || null,
      preferred_time: preferredTime || null,
      duration_minutes: Number(duration) || 30,
      priority,
      decision_required: decisionRequired,
      attendees: selectedAttendees.length > 0 ? selectedAttendees : null,
      status: "Pending",
      approved_by: null,
    });

    setSaving(false);

    if (error) {
      setMessage("Error: " + error.message);
      return;
    }

    setTitle("");
    setPurpose("");
    setMeetingType("Ad-hoc");
    setRequestedDate("");
    setPreferredTime("");
    setDuration("30");
    setPriority("Normal");
    setDecisionRequired(false);
    setSelectedAttendees([]);
    logAction("Created", "meeting_requests", `${title} — pending approval`);
    setMessage("Meeting request submitted — awaiting CEO/Executive approval.");
    loadData();
  }

  async function updateStatus(id: string, status: string) {
    const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "Approved" && canManageRequests) {
      updates.approved_by = displayMemberName(member, email);
    }
    await supabase.from("meeting_requests").update(updates).eq("id", id);
    loadData();
  }

  function toggleAttendee(memberEmail: string) {
    setSelectedAttendees((prev) =>
      prev.includes(memberEmail) ? prev.filter((e) => e !== memberEmail) : [...prev, memberEmail]
    );
  }

  // Week view helpers
  const weekDates = getWeekDates(weekStart);

  function getBusyEvent(date: string, hour: number): BusySlot | null {
    const slotStart = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+05:00`);
    const slotEnd = new Date(`${date}T${String(hour + 1).padStart(2, "0")}:00:00+05:00`);
    return busySlots.find((b) => {
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return bStart < slotEnd && bEnd > slotStart;
    }) || null;
  }

  function hasRequest(date: string, hour: number): MeetingRequest | undefined {
    return requests.find((r) => {
      if (!r.requested_date || r.requested_date !== date) return false;
      if (!r.preferred_time) return false;
      const timeMatch = r.preferred_time.match(/(\d{1,2})/);
      if (!timeMatch) return false;
      const reqHour = parseInt(timeMatch[1]);
      return reqHour === hour || (reqHour === hour - 12 && hour > 12);
    });
  }

  function prevWeek() {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() - 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function nextWeek() {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() + 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function clickSlot(date: string, hour: number) {
    setRequestedDate(date);
    setPreferredTime(`${String(hour).padStart(2, "0")}:00`);
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader />
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }} title="Request meeting">{showForm ? "×" : "+"}</button>
        </div>

        {/* ── REQUEST FORM (collapsible) ── */}
        {showForm && (
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(280px, 500px) minmax(200px, 1fr)",
          gap: "16px",
          alignItems: "start",
          marginBottom: "14px",
        }}>
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "10px" }}>Request a Meeting</div>
            <form onSubmit={submitRequest}>
              <label style={labelStyle}>
                Meeting title
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dispatch recovery discussion" required />
              </label>

              <label style={labelStyle}>
                Purpose
                <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" }} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Why do you need this meeting?" />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                <label style={labelStyle}>
                  Type
                  <select style={inputStyle} value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
                    {MEETING_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>

                <label style={labelStyle}>
                  Date
                  <input type="date" style={inputStyle} value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
                </label>
              </div>

              {requestedDate && (
                <p style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)", marginTop: "-6px", marginBottom: "10px" }}>
                  Selected: <strong>{formatDateUK(requestedDate)}</strong>
                </p>
              )}

              <label style={labelStyle}>
                Preferred time
                <input type="time" style={inputStyle} value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                <label style={labelStyle}>
                  Duration
                  <select style={inputStyle} value={duration} onChange={(e) => setDuration(e.target.value)}>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                  </select>
                </label>

                <label style={labelStyle}>
                  Priority
                  <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option>Low</option>
                    <option>Normal</option>
                    <option>High</option>
                    <option>Urgent</option>
                  </select>
                </label>
              </div>

              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "8px" }}>
                <input type="checkbox" checked={decisionRequired} onChange={(e) => setDecisionRequired(e.target.checked)} style={{ width: "16px", height: "16px" }} />
                Decision required from CEO
              </label>

              {/* Attendees multi-select */}
              <div style={{ ...labelStyle, marginBottom: "12px" }}>
                Attendees
                <div style={{
                  border: "1px solid var(--border-color, #e2e8f0)",
                  borderRadius: "6px",
                  padding: "6px",
                  marginTop: "3px",
                  maxHeight: "120px",
                  overflowY: "auto",
                }}>
                  {allMembers.filter((m) => m.email && m.email !== email).map((m) => (
                    <label key={m.email} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "2px 4px", fontSize: "16px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedAttendees.includes(m.email || "")}
                        onChange={() => toggleAttendee(m.email || "")}
                        style={{ width: "14px", height: "14px" }}
                      />
                      {displayMemberName(m, m.email)}
                      {m.department && <span style={{ color: "var(--text-secondary, #64748b)", fontSize: "14px" }}>({m.department})</span>}
                    </label>
                  ))}
                </div>
              </div>

              <button type="submit" disabled={saving} style={btnStyle}>
                {saving ? "Submitting…" : "Submit Meeting Request"}
              </button>

              {message && (
                <p style={{ marginTop: "10px", fontSize: "17px", color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN, fontWeight: 600 }}>
                  {message}
                </p>
              )}
            </form>
          </div>
        </div>
        )}

        {/* ── Calendar Connection Status ── */}
        {calendarError && (
          <div style={{ ...WARNING_BANNER_STYLE, padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                <span style={{ fontSize: "18px" }}>⚠</span>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>Google Calendar Not Syncing</div>
                  <div style={{ fontSize: "13px", color: WARNING_TITLE_COLOR, marginTop: "3px" }}>{calendarError}</div>
                </div>
              </div>
              {isAdmin && (
                <a href="/api/google/auth" style={{
                  backgroundColor: "#dc2626", color: "white", border: "none", borderRadius: "8px",
                  padding: "8px 18px", fontSize: "14px", fontWeight: 700, textDecoration: "none",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  Reconnect Google Calendar
                </a>
              )}
            </div>
            <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "8px", paddingLeft: "28px" }}>
              Sign in with the Google account whose calendar you want to mirror (e.g. khuram1901@gmail.com).
            </div>
          </div>
        )}
        {!calendarError && !busyLoading && calendarAccounts.length > 0 && (
          <div style={{
            border: "1px solid #bbf7d0", borderLeft: "4px solid #16a34a", borderRadius: "8px",
            backgroundColor: "#f0fdf4", padding: "8px 16px", marginBottom: "12px",
            display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "#166534",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "14px" }}>✓</span>
              Showing calendar for {calendarAccounts.map((a) => a.email).join(", ")} · {busySlots.length} event{busySlots.length !== 1 ? "s" : ""} this week
            </div>
            {isAdmin && (
              <a href="/api/google/auth" style={{
                color: "#166534", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
                border: "1px solid #86efac", borderRadius: "6px", padding: "4px 12px", fontSize: "12px",
              }}>
                + Add Account
              </a>
            )}
          </div>
        )}

        {/* ── WEEK VIEW ── */}
        <SectionTitle title="Weekly Availability" />
        <div style={{
          border: "1px solid var(--border-color, #e2e8f0)",
          borderRadius: "8px",
          backgroundColor: "var(--bg-card, #ffffff)",
          padding: "12px",
          marginBottom: "16px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <button onClick={prevWeek} style={navBtn}>← Prev</button>
            <span style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>
              {dayLabel(weekDates[0])} — {dayLabel(weekDates[6])}
              {busyLoading && <span style={{ color: "var(--text-secondary, #64748b)", fontWeight: 400 }}> (loading…)</span>}
            </span>
            <button onClick={nextWeek} style={navBtn}>Next →</button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: `50px repeat(7, 1fr)`,
              minWidth: "700px",
            }}>
              <div style={headerCell} />
              {weekDates.map((d) => (
                <div key={d} style={{
                  ...headerCell,
                  fontWeight: 700,
                  color: d === new Date().toISOString().slice(0, 10) ? COLOURS.BLUE : "var(--text-primary, #1e293b)",
                }}>
                  {dayLabel(d)}
                </div>
              ))}

              {HOURS.map((hour) => (
                <>
                  <div key={`h-${hour}`} style={{
                    padding: "2px 4px",
                    fontSize: "14px",
                    color: "var(--text-secondary, #64748b)",
                    textAlign: "right",
                    borderTop: "1px solid var(--border-color, #e2e8f0)",
                  }}>
                    {String(hour).padStart(2, "0")}:00
                  </div>
                  {weekDates.map((d) => {
                    const busyEvent = getBusyEvent(d, hour);
                    const req = hasRequest(d, hour);
                    return (
                      <div
                        key={`${d}-${hour}`}
                        onClick={() => !busyEvent && clickSlot(d, hour)}
                        style={{
                          borderTop: "1px solid var(--border-color, #e2e8f0)",
                          borderLeft: "1px solid var(--border-color, #e2e8f0)",
                          height: "28px",
                          backgroundColor: busyEvent ? "#fee2e2" : req ? (req.status === "Approved" ? "#dcfce7" : "#fef3c7") : "var(--bg-card, #ffffff)",
                          cursor: busyEvent ? "not-allowed" : "pointer",
                          position: "relative",
                          fontSize: "13px",
                          padding: "2px 3px",
                          overflow: "hidden",
                        }}
                        title={busyEvent ? `${busyEvent.title || "Busy"} (${busyEvent.account || ""})` : req ? `${req.meeting_title} (${req.status})` : "Click to request"}
                      >
                        {busyEvent && <span style={{ color: "#dc2626", fontWeight: 600 }}>{(busyEvent.title || "Busy").slice(0, 14)}</span>}
                        {!busyEvent && req && (
                          <span style={{ color: req.status === "Approved" ? "#16a34a" : "#d97706", fontWeight: 600 }}>
                            {req.meeting_title.slice(0, 12)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>

          <div style={{ marginTop: "8px", display: "flex", gap: "12px", fontSize: "14px", color: "var(--text-secondary, #64748b)", flexWrap: "wrap" }}>
            <span><span style={{ display: "inline-block", width: "10px", height: "10px", backgroundColor: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "2px", marginRight: "4px" }} />Google Calendar Event</span>
            <span><span style={{ display: "inline-block", width: "10px", height: "10px", backgroundColor: "#dcfce7", border: "1px solid #86efac", borderRadius: "2px", marginRight: "4px" }} />Approved</span>
            <span><span style={{ display: "inline-block", width: "10px", height: "10px", backgroundColor: "#fef3c7", border: "1px solid #fde68a", borderRadius: "2px", marginRight: "4px" }} />Pending</span>
            <span><span style={{ display: "inline-block", width: "10px", height: "10px", backgroundColor: "var(--bg-card, #ffffff)", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "2px", marginRight: "4px" }} />Free — click to request</span>
          </div>
        </div>

        {/* ── PENDING MEETING REQUESTS ── */}
        <SectionTitle title="Pending Meeting Requests" />

        {loading ? (
          <p style={{ color: "var(--text-secondary, #64748b)", fontSize: "17px" }}>Loading requests…</p>
        ) : requests.filter((r) => r.status === "Pending").length === 0 ? (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)", fontSize: "17px" }}>
            No pending meeting requests.
          </div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
                  <th style={tableHeaderStyle}>Title</th>
                  <th style={tableHeaderStyle}>Type</th>
                  <th style={tableHeaderStyle}>Requested By</th>
                  <th style={tableHeaderStyle}>Date</th>
                  <th style={tableHeaderStyle}>Time</th>
                  <th style={tableHeaderStyle}>Priority</th>
                  <th style={tableHeaderStyle}>Status</th>
                  {canManageRequests && <th style={tableHeaderStyle}>Action</th>}
                </tr>
              </thead>
              <tbody>
                {requests.filter((r) => r.status === "Pending").map((r) => (
                  <tr key={r.id}>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 700, color: "var(--text-primary, #1e293b)", fontSize: "16px" }}>
                        {r.meeting_title}
                        {r.decision_required && <span style={{ color: COLOURS.RED, fontSize: "14px", marginLeft: "6px" }}>DECISION</span>}
                      </div>
                      {r.meeting_purpose && <div style={{ color: "var(--text-secondary, #64748b)", fontSize: "15px", marginTop: "2px" }}>{r.meeting_purpose}</div>}
                      {r.attendees && r.attendees.length > 0 && (
                        <div style={{ color: "var(--text-secondary, #64748b)", fontSize: "14px", marginTop: "2px" }}>
                          {r.attendees.length} attendee{r.attendees.length > 1 ? "s" : ""}
                        </div>
                      )}
                    </td>
                    <td style={tableCellStyle}><span style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)" }}>{r.meeting_type || "Ad-hoc"}</span></td>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600, color: "var(--text-primary, #1e293b)", fontSize: "16px" }}>{r.requested_by_name || "—"}</div>
                      {r.requested_by_department && <div style={{ color: "var(--text-secondary, #64748b)", fontSize: "15px" }}>{r.requested_by_department}</div>}
                    </td>
                    <td style={tableCellStyle}>{r.requested_date ? formatDateUK(r.requested_date) : "—"}</td>
                    <td style={tableCellStyle}>{r.preferred_time || "—"}</td>
                    <td style={tableCellStyle}><PriorityBadge priority={r.priority} /></td>
                    <td style={tableCellStyle}><StatusBadge status={r.status} /></td>
                    {canManageRequests && (
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() => updateStatus(r.id, "Approved")}
                            style={{ padding: "5px 12px", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: 700, cursor: "pointer", backgroundColor: "#dcfce7", color: "#166534" }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => updateStatus(r.id, "Rejected")}
                            style={{ padding: "5px 12px", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: 700, cursor: "pointer", backgroundColor: "#fee2e2", color: "#991b1b" }}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── PAST REQUESTS (Approved / Rejected / Completed) ── */}
        {requests.filter((r) => r.status !== "Pending").length > 0 && (
          <>
            <div style={{ marginTop: "20px" }}>
              <SectionTitle title={`Past Requests (${requests.filter((r) => r.status !== "Pending").length})`} />
            </div>
            <div style={{ overflowX: "auto", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
                    <th style={tableHeaderStyle}>Title</th>
                    <th style={tableHeaderStyle}>Requested By</th>
                    <th style={tableHeaderStyle}>Date</th>
                    <th style={tableHeaderStyle}>Status</th>
                    <th style={tableHeaderStyle}>Approved By</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.filter((r) => r.status !== "Pending").map((r) => (
                    <tr key={r.id} style={{ opacity: 0.7 }}>
                      <td style={tableCellStyle}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary, #1e293b)", fontSize: "15px" }}>{r.meeting_title}</span>
                      </td>
                      <td style={tableCellStyle}><span style={{ fontSize: "15px" }}>{r.requested_by_name || "—"}</span></td>
                      <td style={tableCellStyle}>{r.requested_date ? formatDateUK(r.requested_date) : "—"}</td>
                      <td style={tableCellStyle}><StatusBadge status={r.status} /></td>
                      <td style={tableCellStyle}><span style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)" }}>{r.approved_by || "—"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "16px",
  fontWeight: 600,
  color: "var(--text-primary, #1e293b)",
  marginBottom: "10px",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  border: "1px solid var(--border-color, #e2e8f0)",
  borderRadius: "6px",
  fontSize: "17px",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  backgroundColor: COLOURS.NAVY,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "9px 18px",
  fontSize: "17px",
  fontWeight: 700,
  cursor: "pointer",
  marginTop: "4px",
  width: "100%",
};

const navBtn: React.CSSProperties = {
  backgroundColor: "var(--bg-card, #ffffff)",
  border: "1px solid var(--border-color, #e2e8f0)",
  borderRadius: "6px",
  padding: "5px 12px",
  fontSize: "16px",
  fontWeight: 600,
  color: "var(--text-primary, #1e293b)",
  cursor: "pointer",
};

const headerCell: React.CSSProperties = {
  padding: "4px 6px",
  fontSize: "15px",
  textAlign: "center",
  color: "var(--text-secondary, #64748b)",
};
