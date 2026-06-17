"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";

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

function formatDateUK(dateString: string | null) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.slice(0, 10).split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year}`;
}

function formatDateTimeUK(dateString: string | null) {
  if (!dateString) return "—";

  return new Date(dateString).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayMemberName(member: Member | null, email: string | null) {
  if (!member) return email || "User";

  const fullName = `${member.first_name || ""} ${member.last_name || ""}`.trim();

  return fullName || member.name || email || "User";
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
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      alert("Error updating meeting request: " + error.message);
      return;
    }

    loadData();
  }

  return (
    <AuthWrapper>
      <main style={pageStyle}>
        <div style={pageHeaderStyle}>
          <h1 style={pageTitleStyle}>Calendar & Meeting Requests</h1>
          <p style={pageSubtitleStyle}>
            Request meetings with Khuram. Approved meetings can later be connected to Google Calendar.
          </p>
        </div>

        <div style={layoutStyle}>
          <section style={cardStyle}>
            <h2 style={sectionTitleStyle}>Request a Meeting</h2>

            <form onSubmit={submitRequest}>
              <label style={labelStyle}>
                Meeting title
                <input
                  style={inputStyle}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Example: Dispatch recovery discussion"
                  required
                />
              </label>

              <label style={labelStyle}>
                Purpose
                <textarea
                  style={{ ...inputStyle, height: "92px", resize: "vertical" }}
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
                <div style={helperTextStyle}>
                  Selected date: <strong>{formatDateUK(requestedDate)}</strong>
                </div>
              )}

              <label style={labelStyle}>
                Preferred time
                <input
                  style={inputStyle}
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  placeholder="Example: Morning / 3:00 PM / After lunch"
                />
              </label>

              <div style={twoColumnStyle}>
                <label style={labelStyle}>
                  Duration
                  <select
                    style={inputStyle}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
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

              <button type="submit" disabled={saving} style={primaryButtonStyle}>
                {saving ? "Submitting..." : "Submit Meeting Request"}
              </button>

              {message && (
                <p
                  style={{
                    marginTop: "14px",
                    fontSize: "14px",
                    color: message.startsWith("Error") ? "#dc2626" : "#16a34a",
                  }}
                >
                  {message}
                </p>
              )}
            </form>
          </section>

          <section style={infoCardStyle}>
            <h2 style={sectionTitleStyle}>How this works</h2>

            <div style={smallInfoRowStyle}>
              <strong>1. Request</strong>
              <span>Submit a meeting request with purpose, date and priority.</span>
            </div>

            <div style={smallInfoRowStyle}>
              <strong>2. Review</strong>
              <span>Admin or Executive reviews and approves or rejects.</span>
            </div>

            <div style={smallInfoRowStyle}>
              <strong>3. Schedule</strong>
              <span>Google Calendar integration will be added after this workflow is stable.</span>
            </div>
          </section>
        </div>

        <section style={{ marginTop: "30px" }}>
          <h2 style={sectionTitleStyle}>Meeting Requests</h2>

          {loading ? (
            <p style={mutedTextStyle}>Loading meeting requests...</p>
          ) : requests.length === 0 ? (
            <div style={emptyStateStyle}>No meeting requests yet.</div>
          ) : (
            <div style={tableWrapperStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ backgroundColor: "#fafafa" }}>
                    <th style={th}>Title</th>
                    <th style={th}>Requested By</th>
                    <th style={th}>Requested Date</th>
                    <th style={th}>Preferred Time</th>
                    <th style={th}>Duration</th>
                    <th style={th}>Priority</th>
                    <th style={th}>Status</th>
                    <th style={th}>Created</th>
                    {canManageRequests && <th style={th}>Action</th>}
                  </tr>
                </thead>

                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>
                        <strong style={{ color: "#111827" }}>{r.meeting_title}</strong>
                        <div style={purposeTextStyle}>
                          {r.meeting_purpose || "No purpose provided"}
                        </div>
                      </td>

                      <td style={td}>
                        <strong>{r.requested_by_name || r.requested_by_email || "—"}</strong>
                        <div style={purposeTextStyle}>
                          {r.requested_by_department || "—"}
                        </div>
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
                            style={smallSelectStyle}
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
        </section>
      </main>
    </AuthWrapper>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "Approved"
      ? "#16a34a"
      : status === "Rejected"
      ? "#dc2626"
      : status === "Completed"
      ? "#555"
      : "#d97706";

  return (
    <span style={{ ...badgeStyle, backgroundColor: color }}>
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
    <span style={{ ...badgeStyle, backgroundColor: color }}>
      {priority}
    </span>
  );
}

const pageStyle = {
  padding: "40px",
  fontFamily: "sans-serif",
};

const pageHeaderStyle = {
  marginBottom: "24px",
};

const pageTitleStyle = {
  fontSize: "32px",
  fontWeight: "bold",
  marginBottom: "8px",
  color: "#111827",
};

const pageSubtitleStyle = {
  color: "#666",
  marginBottom: "0",
  fontSize: "15px",
};

const layoutStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(280px, 640px) minmax(240px, 1fr)",
  gap: "20px",
  alignItems: "start",
};

const cardStyle = {
  border: "1px solid #e0e0e0",
  borderRadius: "10px",
  padding: "20px",
  backgroundColor: "white",
};

const infoCardStyle = {
  border: "1px solid #e0e0e0",
  borderRadius: "10px",
  padding: "20px",
  backgroundColor: "#fafafa",
};

const sectionTitleStyle = {
  fontSize: "20px",
  fontWeight: "bold",
  marginTop: "0",
  marginBottom: "14px",
  color: "#111827",
};

const labelStyle = {
  display: "block",
  fontSize: "14px",
  fontWeight: "bold",
  color: "#333",
  marginBottom: "6px",
};

const inputStyle = {
  display: "block",
  width: "100%",
  padding: "10px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  fontSize: "14px",
  marginTop: "6px",
  marginBottom: "14px",
  boxSizing: "border-box" as const,
};

const smallSelectStyle = {
  padding: "8px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  fontSize: "13px",
  backgroundColor: "white",
};

const twoColumnStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const primaryButtonStyle = {
  backgroundColor: "#0070f3",
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "12px 20px",
  fontSize: "14px",
  fontWeight: "bold",
  cursor: "pointer",
};

const helperTextStyle = {
  marginTop: "-8px",
  marginBottom: "14px",
  color: "#666",
  fontSize: "13px",
};

const smallInfoRowStyle = {
  display: "grid",
  gap: "4px",
  padding: "12px 0",
  borderBottom: "1px solid #e5e7eb",
  color: "#555",
  fontSize: "14px",
};

const mutedTextStyle = {
  color: "#666",
  fontSize: "14px",
};

const emptyStateStyle = {
  border: "1px solid #e0e0e0",
  borderRadius: "10px",
  padding: "18px",
  backgroundColor: "#fafafa",
  color: "#666",
  fontSize: "14px",
};

const tableWrapperStyle = {
  overflowX: "auto" as const,
  marginBottom: "32px",
};

const tableStyle = {
  borderCollapse: "collapse" as const,
  width: "100%",
  minWidth: "980px",
};

const th = {
  textAlign: "left" as const,
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
  color: "#333",
};

const td = {
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
  verticalAlign: "top" as const,
  color: "#333",
};

const purposeTextStyle = {
  color: "#666",
  fontSize: "12px",
  marginTop: "4px",
};

const badgeStyle = {
  color: "white",
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "bold",
  display: "inline-block",
};