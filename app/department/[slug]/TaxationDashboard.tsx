"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge, WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { downloadCSV } from "../../lib/exportUtils";
import ImportExportButtons from "../../lib/ImportExportButtons";

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
  border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)", marginBottom: "4px",
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
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <PageHeader />
      </div>

      {message && (
        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "var(--bg-card, #ffffff)", fontSize: "15px", color: "var(--text-primary, #1e293b)" }}>{message}</div>
      )}

      {/* Alert Banner */}
      {!loading && hearingSoon.length > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{hearingSoon.length} hearing{hearingSoon.length > 1 ? "s" : ""} within 7 days</div>
                <div style={{ fontSize: "13px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>{hearingSoon.map((i) => `${i.title} (${formatDateUK(i.hearing_deadline)})`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={WARNING_BANNER_INNER}>
              {hearingSoon.map((i) => (
                <div key={i.id} onClick={() => { setExpandedId(i.id); setBannerOpen(false); }} style={{ padding: "8px 16px 8px 48px", borderBottom: "1px solid var(--border-light, #f1f5f9)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{i.title}</div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>{i.company_name || "—"} · {i.consultant_name || "No consultant"}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "#dc2626" }}>{formatDateUK(i.hearing_deadline)}</div>
                    {i.financial_exposure && <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>PKR {i.financial_exposure.toLocaleString()}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI Row */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          <CountCard label="Pending" value={pending.length} color="#d97706" />
          <CountCard label="Hearing Soon" value={hearingSoon.length} color={COLOURS.RED} />
          <CountCard label="High Exposure" value={highExposure.length} color={COLOURS.RED} />
          <CountCard label="Resolved" value={resolved} color={COLOURS.GREEN} />
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${totalExposure > 0 ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "7px", padding: "8px 10px", backgroundColor: "var(--bg-card, #ffffff)" }}>
            <div style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)", marginBottom: "1px" }}>Total Exposure</div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: totalExposure > 0 ? COLOURS.RED : COLOURS.GREEN }}>PKR {totalExposure.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Three chart panels */}
      {!loading && items.length > 0 && (() => {
        const companyColors: Record<string, string> = {
          "Unze Trading PVT Limited": "#1e293b", "Imperial Footwear PVT Limited": "#2563eb",
          "Haute Dolci": "#7c3aed", "Barahn PVT Limited": "#059669", "K&K Jhang": "#d97706",
        };
        const companyDonut = Array.from(
          pending.reduce((map, n) => {
            const c = n.company_name || "Unknown";
            map.set(c, (map.get(c) || 0) + 1);
            return map;
          }, new Map<string, number>())
        ).map(([name, value]) => ({
          name: name.replace(" PVT Limited", ""), value, color: companyColors[name] || COLOURS.SLATE,
        })).sort((a, b) => b.value - a.value);

        const typeColors: Record<string, string> = {
          "income tax": "#dc2626", "sales tax": "#d97706", "withholding tax": "#2563eb",
          "FBR notice": "#7c3aed", "provincial tax": "#059669", "customs": "#1e293b", "other": COLOURS.SLATE,
        };
        const typeDonut = Array.from(
          pending.reduce((map, n) => {
            const t = n.notice_type || "other";
            map.set(t, (map.get(t) || 0) + 1);
            return map;
          }, new Map<string, number>())
        ).map(([name, value]) => ({
          name, value, color: typeColors[name] || COLOURS.SLATE,
        })).sort((a, b) => b.value - a.value);

        return (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "14px", marginBottom: "14px" }}>
            {/* Notices by Company donut */}
            {companyDonut.length > 0 && (
              <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "6px" }}>Pending by Company</div>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={companyDonut} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={2}>
                      {companyDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} notice${Number(value) > 1 ? "s" : ""}`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                  {companyDonut.map((d) => (
                    <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notices by Type donut */}
            {typeDonut.length > 0 && (
              <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "6px" }}>Pending by Type</div>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={typeDonut} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={2}>
                      {typeDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} notice${Number(value) > 1 ? "s" : ""}`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                  {typeDonut.map((d) => (
                    <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Exposure by Company bar */}
            {exposureData.length > 0 && (
              <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "8px" }}>Exposure by Company</div>
                <ResponsiveContainer width="100%" height={Math.max(140, exposureData.length * 32)}>
                  <BarChart data={exposureData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: COLOURS.SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                    <YAxis dataKey="company" type="category" tick={{ fontSize: 11, fill: COLOURS.NAVY, fontWeight: 600 }} width={90} />
                    <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                    <Bar dataKey="amount" fill={COLOURS.RED} name="Exposure (PKR)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        );
      })()}

      {/* Notices header with export + button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px" }}>
        <SectionTitle title="Notices by Company" />
        <ImportExportButtons
          onExport={() => {
            const headers = ["Title", "Company", "Type", "Consultant", "Hearing Date", "Exposure (PKR)", "Status", "Received"];
            const rows = items.map((i) => [i.title, i.company_name || "—", i.notice_type || "—", i.consultant_name || "—", i.hearing_deadline || "—", String(i.financial_exposure || 0), i.resolution_status, i.received_date || "—"]);
            downloadCSV(`tax-notices-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
          }}
          onImport={async (rows) => {
            const errors: string[] = [];
            const validRows: Record<string, string>[] = [];
            rows.forEach((row, i) => {
              const line = i + 2;
              if (!row["Title"]?.trim()) { errors.push(`Row ${line}: Title is required`); return; }
              if (!row["Company"]?.trim()) { errors.push(`Row ${line}: Company is required`); return; }
              if (!row["Type"]?.trim()) { errors.push(`Row ${line}: Type is required`); return; }
              if (!row["Recorded By"]?.trim()) { errors.push(`Row ${line}: Recorded By is required`); return; }
              validRows.push(row);
            });
            if (errors.length > 0) {
              alert(`Import validation failed:\n\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ""}`);
              return;
            }
            let count = 0;
            for (const row of validRows) {
              const recordedBy = row["Recorded By"].trim();
              const userNotes = row["Notes"]?.trim() || "";
              await supabase.from("legal_notices").insert({
                company_id: UTPL_COMPANY_ID, title: row["Title"].trim(),
                company_name: row["Company"].trim(), notice_type: row["Type"].trim(),
                consultant_name: row["Consultant"]?.trim() || null, hearing_deadline: row["Hearing Date"]?.trim() || null,
                financial_exposure: row["Exposure (PKR)"] ? Number(row["Exposure (PKR)"]) : null,
                received_date: row["Received"]?.trim() || null, our_action_required: row["Our Action"]?.trim() || null,
                notes: userNotes ? `Recorded by: ${recordedBy}\n${userNotes}` : `Recorded by: ${recordedBy}`,
                resolution_status: "pending",
              });
              count++;
            }
            alert(`Successfully imported ${count} notice${count !== 1 ? "s" : ""}.`);
            loadData();
          }}
          templateHeaders={["Title", "Company", "Type", "Recorded By", "Consultant", "Hearing Date", "Exposure (PKR)", "Received", "Our Action", "Notes"]}
          templateFilename="tax-notices-import-template.csv"
          exportLabel="Export notices as CSV"
          importLabel="Import notices from CSV"
        />
        <button onClick={() => setShowForm(!showForm)} style={{
          backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
          width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        }} title="Add notice">{showForm ? "×" : "+"}</button>
      </div>

      {showForm && (
        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "10px" }}>New Notice</div>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <label style={lbl}>Notice Title <input style={inp} value={formData.title || ""} onChange={(e) => setField("title", e.target.value)} required placeholder="e.g. Income Tax Notice FY2025" /></label>
              <label style={lbl}>Type <select style={inp} value={formData.notice_type || ""} onChange={(e) => setField("notice_type", e.target.value)} required><option value="">Select</option>{NOTICE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label style={lbl}>Company <select style={inp} value={formData.company_name || ""} onChange={(e) => setField("company_name", e.target.value)} required><option value="">Select</option>{COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label style={lbl}>Consultant <select style={inp} value={formData.consultant_name || ""} onChange={(e) => setField("consultant_name", e.target.value)}><option value="">Select</option>{CONSULTANTS.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label style={lbl}>Received Date <input type="date" style={inp} value={formData.received_date || ""} onChange={(e) => setField("received_date", e.target.value)} /></label>
              <label style={lbl}>Hearing Deadline <input type="date" style={inp} value={formData.hearing_deadline || ""} onChange={(e) => setField("hearing_deadline", e.target.value)} /></label>
              <label style={lbl}>Financial Exposure (PKR) <input type="number" style={inp} value={formData.financial_exposure || ""} onChange={(e) => setField("financial_exposure", e.target.value)} placeholder="0" /></label>
              <label style={lbl}>Our Action Required <textarea style={{ ...inp, height: "50px" }} value={formData.our_action_required || ""} onChange={(e) => setField("our_action_required", e.target.value)} /></label>
              <label style={lbl}>Consultant Action <textarea style={{ ...inp, height: "50px" }} value={formData.consultant_action_required || ""} onChange={(e) => setField("consultant_action_required", e.target.value)} /></label>
            </div>
            <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving…" : "Add Notice"}</button>
          </form>
        </div>
      )}

      {/* Notices grouped by company */}
      {loading ? <p style={{ color: "var(--text-secondary, #64748b)" }}>Loading…</p> : items.length === 0 ? (
        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)" }}>No notices yet.</div>
      ) : (() => {
        const groups = new Map<string, Notice[]>();
        for (const item of items) {
          const c = item.company_name || "Unassigned";
          if (!groups.has(c)) groups.set(c, []);
          groups.get(c)!.push(item);
        }
        const companyNames = Array.from(groups.keys()).sort();

        return (
          <>
            {companyNames.map((company) => {
              const notices = groups.get(company)!;
              const companyPending = notices.filter((n) => n.resolution_status === "pending");
              const companyExposure = companyPending.reduce((s, n) => s + (n.financial_exposure || 0), 0);
              const companyHearingSoon = companyPending.filter((n) => { const d = daysUntil(n.hearing_deadline); return d >= 0 && d <= 7; }).length;

              return (
                <div key={company} style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden", marginBottom: "10px" }}>
                  {/* Company header */}
                  <div style={{ padding: "8px 14px", backgroundColor: "var(--bg-card-hover, #f8fafc)", borderBottom: "1px solid var(--border-color, #e2e8f0)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{company.replace(" PVT Limited", "")}</span>
                    <div style={{ display: "flex", gap: "10px", fontSize: "14px" }}>
                      {companyHearingSoon > 0 && <span style={{ fontWeight: 700, color: COLOURS.RED }}>{companyHearingSoon} hearing soon</span>}
                      {companyExposure > 0 && <span style={{ fontWeight: 700, color: COLOURS.RED }}>PKR {companyExposure.toLocaleString()}</span>}
                      <span style={{ color: "var(--text-secondary, #64748b)" }}>{companyPending.length} pending · {notices.length} total</span>
                    </div>
                  </div>

                  {/* Notice rows */}
                  {notices.map((item) => {
                    const isOpen = expandedId === item.id;
                    const hearingDays = daysUntil(item.hearing_deadline);
                    const isUrgent = item.resolution_status === "pending" && hearingDays >= 0 && hearingDays <= 7;
                    return (
                      <div key={item.id} style={{ borderBottom: "1px solid var(--border-color, #e2e8f0)" }}>
                        <div onClick={() => setExpandedId(isOpen ? null : item.id)} style={{
                          padding: "9px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                          backgroundColor: isUrgent ? "#fef2f2" : isOpen ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{item.title}</div>
                            <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)", marginTop: "2px" }}>
                              {item.notice_type || "—"} · {item.consultant_name || "No consultant"}
                              {item.hearing_deadline && <span style={{ color: isUrgent ? COLOURS.RED : "var(--text-secondary, #64748b)", fontWeight: isUrgent ? 700 : 400 }}> · Hearing: {formatDateUK(item.hearing_deadline)}{isUrgent ? ` (${hearingDays}d)` : ""}</span>}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                            {item.financial_exposure ? <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.RED }}>PKR {item.financial_exposure.toLocaleString()}</span> : null}
                            <StatusBadge status={item.resolution_status} />
                            <span style={{ color: "var(--text-secondary, #64748b)", fontSize: "15px" }}>{isOpen ? "▼" : "▶"}</span>
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ padding: "10px 14px", backgroundColor: "var(--bg-card-hover, #f8fafc)", borderTop: "1px solid var(--border-color, #e2e8f0)", fontSize: "15px", color: "var(--text-secondary, #64748b)" }}>
                            {item.hearing_deadline && <div style={{ marginBottom: "4px" }}>Hearing: <strong style={{ color: isUrgent ? COLOURS.RED : "var(--text-primary, #1e293b)" }}>{formatDateUK(item.hearing_deadline)}{isUrgent ? ` (${hearingDays}d away)` : ""}</strong></div>}
                            {item.received_date && <div style={{ marginBottom: "4px" }}>Received: {formatDateUK(item.received_date)}</div>}
                            {item.our_action_required && <div style={{ marginBottom: "4px" }}>Our action: {item.our_action_required}</div>}
                            {item.consultant_action_required && <div style={{ marginBottom: "4px" }}>Consultant action: {item.consultant_action_required}</div>}
                            {item.notes && <div style={{ marginBottom: "6px" }}>Notes: {item.notes}</div>}
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "6px" }}>
                              <span style={{ fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>Status:</span>
                              <select value={item.resolution_status} onChange={(e) => updateStatus(item.id, e.target.value)} style={{ padding: "5px 8px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", fontSize: "15px" }}>
                                {STATUSES.map((s) => <option key={s}>{s}</option>)}
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        );
      })()}
    </main>
  );
}
