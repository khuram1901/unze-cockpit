"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

const AUDIT_STAGES: { label: string; pct: number }[] = [
  { label: "Audit Planning", pct: 0 },
  { label: "Data Collection", pct: 20 },
  { label: "Data Verification", pct: 30 },
  { label: "Draft Audit Findings", pct: 60 },
  { label: "Review of IA Report", pct: 70 },
  { label: "Communication to Process Owner", pct: 90 },
  { label: "Submission to Senior Management", pct: 100 },
];

const STATUSES = ["Planned", "In Progress", "Completed", "Cancelled"];
const AUDIT_TYPES = ["Financial", "Operational", "Compliance", "IT", "Other"];

type AuditItem = {
  id: string;
  audit_area: string;
  audit_type: string | null;
  scope: string | null;
  planned_date: string | null;
  target_date: string | null;
  assigned_to: string | null;
  status: string;
  audit_stage: string | null;
  completion_pct: number | null;
  findings_count: number | null;
  notes: string | null;
  created_at: string;
};

const today = new Date().toISOString().slice(0, 10);

function overdueDays(targetDate: string | null): number {
  if (!targetDate || targetDate >= today) return 0;
  const t = new Date(targetDate + "T00:00:00");
  const n = new Date(today + "T00:00:00");
  return Math.floor((n.getTime() - t.getTime()) / 86400000);
}

