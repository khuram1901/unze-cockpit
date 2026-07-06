"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { COLOURS, RADII, useToast } from "../lib/SharedUI";
import { canManageTaxSchedule, isPA, type UserCtx, type PermOverrides } from "../lib/permissions";
import { useMobile } from "../lib/useMobile";

// ── Types ──────────────────────────────────────────────────────────

type ScheduleStatus = "Not Started" | "In Progress" | "External Auditors" | "Completed";
type ReturnType = "FBR_SALES_TAX" | "PRA_TAX" | "INCOME_TAX";
type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

// ── Constants ──────────────────────────────────────────────────────

const QUARTERLY_ENTITIES = [
  { key: "UT",      label: "Unze Trading" },
  { key: "IMP",     label: "Imperial" },
  { key: "BARANH",  label: "Baranh" },
  { key: "HD",      label: "Haute Dolci" },
  { key: "ALMAHAR", label: "Almahar" },
];

const ANNUAL_ENTITIES = [
  { key: "UT",       label: "Unze Trading" },
  { key: "IMP",      label: "Imperial" },
  { key: "BARANH",   label: "Baranh" },
  { key: "HD",       label: "Haute Dolci" },
  { key: "ALMAHAR",  label: "Almahar" },
  { key: "KK_JHANG", label: "K&K Jhang" },
  { key: "K_SALEEM", label: "Khuram Saleem" },
  { key: "KA_SALEEM",label: "Kamran Saleem" },
  { key: "W_SALEEM", label: "Waqas Saleem" },
  { key: "SH_SALEEM",label: "Mrs. Shahida Saleem" },
];

const QUARTERLY_STEPS = [
  "Record keeping of accounts",
  "Recording in Sage",
  "Record verification by external auditor",
  "Preparation of accounts",
  "Handover to external auditor",
];

const ANNUAL_STEPS = [
  "Bookkeeping",
  "Recording in Sage",
  "Preparation of accounts",
  "Handing over to external auditor",
  "Consulting with consultant",
  "Final submission",
];

const RETURN_TYPES = [
  { key: "FBR_SALES_TAX" as ReturnType, label: "FBR Sales Tax",  frequency: "monthly"   as const, entities: ["UT","IMP","ALMAHAR"],              dueDay: 15 },
  { key: "PRA_TAX"       as ReturnType, label: "PRA Tax",        frequency: "monthly"   as const, entities: ["UT","IMP","BARANH","HD","ALMAHAR"], dueDay: 15 },
  { key: "INCOME_TAX"    as ReturnType, label: "Income Tax",     frequency: "quarterly" as const, entities: ["UT","IMP","BARANH","HD","ALMAHAR"], dueDay: 15 },
];

