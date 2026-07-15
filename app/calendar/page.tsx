"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions, authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInput from "../lib/DateInput";
import {
  COLOURS,
  RADII,
  cardStyle,
  SectionTitle,
  PageHeader,
  StatusBadge,
  PriorityBadge,
  tableHeaderStyle,
  tableCellStyle,
  labelStyle,
  inputStyle,
  primaryButtonStyle,
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
      supabase.from("meeting_requests").select("id, requested_by_name, requested_by_email, requested_by_department, meeting_title, meeting_purpose, meeting_type, requested_date, preferred_time, duration_minutes, priority, status, attendees, decision_required, approved_by, calendar_event_id, created_at").order("created_at", { ascending: false }),
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
      const res = await authFetch(`/api/calendar/freebusy?date=${date}`);
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
    const params = new URLSearchParams(window.location.search);
    const googleStatus = params.get("google");
    if (googleStatus === "connected") {
      window.history.replaceState({}, "", "/calendar");
    }
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
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader />
          <button onClick={() => setShowForm(!showForm)} style={{
            ...primaryButtonStyle,
            display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
          }} title="Request meeting">
            {showForm ? "✕ Close" : "+ Request Meeting"}
          </button>
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
            <div style={{ ...cardStyle }}>
              <div style={{
                fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "16px",
              }}>
                Request a Meeting
              </div>
              <form onSubmit={submitRequest}>
                <div style={{ marginBottom: "12px" }}>
                  <label style={labelStyle}>Meeting title</label>
                  <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dispatch recovery discussion" required />
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={labelStyle}>Purpose</label>
                  <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" }} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Why do you need this meeting?" />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select style={inputStyle} value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
                      {MEETING_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Date</label>
                    <DateInput style={inputStyle} value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
                  </div>
                </div>

                {requestedDate && (
                  <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "-8px", marginBottom: "12px" }}>
                    Selected: <strong style={{ color: COLOURS.NAVY }}>{formatDateUK(requestedDate)}</strong>
                  </p>
                )}

                <div style={{ marginBottom: "12px" }}>
                  <label style={labelStyle}>Preferred time</label>
                  <input type="time" style={inputStyle} value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  <div>
                    <label style={labelStyle}>Duration</label>
                    <select style={inputStyle} value={duration} onChange={(e) => setDuration(e.target.value)}>
                      <option value="15">15 min</option>
                      <option value="30">30 min</option>
                      <option value="45">45 min</option>
                      <option value="60">60 min</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Priority</label>
                    <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                      <option>Low</option>
                      <option>Normal</option>
                      <option>High</option>
                      <option>Urgent</option>
                    </select>
                  </div>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", fontSize: "13px", color: COLOURS.NAVY, cursor: "pointer" }}>
                  <input type="checkbox" checked={decisionRequired} onChange={(e) => setDecisionRequired(e.target.checked)} style={{ width: "15px", height: "15px" }} />
                  Decision required from CEO
                </label>

                <div style={{ marginBottom: "12px" }}>
                  <label style={labelStyle}>Attendees</label>
                  <div style={{
                    border: `1px solid ${COLOURS.HAIRLINE}`,
                    borderRadius: RADII.SM,
                    padding: "6px",
                    marginTop: "3px",
                    maxHeight: "120px",
                    overflowY: "auto",
                  }}>
                    {allMembers.filter((m) => m.email && m.email !== email).map((m) => (
                      <label key={m.email} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "3px 4px", fontSize: "13px", cursor: "pointer", color: COLOURS.NAVY }}>
                        <input
                          type="checkbox"
                          checked={selectedAttendees.includes(m.email || "")}
                          onChange={() => toggleAttendee(m.email || "")}
                          style={{ width: "14px", height: "14px" }}
                        />
                        {displayMemberName(m, m.email)}
                        {m.department && <span style={{ color: COLOURS.SLATE, fontSize: "12px" }}>({m.department})</span>}
                      </label>
                    ))}
                  </div>
                </div>

                <button type="submit" disabled={saving} style={{ ...primaryButtonStyle, width: "100%", marginTop: "4px", opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Submitting…" : "Submit Meeting Request"}
                </button>

                {message && (
                  <p style={{ marginTop: "10px", fontSize: "13px", color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN, fontWeight: 600 }}>
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
                <span style={{ fontSize: "16px" }}>⚠</span>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: WARNING_TITLE_COLOR }}>Google Calendar Not Syncing</div>
                  <div style={{ fontSize: "12px", color: WARNING_TITLE_COLOR, marginTop: "3px" }}>{calendarError}</div>
                </div>
              </div>
              {isAdmin && (
                <a href="/api/google/auth?returnTo=/calendar" style={{
                  backgroundColor: COLOURS.RED, color: "white", border: "none", borderRadius: RADII.PILL,
                  padding: "7px 16px", fontSize: "12px", fontWeight: 600, textDecoration: "none",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  Reconnect Google Calendar
                </a>
              )}
            </div>
            <div style={{ fontSize: "11px", color: COLOURS.AMBER, marginTop: "8px", paddingLeft: "26px" }}>
              Sign in with k.saleem@unzegroup.com to reconnect your calendar.
            </div>
          </div>
        )}
        {!calendarError && !busyLoading && calendarAccounts.length > 0 && (
          <div style={{
            border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.CARD,
            backgroundColor: COLOURS.SUCCESS_SOFT,
            padding: "10px 16px",
            marginBottom: "16px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontSize: "12px", color: COLOURS.GREEN,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 700 }}>✓</span>
              Showing calendar for <strong>{calendarAccounts.map((a) => a.email).join(", ")}</strong> · {busySlots.length} event{busySlots.length !== 1 ? "s" : ""} this week
            </div>
            {isAdmin && (
              <a href="/api/google/auth?returnTo=/calendar" style={{
                fontSize: "12px", color: COLOURS.GREEN, textDecoration: "underline", whiteSpace: "nowrap", fontWeight: 500,
              }}>
                Reconnect Google
              </a>
            )}
          </div>
        )}

        {/* ── WEEK VIEW ── */}
        <SectionTitle title="Weekly Availability" />
        <div style={{
          ...cardStyle,
          padding: 0,
          overflow: "hidden",
          marginBottom: "24px",
        }}>
          {/* Toolbar */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 20px",
            borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
            backgroundColor: COLOURS.CARD_ALT,
          }}>
            <button onClick={prevWeek} style={{ backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "5px 14px", fontSize: "12px", fontWeight: 500, color: COLOURS.NAVY, cursor: "pointer" }}>← Prev</button>
            <span style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>
              {dayLabel(weekDates[0])} — {dayLabel(weekDates[6])}
              {busyLoading && <span style={{ color: COLOURS.SLATE, fontWeight: 400 }}> (loading…)</span>}
            </span>
            <button onClick={nextWeek} style={{ backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "5px 14px", fontSize: "12px", fontWeight: 500, color: COLOURS.NAVY, cursor: "pointer" }}>Next →</button>
          </div>

          {/* Grid */}
          <div style={{ overflowX: "auto" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: `50px repeat(7, 1fr)`,
              minWidth: "700px",
            }}>
              {/* Corner */}
              <div style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }} />
              {/* Day headers */}
              {weekDates.map((d) => {
                const isToday = d === new Date().toISOString().slice(0, 10);
                return (
                  <div key={d} style={{
                    padding: "10px 6px",
                    textAlign: "center",
                    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                    borderLeft: `1px solid ${COLOURS.HAIRLINE}`,
                  }}>
                    <div style={{ fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, fontWeight: 500 }}>
                      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(d + "T00:00:00").getDay()]}
                    </div>
                    <div style={{
                      fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                      fontSize: "17px", fontWeight: 600, marginTop: "2px",
                      color: isToday ? COLOURS.BLUE : COLOURS.NAVY,
                    }}>
                      {d.slice(8, 10)}
                    </div>
                  </div>
                );
              })}

              {/* Hour rows */}
              {HOURS.map((hour) => (
                <>
                  <div key={`h-${hour}`} style={{
                    padding: "6px 6px 0 0",
                    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                    fontSize: "10px",
                    color: COLOURS.INK_400,
                    textAlign: "right",
                    height: "44px",
                    borderRight: `1px solid ${COLOURS.HAIRLINE}`,
                  }}>
                    {String(hour).padStart(2, "0")}:00
                  </div>
                  {weekDates.map((d) => {
                    const busyEvent = getBusyEvent(d, hour);
                    const req = hasRequest(d, hour);
                    let bgColor = COLOURS.CARD;
                    if (busyEvent) bgColor = COLOURS.DANGER_SOFT;
                    else if (req) bgColor = req.status === "Approved" ? COLOURS.SUCCESS_SOFT : COLOURS.WARNING_SOFT;
                    return (
                      <div
                        key={`${d}-${hour}`}
                        onClick={() => !busyEvent && clickSlot(d, hour)}
                        style={{
                          borderTop: `1px solid ${COLOURS.HAIRLINE}`,
                          borderLeft: `1px solid ${COLOURS.HAIRLINE}`,
                          height: "44px",
                          backgroundColor: bgColor,
                          cursor: busyEvent ? "not-allowed" : "pointer",
                          position: "relative",
                          fontSize: "10.5px",
                          padding: "2px 3px",
                          overflow: "hidden",
                        }}
                        title={busyEvent ? `${busyEvent.title || "Busy"} (${busyEvent.account || ""})` : req ? `${req.meeting_title} (${req.status})` : "Click to request"}
                      >
                        {busyEvent && (
                          <span style={{ color: COLOURS.RED, fontWeight: 600 }}>{(busyEvent.title || "Busy").slice(0, 14)}</span>
                        )}
                        {!busyEvent && req && (
                          <span style={{ color: req.status === "Approved" ? COLOURS.GREEN : COLOURS.AMBER, fontWeight: 600 }}>
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

          {/* Legend */}
          <div style={{
            display: "flex", gap: "16px", padding: "12px 20px",
            backgroundColor: COLOURS.CARD_ALT,
            borderTop: `1px solid ${COLOURS.HAIRLINE}`,
            fontSize: "11px", color: COLOURS.SLATE, flexWrap: "wrap",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "3px", backgroundColor: COLOURS.DANGER_SOFT, borderLeft: `3px solid ${COLOURS.RED}`, display: "inline-block" }} />
              Google Calendar Event
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "3px", backgroundColor: COLOURS.SUCCESS_SOFT, borderLeft: `3px solid ${COLOURS.GREEN}`, display: "inline-block" }} />
              Approved
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "3px", backgroundColor: COLOURS.WARNING_SOFT, borderLeft: `3px solid ${COLOURS.AMBER}`, display: "inline-block" }} />
              Pending
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
              Free — click to request
            </span>
          </div>
        </div>

        {/* ── PENDING MEETING REQUESTS ── */}
        <SectionTitle title="Pending Meeting Requests" />

        {loading ? (
          <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Loading requests…</p>
        ) : requests.filter((r) => r.status === "Pending").length === 0 ? (
          <div style={{ ...cardStyle, color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "32px 24px" }}>
            No pending meeting requests.
          </div>
        ) : (
          <div style={{ overflowX: "auto", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
              <thead>
                <tr>
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
                      <div style={{ fontWeight: 600, color: COLOURS.NAVY, fontSize: "13px" }}>
                        {r.meeting_title}
                        {r.decision_required && <span style={{ color: COLOURS.RED, fontSize: "11px", marginLeft: "6px", fontWeight: 700 }}>DECISION</span>}
                      </div>
                      {r.meeting_purpose && <div style={{ color: COLOURS.SLATE, fontSize: "12px", marginTop: "2px" }}>{r.meeting_purpose}</div>}
                      {r.attendees && r.attendees.length > 0 && (
                        <div style={{ color: COLOURS.SLATE, fontSize: "12px", marginTop: "2px" }}>
                          {r.attendees.length} attendee{r.attendees.length > 1 ? "s" : ""}
                        </div>
                      )}
                    </td>
                    <td style={tableCellStyle}><span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{r.meeting_type || "Ad-hoc"}</span></td>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600, color: COLOURS.NAVY, fontSize: "13px" }}>{r.requested_by_name || "—"}</div>
                      {r.requested_by_department && <div style={{ color: COLOURS.SLATE, fontSize: "12px" }}>{r.requested_by_department}</div>}
                    </td>
                    <td style={{ ...tableCellStyle, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "12px", color: COLOURS.SLATE }}>
                      {r.requested_date ? formatDateUK(r.requested_date) : "—"}
                    </td>
                    <td style={{ ...tableCellStyle, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "12px", color: COLOURS.SLATE }}>
                      {r.preferred_time || "—"}
                    </td>
                    <td style={tableCellStyle}><PriorityBadge priority={r.priority} /></td>
                    <td style={tableCellStyle}><StatusBadge status={r.status} /></td>
                    {canManageRequests && (
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() => updateStatus(r.id, "Approved")}
                            style={{ padding: "5px 12px", border: "none", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, cursor: "pointer", backgroundColor: COLOURS.GREEN, color: "white" }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => updateStatus(r.id, "Rejected")}
                            style={{ padding: "5px 12px", border: "none", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, cursor: "pointer", backgroundColor: COLOURS.RED, color: "white" }}
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
            <SectionTitle title={`Past Requests (${requests.filter((r) => r.status !== "Pending").length})`} />
            <div style={{ overflowX: "auto", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
                <thead>
                  <tr>
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
                        <span style={{ fontWeight: 600, color: COLOURS.NAVY, fontSize: "13px" }}>{r.meeting_title}</span>
                      </td>
                      <td style={tableCellStyle}><span style={{ fontSize: "13px", color: COLOURS.NAVY }}>{r.requested_by_name || "—"}</span></td>
                      <td style={{ ...tableCellStyle, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "12px", color: COLOURS.SLATE }}>
                        {r.requested_date ? formatDateUK(r.requested_date) : "—"}
                      </td>
                      <td style={tableCellStyle}><StatusBadge status={r.status} /></td>
                      <td style={tableCellStyle}><span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{r.approved_by || "—"}</span></td>
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