function stageToCompletion(stage: string | null): number {
  if (!stage) return 0;
  const found = AUDIT_STAGES.find((s) => s.label === stage);
  return found ? found.pct : 0;
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "16px", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px",
};
const th: React.CSSProperties = {
  textAlign: "left", borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "6px 10px",
  fontSize: "14px", color: COLOURS.SLATE, fontWeight: 700,
};
const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`, padding: "7px 10px", fontSize: "15px",
};

export default function AuditDashboard() {
  const isMobile = useMobile();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [auditArea, setAuditArea] = useState("");
  const [auditType, setAuditType] = useState("");
  const [scope, setScope] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_plan_items")
      .select("*")
      .eq("company_id", UTPL_COMPANY_ID)
      .order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function showMsg(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 4000);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("audit_plan_items").insert({
      company_id: UTPL_COMPANY_ID,
      audit_area: auditArea,
      audit_type: auditType || null,
      scope: scope || null,
      planned_date: plannedDate || null,
      target_date: targetDate || null,
      assigned_to: assignedTo || null,
      notes: notes || null,
      status: "Planned",
      audit_stage: "Audit Planning",
      completion_pct: 0,
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "audit_plan_items", auditArea);
    showMsg("Audit item added.");
    setAuditArea(""); setAuditType(""); setScope(""); setPlannedDate("");
    setTargetDate(""); setAssignedTo(""); setNotes("");
    setShowForm(false);
    loadData();
  }

  async function updateField(id: string, field: string, value: unknown) {
    const updates: Record<string, unknown> = { [field]: value };
    if (field === "audit_stage") {
      updates.completion_pct = stageToCompletion(value as string);
      if (value === "Submission to Senior Management") {
        updates.status = "Completed";
      }
    }
    await supabase.from("audit_plan_items").update(updates).eq("id", id);
    logAction("Updated", "audit_plan_items", `${field} → ${value}`, id);
    loadData();
  }

  const active = items.filter((i) => i.status !== "Cancelled");
  const planned = items.filter((i) => i.status === "Planned").length;
  const inProgress = items.filter((i) => i.status === "In Progress").length;
  const completed = items.filter((i) => i.status === "Completed").length;
  const overdue = items.filter((i) => i.status !== "Completed" && i.status !== "Cancelled" && overdueDays(i.target_date) > 0).length;
  const avgPct = active.length > 0 ? Math.round(active.reduce((s, i) => s + (i.completion_pct || 0), 0) / active.length) : 0;

  function completionBar(pct: number) {
    const color = pct === 100 ? COLOURS.GREEN : pct >= 60 ? "#d97706" : COLOURS.BLUE;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div style={{ flex: 1, height: "8px", backgroundColor: "#f1f5f9", borderRadius: "4px", minWidth: "60px" }}>
          <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: "4px", transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: "13px", fontWeight: 700, color, minWidth: "32px" }}>{pct}%</span>
      </div>
    );
  }

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
      <PageHeader title="Internal Audit" subtitle="Audit department dashboard" />

      {message && (
        <div style={{
          border: `1px solid ${COLOURS.BORDER}`,
          borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
          borderRadius: "6px", padding: "10px 14px", marginBottom: "14px",
          backgroundColor: "white", fontSize: "16px", color: COLOURS.NAVY,
        }}>{message}</div>
      )}

      {/* Alert Banner */}
      {!loading && overdue > 0 && (
        <div style={{
          border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "8px",
          backgroundColor: "#fef2f2", overflow: "hidden", marginBottom: "14px",
        }}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{
            padding: "12px 16px", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#991b1b" }}>{overdue} audit{overdue > 1 ? "s" : ""} past target date</div>
                <div style={{ fontSize: "13px", color: "#991b1b", marginTop: "1px" }}>
                  {items.filter((i) => i.status !== "Completed" && i.status !== "Cancelled" && overdueDays(i.target_date) > 0).slice(0, 3).map((i) => `${i.audit_area} (${overdueDays(i.target_date)}d)`).join(" · ")}
                </div>
              </div>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#991b1b" }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={{ borderTop: "1px solid #fecaca", backgroundColor: "white" }}>
              {items.filter((i) => i.status !== "Completed" && i.status !== "Cancelled" && overdueDays(i.target_date) > 0).map((i) => (
                <div key={i.id} onClick={() => { setExpandedId(i.id); setBannerOpen(false); }} style={{
                  padding: "8px 16px 8px 48px", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{i.audit_area}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{i.assigned_to || "Unassigned"} · Stage: {i.audit_stage || "Not started"}</div>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626" }}>{overdueDays(i.target_date)}d overdue</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      {!loading && (
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "8px", marginBottom: "16px",
        }}>
          <CountCard label="Planned" value={planned} color={COLOURS.BLUE} />
          <CountCard label="In Progress" value={inProgress} color="#d97706" />
          <CountCard label="Completed" value={completed} color={COLOURS.GREEN} />
          <CountCard label="Overdue" value={overdue} color={COLOURS.RED} />
          <CountCard label="Avg Completion" value={avgPct} color={COLOURS.PURPLE} />
        </div>
      )}

      {/* Stage Pipeline Chart */}
      {!loading && items.length > 0 && (() => {
        const stageCounts = AUDIT_STAGES.map((s) => ({
          stage: s.label.length > 18 ? s.label.slice(0, 16) + "…" : s.label,
          count: items.filter((i) => i.audit_stage === s.label && i.status !== "Cancelled").length,
          pct: s.pct,
        }));
        const stageColors = ["#64748b", "#0070f3", "#2563eb", "#d97706", "#7c3aed", "#16a34a", "#16a34a"];
        return (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>
              Audit Pipeline — by Stage
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stageCounts} margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 11, fill: COLOURS.SLATE }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 12, fill: COLOURS.SLATE }} allowDecimals={false} />
                <Tooltip formatter={(value, _name, props) => [`${value} audit${Number(value) !== 1 ? "s" : ""} (${props.payload.pct}%)`, "Count"]} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {stageCounts.map((_, i) => <Cell key={i} fill={stageColors[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

      {/* Add button + form */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <SectionTitle title="Audit Records" />
        <button onClick={() => setShowForm(!showForm)} style={{
          backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
          padding: "8px 16px", fontSize: "15px", fontWeight: 700, cursor: "pointer",
        }}>{showForm ? "Cancel" : "+ Add"}</button>
      </div>

      {showForm && (
        <div style={{
          border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px",
          padding: "16px", backgroundColor: "white", marginBottom: "14px",
        }}>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px" }}>
              <label style={lbl}>Audit Area <input style={inp} value={auditArea} onChange={(e) => setAuditArea(e.target.value)} required placeholder="e.g. Procurement Process" /></label>
              <label style={lbl}>Audit Type
                <select style={inp} value={auditType} onChange={(e) => setAuditType(e.target.value)}>
                  <option value="">— Select —</option>
                  {AUDIT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label style={lbl}>Assigned To <input style={inp} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Auditor name" /></label>
              <label style={lbl}>Planned Date <input type="date" style={inp} value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} /></label>
              <label style={lbl}>Target Date <input type="date" style={inp} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} required /></label>
              <label style={lbl}>Scope <textarea style={{ ...inp, height: "60px" }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="What will be audited" /></label>
              <label style={lbl}>Notes <textarea style={{ ...inp, height: "60px" }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            </div>
            <button type="submit" disabled={saving} style={{
              backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
              padding: "10px 20px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "10px",
            }}>{saving ? "Saving…" : "Save"}</button>
          </form>
        </div>
      )}

      {/* Records table */}
      {loading ? (
        <p style={{ color: COLOURS.SLATE, fontSize: "16px" }}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", color: COLOURS.SLATE, fontSize: "16px" }}>
          No audit records yet.
        </div>
      ) : (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
          {items.map((item) => {
            const isExpanded = expandedId === item.id;
            const od = overdueDays(item.target_date);
            const isOverdue = od > 0 && item.status !== "Completed" && item.status !== "Cancelled";
            const pct = item.completion_pct || 0;

            return (
              <div key={item.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                {/* Summary row */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1fr 1fr 0.8fr 1.2fr",
                    gap: "8px", padding: "10px 12px", alignItems: "center",
                    cursor: "pointer", backgroundColor: isOverdue ? "#fef2f2" : isExpanded ? "#f8fafc" : "white",
                  }}
                >
                  {/* Audit Area (not editable) */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.audit_area}
                    </div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                      {item.audit_type || "—"} · {item.assigned_to || "Unassigned"}
                    </div>
                  </div>

                  {!isMobile && (
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                      <div>Target: {formatDateUK(item.target_date)}</div>
                      {isOverdue && <div style={{ color: COLOURS.RED, fontWeight: 700 }}>{od} days overdue</div>}
                    </div>
                  )}

                  {!isMobile && (
                    <div style={{ fontSize: "13px", color: COLOURS.NAVY }}>
                      {item.audit_stage || "Not started"}
                    </div>
                  )}

                  {!isMobile && <StatusBadge status={item.status} />}

                  {/* Completion bar */}
                  <div>{completionBar(pct)}</div>
                </div>

                {/* Mobile sub-info */}
                {isMobile && !isExpanded && (
                  <div style={{ padding: "0 12px 8px", fontSize: "12px", color: COLOURS.SLATE }}>
                    Target: {formatDateUK(item.target_date)}
                    {isOverdue && <span style={{ color: COLOURS.RED, fontWeight: 700 }}> · {od} days overdue</span>}
                    {" · "}{item.audit_stage || "Not started"}
                    {" · "}<StatusBadge status={item.status} />
                  </div>
                )}

                {/* Expanded edit panel */}
                {isExpanded && (
                  <div style={{ padding: "12px", borderTop: `1px solid ${COLOURS.BORDER}`, backgroundColor: "#f8fafc" }}>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                      {/* Audit Area — read only */}
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Audit Area</div>
                        <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, padding: "7px 10px", backgroundColor: "#f1f5f9", borderRadius: "6px", border: `1px solid ${COLOURS.BORDER}` }}>
                          {item.audit_area}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Status</div>
                        <select style={inp} value={item.status} onChange={(e) => updateField(item.id, "status", e.target.value)}>
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>

                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Audit Stage</div>
                        <select style={inp} value={item.audit_stage || ""} onChange={(e) => updateField(item.id, "audit_stage", e.target.value)}>
                          <option value="">— Select —</option>
                          {AUDIT_STAGES.map((s) => <option key={s.label} value={s.label}>{s.label} ({s.pct}%)</option>)}
                        </select>
                      </div>

                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Target Date</div>
                        <input type="date" style={inp} value={item.target_date || ""} onChange={(e) => updateField(item.id, "target_date", e.target.value || null)} />
                      </div>

                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Planned Date</div>
                        <input type="date" style={inp} value={item.planned_date || ""} onChange={(e) => updateField(item.id, "planned_date", e.target.value || null)} />
                      </div>

                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Assigned To</div>
                        <input style={inp} value={item.assigned_to || ""} onChange={(e) => updateField(item.id, "assigned_to", e.target.value || null)} />
                      </div>
                    </div>

                    {item.scope && (
                      <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginBottom: "6px" }}>
                        <strong>Scope:</strong> {item.scope}
                      </div>
                    )}
                    {item.notes && (
                      <div style={{ fontSize: "14px", color: COLOURS.SLATE }}>
                        <strong>Notes:</strong> {item.notes}
                      </div>
                    )}
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