const STATUS_COLOURS: Record<ScheduleStatus, { bg: string; text: string }> = {
  "Not Started":       { bg: COLOURS.CARD_ALT,    text: COLOURS.SLATE },
  "In Progress":       { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  "External Auditors": { bg: "#EEF1FC",            text: COLOURS.BLUE  },
  "Completed":         { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN },
};

const STATUS_OPTIONS: ScheduleStatus[] = ["Not Started","In Progress","External Auditors","Completed"];

// ── Fiscal year helpers ────────────────────────────────────────────

function getCurrentTaxYear(): string {
  const now = new Date();
  const m = now.getMonth() + 1; // 1-12
  const y = now.getFullYear();
  // Fiscal year: Jul–Jun. If month >= 7, year is e.g. "2026-27", else "2025-26"
  if (m >= 7) return `${y}-${String(y + 1).slice(2)}`;
  return `${y - 1}-${String(y).slice(2)}`;
}

function fiscalYearStart(year: string): number {
  // "2026-27" → 2026
  return parseInt(year.split("-")[0], 10);
}

function getFiscalSections(year: string): { key: Quarter; label: string; badge: string; months: string[] }[] {
  const s = fiscalYearStart(year);
  const n = s + 1; // next calendar year
  return [
    { key: "Q1", label: "Q1", badge: "Jul–Sep", months: [`${s}-07`,`${s}-08`,`${s}-09`] },
    { key: "Q2", label: "Q2", badge: "Oct–Dec", months: [`${s}-10`,`${s}-11`,`${s}-12`] },
    { key: "Q3", label: "Q3", badge: "Jan–Mar", months: [`${n}-01`,`${n}-02`,`${n}-03`] },
    { key: "Q4", label: "Q4", badge: "Apr–Jun", months: [`${n}-04`,`${n}-05`,`${n}-06`] },
  ];
}

function getCurrentQuarter(today: Date): Quarter {
  const m = today.getMonth() + 1;
  if (m >= 7 && m <= 9)  return "Q1";
  if (m >= 10 && m <= 12) return "Q2";
  if (m >= 1 && m <= 3)  return "Q3";
  return "Q4";
}

function nextFiscalYear(current: string): string {
  const s = fiscalYearStart(current) + 1;
  return `${s}-${String(s + 1).slice(2)}`;
}

// ── Overdue logic (pure function) ──────────────────────────────────

export function isOverdue(
  returnType: ReturnType,
  periodKey: string,
  filed: boolean,
  today: Date,
  taxYear: string
): boolean {
  if (filed) return false;
  const s = fiscalYearStart(taxYear);
  const n = s + 1;
  let dueDate: Date;

  if (returnType === "INCOME_TAX") {
    // Quarterly: due 15th of month AFTER quarter ends
    const quarterDue: Record<Quarter, string> = {
      Q1: `${s}-10-15`,
      Q2: `${n}-01-15`,
      Q3: `${n}-04-15`,
      Q4: `${n}-07-15`,
    };
    const ds = quarterDue[periodKey as Quarter];
    if (!ds) return false;
    dueDate = new Date(ds + "T00:00:00");
  } else {
    // Monthly: due 15th of the same month as the period
    dueDate = new Date(`${periodKey}-15T00:00:00`);
  }

  return today > dueDate;
}

// ── Component ──────────────────────────────────────────────────────

export default function AccountsTaxDashboard() {
  const router = useRouter();
  const isMobile = useMobile();
  const toast = useToast();

  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedYear, setSelectedYear] = useState(getCurrentTaxYear);
  const [availableYears, setAvailableYears] = useState<string[]>([getCurrentTaxYear()]);

  // Map key: "${year}:${section}:${stepIndex}:${entityKey}"
  const [scheduleEntries, setScheduleEntries] = useState<Map<string, ScheduleStatus>>(new Map());
  // Map key: "${year}:${returnType}:${entityKey}:${periodKey}"
  const [returnFilings, setReturnFilings] = useState<Map<string, boolean>>(new Map());

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedReturnQuarter, setSelectedReturnQuarter] = useState<Quarter>(() => getCurrentQuarter(new Date()));

  const [savingSchedule, setSavingSchedule] = useState<Set<string>>(new Set());
  const [savingFiling, setSavingFiling] = useState<Set<string>>(new Set());

  const [userEmail, setUserEmail] = useState("");

  // ── Auth + permissions ──

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      if (user.email) setUserEmail(user.email);

      const { data: memberData } = await supabase
        .from("members")
        .select("role, department, company")
        .eq("email", user.email)
        .maybeSingle();

      if (memberData) {
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email: user.email, role: memberData.role, department: memberData.department, company: memberData.company, overrides };
        setUserCtx(ctx);
        if (isPA(ctx)) { router.push("/pa"); return; }
        setCanManage(canManageTaxSchedule(ctx));
      }
    }
    init();
  }, [router]);

  // ── Load data ──

  const loadData = useCallback(async (year: string) => {
    setLoading(true);

    const [schedRes, filingRes] = await Promise.all([
      supabase.from("tax_schedule_entries").select("tax_year, section, step_index, entity_key, status").eq("tax_year", year),
      supabase.from("tax_return_filings").select("tax_year, return_type, entity_key, period_key, filed").eq("tax_year", year),
    ]);

    const sm = new Map<string, ScheduleStatus>();
    for (const r of schedRes.data || []) {
      sm.set(`${r.tax_year}:${r.section}:${r.step_index}:${r.entity_key}`, r.status as ScheduleStatus);
    }
    setScheduleEntries(sm);

    const fm = new Map<string, boolean>();
    for (const r of filingRes.data || []) {
      fm.set(`${r.tax_year}:${r.return_type}:${r.entity_key}:${r.period_key}`, r.filed);
    }
    setReturnFilings(fm);

    setLoading(false);
  }, []);

  useEffect(() => {
    if (userCtx) loadData(selectedYear);
  }, [userCtx, selectedYear, loadData]);

  // ── Schedule status change ──

  async function handleStatusChange(section: string, stepIndex: number, entityKey: string, newStatus: ScheduleStatus) {
    const key = `${selectedYear}:${section}:${stepIndex}:${entityKey}`;

    // Optimistic update
    setScheduleEntries((prev) => new Map(prev).set(key, newStatus));
    setSavingSchedule((prev) => new Set(prev).add(key));

    const { error } = await supabase.from("tax_schedule_entries").upsert({
      tax_year: selectedYear,
      section,
      step_index: stepIndex,
      entity_key: entityKey,
      status: newStatus,
      updated_by: userEmail,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tax_year,section,step_index,entity_key" });

    setSavingSchedule((prev) => { const s = new Set(prev); s.delete(key); return s; });

    if (error) {
      toast.show("Save failed — " + error.message, "error");
      setScheduleEntries((prev) => { const m = new Map(prev); m.delete(key); return m; });
    }
  }

  // ── Filing toggle ──

  async function handleFilingToggle(returnType: ReturnType, entityKey: string, periodKey: string) {
    const key = `${selectedYear}:${returnType}:${entityKey}:${periodKey}`;
    const current = returnFilings.get(key) ?? false;
    const next = !current;

    // Optimistic update
    setReturnFilings((prev) => new Map(prev).set(key, next));
    setSavingFiling((prev) => new Set(prev).add(key));

    const { error } = await supabase.from("tax_return_filings").upsert({
      tax_year: selectedYear,
      return_type: returnType,
      entity_key: entityKey,
      period_key: periodKey,
      filed: next,
      filed_at: next ? new Date().toISOString() : null,
      filed_by: next ? userEmail : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tax_year,return_type,entity_key,period_key" });

    setSavingFiling((prev) => { const s = new Set(prev); s.delete(key); return s; });

    if (error) {
      toast.show("Save failed — " + error.message, "error");
      setReturnFilings((prev) => new Map(prev).set(key, current));
    }
  }

  // ── Helpers ──

  function getScheduleStatus(section: string, stepIndex: number, entityKey: string): ScheduleStatus {
    return scheduleEntries.get(`${selectedYear}:${section}:${stepIndex}:${entityKey}`) ?? "Not Started";
  }

  function getFiled(returnType: ReturnType, entityKey: string, periodKey: string): boolean {
    return returnFilings.get(`${selectedYear}:${returnType}:${entityKey}:${periodKey}`) ?? false;
  }

  function toggleSection(key: string) {
    setCollapsedSections((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  }

  function addNewYear() {
    const next = nextFiscalYear(availableYears[availableYears.length - 1]);
    setAvailableYears((prev) => [...prev, next]);
    setSelectedYear(next);
  }

  // ── Derived: overdue count for Return Filings banner ──

  const today = new Date();
  const fiscalSections = getFiscalSections(selectedYear);

  type OverdueItem = { entityLabel: string; returnLabel: string; period: string };
  const overdueItems: OverdueItem[] = [];

  for (const rt of RETURN_TYPES) {
    if (rt.frequency === "monthly") {
      for (const sec of fiscalSections) {
        for (const month of sec.months) {
          for (const ek of rt.entities) {
            const filed = getFiled(rt.key, ek, month);
            if (isOverdue(rt.key, month, filed, today, selectedYear)) {
              const entity = [...QUARTERLY_ENTITIES,...ANNUAL_ENTITIES].find((e) => e.key === ek);
              overdueItems.push({ entityLabel: entity?.label ?? ek, returnLabel: rt.label, period: month });
            }
          }
        }
      }
    } else {
      for (const q of ["Q1","Q2","Q3","Q4"] as Quarter[]) {
        for (const ek of rt.entities) {
          const filed = getFiled(rt.key, ek, q);
          if (isOverdue(rt.key, q, filed, today, selectedYear)) {
            const entity = QUARTERLY_ENTITIES.find((e) => e.key === ek);
            overdueItems.push({ entityLabel: entity?.label ?? ek, returnLabel: rt.label, period: q });
          }
        }
      }
    }
  }

  // ── Section summary chips ──

  function getSectionSummary(sectionKey: string, entities: typeof QUARTERLY_ENTITIES, steps: string[]) {
    let completed = 0, inProgress = 0, notStarted = 0;
    for (const e of entities) {
      for (let i = 1; i <= steps.length; i++) {
        const s = getScheduleStatus(sectionKey, i, e.key);
        if (s === "Completed") completed++;
        else if (s === "Not Started") notStarted++;
        else inProgress++;
      }
    }
    const total = entities.length * steps.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, inProgress, notStarted, total, pct };
  }

  // ── Styles ──

  const { NAVY, SLATE, HAIRLINE, CARD, CARD_ALT, CANVAS, GREEN, AMBER, RED, BLUE,
    SUCCESS_SOFT, WARNING_SOFT, DANGER_SOFT, TRACK, INK_700 } = COLOURS;

  const pillTab = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 600,
    cursor: "pointer", border: "none",
    backgroundColor: active ? NAVY : CARD_ALT,
    color: active ? "#fff" : SLATE,
    transition: "background 0.15s",
  });

  const tableHeaderCell: React.CSSProperties = {
    padding: "6px 10px", fontSize: "11px", fontWeight: 600, color: SLATE,
    textAlign: "center", whiteSpace: "nowrap", backgroundColor: CARD_ALT,
    borderBottom: `1px solid ${HAIRLINE}`, minWidth: "130px",
  };

  const tableRowLabel: React.CSSProperties = {
    padding: "8px 12px", fontSize: "12px", color: SLATE, fontWeight: 500,
    minWidth: isMobile ? "140px" : "200px", borderRight: `1px solid ${HAIRLINE}`,
    backgroundColor: CARD_ALT, whiteSpace: "nowrap",
    position: "sticky", left: 0, zIndex: 1,
  };

  const tableCell: React.CSSProperties = {
    padding: "6px 8px", textAlign: "center", borderBottom: `1px solid ${HAIRLINE}`,
    minWidth: "130px",
  };

  // Fix 2 — styled status select (pill, coloured, no browser arrow)
  const statusSelectStyle = (bg: string, text: string, saving: boolean): React.CSSProperties => ({
    fontSize: "12px", fontWeight: 600,
    padding: "4px 24px 4px 8px",
    borderRadius: RADII.PILL,
    border: `1px solid ${HAIRLINE}`,
    backgroundColor: bg, color: text,
    cursor: saving ? "wait" : "pointer",
    opacity: saving ? 0.6 : 1,
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2364748B'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 8px center",
    minWidth: "120px",
    fontFamily: "var(--font-sans, Inter, sans-serif)",
  });

  // Fix 3 — filing chip (read-only)
  const filingChipStyle = (filed: boolean, overdue: boolean): React.CSSProperties => ({
    fontSize: "11px", fontWeight: 600,
    padding: "3px 9px",
    borderRadius: RADII.PILL,
    border: `1px solid ${filed ? SUCCESS_SOFT : overdue ? DANGER_SOFT : HAIRLINE}`,
    backgroundColor: filed ? SUCCESS_SOFT : overdue ? DANGER_SOFT : CARD_ALT,
    color: filed ? GREEN : overdue ? RED : SLATE,
    whiteSpace: "nowrap" as const,
    display: "inline-block",
  });

  // Fix 3 — filing button (canManage)
  const filingButtonStyle = (filed: boolean, overdue: boolean, saving: boolean): React.CSSProperties => ({
    fontSize: "11px", fontWeight: 600,
    padding: "3px 9px",
    borderRadius: RADII.PILL,
    border: `1px solid ${filed ? SUCCESS_SOFT : overdue ? DANGER_SOFT : HAIRLINE}`,
    backgroundColor: filed ? SUCCESS_SOFT : overdue ? DANGER_SOFT : CARD_ALT,
    color: filed ? GREEN : overdue ? RED : SLATE,
    cursor: saving ? "wait" : "pointer",
    opacity: saving ? 0.6 : 1,
    whiteSpace: "nowrap" as const,
  });

  if (!userCtx && !loading) return null;

  return (
    <main style={{ padding: isMobile ? "16px 16px" : "32px 40px", maxWidth: "100%", minWidth: 0, backgroundColor: CANVAS, fontFamily: "var(--font-sans, Inter, sans-serif)" }}>
      {toast.element}

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontSize: "22px", fontWeight: 600, color: NAVY, margin: 0, letterSpacing: "-0.01em" }}>
            Accounts (Tax)
          </h1>
          <p style={{ fontSize: "13px", color: SLATE, margin: "4px 0 0" }}>
            Quarterly accounts schedule and monthly return filings
          </p>
        </div>

        {/* Year selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          {availableYears.map((y) => (
            <button key={y} style={pillTab(y === selectedYear)} onClick={() => setSelectedYear(y)}>{y}</button>
          ))}
          <button
            onClick={addNewYear}
            style={{ ...pillTab(false), backgroundColor: CARD_ALT, color: BLUE, border: `1px solid ${HAIRLINE}` }}
          >
            + New year
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: SLATE, fontSize: "14px", padding: "40px 0" }}>Loading…</div>
      ) : (
        <>
          {/* ══════════════════════════════════════════════════════
              AREA 1 — ACCOUNTS SCHEDULE
          ══════════════════════════════════════════════════════ */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "14px" }}>
              Accounts Schedule
            </div>

            {/* Q1–Q4 sections */}
            {fiscalSections.map((sec) => {
              const steps = QUARTERLY_STEPS;
              const entities = QUARTERLY_ENTITIES;
              const summary = getSectionSummary(sec.key, entities, steps);
              const collapsed = collapsedSections.has(sec.key);

              return (
                <div key={sec.key} style={{ border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: CARD, overflow: "hidden", marginBottom: "10px" }}>
                  {/* Section header */}
                  <div
                    onClick={() => toggleSection(sec.key)}
                    style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}
                  >
                    <span style={{ fontSize: "13px", color: SLATE }}>{collapsed ? "▶" : "▼"}</span>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: NAVY }}>{sec.label}</span>
                    <span style={{ fontSize: "12px", color: SLATE, backgroundColor: CARD_ALT, padding: "2px 8px", borderRadius: RADII.PILL }}>{sec.badge}</span>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginLeft: "4px" }}>
                      {summary.completed > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: SUCCESS_SOFT, color: GREEN }}>{summary.completed} done</span>}
                      {summary.inProgress > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: WARNING_SOFT, color: AMBER }}>{summary.inProgress} in progress</span>}
                      {summary.notStarted > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: CARD_ALT, color: SLATE }}>{summary.notStarted} not started</span>}
                    </div>
                    {/* Progress bar — TRACK always visible, GREEN fill on top */}
                    <div style={{ flex: 1, minWidth: "80px", height: "3px", backgroundColor: TRACK, borderRadius: "2px", position: "relative" }}>
                      {summary.pct > 0 && <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${summary.pct}%`, backgroundColor: GREEN, borderRadius: "2px", transition: "width 0.3s" }} />}
                    </div>
                    <span style={{ fontSize: "11px", color: SLATE }}>{summary.pct}%</span>
                  </div>

                  {/* Section body */}
                  {!collapsed && (
                    <div style={{ overflowX: "auto", borderTop: `1px solid ${HAIRLINE}` }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "auto" }}>
                        <thead>
                          <tr>
                            <th style={{ ...tableHeaderCell, textAlign: "left", minWidth: isMobile ? "140px" : "200px" }}>Step</th>
                            {entities.map((e) => (
                              <th key={e.key} style={tableHeaderCell}>
                                {isMobile ? e.label.slice(0, 4) : e.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {steps.map((step, si) => {
                            const stepIndex = si + 1;
                            return (
                              <tr key={stepIndex} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                                <td style={tableRowLabel}>{stepIndex}. {step}</td>
                                {entities.map((e) => {
                                  const status = getScheduleStatus(sec.key, stepIndex, e.key);
                                  const { bg, text } = STATUS_COLOURS[status];
                                  const cellKey = `${selectedYear}:${sec.key}:${stepIndex}:${e.key}`;
                                  const saving = savingSchedule.has(cellKey);
                                  return (
                                    <td key={e.key} style={tableCell}>
                                      {canManage ? (
                                        <select
                                          value={status}
                                          disabled={saving}
                                          onChange={(ev) => handleStatusChange(sec.key, stepIndex, e.key, ev.target.value as ScheduleStatus)}
                                          style={statusSelectStyle(bg, text, saving)}
                                        >
                                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                      ) : (
                                        <span style={{ fontSize: "12px", fontWeight: 600, padding: "4px 8px", borderRadius: RADII.PILL, border: `1px solid ${HAIRLINE}`, backgroundColor: bg, color: text, whiteSpace: "nowrap", display: "inline-block" }}>
                                          {status}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Annual Returns section */}
            {(() => {
              const sectionKey = "Annual";
              const steps = ANNUAL_STEPS;
              const entities = ANNUAL_ENTITIES;
              const summary = getSectionSummary(sectionKey, entities, steps);
              const collapsed = collapsedSections.has(sectionKey);

              return (
                <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: CARD, overflow: "hidden", marginBottom: "10px" }}>
                  <div
                    onClick={() => toggleSection(sectionKey)}
                    style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}
                  >
                    <span style={{ fontSize: "13px", color: SLATE }}>{collapsed ? "▶" : "▼"}</span>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: NAVY }}>Annual Returns</span>
                    <span style={{ fontSize: "12px", color: SLATE, backgroundColor: CARD_ALT, padding: "2px 8px", borderRadius: RADII.PILL }}>All entities</span>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginLeft: "4px" }}>
                      {summary.completed > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: SUCCESS_SOFT, color: GREEN }}>{summary.completed} done</span>}
                      {summary.inProgress > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: WARNING_SOFT, color: AMBER }}>{summary.inProgress} in progress</span>}
                      {summary.notStarted > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: CARD_ALT, color: SLATE }}>{summary.notStarted} not started</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: "80px", height: "3px", backgroundColor: TRACK, borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${summary.pct}%`, backgroundColor: GREEN, borderRadius: "2px", transition: "width 0.3s" }} />
                    </div>
                    <span style={{ fontSize: "11px", color: SLATE }}>{summary.pct}%</span>
                  </div>

                  {!collapsed && (
                    <div style={{ overflowX: "auto", borderTop: `1px solid ${HAIRLINE}` }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "auto" }}>
                        <thead>
                          <tr>
                            <th style={{ ...tableHeaderCell, textAlign: "left", minWidth: isMobile ? "140px" : "200px" }}>Step</th>
                            {entities.map((e) => (
                              <th key={e.key} style={tableHeaderCell}>
                                {isMobile ? e.label.slice(0, 4) : e.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {steps.map((step, si) => {
                            const stepIndex = si + 1;
                            return (
                              <tr key={stepIndex} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                                <td style={tableRowLabel}>{stepIndex}. {step}</td>
                                {entities.map((e) => {
                                  const status = getScheduleStatus(sectionKey, stepIndex, e.key);
                                  const { bg, text } = STATUS_COLOURS[status];
                                  const cellKey = `${selectedYear}:${sectionKey}:${stepIndex}:${e.key}`;
                                  const saving = savingSchedule.has(cellKey);
                                  return (
                                    <td key={e.key} style={tableCell}>
                                      {canManage ? (
                                        <select
                                          value={status}
                                          disabled={saving}
                                          onChange={(ev) => handleStatusChange(sectionKey, stepIndex, e.key, ev.target.value as ScheduleStatus)}
                                          style={statusSelectStyle(bg, text, saving)}
                                        >
                                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                      ) : (
                                        <span style={{ fontSize: "12px", fontWeight: 600, padding: "4px 8px", borderRadius: RADII.PILL, border: `1px solid ${HAIRLINE}`, backgroundColor: bg, color: text, whiteSpace: "nowrap", display: "inline-block" }}>
                                          {status}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ── Divider ── */}
          <div style={{ height: "1px", backgroundColor: HAIRLINE, margin: "0 0 32px" }} />

          {/* ══════════════════════════════════════════════════════
              AREA 2 — RETURN FILINGS
          ══════════════════════════════════════════════════════ */}
          <div>
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "2px" }}>Return Filings</div>
              <div style={{ fontSize: "13px", color: SLATE }}>Monthly and quarterly tax return filing status — due 15th of each period</div>
            </div>

            {/* Overdue alert banner */}
            {overdueItems.length > 0 && (
              <div style={{ backgroundColor: DANGER_SOFT, border: `1px solid ${RED}20`, borderRadius: RADII.CARD, padding: "14px 18px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "16px" }}>⚠</span>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: RED }}>
                    {overdueItems.length} return{overdueItems.length > 1 ? "s" : ""} overdue — past 15th deadline and not yet filed
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {overdueItems.map((item, i) => (
                    <div key={i} style={{ fontSize: "12px", color: RED }}>
                      {item.entityLabel} — {item.returnLabel} — {item.period}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quarter tab selector */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
              {(["Q1","Q2","Q3","Q4"] as Quarter[]).map((q) => {
                const sec = fiscalSections.find((s) => s.key === q);
                return (
                  <button key={q} style={pillTab(selectedReturnQuarter === q)} onClick={() => setSelectedReturnQuarter(q)}>
                    {q} <span style={{ fontWeight: 400, opacity: 0.7 }}>{sec?.badge}</span>
                  </button>
                );
              })}
            </div>

            {(() => {
              const sec = fiscalSections.find((s) => s.key === selectedReturnQuarter)!;
              const monthlyRTs = RETURN_TYPES.filter((r) => r.frequency === "monthly");
              const quarterlyRTs = RETURN_TYPES.filter((r) => r.frequency === "quarterly");

              function FilingCell({ returnType, entityKey, periodKey }: { returnType: ReturnType; entityKey: string; periodKey: string }) {
                const filed = getFiled(returnType, entityKey, periodKey);
                const overdue = isOverdue(returnType, periodKey, filed, today, selectedYear);
                const fKey = `${selectedYear}:${returnType}:${entityKey}:${periodKey}`;
                const saving = savingFiling.has(fKey);

                if (canManage) {
                  return (
                    <button
                      disabled={saving}
                      onClick={() => handleFilingToggle(returnType, entityKey, periodKey)}
                      style={filingButtonStyle(filed, overdue, saving)}
                    >
                      {filed ? "✓ Filed" : overdue ? "⚠ Overdue" : "Not filed"}
                    </button>
                  );
                }

                return (
                  <span style={filingChipStyle(filed, overdue)}>
                    {filed ? "✓ Filed" : overdue ? "⚠ Overdue" : "Not filed"}
                  </span>
                );
              }

              // Month label helper
              const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              function monthLabel(ym: string) {
                const m = parseInt(ym.split("-")[1], 10);
                return MONTH_NAMES[m - 1];
              }

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

                  {/* Sub-section A: Monthly Returns */}
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: INK_700, marginBottom: "12px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                      Monthly Returns
                    </div>
                    {monthlyRTs.map((rt) => (
                      <div key={rt.key} style={{ marginBottom: "14px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, marginBottom: "8px" }}>{rt.label}</div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ borderCollapse: "collapse", width: "100%" }}>
                            <thead>
                              <tr>
                                <th style={{ ...tableHeaderCell, textAlign: "left", minWidth: isMobile ? "100px" : "140px" }}>Entity</th>
                                {sec.months.map((m) => (
                                  <th key={m} style={tableHeaderCell}>{monthLabel(m)}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rt.entities.map((ek) => {
                                const entity = QUARTERLY_ENTITIES.find((e) => e.key === ek);
                                return (
                                  <tr key={ek} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                                    <td style={tableRowLabel}>{entity?.label ?? ek}</td>
                                    {sec.months.map((m) => (
                                      <td key={m} style={tableCell}>
                                        <FilingCell returnType={rt.key} entityKey={ek} periodKey={m} />
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Sub-section B: Quarterly Returns */}
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: INK_700, marginBottom: "12px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                      Quarterly Returns
                    </div>
                    {quarterlyRTs.map((rt) => (
                      <div key={rt.key} style={{ marginBottom: "14px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, marginBottom: "8px" }}>{rt.label}</div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ borderCollapse: "collapse", width: "100%" }}>
                            <thead>
                              <tr>
                                <th style={{ ...tableHeaderCell, textAlign: "left", minWidth: isMobile ? "100px" : "140px" }}>Entity</th>
                                <th style={tableHeaderCell}>{selectedReturnQuarter} Filing</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rt.entities.map((ek) => {
                                const entity = QUARTERLY_ENTITIES.find((e) => e.key === ek);
                                return (
                                  <tr key={ek} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                                    <td style={tableRowLabel}>{entity?.label ?? ek}</td>
                                    <td style={tableCell}>
                                      <FilingCell returnType={rt.key} entityKey={ek} periodKey={selectedReturnQuarter} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              );
            })()}
          </div>
        </>
      )}
    </main>
  );
}
