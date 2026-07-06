"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase, loadMyPermissions } from "../../lib/supabase";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import DateInput from "../../lib/DateInput";
import { useMobile } from "../../lib/useMobile";
import {
  COLOURS, RADII, SHADOWS, PageHeader, SectionTitle, CountCard, StatusBadge,
  WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR,
  useToast, useConfirm, labelStyle, inputStyle, primaryButtonStyle,
} from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { canCreateAssignments, canManageTaxNotices, type UserCtx, type PermOverrides } from "../../lib/permissions";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { downloadCSV } from "../../lib/exportUtils";
import ImportExportButtons from "../../lib/ImportExportButtons";
import NewTaskForm from "../../tasks/NewTaskForm";

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
  is_active: boolean;
  notice_status: string | null;
  legal_stage: string | null;
};

type EditForm = {
  title: string;
  consultant_name: string;
  hearing_deadline: string;
  financial_exposure: string;
  resolution_status: string;
  our_action_required: string;
  consultant_action_required: string;
  notes: string;
  notice_type: string;
  company_name: string;
  received_date: string;
};

const STATUSES = ["pending", "won", "lost", "settled"];
const NOTICE_TYPES = ["income tax", "sales tax", "withholding tax", "FBR notice", "provincial tax", "customs", "other"];
const COMPANIES = ["Unze Trading PVT Limited", "Imperial Footwear PVT Limited", "Haute Dolci", "Barahn PVT Limited", "K&K Jhang"];
const CONSULTANTS = ["Rana Munir", "Rana Shehbaz", "Hashim Butt", "Others"];
const NOTICE_STATUSES = ["Order", "Notice", "Show Cause"] as const;
const LEGAL_STAGES = ["Authority", "Department", "CIR Appeal", "Tribunal", "High Court", "Supreme Court"] as const;

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86400000);
}

const TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  "income tax":      { bg: COLOURS.DANGER_SOFT, text: COLOURS.RED },
  "sales tax":       { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  "withholding tax": { bg: "#EEF1FC", text: COLOURS.BLUE },
  "FBR notice":      { bg: "#F0EEFB", text: COLOURS.PURPLE },
  "provincial tax":  { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN },
  "customs":         { bg: COLOURS.HAIRLINE, text: COLOURS.NAVY },
  "other":           { bg: COLOURS.HAIRLINE, text: COLOURS.SLATE },
};

const TYPE_COLOURS: Record<string, string> = {
  "income tax":      COLOURS.RED,
  "sales tax":       COLOURS.AMBER,
  "withholding tax": COLOURS.BLUE,
  "FBR notice":      COLOURS.PURPLE,
  "provincial tax":  COLOURS.GREEN,
  "customs":         COLOURS.NAVY,
  "other":           COLOURS.SLATE,
};

const COMPANY_COLOURS: Record<string, string> = {
  "Unze Trading PVT Limited":      COLOURS.BLUE,
  "Imperial Footwear PVT Limited": COLOURS.AMBER,
  "Haute Dolci":                   COLOURS.GREEN,
  "Barahn PVT Limited":            COLOURS.PURPLE,
  "K&K Jhang":                     COLOURS.SLATE,
};

const NOTICE_STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  "Order":      { bg: COLOURS.CARD_ALT, text: COLOURS.NAVY },
  "Notice":     { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  "Show Cause": { bg: COLOURS.DANGER_SOFT, text: COLOURS.RED },
};

function NoticeTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const { bg, text } = TYPE_BADGE[type] || { bg: COLOURS.HAIRLINE, text: COLOURS.SLATE };
  return (
    <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.XS, backgroundColor: bg, color: text, whiteSpace: "nowrap", textTransform: "capitalize" }}>
      {type}
    </span>
  );
}

function NoticeStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const { bg, text } = NOTICE_STATUS_BADGE[status] || { bg: COLOURS.HAIRLINE, text: COLOURS.SLATE };
  return (
    <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.XS, backgroundColor: bg, color: text, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.XS, backgroundColor: active ? COLOURS.SUCCESS_SOFT : COLOURS.WARNING_SOFT, color: active ? COLOURS.GREEN : COLOURS.AMBER, whiteSpace: "nowrap" }}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

