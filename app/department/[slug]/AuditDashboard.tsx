"use client";

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions } from "../../lib/supabase";
import { COMPANIES } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import DateInput from "../../lib/DateInput";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, RADII, SHADOWS, PageHeader, SectionTitle, CountCard, WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR, useToast } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { canCreateAssignments, type UserCtx, type PermOverrides } from "../../lib/permissions";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { downloadCSV } from "../../lib/exportUtils";
import ImportExportButtons from "../../lib/ImportExportButtons";
import NewTaskForm from "../../tasks/NewTaskForm";

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

const TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  Financial:   { bg: "#EEF1FC", text: COLOURS.BLUE },
  Operational: { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  Compliance:  { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN },
  IT:          { bg: COLOURS.HAIRLINE, text: COLOURS.SLATE },
  Other:       { bg: COLOURS.HAIRLINE, text: COLOURS.SLATE },
};

const TYPE_COLOURS: Record<string, string> = {
  Financial:   COLOURS.BLUE,
  Operational: COLOURS.AMBER,
  Compliance:  COLOURS.GREEN,
  IT:          COLOURS.SLATE,
  Other:       COLOURS.SLATE,
};

const COMPANY_BADGE_STYLES: Record<string, { bg: string; text: string }> = {
  UTPL: { bg: "#EEF1FC",              text: COLOURS.BLUE },
  IFPL: { bg: COLOURS.SUCCESS_SOFT,   text: COLOURS.GREEN },
  BRNH: { bg: COLOURS.WARNING_SOFT,   text: COLOURS.AMBER },
  HD:   { bg: "#F3EEF9",             text: "#6E45B8" },
  ALM:  { bg: COLOURS.CARD_ALT,      text: COLOURS.SLATE },
  DIR:  { bg: COLOURS.CARD_ALT,      text: COLOURS.NAVY },
};

type AuditItem = {
  id: string;
  company_id: string | null;
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
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, fontSize: "14px", boxSizing: "border-box",
  color: COLOURS.NAVY,
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE,
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px",
};

function CompanyBadge({ companyId }: { companyId: string | null }) {
  const company = COMPANIES.find((c) => c.id === companyId);
  if (!company) return null;
  const s = COMPANY_BADGE_STYLES[company.shortCode] || { bg: COLOURS.CARD_ALT, text: COLOURS.SLATE };
  return (
    <span style={{
      fontSize: "10px", fontWeight: 600, padding: "2px 6px",
      borderRadius: RADII.PILL, backgroundColor: s.bg, color: s.text,
      border: `1px solid ${s.text}22`, marginRight: "4px", whiteSpace: "nowrap",
    }}>
      {company.shortCode}
    </span>
  );
}

