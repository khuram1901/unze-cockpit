"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { formatDateUK, formatDateTimeUK } from "../lib/dateUtils";

type MeetingRequest = {
  id: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  requested_by_department: string | null;
  meeting_title: string;
  meeting_purpose: string | null;
  requested_date: string | null;
  preferred_time: string | null;
  duration_minutes: number | null;
  priority: string | null;
  status: string | null;
  admin_notes: string | null;
  created_at: string;
};

type Member = {
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  department: string | null;
  role: string | null;
};

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";



function displayMemberName(member: Member | null, email: string | null) {
  if (!member) return email || "User";
  const fullName = `${member.first_name || ""} ${member.last_name || ""}`.trim();
  return fullName || member.name || email || "User";
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontSize: "13px",
        fontWeight: 700,
        color: NAVY,
        margin: "20px 0 10px",
        paddingLeft: "9px",
        borderLeft: `3px solid ${NAVY}`,
      }}
    >
      {title}
    </h2>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "Approved"
      ? "#16a34a"
      : status === "Rejected"
      ? "#dc2626"
      : status === "Completed"
      ? "#64748b"
      : "#d97706";
  return (
    <span
      style={{
        fontSize: "11px",
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: "10px",
        color: "white",
        backgroundColor: color,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const color =
    priority === "Urgent"
      ? "#dc2626"
      : priority === "High"
      ? "#d97706"
      : priority === "Low"
      ? "#64748b"
      : "#0070f3";
  return (
    <span
      style={{
        fontSize: "11px",
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: "10px",
        color: "white",
        backgroundColor: color,
        whiteSpace: "nowrap",
      }}
    >
      {priority}
    </span>
  );
}

export default function CalendarPage() {
  const [requests, setRequests] = useState<MeetingRequest[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [priority, setPriority] = useState("Normal");
  const [message, setMessage] = useState("");

  const canManageRequests =
    member?.role === "Admin" || member?.role === "Executive";

  async function loadData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const userEmail = userData.user?.email || null;
    setEmail(userEmail);

    if (userEmail) {
      const { data: memberData } = await supabase
        .from("members")
        .select("first_name, last_name, name, department, role")
        .eq("email", userEmail)
        .single();
      if (memberData) setMember(memberData);
    }

    const { data } = await supabase
      .from("meeting_requests")
      .select("*")
      .order("created_at", { ascending: false });

    setRequests(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

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
      requested_date: requestedDate || null,
      preferred_time: preferredTime || null,
      duration_minutes: Number(duration) || 30,
      priority,
      status: "Pending",
    });

    setSaving(false);

    if (error) {
      setMessage("Error: " + error.message);
      return;
    }

    setTitle("");
    setPurpose("");
    setRequestedDate("");
    setPreferredTime("");
    setDuration("30");
    setPriority("Normal");
    setMessage("✅ Meeting request submitted.");
    loadData();
  }

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase
      .from("meeting_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      alert("Error updating request: " + error.message);
      return;
    }
    loadData();
  }

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: NAVY, margin: 0 }}>
            Calendar & Meeting Requests
          </h1>
          <p style={{ color: SLATE, fontSize: "12px", marginTop: "5px" }}>
            Request a meeting with Khuram. Admin and Executive can approve or reject requests.
          </p>
        </div>

        {/* Two-column: form + how it works */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 460px) minmax(200px, 1fr)",
            gap: "16px",
            alignItems: "start",
          }}
        >
          {/* Request form */}
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: "8px",
              padding: "16px",
              backgroundColor: "white",
            }}
          >
            <SectionTitle title="Request a Meeting" />

            <form onSubmit={submitRequest}>
              <label style={labelStyle}>
                Meeting title
                <input
                  style={inputStyle}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Dispatch recovery discussion"
                  required
                />
              </label>

              <label style={labelStyle}>
                Purpose
                <textarea
                  style={{ ...inputStyle, height: "80px", resize: "vertical" }}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Why do you need this meeting?"
                />
              </label>

              <label style={labelStyle}>
                Requested date
                <input
                  type="date"
                  style={inputStyle}
                  value={requestedDate}
                  onChange={(e) => setRequestedDate(e.target.value)}
                />
              </label>

              {requestedDate && (
                <p style={{ fontSize: "11px", color: SLATE, marginTop: "-6px", marginBottom: "10px" }}>
                  Selected: <strong>{formatDateUK(requestedDate)}</strong>
                </p>
              )}

              <label style={labelStyle}>
                Preferred time
                <input
                  style={inputStyle}
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  placeholder="e.g. Morning / 3:00 PM / After lunch"
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label style={labelStyle}>
                  Duration
                  <select
                    style={inputStyle}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  >
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                  </select>
                </label>

                <label style={labelStyle}>
                  Priority
                  <select
                    style={inputStyle}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    <option>Low</option>
                    <option>Normal</option>
                    <option>High</option>
                    <option>Urgent</option>
                  </select>
                </label>
              </div>

              <button type="submit" disabled={saving} style={btnStyle}>
                {saving ? "Submitting…" : "Submit Meeting Request"}
              </button>

              {message && (
                <p
                  style={{
                    marginTop: "10px",
                    fontSize: "13px",
                    color: message.startsWith("Error") ? "#dc2626" : "#16a34a",
                    fontWeight: 600,
                  }}
                >
                  {message}
                </p>
              )}
            </form>
          </div>

          {/* How it works */}
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: "8px",
              padding: "16px",
              backgroundColor: "#f8fafc",
            }}
          >
            <SectionTitle title="How this works" />
            {[
              { step: "1. Request", detail: "Submit with purpose, date, and priority." },
              { step: "2. Review", detail: "Admin or Executive approves or rejects." },
              {
                step: "3. Schedule",
                detail:
                  "Google Calendar integration is coming — approved requests will create calendar events automatically.",
              },
            ].map((row) => (
              <div
                key={row.step}
                style={{
                  borderBottom: `1px solid ${BORDER}`,
                  padding: "10px 0",
                  fontSize: "12px",
                  color: SLATE,
                }}
              >
                <div style={{ fontWeight: 700, color: NAVY, marginBottom: "3px" }}>
                  {row.step}
                </div>
                {row.detail}
              </div>
            ))}
          </div>
        </div>

        {/* Requests table */}
        <SectionTitle title="All Meeting Requests" />

        {loading ? (
          <p style={{ color: SLATE, fontSize: "13px" }}>Loading requests…</p>
        ) : requests.length === 0 ? (
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: "8px",
              padding: "14px",
              backgroundColor: "white",
              color: SLATE,
              fontSize: "13px",
            }}
          >
            No meeting requests yet.
          </div>
        ) : (
          <div
            style={{
              overflowX: "auto",
              border: `1px solid ${BORDER}`,
              borderRadius: "8px",
              backgroundColor: "white",
            }}
          >
            <table
              style={{ borderCollapse: "collapse", width: "100%", minWidth: "860px" }}
            >
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th style={th}>Title & Purpose</th>
                  <th style={th}>Requested By</th>
                  <th style={th}>Date</th>
                  <th style={th}>Time</th>
                  <th style={th}>Duration</th>
                  <th style={th}>Priority</th>
                  <th style={th}>Status</th>
                  <th style={th}>Submitted</th>
                  {canManageRequests && <th style={th}>Action</th>}
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 700, color: NAVY, fontSize: "12px" }}>
                        {r.meeting_title}
                      </div>
                      {r.meeting_purpose && (
                        <div style={{ color: SLATE, fontSize: "11px", marginTop: "2px" }}>
                          {r.meeting_purpose}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: NAVY, fontSize: "12px" }}>
                        {r.requested_by_name || r.requested_by_email || "—"}
                      </div>
                      {r.requested_by_department && (
                        <div style={{ color: SLATE, fontSize: "11px" }}>
                          {r.requested_by_department}
                        </div>
                      )}
                    </td>
                    <td style={td}>{formatDateUK(r.requested_date)}</td>
                    <td style={td}>{r.preferred_time || "—"}</td>
                    <td style={td}>{r.duration_minutes || 30} min</td>
                    <td style={td}>
                      <PriorityBadge priority={r.priority || "Normal"} />
                    </td>
                    <td style={td}>
                      <StatusBadge status={r.status || "Pending"} />
                    </td>
                    <td style={td}>{formatDateTimeUK(r.created_at)}</td>
                    {canManageRequests && (
                      <td style={td}>
                        <select
                          value={r.status || "Pending"}
                          onChange={(e) => updateStatus(r.id, e.target.value)}
                          style={{
                            padding: "5px 7px",
                            border: `1px solid ${BORDER}`,
                            borderRadius: "6px",
                            fontSize: "12px",
                            backgroundColor: "white",
                          }}
                        >
                          <option>Pending</option>
                          <option>Approved</option>
                          <option>Rejected</option>
                          <option>Completed</option>
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 600,
  color: NAVY,
  marginBottom: "10px",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  fontSize: "13px",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "9px 18px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  marginTop: "4px",
  width: "100%",
};

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "6px 10px",
  fontSize: "11px",
  color: SLATE,
  fontWeight: 700,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "7px 10px",
  fontSize: "12px",
  verticalAlign: "top",
};
