"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge, WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

type Position = {
  id: string;
  position_title: string;
  department: string | null;
  date_opened: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

const today = new Date().toISOString().slice(0, 10);
const STATUSES = ["Open", "Interviewing", "Offered", "Filled", "Cancelled"];
const DEPARTMENTS = ["Unze Trading Ops", "Finance", "HR", "Admin", "Legal", "Sales", "Audit"];

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)", marginBottom: "4px",
};

export default function HRDashboard() {
  const isMobile = useMobile();
  const [items, setItems] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [dateOpened, setDateOpened] = useState(today);
  const [notes, setNotes] = useState("");

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from("recruitment_positions").select("*").eq("company_id", UTPL_COMPANY_ID).order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("recruitment_positions").insert({
      company_id: UTPL_COMPANY_ID, position_title: title, department: dept || null,
      date_opened: dateOpened || null, notes: notes || null, status: "Open",
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "recruitment_positions", title);
    showMsg("Position added.");
    setTitle(""); setDept(""); setDateOpened(today); setNotes("");
    setShowForm(false);
    loadData();
  }

  async function updateStatus(id: string, newStatus: string) {
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "Filled") {
      const item = items.find((i) => i.id === id);
      if (item?.date_opened) updates.time_to_hire_days = daysSince(item.date_opened);
    }
    await supabase.from("recruitment_positions").update(updates).eq("id", id);
    logAction("Updated", "recruitment_positions", `Status → ${newStatus}`, id);
    loadData();
  }

  const open = items.filter((i) => i.status === "Open" || i.status === "Interviewing");
  const filled = items.filter((i) => i.status === "Filled").length;
  const longOpen = open.filter((i) => daysSince(i.date_opened) > 60);
  const offered = items.filter((i) => i.status === "Offered").length;

  const donutData = [
    { name: "Open", value: items.filter((i) => i.status === "Open").length, color: "#d97706" },
    { name: "Interviewing", value: items.filter((i) => i.status === "Interviewing").length, color: COLOURS.BLUE },
    { name: "Offered", value: offered, color: "#7c3aed" },
    { name: "Filled", value: filled, color: COLOURS.GREEN },
  ].filter((d) => d.value > 0);

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      <PageHeader />

      {message && (
        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "var(--bg-card, #ffffff)", fontSize: "15px", color: "var(--text-primary, #1e293b)" }}>{message}</div>
      )}

      {/* Alert Banner */}
      {!loading && longOpen.length > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{longOpen.length} position{longOpen.length > 1 ? "s" : ""} open for 60+ days</div>
                <div style={{ fontSize: "13px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>{longOpen.map((i) => `${i.position_title} (${daysSince(i.date_opened)}d)`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={WARNING_BANNER_INNER}>
              {longOpen.map((i) => (
                <div key={i.id} onClick={() => { setExpandedId(i.id); setBannerOpen(false); }} style={{ padding: "8px 16px 8px 48px", borderBottom: "1px solid var(--border-light, #f1f5f9)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{i.position_title}</div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>{i.department || "—"} · Opened: {formatDateUK(i.date_opened)}</div>
                  </div>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: "#dc2626" }}>{daysSince(i.date_opened)}d open</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI + Donut */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px" }}>
            <CountCard label="Open Positions" value={open.length} color="#d97706" />
            <CountCard label="Filled" value={filled} color={COLOURS.GREEN} />
            <CountCard label="Open 60+ Days" value={longOpen.length} color={COLOURS.RED} />
            <CountCard label="Total" value={items.length} color={COLOURS.BLUE} />
          </div>
          {donutData.length > 0 && (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "6px" }}>Recruitment Pipeline</div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                    {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value} position${Number(value) > 1 ? "s" : ""}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                {donutData.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add button + form */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <SectionTitle title="Positions" />
        <button onClick={() => setShowForm(!showForm)} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "16px", fontWeight: 700, cursor: "pointer" }}>{showForm ? "Cancel" : "+ Add"}</button>
      </div>

      {showForm && (
        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <label style={lbl}>Position Title <input style={inp} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Finance Manager" /></label>
              <label style={lbl}>Department <select style={inp} value={dept} onChange={(e) => setDept(e.target.value)} required><option value="">Select</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>
              <label style={lbl}>Date Opened <input type="date" style={inp} value={dateOpened} onChange={(e) => setDateOpened(e.target.value)} required /></label>
              <label style={{ ...lbl, gridColumn: isMobile ? undefined : "1 / -1" }}>Notes <textarea style={{ ...inp, height: "50px" }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            </div>
            <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving…" : "Save"}</button>
          </form>
        </div>
      )}

      {/* Records */}
      {loading ? (
        <p style={{ color: "var(--text-secondary, #64748b)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)" }}>No positions yet.</div>
      ) : (
        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden" }}>
          {items.map((item) => {
            const isOpen = expandedId === item.id;
            const days = daysSince(item.date_opened);
            const isLong = days > 60 && item.status !== "Filled" && item.status !== "Cancelled";
            return (
              <div key={item.id} style={{ borderBottom: "1px solid var(--border-color, #e2e8f0)" }}>
                <div onClick={() => setExpandedId(isOpen ? null : item.id)} style={{
                  padding: "9px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                  backgroundColor: isLong ? "#fef2f2" : isOpen ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{item.position_title}</div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)", marginTop: "2px" }}>
                      {item.department || "—"} · Opened: {formatDateUK(item.date_opened)} · {days}d
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                    <StatusBadge status={item.status} />
                    <span style={{ color: "var(--text-secondary, #64748b)", fontSize: "15px" }}>{isOpen ? "▼" : "▶"}</span>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: "10px 14px", backgroundColor: "var(--bg-card-hover, #f8fafc)", borderTop: "1px solid var(--border-color, #e2e8f0)" }}>
                    {item.notes && <div style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)", marginBottom: "8px" }}>Notes: {item.notes}</div>}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>Status:</span>
                      <select value={item.status} onChange={(e) => updateStatus(item.id, e.target.value)} style={{ padding: "5px 8px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", fontSize: "15px" }}>
                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
