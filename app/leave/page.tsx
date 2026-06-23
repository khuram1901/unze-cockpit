"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { formatDateUK, todayISO } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";

type Leave = {
  id: string;
  member_email: string;
  member_name: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  approved_by: string | null;
  created_at: string;
};

type Member = { name: string; email: string | null; first_name: string | null; last_name: string | null };

const LEAVE_TYPES = ["Annual", "Sick", "Emergency", "Personal", "Public Holiday", "Other"];
const today = todayISO();

export default function LeavePage() {
  const isMobile = useMobile();
  const [records, setRecords] = useState<Leave[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [leaveFor, setLeaveFor] = useState("");
  const [leaveType, setLeaveType] = useState("Annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email || null;
    setUserEmail(email);

    if (email) {
      const { data: member } = await supabase.from("members").select("first_name, last_name, name, role").eq("email", email).maybeSingle();
      if (member) {
        setUserName(`${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email);
        setIsAdmin(member.role === "Admin" || member.role === "Executive");
      }
    }

    const { data } = await supabase.from("leave_records").select("*").order("start_date", { ascending: false });
    setRecords(data || []);

    const { data: membersData } = await supabase.from("members").select("name, email, first_name, last_name");
    setMembers(membersData || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }

  function calcDays(s: string, e: string): number {
    if (!s || !e) return 0;
    const start = new Date(s + "T00:00:00");
    const end = new Date(e + "T00:00:00");
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) return;
    setSaving(true);

    const targetEmail = isAdmin && leaveFor ? leaveFor : userEmail;
    const targetMember = members.find((m) => m.email === targetEmail);
    const targetName = targetMember ? `${targetMember.first_name || ""} ${targetMember.last_name || ""}`.trim() || targetMember.name : userName;
    const days = calcDays(startDate, endDate);

    const { error } = await supabase.from("leave_records").insert({
      member_email: targetEmail,
      member_name: targetName,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      days,
      reason: reason || null,
      status: isAdmin ? "Approved" : "Pending",
      approved_by: isAdmin ? userName : null,
    });

    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "leave_records", `${targetName}: ${leaveType} ${startDate} to ${endDate} (${days}d)`);
    showMsg(isAdmin ? "Leave approved and saved." : "Leave request submitted for approval.");
    setStartDate(""); setEndDate(""); setReason(""); setLeaveFor(""); setLeaveType("Annual");
    setShowForm(false);
    loadData();
  }

  async function approveLeave(id: string) {
    await supabase.from("leave_records").update({ status: "Approved", approved_by: userName }).eq("id", id);
    logAction("Updated", "leave_records", "Approved", id);
    loadData();
  }

  async function rejectLeave(id: string) {
    await supabase.from("leave_records").update({ status: "Rejected", approved_by: userName }).eq("id", id);
    logAction("Updated", "leave_records", "Rejected", id);
    loadData();
  }

  async function deleteLeave(id: string) {
    if (!confirm("Delete this leave record?")) return;
    await supabase.from("leave_records").delete().eq("id", id);
    loadData();
  }

  const pending = records.filter((r) => r.status === "Pending");
  const offToday = records.filter((r) => r.status === "Approved" && r.start_date <= today && r.end_date >= today);
  const upcoming = records.filter((r) => r.status === "Approved" && r.start_date > today).slice(0, 10);
  const totalDaysThisMonth = records.filter((r) => r.status === "Approved" && r.start_date.slice(0, 7) === today.slice(0, 7)).reduce((s, r) => s + r.days, 0);

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader title="Leave & Absence" subtitle="Track leave requests, approvals, and who's off" />
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }} title="Request leave">{showForm ? "×" : "+"}</button>
        </div>

        {message && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>{message}</div>
        )}

        {showForm && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>{isAdmin ? "Add Leave" : "Request Leave"}</div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: "8px" }}>
                {isAdmin && (
                  <label style={lbl}>For <select style={inp} value={leaveFor} onChange={(e) => setLeaveFor(e.target.value)} required>
                    <option value="">Select member</option>
                    {members.map((m) => <option key={m.email} value={m.email || ""}>{`${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name}</option>)}
                  </select></label>
                )}
                <label style={lbl}>Type <select style={inp} value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>{LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
                <label style={lbl}>From <input type="date" style={inp} value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label>
                <label style={lbl}>To <input type="date" style={inp} value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></label>
                {startDate && endDate && <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, display: "flex", alignItems: "end", paddingBottom: "6px" }}>{calcDays(startDate, endDate)} working day{calcDays(startDate, endDate) !== 1 ? "s" : ""}</div>}
                <label style={{ ...lbl, gridColumn: isMobile ? undefined : "1 / -1" }}>Reason <input style={inp} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" /></label>
              </div>
              <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving..." : isAdmin ? "Add & Approve" : "Submit Request"}</button>
            </form>
          </div>
        )}

        {!loading && (
          <>
            {/* Who's off today banner */}
            {offToday.length > 0 && (
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid #d97706`, borderRadius: "8px", padding: "12px 16px", marginBottom: "14px", backgroundColor: "#fffbeb" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#92400e" }}>Off Today ({offToday.length})</div>
                <div style={{ fontSize: "13px", color: "#92400e", marginTop: "2px" }}>{offToday.map((r) => `${r.member_name} (${r.leave_type})`).join(" · ")}</div>
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
              <CountCard label="Off Today" value={offToday.length} color="#d97706" />
              <CountCard label="Pending" value={pending.length} color={COLOURS.RED} />
              <CountCard label="Upcoming" value={upcoming.length} color={COLOURS.BLUE} />
              <CountCard label="Days (Month)" value={totalDaysThisMonth} color={COLOURS.NAVY} />
            </div>

            {/* Pending approvals */}
            {isAdmin && pending.length > 0 && (
              <>
                <SectionTitle title={`Pending Approval (${pending.length})`} />
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "14px" }}>
                  {pending.map((r) => (
                    <div key={r.id} style={{ padding: "9px 14px", borderBottom: `1px solid ${COLOURS.LIGHT}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{r.member_name}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{r.leave_type} · {formatDateUK(r.start_date)} to {formatDateUK(r.end_date)} · {r.days}d{r.reason && ` · ${r.reason}`}</div>
                      </div>
                      <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                        <button onClick={() => approveLeave(r.id)} style={{ backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: "5px", padding: "4px 10px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Approve</button>
                        <button onClick={() => rejectLeave(r.id)} style={{ backgroundColor: "white", color: COLOURS.RED, border: `1px solid ${COLOURS.RED}`, borderRadius: "5px", padding: "4px 10px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* All leave records */}
            <SectionTitle title="Leave Records" />
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
              {records.length === 0 ? (
                <div style={{ padding: "14px", color: COLOURS.SLATE, textAlign: "center" }}>No leave records.</div>
              ) : records.slice(0, 30).map((r) => (
                <div key={r.id} style={{ padding: "8px 14px", borderBottom: `1px solid ${COLOURS.LIGHT}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{r.member_name}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                      {r.leave_type} · {formatDateUK(r.start_date)} to {formatDateUK(r.end_date)} · {r.days}d
                      {r.reason && ` · ${r.reason}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                    <StatusBadge status={r.status} />
                    {isAdmin && <button onClick={() => deleteLeave(r.id)} style={{ background: "transparent", border: "none", color: COLOURS.RED, fontSize: "14px", cursor: "pointer" }} title="Delete">×</button>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

const inp: React.CSSProperties = { display: "block", width: "100%", padding: "7px 10px", marginTop: "3px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" };