export default function AuditDashboard() {
  const isMobile = useMobile();
  const toast = useToast();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Add form state
  const [auditArea, setAuditArea] = useState("");
  const [auditType, setAuditType] = useState("");
  const [scope, setScope] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  // CSV import company selector
  const [importCompanyId, setImportCompanyId] = useState(COMPANIES[0]?.id || "");

  async function loadData() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_plan_items").select("*")
      .order("created_at", { ascending: false });
    setItems(data || []);

    const { data: userData } = await supabase.auth.getUser();
    if (userData.user?.email) {
      const { data: memberData } = await supabase.from("members").select("role, department, company").eq("email", userData.user.email).maybeSingle();
      if (memberData) {
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        setUserCtx({ email: userData.user.email, role: memberData.role, department: memberData.department, company: memberData.company, overrides });
      }
    }

    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId) { showMsg("Please select a company."); return; }
    setSaving(true);
    const { error } = await supabase.from("audit_plan_items").insert({
      company_id: selectedCompanyId, audit_area: auditArea, audit_type: auditType || null,
      scope: scope || null, planned_date: plannedDate || null, target_date: targetDate || null,
      assigned_to: assignedTo || null, notes: notes || null,
      status: "Planned", audit_stage: "Audit Planning", completion_pct: 0,
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "audit_plan_items", auditArea);
    showMsg("Audit item added.");
    setAuditArea(""); setAuditType(""); setScope(""); setPlannedDate("");
    setTargetDate(""); setAssignedTo(""); setNotes(""); setSelectedCompanyId("");
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

  // KPI calcs always over ALL items
  const active = items.filter((i) => i.status !== "Cancelled");
  const planned = items.filter((i) => i.status === "Planned").length;
  const inProgress = items.filter((i) => i.status === "In Progress").length;
  const completed = items.filter((i) => i.status === "Completed").length;
  const overdueItems = active.filter((i) => i.status !== "Completed" && overdueDays(i.target_date) > 0);
  const overdue = overdueItems.length;
  const avgPct = active.length > 0 ? Math.round(active.reduce((s, i) => s + (i.completion_pct || 0), 0) / active.length) : 0;

  // Filtered items for records list + charts
  const filteredByCompany = companyFilter === "all" ? items : items.filter((i) => i.company_id === companyFilter);
  const filteredItems = statusFilter === "all"
    ? filteredByCompany
    : statusFilter === "overdue"
      ? filteredByCompany.filter((i) => i.status !== "Completed" && i.status !== "Cancelled" && overdueDays(i.target_date) > 0)
      : filteredByCompany.filter((i) => i.status === statusFilter);

  const filteredActive = filteredItems.filter((i) => i.status !== "Cancelled");

  // Chart data (uses filteredActive)
  const stagePipelineData = AUDIT_STAGES.map((s) => ({
    stage: s.label.replace("Communication to Process Owner", "Comm. to Owner").replace("Submission to Senior Management", "Submit to Mgmt").replace("Draft Audit Findings", "Draft Findings").replace("Review of IA Report", "Review Report"),
    count: filteredActive.filter((i) => i.audit_stage === s.label).length,
    pct: s.pct,
  }));
  const stageColors = [COLOURS.SLATE, COLOURS.BLUE, COLOURS.BLUE, COLOURS.AMBER, COLOURS.PURPLE, COLOURS.GREEN, COLOURS.GREEN];

  const typeDonut = AUDIT_TYPES.map((t) => ({
    name: t, value: filteredActive.filter((i) => i.audit_type === t).length, color: TYPE_COLOURS[t] || COLOURS.SLATE,
  })).filter((d) => d.value > 0);

  const auditorMap = new Map<string, { total: number; overdue: number; completed: number }>();
  for (const i of filteredActive) {
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

  // Group filtered records by status
  const statusOrder = ["In Progress", "Planned", "Completed", "Cancelled"];
  const statusGroups = new Map<string, AuditItem[]>();
  for (const i of filteredItems) {
    if (!statusGroups.has(i.status)) statusGroups.set(i.status, []);
    statusGroups.get(i.status)!.push(i);
  }

  // Company filter tabs with counts
  const companyTabs = [
    { id: "all", label: "All", count: items.length },
    ...COMPANIES.map((c) => ({ id: c.id, label: c.shortCode, count: items.filter((i) => i.company_id === c.id).length })),
  ];

  // Status filter tabs with counts (based on company-filtered items)
  const overdueCount = filteredByCompany.filter((i) => i.status !== "Completed" && i.status !== "Cancelled" && overdueDays(i.target_date) > 0).length;
  const statusTabs = [
    { id: "all",         label: "All",         count: filteredByCompany.length },
    { id: "Planned",     label: "Planned",     count: filteredByCompany.filter((i) => i.status === "Planned").length },
    { id: "In Progress", label: "In Progress", count: filteredByCompany.filter((i) => i.status === "In Progress").length },
    { id: "overdue",     label: "Overdue",     count: overdueCount },
    { id: "Completed",   label: "Completed",   count: filteredByCompany.filter((i) => i.status === "Completed").length },
  ];

  function completionBar(pct: number, small?: boolean) {
    const color = pct === 100 ? COLOURS.GREEN : pct >= 60 ? COLOURS.AMBER : COLOURS.BLUE;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <div style={{ flex: 1, height: small ? "6px" : "8px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, minWidth: small ? "40px" : "60px" }}>
          <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: RADII.PILL, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: small ? "11px" : "13px", fontWeight: 600, color, minWidth: "28px", fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{pct}%</span>
      </div>
    );
  }

  function AuditTypeBadge({ type }: { type: string | null }) {
    if (!type) return null;
    const { bg, text } = TYPE_BADGE[type] || { bg: COLOURS.HAIRLINE, text: COLOURS.SLATE };
    return (
      <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.XS, backgroundColor: bg, color: text, whiteSpace: "nowrap" }}>
        {type}
      </span>
    );
  }

  function PillTabs({ tabs, active: activeId, onChange }: { tabs: { id: string; label: string; count: number }[]; active: string; onChange: (id: string) => void }) {
    return (
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          return (
            <button key={t.id} onClick={() => onChange(t.id)} style={{
              padding: "5px 12px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600,
              cursor: "pointer", border: `1px solid ${isActive ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
              backgroundColor: isActive ? COLOURS.NAVY : COLOURS.CARD,
              color: isActive ? "#FFFFFF" : COLOURS.NAVY,
              display: "flex", alignItems: "center", gap: "5px",
            }}>
              {t.label}
              <span style={{
                fontSize: "10px", fontWeight: 700, minWidth: "16px", height: "16px",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                borderRadius: RADII.PILL,
                backgroundColor: isActive ? "rgba(255,255,255,0.2)" : COLOURS.HAIRLINE,
                color: isActive ? "#FFFFFF" : COLOURS.SLATE,
                padding: "0 4px",
              }}>{t.count}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      {toast.element}
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader />
        <button onClick={() => setShowForm(!showForm)} style={{
          backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: "50%",
          width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          boxShadow: SHADOWS.MODAL,
        }} title="Add audit">{showForm ? "×" : "+"}</button>
      </div>

      {message && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px", backgroundColor: COLOURS.CARD, fontSize: "14px", color: COLOURS.NAVY }}>{message}</div>
      )}

      {/* Add Audit form */}
      {showForm && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD, marginBottom: "14px" }}>
          <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "12px" }}>New Audit</div>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px" }}>
              <label style={lbl}>Company / Entity
                <select style={inp} value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} required>
                  <option value="">— Select company —</option>
                  {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label style={lbl}>Audit Area <input style={inp} value={auditArea} onChange={(e) => setAuditArea(e.target.value)} required placeholder="e.g. Procurement Process" /></label>
              <label style={lbl}>Audit Type <select style={inp} value={auditType} onChange={(e) => setAuditType(e.target.value)} required><option value="">Select</option>{AUDIT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label style={lbl}>Assigned To <input style={inp} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Auditor name" required /></label>
              <label style={lbl}>Planned Date <DateInput style={inp} value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} /></label>
              <label style={lbl}>Target Date <DateInput style={inp} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} required /></label>
              <label style={lbl}>Scope <textarea style={{ ...inp, height: "50px" }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="What will be audited" /></label>
            </div>
            <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: RADII.PILL, padding: "8px 20px", fontSize: "13px", fontWeight: 600, cursor: "pointer", marginTop: "10px" }}>{saving ? "Saving…" : "Add Audit"}</button>
          </form>
        </div>
      )}

      {/* Issue Task */}
      {userCtx && canCreateAssignments(userCtx) && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <button
            onClick={() => setShowTaskForm(!showTaskForm)}
            style={{ backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: RADII.PILL, padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
          >
            {showTaskForm ? "Cancel" : "+ Issue Task"}
          </button>
        </div>
      )}

      {showTaskForm && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: RADII.CARD, marginBottom: "14px", overflow: "hidden" }}>
          <NewTaskForm onCreated={() => { setShowTaskForm(false); loadData(); }} />
        </div>
      )}

      {/* ═══ ZONE 1: ALERT BANNER ═══ */}
      {!loading && overdue > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{overdue} audit{overdue > 1 ? "s" : ""} past target date</div>
                <div style={{ fontSize: "12px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>{overdueItems.slice(0, 3).map((i) => `${i.audit_area} (${overdueDays(i.target_date)}d)`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={WARNING_BANNER_INNER}>
              {overdueItems.sort((a, b) => overdueDays(b.target_date) - overdueDays(a.target_date)).map((i) => (
                <div key={i.id} onClick={() => { setExpandedId(i.id); setBannerOpen(false); }} style={{ padding: "8px 16px 8px 48px", borderBottom: `1px solid ${COLOURS.TRACK}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{i.audit_area}</div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>{i.assigned_to || "Unassigned"} · {i.audit_stage || "Not started"}</div>
                  </div>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.RED }}>{overdueDays(i.target_date)}d overdue</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ ZONE 2: KPI CARDS (always all items) ═══ */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          <CountCard label="Planned" value={planned} color={COLOURS.BLUE} />
          <CountCard label="In Progress" value={inProgress} color={COLOURS.AMBER} />
          <CountCard label="Completed" value={completed} color={COLOURS.GREEN} />
          <CountCard label="Overdue" value={overdue} color={COLOURS.RED} />
          <CountCard label="Avg %" value={avgPct} color={COLOURS.PURPLE} />
        </div>
      )}

      {/* ═══ ZONE 3: THREE CHART PANELS (filtered) ═══ */}
      {!loading && filteredActive.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          {/* Stage Pipeline */}
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px" }}>Stage Pipeline</div>
            <ResponsiveContainer width="100%" height={AUDIT_STAGES.length * 28 + 10}>
              <BarChart data={stagePipelineData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.TRACK} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: COLOURS.SLATE }} allowDecimals={false} />
                <YAxis dataKey="stage" type="category" tick={{ fontSize: 11, fill: COLOURS.NAVY }} width={95} />
                <Tooltip formatter={(value, _n, props) => [`${value} (${props.payload.pct}%)`, "Audits"]} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {stagePipelineData.map((_, i) => <Cell key={i} fill={stageColors[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* By Audit Type */}
          {typeDonut.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD }}>
              <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px" }}>By Type</div>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={typeDonut} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={2}>
                    {typeDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value} audit${Number(value) > 1 ? "s" : ""}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", marginTop: "6px" }}>
                {typeDonut.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: COLOURS.SLATE }}>
                    <span style={{ width: "7px", height: "7px", borderRadius: "2px", backgroundColor: d.color }} /> {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auditor Workload */}
          {auditorData.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD }}>
              <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px" }}>Auditor Workload</div>
              <ResponsiveContainer width="100%" height={Math.max(120, auditorData.length * 32)}>
                <BarChart data={auditorData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.TRACK} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: COLOURS.SLATE }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: COLOURS.NAVY }} width={80} />
                  <Tooltip />
                  <Bar dataKey="overdue" stackId="a" fill={COLOURS.RED} name="Overdue" />
                  <Bar dataKey="active" stackId="a" fill={COLOURS.BLUE} name="Active" />
                  <Bar dataKey="completed" stackId="a" fill={COLOURS.GREEN} name="Done" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ═══ ZONE 4: RECORDS ═══ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
        <SectionTitle title="Audit Records" />
        <ImportExportButtons
          onExport={() => {
            const headers = ["Company", "Audit Area", "Type", "Stage", "Completion %", "Status", "Assigned To", "Target Date", "Planned Date"];
            const rows = filteredItems.map((i) => {
              const co = COMPANIES.find((c) => c.id === i.company_id);
              return [co?.shortCode || "—", i.audit_area, i.audit_type || "—", i.audit_stage || "—", String(i.completion_pct || 0), i.status, i.assigned_to || "—", i.target_date || "—", i.planned_date || "—"];
            });
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
              toast.show(`Import validation failed: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` ...and ${errors.length - 5} more` : ""}`, "error");
              return;
            }
            let count = 0;
            for (const row of validRows) {
              const createdBy = row["Created By"].trim();
              const userNotes = row["Notes"]?.trim() || "";
              await supabase.from("audit_plan_items").insert({
                company_id: importCompanyId, audit_area: row["Audit Area"].trim(),
                audit_type: row["Type"].trim(), assigned_to: row["Assigned To"].trim(),
                target_date: row["Target Date"].trim(), planned_date: row["Planned Date"]?.trim() || null,
                scope: row["Scope"]?.trim() || null,
                notes: userNotes ? `Created by: ${createdBy}\n${userNotes}` : `Created by: ${createdBy}`,
                status: "Planned", audit_stage: "Audit Planning", completion_pct: 0,
              });
              count++;
            }
            toast.show(`Successfully imported ${count} audit${count !== 1 ? "s" : ""}.`, "success");
            loadData();
          }}
          templateHeaders={["Audit Area", "Type", "Assigned To", "Created By", "Target Date", "Planned Date", "Scope", "Notes"]}
          templateFilename="audit-import-template.csv"
          exportLabel="Export audit records as CSV"
          importLabel="Import audit records from CSV"
        />
      </div>

      {/* Company selector for CSV import */}
      {!loading && (
        <div style={{ marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "11px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Import company:</span>
          <select style={{ ...inp, width: "auto", marginTop: 0 }} value={importCompanyId} onChange={(e) => setImportCompanyId(e.target.value)}>
            {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* Company filter tabs */}
      {!loading && (
        <div style={{ marginBottom: "8px" }}>
          <PillTabs tabs={companyTabs} active={companyFilter} onChange={(id) => { setCompanyFilter(id); setStatusFilter("all"); }} />
        </div>
      )}

      {/* Status filter tabs */}
      {!loading && (
        <div style={{ marginBottom: "14px" }}>
          <PillTabs tabs={statusTabs} active={statusFilter} onChange={setStatusFilter} />
        </div>
      )}

      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : filteredItems.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD, color: COLOURS.SLATE }}>No audit records match the selected filters.</div>
      ) : (
        statusOrder.filter((s) => statusGroups.has(s)).map((status) => {
          const group = statusGroups.get(status)!;
          const statusColor = status === "In Progress" ? COLOURS.AMBER : status === "Completed" ? COLOURS.GREEN : status === "Cancelled" ? COLOURS.SLATE : COLOURS.BLUE;
          return (
            <div key={status} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "10px" }}>
              <div style={{ padding: "10px 18px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: statusColor }} />
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.INK_700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{status}</span>
                </div>
                <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{group.length} audit{group.length > 1 ? "s" : ""}</span>
              </div>

              {group.map((item) => {
                const isOpen = expandedId === item.id;
                const od = overdueDays(item.target_date);
                const isOverdue = od > 0 && item.status !== "Completed" && item.status !== "Cancelled";
                const pct = item.completion_pct || 0;

                return (
                  <div key={item.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <div onClick={() => setExpandedId(isOpen ? null : item.id)} style={{
                      padding: "12px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                      backgroundColor: isOverdue ? COLOURS.DANGER_SOFT : isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.audit_area}</div>
                        <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "3px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                          <CompanyBadge companyId={item.company_id} />
                          {item.audit_type && <AuditTypeBadge type={item.audit_type} />}
                          <span>{item.assigned_to || "Unassigned"}</span>
                          {item.target_date && <span style={{ color: isOverdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: isOverdue ? 600 : 400 }}>Target: {formatDateUK(item.target_date)}{isOverdue ? ` (${od}d late)` : ""}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, minWidth: isMobile ? "60px" : "120px" }}>
                        {completionBar(pct, true)}
                        <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{isOpen ? "▼" : "▶"}</span>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ padding: "16px 18px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <div style={{ marginBottom: "10px" }}>
                          <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>Audit Area</div>
                          <input style={inp} defaultValue={item.audit_area}
                            onBlur={(e) => { if (e.target.value.trim() !== item.audit_area) updateField(item.id, "audit_area", e.target.value.trim()); }} />
                        </div>
                        <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginBottom: "10px" }}>
                          {item.scope && <div style={{ marginBottom: "4px" }}><strong>Scope:</strong> {item.scope}</div>}
                          {item.notes && <div style={{ marginBottom: "4px" }}><strong>Notes:</strong> {item.notes}</div>}
                          {item.planned_date && <div>Planned: {formatDateUK(item.planned_date)}</div>}
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px" }}>
                          <div>
                            <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>Status</div>
                            <select style={inp} value={item.status} onChange={(e) => updateField(item.id, "status", e.target.value)}>
                              {STATUSES.map((s) => <option key={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>Audit Stage</div>
                            <select style={inp} value={item.audit_stage || ""} onChange={(e) => updateField(item.id, "audit_stage", e.target.value)}>
                              <option value="">Select</option>
                              {AUDIT_STAGES.map((s) => <option key={s.label} value={s.label}>{s.label} ({s.pct}%)</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>Target Date</div>
                            <DateInput style={inp} value={item.target_date || ""} onChange={(e) => updateField(item.id, "target_date", e.target.value || null)} />
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
