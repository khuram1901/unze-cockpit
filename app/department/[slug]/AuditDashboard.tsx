"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { downloadCSV } from "../../lib/exportUtils";
import ImportExportButtons from "../../lib/ImportExportButtons";

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
const TYPE_COLOURS: Record<string, string> = {
  Financial: "#2563eb", Operational: "#d97706", Compliance: "#7c3aed",
  IT: "#059669", Other: COLOURS.SLATE,
};

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
  return Math.floor((new Date(today + "T00:00:00").getTime() - new Date(targetDate + "T00:00:00").getTime()) / 86400000);
}

function stageToCompletion(stage: string | null): number {
  if (!stage) return 0;
  return AUDIT_STAGES.find((s) => s.label === stage)?.pct || 0;
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px",
};

export default function AuditDashboard() {
  const isMobile = useMobile();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);

  const [auditArea, setAuditArea] = useState("");
  const [auditType, setAuditType] = useState("");
  const [scope, setScope] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");

  async function loadData() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_plan_items").select("*")
      .eq("company_id", UTPL_COMPANY_ID)
      .order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("audit_plan_items").insert({
      company_id: UTPL_COMPANY_ID, audit_area: auditArea, audit_type: auditType || null,
      scope: scope || null, planned_date: plannedDate || null, target_date: targetDate || null,
      assigned_to: assignedTo || null, notes: notes || null,
      status: "Planned", audit_stage: "Audit Planning", completion_pct: 0,
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
      if (value === "Submission to Senior Management") updates.status = "Completed";
    }
    await supabase.from("audit_plan_items").update(updates).eq("id", id);
    logAction("Updated", "audit_plan_items", `${field} → ${value}`, id);
    loadData();
  }

  const active = items.filter((i) => i.status !== "Cancelled");
  const planned = items.filter((i) => i.status === "Planned").length;
  const inProgress = items.filter((i) => i.status === "In Progress").length;
  const completed = items.filter((i) => i.status === "Completed").length;
  const overdueItems = active.filter((i) => i.status !== "Completed" && overdueDays(i.target_date) > 0);
  const overdue = overdueItems.length;
  const avgPct = active.length > 0 ? Math.round(active.reduce((s, i) => s + (i.completion_pct || 0), 0) / active.length) : 0;

  // Chart data: stage pipeline (horizontal)
  const stagePipelineData = AUDIT_STAGES.map((s) => ({
    stage: s.label.replace("Communication to Process Owner", "Comm. to Owner").replace("Submission to Senior Management", "Submit to Mgmt").replace("Draft Audit Findings", "Draft Findings").replace("Review of IA Report", "Review Report"),
    count: active.filter((i) => i.audit_stage === s.label).length,
    pct: s.pct,
  }));
  const stageColors = [COLOURS.SLATE, "#2563eb", "#2563eb", "#d97706", "#7c3aed", "#059669", COLOURS.GREEN];

  // Chart data: by audit type (donut)
  const typeDonut = AUDIT_TYPES.map((t) => ({
    name: t, value: active.filter((i) => i.audit_type === t).length, color: TYPE_COLOURS[t] || COLOURS.SLATE,
  })).filter((d) => d.value > 0);

  // Chart data: auditor workload
  const auditorMap = new Map<string, { total: number; overdue: number; completed: number }>();
  for (const i of active) {
    const a = i.assigned_to || "Unassigned";
    if (!auditorMap.has(a)) auditorMap.set(a, { total: 0, overdue: 0, completed: 0 });
    const row = auditorMap.get(a)!;
    row.total++;
    if (i.status === "Completed") row.completed++;
    else if (overdueDays(i.target_date) > 0) row.overdue++;
  }
  const auditorData = Array.from(auditorMap.entries())
    .map(([name, d]) => ({ name: name.length > 14 ? name.slice(0, 12) + "…" : name, ...d, active: d.total - d.completed - d.overdue }))
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);

  // Group records by status
  const statusOrder = ["In Progress", "Planned", "Completed", "Cancelled"];
  const statusGroups = new Map<string, AuditItem[]>();
  for (const i of items) {
    if (!statusGroups.has(i.status)) statusGroups.set(i.status, []);
    statusGroups.get(i.status)!.push(i);
  }

  function completionBar(pct: number, small?: boolean) {
    const color = pct === 100 ? COLOURS.GREEN : pct >= 60 ? "#d97706" : COLOURS.BLUE;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <div style={{ flex: 1, height: small ? "6px" : "8px", backgroundColor: "#f1f5f9", borderRadius: "4px", minWidth: small ? "40px" : "60px" }}>
          <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: "4px", transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: small ? "11px" : "13px", fontWeight: 700, color, minWidth: "28px" }}>{pct}%</span>
      </div>
    );
  }

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      {/* Header with + button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader title="Internal Audit" subtitle="Audit planning, tracking, and completion" />
        <button onClick={() => setShowForm(!showForm)} style={{
          backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
          width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        }} title="Add audit">{showForm ? "×" : "+"}</button>
      </div>

      {message && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>{message}</div>
      )}

      {/* Collapsible add form */}
      {showForm && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>New Audit</div>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <label style={lbl}>Audit Area <input style={inp} value={auditArea} onChange={(e) => setAuditArea(e.target.value)} required placeholder="e.g. Procurement Process" /></label>
              <label style={lbl}>Audit Type <select style={inp} value={auditType} onChange={(e) => setAuditType(e.target.value)} required><option value="">Select</option>{AUDIT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label style={lbl}>Assigned To <input style={inp} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Auditor name" required /></label>
              <label style={lbl}>Planned Date <input type="date" style={inp} value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} /></label>
              <label style={lbl}>Target Date <input type="date" style={inp} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} required /></label>
              <label style={lbl}>Scope <textarea style={{ ...inp, height: "50px" }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="What will be audited" /></label>
            </div>
            <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving…" : "Add Audit"}</button>
          </form>
        </div>
      )}

      {/* ═══ ZONE 1: ALERT BANNER + KPIs ═══ */}
      {!loading && overdue > 0 && (
        <div style={{ border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "8px", backgroundColor: "#fef2f2", overflow: "hidden", marginBottom: "14px" }}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#991b1b" }}>{overdue} audit{overdue > 1 ? "s" : ""} past target date</div>
                <div style={{ fontSize: "13px", color: "#991b1b", marginTop: "1px" }}>{overdueItems.slice(0, 3).map((i) => `${i.audit_area} (${overdueDays(i.target_date)}d)`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#991b1b" }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={{ borderTop: "1px solid #fecaca", backgroundColor: "white" }}>
              {overdueItems.sort((a, b) => overdueDays(b.target_date) - overdueDays(a.target_date)).map((i) => (
                <div key={i.id} onClick={() => { setExpandedId(i.id); setBannerOpen(false); }} style={{ padding: "8px 16px 8px 48px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{i.audit_area}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{i.assigned_to || "Unassigned"} · {i.audit_stage || "Not started"}</div>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626" }}>{overdueDays(i.target_date)}d overdue</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          <CountCard label="Planned" value={planned} color={COLOURS.BLUE} />
          <CountCard label="In Progress" value={inProgress} color="#d97706" />
          <CountCard label="Completed" value={completed} color={COLOURS.GREEN} />
          <CountCard label="Overdue" value={overdue} color={COLOURS.RED} />
          <CountCard label="Avg %" value={avgPct} color={COLOURS.PURPLE} />
        </div>
      )}

      {/* ═══ ZONE 2: THREE CHART PANELS ═══ */}
      {!loading && items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          {/* Stage Pipeline — horizontal bars */}
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>Stage Pipeline</div>
            <ResponsiveContainer width="100%" height={AUDIT_STAGES.length * 28 + 10}>
              <BarChart data={stagePipelineData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: COLOURS.SLATE }} allowDecimals={false} />
                <YAxis dataKey="stage" type="category" tick={{ fontSize: 11, fill: COLOURS.NAVY }} width={95} />
                <Tooltip formatter={(value, _n, props) => [`${value} (${props.payload.pct}%)`, "Audits"]} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {stagePipelineData.map((_, i) => <Cell key={i} fill={stageColors[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* By Audit Type — donut */}
          {typeDonut.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>By Type</div>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={typeDonut} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={2}>
                    {typeDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value} audit${Number(value) > 1 ? "s" : ""}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                {typeDonut.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: COLOURS.SLATE }}>
                    <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auditor Workload — stacked horizontal bars */}
          {auditorData.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>Auditor Workload</div>
              <ResponsiveContainer width="100%" height={Math.max(120, auditorData.length * 32)}>
                <BarChart data={auditorData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: COLOURS.SLATE }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: COLOURS.NAVY }} width={80} />
                  <Tooltip />
                  <Bar dataKey="overdue" stackId="a" fill={COLOURS.RED} name="Overdue (red)" />
                  <Bar dataKey="active" stackId="a" fill={COLOURS.BLUE} name="Active (blue)" />
                  <Bar dataKey="completed" stackId="a" fill={COLOURS.GREEN} name="Done (green)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ═══ ZONE 3: RECORDS GROUPED BY STATUS ═══ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <SectionTitle title="Audit Records" />
        <ImportExportButtons
          onExport={() => {
            const headers = ["Audit Area", "Type", "Stage", "Completion %", "Status", "Assigned To", "Target Date", "Planned Date"];
            const rows = items.map((i) => [i.audit_area, i.audit_type || "—", i.audit_stage || "—", String(i.completion_pct || 0), i.status, i.assigned_to || "—", i.target_date || "—", i.planned_date || "—"]);
            downloadCSV(`audit-records-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
          }}
          onImport={async (rows) => {
            const errors: string[] = [];
            const validRows: Record<string, string>[] = [];
            rows.forEach((row, i) => {
              const line = i + 2;
              if (!row["Audit Area"]?.trim()) { errors.push(`Row ${line}: Audit Area is required`); return; }
              if (!row["Type"]?.trim()) { errors.push(`Row ${line}: Type is required`); return; }
              if (!row["Assigned To"]?.trim()) { errors.push(`Row ${line}: Assigned To is required`); return; }
              if (!row["Created By"]?.trim()) { errors.push(`Row ${line}: Created By is required`); return; }
              if (!row["Target Date"]?.trim()) { errors.push(`Row ${line}: Target Date is required`); return; }
              validRows.push(row);
            });
            if (errors.length > 0) {
              alert(`Import validation failed:\n\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ""}`);
              return;
            }
            let count = 0;
            for (const row of validRows) {
              const createdBy = row["Created By"].trim();
              const userNotes = row["Notes"]?.trim() || "";
              await supabase.from("audit_plan_items").insert({
                company_id: UTPL_COMPANY_ID, audit_area: row["Audit Area"].trim(),
                audit_type: row["Type"].trim(), assigned_to: row["Assigned To"].trim(),
                target_date: row["Target Date"].trim(), planned_date: row["Planned Date"]?.trim() || null,
                scope: row["Scope"]?.trim() || null,
                notes: userNotes ? `Created by: ${createdBy}\n${userNotes}` : `Created by: ${createdBy}`,
                status: "Planned", audit_stage: "Audit Planning", completion_pct: 0,
              });
              count++;
            }
            alert(`Successfully imported ${count} audit${count !== 1 ? "s" : ""}.`);
            loadData();
          }}
          templateHeaders={["Audit Area", "Type", "Assigned To", "Created By", "Target Date", "Planned Date", "Scope", "Notes"]}
          templateFilename="audit-import-template.csv"
          exportLabel="Export audit records as CSV"
          importLabel="Import audit records from CSV"
        />
      </div>

      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : items.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", color: COLOURS.SLATE }}>No audit records yet.</div>
      ) : (
        statusOrder.filter((s) => statusGroups.has(s)).map((status) => {
          const group = statusGroups.get(status)!;
          const statusColor = status === "In Progress" ? "#d97706" : status === "Completed" ? COLOURS.GREEN : status === "Cancelled" ? COLOURS.SLATE : COLOURS.BLUE;
          return (
            <div key={status} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "10px" }}>
              <div style={{ padding: "8px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: statusColor }} />
                  <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{status}</span>
                </div>
                <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{group.length} audit{group.length > 1 ? "s" : ""}</span>
              </div>

              {group.map((item) => {
                const isOpen = expandedId === item.id;
                const od = overdueDays(item.target_date);
                const isOverdue = od > 0 && item.status !== "Completed" && item.status !== "Cancelled";
                const pct = item.completion_pct || 0;

                return (
                  <div key={item.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                    <div onClick={() => setExpandedId(isOpen ? null : item.id)} style={{
                      padding: "9px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                      backgroundColor: isOverdue ? "#fef2f2" : isOpen ? "#f8fafc" : "white",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.audit_area}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                          {item.audit_type && <span style={{ fontSize: "11px", fontWeight: 600, padding: "1px 5px", borderRadius: "4px", backgroundColor: TYPE_COLOURS[item.audit_type] || COLOURS.SLATE, color: "white" }}>{item.audit_type}</span>}
                          <span>{item.assigned_to || "Unassigned"}</span>
                          {item.target_date && <span style={{ color: isOverdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: isOverdue ? 700 : 400 }}>Target: {formatDateUK(item.target_date)}{isOverdue ? ` (${od}d late)` : ""}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, minWidth: isMobile ? "60px" : "120px" }}>
                        {completionBar(pct, true)}
                        <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{isOpen ? "▼" : "▶"}</span>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderTop: `1px solid ${COLOURS.BORDER}` }}>
                        {/* Audit Area — editable */}
                        <div style={{ marginBottom: "8px" }}>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Audit Area</div>
                          <input style={inp} defaultValue={item.audit_area}
                            onBlur={(e) => { if (e.target.value.trim() !== item.audit_area) updateField(item.id, "audit_area", e.target.value.trim()); }} />
                        </div>
                        <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "8px" }}>
                          {item.scope && <div style={{ marginBottom: "4px" }}><strong>Scope:</strong> {item.scope}</div>}
                          {item.notes && <div style={{ marginBottom: "4px" }}><strong>Notes:</strong> {item.notes}</div>}
                          {item.planned_date && <div>Planned: {formatDateUK(item.planned_date)}</div>}
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Status</div>
                            <select style={inp} value={item.status} onChange={(e) => updateField(item.id, "status", e.target.value)}>
                              {STATUSES.map((s) => <option key={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Audit Stage</div>
                            <select style={inp} value={item.audit_stage || ""} onChange={(e) => updateField(item.id, "audit_stage", e.target.value)}>
                              <option value="">Select</option>
                              {AUDIT_STAGES.map((s) => <option key={s.label} value={s.label}>{s.label} ({s.pct}%)</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px" }}>Target Date</div>
                            <input type="date" style={inp} value={item.target_date || ""} onChange={(e) => updateField(item.id, "target_date", e.target.value || null)} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </main>
  );
}
