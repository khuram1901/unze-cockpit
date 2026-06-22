"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

type Notice = {
  id: string;
  title: string;
  company_name: string | null;
  notice_type: string | null;
  consultant_name: string | null;
  received_date: string | null;
  hearing_deadline: string | null;
  financial_exposure: number | null;
  our_action_required: string | null;
  consultant_action_required: string | null;
  resolution_status: string;
  notes: string | null;
  created_at: string;
};

const today = new Date().toISOString().slice(0, 10);
const STATUSES = ["pending", "won", "lost", "settled"];
const NOTICE_TYPES = ["income tax", "sales tax", "withholding tax", "FBR notice", "provincial tax", "customs", "other"];
const COMPANIES = ["Unze Trading PVT Limited", "Imperial Footwear PVT Limited", "Haute Dolci", "Barahn PVT Limited", "K&K Jhang"];
const CONSULTANTS = ["Rana Munir", "Rana Shehbaz", "Hashim Butt", "Others"];

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86400000);
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px",
};

export default function TaxationDashboard() {
  const isMobile = useMobile();
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);

  const [formData, setFormData] = useState<Record<string, string>>({});

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from("legal_notices").select("*").eq("company_id", UTPL_COMPANY_ID).order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }
  function setField(key: string, value: string) { setFormData((prev) => ({ ...prev, [key]: value })); }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("legal_notices").insert({
      company_id: UTPL_COMPANY_ID, title: formData.title, notice_type: formData.notice_type || null,
      company_name: formData.company_name || null, consultant_name: formData.consultant_name || null,
      received_date: formData.received_date || null, hearing_deadline: formData.hearing_deadline || null,
      financial_exposure: formData.financial_exposure ? Number(formData.financial_exposure) : null,
      our_action_required: formData.our_action_required || null,
      consultant_action_required: formData.consultant_action_required || null,
      notes: formData.notes || null, resolution_status: "pending",
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "legal_notices", formData.title);
    showMsg("Notice added.");
    setFormData({});
    setShowForm(false);
    loadData();
  }

  async function updateStatus(id: string, newStatus: string) {
    await supabase.from("legal_notices").update({ resolution_status: newStatus }).eq("id", id);
    logAction("Updated", "legal_notices", `Status → ${newStatus}`, id);
    loadData();
  }

  const pending = items.filter((i) => i.resolution_status === "pending");
  const hearingSoon = pending.filter((i) => { const d = daysUntil(i.hearing_deadline); return d >= 0 && d <= 7; });
  const totalExposure = pending.reduce((s, i) => s + (i.financial_exposure || 0), 0);
  const highExposure = pending.filter((i) => (i.financial_exposure || 0) > 500000);
  const resolved = items.filter((i) => i.resolution_status !== "pending").length;

  // Exposure by company chart
  const companyExposure = new Map<string, number>();
  for (const i of pending) {
    const c = i.company_name || "Unknown";
    companyExposure.set(c, (companyExposure.get(c) || 0) + (i.financial_exposure || 0));
  }
  const exposureData = Array.from(companyExposure.entries())
    .map(([company, amount]) => ({ company: company.replace(" PVT Limited", ""), amount }))
    .sort((a, b) => b.amount - a.amount);

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
      <PageHeader title="Taxation" subtitle="Tax notices, hearings, and financial exposure tracking" />

      {message && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>{message}</div>
      )}

      {/* Alert Banner */}
      {!loading && hearingSoon.length > 0 && (
        <div style={{ border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "8px", backgroundColor: "#fef2f2", overflow: "hidden", marginBottom: "14px" }}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#991b1b" }}>{hearingSoon.length} hearing{hearingSoon.length > 1 ? "s" : ""} within 7 days</div>
                <div style={{ fontSize: "13px", color: "#991b1b", marginTop: "1px" }}>{hearingSoon.map((i) => `${i.title} (${formatDateUK(i.hearing_deadline)})`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#991b1b" }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={{ borderTop: "1px solid #fecaca", backgroundColor: "white" }}>
              {hearingSoon.map((i) => (
                <div key={i.id} onClick={() => { setExpandedId(i.id); setBannerOpen(false); }} style={{ padding: "8px 16px 8px 48px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{i.title}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{i.company_name || "—"} · {i.consultant_name || "No consultant"}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626" }}>{formatDateUK(i.hearing_deadline)}</div>
                    {i.financial_exposure && <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>PKR {i.financial_exposure.toLocaleString()}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPIs + Exposure Chart */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", marginBottom: "8px" }}>
              <CountCard label="Pending" value={pending.length} color="#d97706" />
              <CountCard label="Hearing < 7 Days" value={hearingSoon.length} color={COLOURS.RED} />
              <CountCard label="High Exposure" value={highExposure.length} color={COLOURS.RED} />
              <CountCard label="Resolved" value={resolved} color={COLOURS.GREEN} />
            </div>
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.BLUE}`, borderRadius: "7px", padding: "10px 12px", backgroundColor: "white" }}>
              <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>Total Pending Exposure</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: totalExposure > 0 ? COLOURS.RED : COLOURS.GREEN }}>PKR {totalExposure.toLocaleString()}</div>
            </div>
          </div>
          {exposureData.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>Exposure by Company</div>
              <ResponsiveContainer width="100%" height={Math.max(140, exposureData.length * 35)}>
                <BarChart data={exposureData} layout="vertical" margin={{ left: 5, right: 10, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: COLOURS.SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                  <YAxis dataKey="company" type="category" tick={{ fontSize: 12, fill: COLOURS.NAVY, fontWeight: 600 }} width={100} />
                  <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                  <Bar dataKey="amount" fill={COLOURS.RED} name="Exposure (PKR)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Add button + form */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <SectionTitle title="Notices" />
        <button onClick={() => setShowForm(!showForm)} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>{showForm ? "Cancel" : "+ Add"}</button>
      </div>

      {showForm && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <label style={lbl}>Notice Title <input style={inp} value={formData.title || ""} onChange={(e) => setField("title", e.target.value)} required placeholder="e.g. Income Tax Notice FY2025" /></label>
              <label style={lbl}>Type <select style={inp} value={formData.notice_type || ""} onChange={(e) => setField("notice_type", e.target.value)}><option value="">Select</option>{NOTICE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label style={lbl}>Company <select style={inp} value={formData.company_name || ""} onChange={(e) => setField("company_name", e.target.value)}><option value="">Select</option>{COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label style={lbl}>Consultant <select style={inp} value={formData.consultant_name || ""} onChange={(e) => setField("consultant_name", e.target.value)}><option value="">Select</option>{CONSULTANTS.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label style={lbl}>Received Date <input type="date" style={inp} value={formData.received_date || ""} onChange={(e) => setField("received_date", e.target.value)} /></label>
              <label style={lbl}>Hearing Deadline <input type="date" style={inp} value={formData.hearing_deadline || ""} onChange={(e) => setField("hearing_deadline", e.target.value)} /></label>
              <label style={lbl}>Financial Exposure (PKR) <input type="number" style={inp} value={formData.financial_exposure || ""} onChange={(e) => setField("financial_exposure", e.target.value)} placeholder="0" /></label>
              <label style={lbl}>Our Action Required <textarea style={{ ...inp, height: "50px" }} value={formData.our_action_required || ""} onChange={(e) => setField("our_action_required", e.target.value)} /></label>
              <label style={lbl}>Consultant Action <textarea style={{ ...inp, height: "50px" }} value={formData.consultant_action_required || ""} onChange={(e) => setField("consultant_action_required", e.target.value)} /></label>
            </div>
            <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving…" : "Save"}</button>
          </form>
        </div>
      )}

      {/* Records */}
      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : items.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", color: COLOURS.SLATE }}>No notices yet.</div>
      ) : (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
          {items.map((item) => {
            const isOpen = expandedId === item.id;
            const hearingDays = daysUntil(item.hearing_deadline);
            const isUrgent = item.resolution_status === "pending" && hearingDays >= 0 && hearingDays <= 7;
            return (
              <div key={item.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                <div onClick={() => setExpandedId(isOpen ? null : item.id)} style={{
                  padding: "9px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                  backgroundColor: isUrgent ? "#fef2f2" : isOpen ? "#f8fafc" : "white",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{item.title}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      {item.company_name || "—"} · {item.notice_type || "—"} · {item.consultant_name || "No consultant"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                    {item.financial_exposure && <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.RED }}>PKR {item.financial_exposure.toLocaleString()}</span>}
                    <StatusBadge status={item.resolution_status} />
                    <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{isOpen ? "▼" : "▶"}</span>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderTop: `1px solid ${COLOURS.BORDER}`, fontSize: "13px", color: COLOURS.SLATE }}>
                    {item.hearing_deadline && <div style={{ marginBottom: "4px" }}>Hearing: <strong style={{ color: isUrgent ? COLOURS.RED : COLOURS.NAVY }}>{formatDateUK(item.hearing_deadline)}{isUrgent ? ` (${hearingDays}d away)` : ""}</strong></div>}
                    {item.received_date && <div style={{ marginBottom: "4px" }}>Received: {formatDateUK(item.received_date)}</div>}
                    {item.our_action_required && <div style={{ marginBottom: "4px" }}>Our action: {item.our_action_required}</div>}
                    {item.consultant_action_required && <div style={{ marginBottom: "4px" }}>Consultant action: {item.consultant_action_required}</div>}
                    {item.notes && <div style={{ marginBottom: "6px" }}>Notes: {item.notes}</div>}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "6px" }}>
                      <span style={{ fontWeight: 600, color: COLOURS.NAVY }}>Status:</span>
                      <select value={item.resolution_status} onChange={(e) => updateStatus(item.id, e.target.value)} style={{ padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "13px" }}>
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
