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

export default function CalendarPage() {
  const [requests, setRequests] = useState<MeetingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [priority, setPriority] = useState("Normal");
  const [message, setMessage] = useState("");

  async function loadRequests() {
    const { data } = await supabase
      .from("meeting_requests")
      .select("*")
      .order("created_at", { ascending: false });

    setRequests(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadRequests();
  }, []);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;

    let memberName = null;
    let department = null;

    if (email) {
      const { data: member } = await supabase
        .from("members")
        .select("first_name, last_name, name, department")
        .eq("email", email)
        .single();

      if (member) {
        const fullName = `${member.first_name || ""} ${member.last_name || ""}`.trim();
        memberName = fullName || member.name || email;
        department = member.department || null;
      }
    }

    const { error } = await supabase.from("meeting_requests").insert({
      requested_by_name: memberName,
      requested_by_email: email,
      requested_by_department: department,
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
    loadRequests();
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

    loadRequests();
  }

  const inputStyle = {
    width: "100%",
    padding: "10px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "14px",
    marginTop: "6px",
    marginBottom: "14px",
  };

  return (
    <AuthWrapper>
      <main style={{ padding: "32px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "8px" }}>
          Calendar & Meeting Requests
        </h1>

        <p style={{ color: "#666", marginBottom: "24px" }}>
          Request meetings with Khuram. Approved meetings can later be connected to Google Calendar.
        </p>

        <form
          onSubmit={submitRequest}
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "12px",
            padding: "20px",
            maxWidth: "620px",
            marginBottom: "32px",
            backgroundColor: "#fff",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "16px" }}>
            Request a Meeting
          </h2>

          <label>
            Meeting title
            <input
              style={inputStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Example: Dispatch recovery discussion"
              required
            />
          </label>

          <label>
            Purpose
            <textarea
              style={{ ...inputStyle, height: "90px" }}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Why do you need this meeting?"
            />
          </label>

          <label>
            Requested date
            <input
              type="date"
              style={inputStyle}
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
            />
          </label>

          <label>
            Preferred time
            <input
              style={inputStyle}
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
              placeholder="Example: Morning / 3:00 PM / After lunch"
            />
          </label>

          <label>
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

          <label>
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

          <button
            type="submit"
            disabled={saving}
            style={{
              backgroundColor: "#0070f3",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "12px 20px",
              fontSize: "14px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {saving ? "Submitting..." : "Submit Meeting Request"}
          </button>

          {message && (
            <p
              style={{
                marginTop: "14px",
                color: message.startsWith("Error") ? "#dc2626" : "#16a34a",
                fontSize: "14px",
              }}
            >
              {message}
            </p>
          )}
        </form>

        <h2 style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "14px" }}>
          Meeting Requests
        </h2>

        {loading ? (
          <p>Loading meeting requests...</p>
        ) : requests.length === 0 ? (
          <p style={{ color: "#666" }}>No meeting requests yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
              <thead>
                <tr style={{ backgroundColor: "#fafafa" }}>
                  <th style={th}>Title</th>
                  <th style={th}>Requested By</th>
                  <th style={th}>Date</th>
                  <th style={th}>Time</th>
                  <th style={th}>Duration</th>
                  <th style={th}>Priority</th>
                  <th style={th}>Status</th>
                  <th style={th}>Action</th>
                </tr>
              </thead>

              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>
                      <strong>{r.meeting_title}</strong>
                      <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                        {r.meeting_purpose || "No purpose provided"}
                      </div>
                    </td>
                    <td style={td}>
                      {r.requested_by_name || r.requested_by_email || "—"}
                      <div style={{ color: "#666", fontSize: "12px" }}>
                        {r.requested_by_department || "—"}
                      </div>
                    </td>
                    <td style={td}>{r.requested_date || "—"}</td>
                    <td style={td}>{r.preferred_time || "—"}</td>
                    <td style={td}>{r.duration_minutes || 30} min</td>
                    <td style={td}>{r.priority || "Normal"}</td>
                    <td style={td}>
                      <StatusBadge status={r.status || "Pending"} />
                    </td>
                    <td style={td}>
                      <select
                        value={r.status || "Pending"}
                        onChange={(e) => updateStatus(r.id, e.target.value)}
                        style={{
                          padding: "8px",
                          border: "1px solid #ccc",
                          borderRadius: "6px",
                        }}
                      >
                        <option>Pending</option>
                        <option>Approved</option>
                        <option>Rejected</option>
                        <option>Completed</option>
                      </select>
                    </td>
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
    <span
      style={{
        backgroundColor: color,
        color: "white",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: "bold",
      }}
    >
      {status}
    </span>
  );
}

const th = {
  textAlign: "left" as const,
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
};

const td = {
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
  verticalAlign: "top" as const,
};