const smallSelect: React.CSSProperties = {
  padding: "3px 8px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
  fontSize: "12px", backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, cursor: "pointer",
  fontFamily: "var(--font-body,'Inter',sans-serif)",
};

export default function TaxationDashboard() {
  const toast = useToast();
  const confirm = useConfirm();
  const isMobile = useMobile();

  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [formData, setFormData] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("legal_notices").select("*").eq("company_id", UTPL_COMPANY_ID).order("created_at", { ascending: false });
    setItems((data || []) as Notice[]);

    const { data: userData } = await supabase.auth.getUser();
    if (userData.user?.email) {
      const { data: memberData } = await supabase.from("members").select("role, department, company").eq("email", userData.user.email).maybeSingle();
      if (memberData) {
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email: userData.user.email, role: memberData.role, department: memberData.department, company: memberData.company, overrides };
        setUserCtx(ctx);
        setCanManage(canManageTaxNotices(ctx));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }
  function setField(key: string, value: string) { setFormData((prev) => ({ ...prev, [key]: value })); }

  // ── Optimistic field update ──
  async function patchNotice(id: string, patch: Partial<Notice>) {
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
    const { error } = await supabase.from("legal_notices").update(patch).eq("id", id);
    if (error) {
      toast.show("Save failed: " + error.message, "error");
      loadData();
    }
  }

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
      is_active: true, notice_status: null, legal_stage: null,
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "legal_notices", formData.title);
    showMsg("Notice added.");
    setFormData({});
    setShowForm(false);
    loadData();
  }

  function startEdit(item: Notice) {
    setEditingId(item.id);
    setExpandedId(item.id);
    setEditForm({
      title: item.title,
      consultant_name: item.consultant_name || "",
      hearing_deadline: item.hearing_deadline || "",
      financial_exposure: item.financial_exposure ? String(item.financial_exposure) : "",
      resolution_status: item.resolution_status,
      our_action_required: item.our_action_required || "",
      consultant_action_required: item.consultant_action_required || "",
      notes: item.notes || "",
      notice_type: item.notice_type || "",
      company_name: item.company_name || "",
      received_date: item.received_date || "",
    });
  }

  function cancelEdit() { setEditingId(null); setEditForm(null); }

  async function saveEdit(id: string) {
    if (!editForm) return;
    setSavingEdit(true);
    const patch = {
      title: editForm.title,
      consultant_name: editForm.consultant_name || null,
      hearing_deadline: editForm.hearing_deadline || null,
      financial_exposure: editForm.financial_exposure ? Number(editForm.financial_exposure) : null,
      resolution_status: editForm.resolution_status,
      our_action_required: editForm.our_action_required || null,
      consultant_action_required: editForm.consultant_action_required || null,
      notes: editForm.notes || null,
      notice_type: editForm.notice_type || null,
      company_name: editForm.company_name || null,
      received_date: editForm.received_date || null,
    };
    const { error } = await supabase.from("legal_notices").update(patch).eq("id", id);
    setSavingEdit(false);
    if (error) { toast.show("Save failed: " + error.message, "error"); return; }
    logAction("Updated", "legal_notices", editForm.title, id);
    toast.show("Notice saved.", "success");
    setEditingId(null);
    setEditForm(null);
    loadData();
  }

  async function handleDelete(item: Notice) {
    const ok = await confirm.confirm(`Delete "${item.title}"? This cannot be undone.`, true);
    if (!ok) return;
    const { error } = await supabase.from("legal_notices").delete().eq("id", item.id);
    if (error) { toast.show("Delete failed: " + error.message, "error"); return; }
    logAction("Deleted", "legal_notices", item.title, item.id);
    setItems((prev) => prev.filter((n) => n.id !== item.id));
    toast.show("Notice deleted.", "success");
  }

  // ── Derived counts (always from full items, not filtered) ──
  const pending = items.filter((i) => i.resolution_status === "pending");
  const hearingSoon = pending.filter((i) => { const d = daysUntil(i.hearing_deadline); return d >= 0 && d <= 7; });
  const totalExposure = pending.reduce((s, i) => s + (i.financial_exposure || 0), 0);
  const highExposure = pending.filter((i) => (i.financial_exposure || 0) > 500000);
  const resolved = items.filter((i) => i.resolution_status !== "pending").length;

  // ── Active filter ──
  const filteredItems = items.filter((i) => {
    if (activeFilter === "active") return i.is_active;
    if (activeFilter === "inactive") return !i.is_active;
    return true;
  });

  const companyExposureMap = new Map<string, number>();
  for (const i of pending) {
    const c = i.company_name || "Unknown";
    companyExposureMap.set(c, (companyExposureMap.get(c) || 0) + (i.financial_exposure || 0));
  }
  const exposureData = Array.from(companyExposureMap.entries())
    .map(([company, amount]) => ({ company: company.replace(" PVT Limited", ""), amount }))
    .sort((a, b) => b.amount - a.amount);

  // ── Tab pill style ──
  function tabStyle(active: boolean): React.CSSProperties {
    return {
      padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 600,
      cursor: "pointer", border: active ? "none" : `1px solid ${COLOURS.HAIRLINE}`,
      backgroundColor: active ? COLOURS.NAVY : COLOURS.CARD,
      color: active ? "#fff" : COLOURS.NAVY,
      transition: "background 0.15s",
    };
  }

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      {toast.element}
      {confirm.element}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <PageHeader />
      </div>

      {message && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px", backgroundColor: COLOURS.CARD, fontSize: "14px", color: COLOURS.NAVY }}>{message}</div>
      )}

      {/* Alert Banner */}
      {!loading && hearingSoon.length > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{hearingSoon.length} hearing{hearingSoon.length > 1 ? "s" : ""} within 7 days</div>
                <div style={{ fontSize: "12px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>{hearingSoon.map((i) => `${i.title} (${formatDateUK(i.hearing_deadline)})`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={WARNING_BANNER_INNER}>
              {hearingSoon.map((i) => (
                <div key={i.id} onClick={() => { setExpandedId(i.id); setBannerOpen(false); }} style={{ padding: "8px 16px 8px 48px", borderBottom: `1px solid ${COLOURS.TRACK}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{i.title}</div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>{i.company_name || "—"} · {i.consultant_name || "No consultant"}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.RED }}>{formatDateUK(i.hearing_deadline)}</div>
                    {i.financial_exposure && <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>PKR {i.financial_exposure.toLocaleString()}</div>}
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
          <CountCard label="Pending" value={pending.length} color={COLOURS.AMBER} />
          <CountCard label="Hearing Soon" value={hearingSoon.length} color={COLOURS.RED} />
          <CountCard label="High Exposure" value={highExposure.length} color={COLOURS.RED} />
          <CountCard label="Resolved" value={resolved} color={COLOURS.GREEN} />
          <div style={{ background: COLOURS.NAVY, border: `1px solid ${COLOURS.NAVY}`, borderRadius: RADII.CARD, padding: "16px 20px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Total Exposure</div>
            <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontSize: "40px", fontWeight: 600, color: "#FFFFFF", letterSpacing: "-0.025em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              PKR {(totalExposure / 1000000).toFixed(1)}M
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      {!loading && items.length > 0 && (() => {
        const companyDonut = Array.from(
          pending.reduce((map, n) => {
            const c = n.company_name || "Unknown";
            map.set(c, (map.get(c) || 0) + 1);
            return map;
          }, new Map<string, number>())
        ).map(([name, value]) => ({ name: name.replace(" PVT Limited", ""), value, color: COMPANY_COLOURS[name] || COLOURS.SLATE })).sort((a, b) => b.value - a.value);

        const typeDonut = Array.from(
          pending.reduce((map, n) => {
            const t = n.notice_type || "other";
            map.set(t, (map.get(t) || 0) + 1);
            return map;
          }, new Map<string, number>())
        ).map(([name, value]) => ({ name, value, color: TYPE_COLOURS[name] || COLOURS.SLATE })).sort((a, b) => b.value - a.value);

        return (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "14px", marginBottom: "14px" }}>
            {companyDonut.length > 0 && (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "16px 20px", backgroundColor: COLOURS.CARD }}>
                <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Pending by Company</div>
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
                    <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "12px", color: COLOURS.SLATE }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </div>
            )}
            {typeDonut.length > 0 && (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "16px 20px", backgroundColor: COLOURS.CARD }}>
                <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Pending by Type</div>
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
                    <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "12px", color: COLOURS.SLATE }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </div>
            )}
            {exposureData.length > 0 && (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "16px 20px", backgroundColor: COLOURS.CARD }}>
                <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Exposure by Company</div>
                <ResponsiveContainer width="100%" height={Math.max(140, exposureData.length * 32)}>
                  <BarChart data={exposureData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.TRACK} horizontal={false} />
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

      {/* Notices header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px", flexWrap: "wrap" }}>
        <SectionTitle title="Notices by Company" />
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ImportExportButtons
            onExport={() => {
              const headers = ["Title", "Company", "Type", "Consultant", "Hearing Date", "Exposure (PKR)", "Status", "Notice Status", "Stage", "Active", "Received"];
              const rows = items.map((i) => [i.title, i.company_name || "—", i.notice_type || "—", i.consultant_name || "—", i.hearing_deadline || "—", String(i.financial_exposure || 0), i.resolution_status, i.notice_status || "—", i.legal_stage || "—", i.is_active ? "Yes" : "No", i.received_date || "—"]);
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
                toast.show(`Import validation failed: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` ...and ${errors.length - 5} more` : ""}`, "error");
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
                  resolution_status: "pending", is_active: true,
                });
                count++;
              }
              toast.show(`Successfully imported ${count} notice${count !== 1 ? "s" : ""}.`, "success");
              loadData();
            }}
            templateHeaders={["Title", "Company", "Type", "Recorded By", "Consultant", "Hearing Date", "Exposure (PKR)", "Received", "Our Action", "Notes"]}
            templateFilename="tax-notices-import-template.csv"
            exportLabel="Export notices as CSV"
            importLabel="Import notices from CSV"
          />
          {canManage && (
            <button onClick={() => setShowForm(!showForm)} style={{
              backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: "50%",
              width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              boxShadow: SHADOWS.MODAL,
            }} title="Add notice">{showForm ? "×" : "+"}</button>
          )}
        </div>
      </div>

      {/* Add Notice form */}
      {canManage && showForm && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD, marginBottom: "14px" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "10px" }}>New Notice</div>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <label style={labelStyle}>Notice Title <input style={inputStyle} value={formData.title || ""} onChange={(e) => setField("title", e.target.value)} required placeholder="e.g. Income Tax Notice FY2025" /></label>
              <label style={labelStyle}>Type <select style={inputStyle} value={formData.notice_type || ""} onChange={(e) => setField("notice_type", e.target.value)} required><option value="">Select</option>{NOTICE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label style={labelStyle}>Company <select style={inputStyle} value={formData.company_name || ""} onChange={(e) => setField("company_name", e.target.value)} required><option value="">Select</option>{COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label style={labelStyle}>Consultant <select style={inputStyle} value={formData.consultant_name || ""} onChange={(e) => setField("consultant_name", e.target.value)}><option value="">Select</option>{CONSULTANTS.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label style={labelStyle}>Received Date <DateInput style={inputStyle} value={formData.received_date || ""} onChange={(e) => setField("received_date", e.target.value)} /></label>
              <label style={labelStyle}>Hearing Deadline <DateInput style={inputStyle} value={formData.hearing_deadline || ""} onChange={(e) => setField("hearing_deadline", e.target.value)} /></label>
              <label style={labelStyle}>Financial Exposure (PKR) <input type="number" style={inputStyle} value={formData.financial_exposure || ""} onChange={(e) => setField("financial_exposure", e.target.value)} placeholder="0" /></label>
              <label style={labelStyle}>Notice Status <select style={inputStyle} value={formData.notice_status || ""} onChange={(e) => setField("notice_status", e.target.value)}><option value="">— None —</option>{NOTICE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label style={labelStyle}>Legal Stage <select style={inputStyle} value={formData.legal_stage || ""} onChange={(e) => setField("legal_stage", e.target.value)}><option value="">— None —</option>{LEGAL_STAGES.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label style={labelStyle}>Our Action Required <textarea style={{ ...inputStyle, height: "50px" }} value={formData.our_action_required || ""} onChange={(e) => setField("our_action_required", e.target.value)} /></label>
              <label style={labelStyle}>Consultant Action <textarea style={{ ...inputStyle, height: "50px" }} value={formData.consultant_action_required || ""} onChange={(e) => setField("consultant_action_required", e.target.value)} /></label>
            </div>
            <button type="submit" disabled={saving} style={{ ...primaryButtonStyle, marginTop: "8px", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Add Notice"}</button>
          </form>
        </div>
      )}

      {/* Issue Task */}
      {userCtx && canCreateAssignments(userCtx) && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <button onClick={() => setShowTaskForm(!showTaskForm)} style={{ backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: RADII.PILL, padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            {showTaskForm ? "Cancel" : "+ Issue Task"}
          </button>
        </div>
      )}
      {showTaskForm && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: RADII.CARD, marginBottom: "14px", overflow: "hidden" }}>
          <NewTaskForm onCreated={() => { setShowTaskForm(false); loadData(); }} />
        </div>
      )}

      {/* Active / Inactive filter tabs */}
      {!loading && items.length > 0 && (
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
          <button style={tabStyle(activeFilter === "all")} onClick={() => setActiveFilter("all")}>All ({items.length})</button>
          <button style={tabStyle(activeFilter === "active")} onClick={() => setActiveFilter("active")}>Active ({items.filter((i) => i.is_active).length})</button>
          <button style={tabStyle(activeFilter === "inactive")} onClick={() => setActiveFilter("inactive")}>Inactive ({items.filter((i) => !i.is_active).length})</button>
        </div>
      )}

      {/* Notices grouped by company */}
      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : filteredItems.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD, color: COLOURS.SLATE }}>
          {activeFilter === "all" ? "No notices yet." : `No ${activeFilter} notices.`}
        </div>
      ) : (() => {
        const groups = new Map<string, Notice[]>();
        for (const item of filteredItems) {
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
                <div key={company} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "10px" }}>
                  {/* Company header */}
                  <div style={{ padding: "10px 16px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{company.replace(" PVT Limited", "")}</span>
                    <div style={{ display: "flex", gap: "10px", fontSize: "13px" }}>
                      {companyHearingSoon > 0 && <span style={{ fontWeight: 700, color: COLOURS.RED }}>{companyHearingSoon} hearing soon</span>}
                      {companyExposure > 0 && <span style={{ fontWeight: 700, color: COLOURS.RED }}>PKR {companyExposure.toLocaleString()}</span>}
                      <span style={{ color: COLOURS.SLATE }}>{companyPending.length} pending · {notices.length} total</span>
                    </div>
                  </div>

                  {/* Notice rows */}
                  {notices.map((item) => {
                    const isOpen = expandedId === item.id;
                    const isEditMode = editingId === item.id;
                    const hearingDays = daysUntil(item.hearing_deadline);
                    const isUrgent = item.resolution_status === "pending" && hearingDays >= 0 && hearingDays <= 7;

                    return (
                      <div key={item.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        {/* ── Notice row ── */}
                        <div style={{
                          padding: "10px 16px", display: "flex", justifyContent: "space-between",
                          alignItems: isMobile ? "flex-start" : "center",
                          flexDirection: isMobile ? "column" : "row",
                          gap: "8px",
                          backgroundColor: isUrgent ? COLOURS.DANGER_SOFT : isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                        }}>
                          {/* Left: title + meta */}
                          <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setExpandedId(isOpen ? null : item.id)}>
                            <div style={{ fontSize: "15px", fontWeight: 600, color: item.is_active ? COLOURS.NAVY : COLOURS.SLATE }}>
                              {item.title}
                              {!item.is_active && <span style={{ fontSize: "11px", fontWeight: 500, marginLeft: "6px", color: COLOURS.SLATE }}>(Inactive)</span>}
                            </div>
                            <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                              <NoticeTypeBadge type={item.notice_type} />
                              <span>{item.consultant_name || "No consultant"}</span>
                              {item.hearing_deadline && <span style={{ color: isUrgent ? COLOURS.RED : COLOURS.SLATE, fontWeight: isUrgent ? 700 : 400 }}>Hearing: {formatDateUK(item.hearing_deadline)}{isUrgent ? ` (${hearingDays}d)` : ""}</span>}
                            </div>
                          </div>

                          {/* Right: controls */}
                          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
                            {/* Active/Inactive toggle (canManage) or badge (read-only) */}
                            {canManage ? (
                              <div style={{ display: "flex", gap: "2px" }}>
                                <button
                                  onClick={() => patchNotice(item.id, { is_active: true })}
                                  style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: `${RADII.XS} 0 0 ${RADII.XS}`, border: `1px solid ${item.is_active ? COLOURS.GREEN : COLOURS.HAIRLINE}`, backgroundColor: item.is_active ? COLOURS.SUCCESS_SOFT : COLOURS.CARD, color: item.is_active ? COLOURS.GREEN : COLOURS.SLATE, cursor: "pointer" }}
                                >● Active</button>
                                <button
                                  onClick={() => patchNotice(item.id, { is_active: false })}
                                  style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: `0 ${RADII.XS} ${RADII.XS} 0`, border: `1px solid ${!item.is_active ? COLOURS.AMBER : COLOURS.HAIRLINE}`, backgroundColor: !item.is_active ? COLOURS.WARNING_SOFT : COLOURS.CARD, color: !item.is_active ? COLOURS.AMBER : COLOURS.SLATE, cursor: "pointer" }}
                                >○ Inactive</button>
                              </div>
                            ) : (
                              <ActiveBadge active={item.is_active} />
                            )}

                            {/* Notice Status */}
                            {canManage ? (
                              <select
                                value={item.notice_status || ""}
                                onChange={(e) => patchNotice(item.id, { notice_status: e.target.value || null })}
                                style={smallSelect}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">— Status —</option>
                                {NOTICE_STATUSES.map((s) => <option key={s}>{s}</option>)}
                              </select>
                            ) : (
                              <NoticeStatusBadge status={item.notice_status} />
                            )}

                            {/* Legal Stage */}
                            {canManage ? (
                              <select
                                value={item.legal_stage || ""}
                                onChange={(e) => patchNotice(item.id, { legal_stage: e.target.value || null })}
                                style={smallSelect}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">— Stage —</option>
                                {LEGAL_STAGES.map((s) => <option key={s}>{s}</option>)}
                              </select>
                            ) : (
                              item.legal_stage ? <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{item.legal_stage}</span> : null
                            )}

                            {item.financial_exposure ? <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.RED }}>PKR {item.financial_exposure.toLocaleString()}</span> : null}
                            <StatusBadge status={item.resolution_status} />

                            {/* Expand toggle */}
                            <span style={{ color: COLOURS.SLATE, fontSize: "14px", cursor: "pointer" }} onClick={() => setExpandedId(isOpen ? null : item.id)}>{isOpen ? "▼" : "▶"}</span>

                            {/* Delete */}
                            {canManage && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                                title="Delete notice"
                                style={{ background: "none", border: "none", cursor: "pointer", color: COLOURS.SLATE, fontSize: "15px", padding: "2px 4px", lineHeight: 1 }}
                              >🗑</button>
                            )}
                          </div>
                        </div>

                        {/* ── Expanded panel ── */}
                        {isOpen && (
                          <div style={{ padding: "14px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                            {isEditMode && editForm ? (
                              /* ── Edit form ── */
                              <div>
                                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                                  <label style={labelStyle}>Title *<input style={inputStyle} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} /></label>
                                  <label style={labelStyle}>Type<select style={inputStyle} value={editForm.notice_type} onChange={(e) => setEditForm({ ...editForm, notice_type: e.target.value })}><option value="">Select</option>{NOTICE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
                                  <label style={labelStyle}>Company<select style={inputStyle} value={editForm.company_name} onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}><option value="">Select</option>{COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></label>
                                  <label style={labelStyle}>Consultant<select style={inputStyle} value={editForm.consultant_name} onChange={(e) => setEditForm({ ...editForm, consultant_name: e.target.value })}><option value="">Select</option>{CONSULTANTS.map((c) => <option key={c}>{c}</option>)}</select></label>
                                  <label style={labelStyle}>Received Date<DateInput style={inputStyle} value={editForm.received_date} onChange={(e) => setEditForm({ ...editForm, received_date: e.target.value })} /></label>
                                  <label style={labelStyle}>Hearing Deadline<DateInput style={inputStyle} value={editForm.hearing_deadline} onChange={(e) => setEditForm({ ...editForm, hearing_deadline: e.target.value })} /></label>
                                  <label style={labelStyle}>Financial Exposure (PKR)<input type="number" style={inputStyle} value={editForm.financial_exposure} onChange={(e) => setEditForm({ ...editForm, financial_exposure: e.target.value })} /></label>
                                  <label style={labelStyle}>Resolution Status<select style={inputStyle} value={editForm.resolution_status} onChange={(e) => setEditForm({ ...editForm, resolution_status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
                                  <label style={labelStyle}>Our Action Required<textarea style={{ ...inputStyle, height: "52px" }} value={editForm.our_action_required} onChange={(e) => setEditForm({ ...editForm, our_action_required: e.target.value })} /></label>
                                  <label style={labelStyle}>Consultant Action<textarea style={{ ...inputStyle, height: "52px" }} value={editForm.consultant_action_required} onChange={(e) => setEditForm({ ...editForm, consultant_action_required: e.target.value })} /></label>
                                  <label style={labelStyle}>Notes<textarea style={{ ...inputStyle, height: "52px" }} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></label>
                                </div>
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <button onClick={() => saveEdit(item.id)} disabled={savingEdit} style={{ ...primaryButtonStyle, opacity: savingEdit ? 0.6 : 1 }}>{savingEdit ? "Saving…" : "Save changes"}</button>
                                  <button onClick={cancelEdit} style={{ padding: "7px 16px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              /* ── Read-only expanded view ── */
                              <div style={{ fontSize: "14px", color: COLOURS.SLATE }}>
                                {item.hearing_deadline && <div style={{ marginBottom: "4px" }}>Hearing: <strong style={{ color: isUrgent ? COLOURS.RED : COLOURS.NAVY }}>{formatDateUK(item.hearing_deadline)}{isUrgent ? ` (${hearingDays}d away)` : ""}</strong></div>}
                                {item.received_date && <div style={{ marginBottom: "4px" }}>Received: {formatDateUK(item.received_date)}</div>}
                                {item.our_action_required && <div style={{ marginBottom: "4px" }}>Our action: {item.our_action_required}</div>}
                                {item.consultant_action_required && <div style={{ marginBottom: "4px" }}>Consultant action: {item.consultant_action_required}</div>}
                                {item.notes && <div style={{ marginBottom: "6px" }}>Notes: {item.notes}</div>}
                                {canManage && (
                                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                                    <button onClick={() => startEdit(item)} style={{ padding: "5px 14px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: "transparent", color: COLOURS.NAVY, fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>Edit this notice</button>
                                  </div>
                                )}
                              </div>
                            )}
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
