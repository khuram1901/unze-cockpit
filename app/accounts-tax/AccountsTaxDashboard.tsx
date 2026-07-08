"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, authFetch, loadMyPermissions } from "../lib/supabase";
import { COLOURS, RADII, PageHeader, SectionTitle, CountCard, useToast } from "../lib/SharedUI";
import { canManageTaxSchedule, isPA, type UserCtx, type PermOverrides } from "../lib/permissions";
import TaxComplianceSummary from "./TaxComplianceSummary";
import { useMobile } from "../lib/useMobile";
import { formatDateUK } from "../lib/dateUtils";

// ── Types ──────────────────────────────────────────────────────────

type ScheduleStatus = "Not Started" | "In Progress" | "External Auditors" | "Completed";
type ReturnType = "FBR_SALES_TAX" | "PRA_TAX" | "INCOME_TAX";
type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

// ── Sign-off constant ──────────────────────────────────────────────

const SHAKEEL_EMAIL = "shakeel@unze.co.uk";

// ── Constants ──────────────────────────────────────────────────────

const QUARTERLY_ENTITIES = [
  { key: "UT",     label: "Unze Trading" },
  { key: "IMP",    label: "Imperial" },
  { key: "BARANH", label: "Baranh" },
  { key: "HD",     label: "Haute Dolci" },
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
  { key: "FBR_SALES_TAX" as ReturnType, label: "FBR Sales Tax",  frequency: "monthly"   as const, entities: ["UT","IMP"],              dueDay: 15 },
  { key: "PRA_TAX"       as ReturnType, label: "PRA Tax",        frequency: "monthly"   as const, entities: ["UT","IMP","BARANH","HD"], dueDay: 15 },
  { key: "INCOME_TAX"    as ReturnType, label: "Income Tax",     frequency: "quarterly" as const, entities: ["UT","IMP","BARANH","HD"], dueDay: 15 },
];

const STATUS_COLOURS: Record<ScheduleStatus, { bg: string; text: string; border: string }> = {
  "Not Started":       { bg: COLOURS.CARD_ALT,    text: COLOURS.SLATE, border: COLOURS.HAIRLINE },
  "In Progress":       { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER, border: "#F6D28A" },
  "External Auditors": { bg: "#EEF1FC",            text: COLOURS.BLUE,  border: "#C5CFF5" },
  "Completed":         { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN, border: "#9ED4A3" },
};

const STATUS_OPTIONS: ScheduleStatus[] = ["Not Started","In Progress","External Auditors","Completed"];

function getAvailableStatuses(currentStatus: ScheduleStatus, canManage: boolean): ScheduleStatus[] {
  if (canManage) return STATUS_OPTIONS;
  if (currentStatus === "Not Started") return STATUS_OPTIONS;
  return STATUS_OPTIONS.filter((s) => s !== "Not Started");
}

// ── Fiscal year helpers ────────────────────────────────────────────

function getCurrentTaxYear(): string {
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  if (m >= 7) return `${y}-${String(y + 1).slice(2)}`;
  return `${y - 1}-${String(y).slice(2)}`;
}

function fiscalYearStart(year: string): number {
  return parseInt(year.split("-")[0], 10);
}

function getFiscalSections(year: string): { key: Quarter; label: string; badge: string; months: string[] }[] {
  const s = fiscalYearStart(year);
  const n = s + 1;
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

function prevFiscalYear(current: string): string {
  const s = fiscalYearStart(current) - 1;
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

  const [scheduleEntries, setScheduleEntries] = useState<Map<string, ScheduleStatus>>(new Map());
  const [returnFilings, setReturnFilings] = useState<Map<string, boolean>>(new Map());

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedReturnQuarter, setSelectedReturnQuarter] = useState<Quarter>(() => getCurrentQuarter(new Date()));

  const [savingSchedule, setSavingSchedule] = useState<Set<string>>(new Set());
  const [savingFiling, setSavingFiling] = useState<Set<string>>(new Set());

  const [userEmail, setUserEmail] = useState("");

  const [signoffs, setSignoffs] = useState<Map<string, boolean>>(new Map());
  const [signoffMeta, setSignoffMeta] = useState<Map<string, { by: string; at: string }>>(new Map());
  const [isShakeel, setIsShakeel] = useState(false);
  // signoff key: "${year}:${section}:${entityKey}"

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

    const [schedRes, filingRes, schedYearsRes, filingYearsRes, signoffRes] = await Promise.all([
      supabase.from("tax_schedule_entries").select("tax_year, section, step_index, entity_key, status").eq("tax_year", year),
      supabase.from("tax_return_filings").select("tax_year, return_type, entity_key, period_key, filed").eq("tax_year", year),
      supabase.from("tax_schedule_entries").select("tax_year").order("tax_year"),
      supabase.from("tax_return_filings").select("tax_year").order("tax_year"),
      supabase.from("tax_accounts_signoffs").select("section, entity_key, signed_off, signed_off_by, signed_off_at").eq("tax_year", year),
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

    const sofm = new Map<string, boolean>();
    const sofmeta = new Map<string, { by: string; at: string }>();
    for (const r of signoffRes.data || []) {
      const k = `${year}:${r.section}:${r.entity_key}`;
      sofm.set(k, r.signed_off);
      if (r.signed_off && r.signed_off_by && r.signed_off_at) {
        sofmeta.set(k, { by: r.signed_off_by, at: r.signed_off_at });
      }
    }
    setSignoffs(sofm);
    setSignoffMeta(sofmeta);

    const { data: { user } } = await supabase.auth.getUser();
    setIsShakeel(user?.email?.toLowerCase() === SHAKEEL_EMAIL.toLowerCase());

    const dbYears = Array.from(new Set([
      ...(schedYearsRes.data || []).map((r) => r.tax_year),
      ...(filingYearsRes.data || []).map((r) => r.tax_year),
    ])).sort();

    const currentYear = getCurrentTaxYear();
    const prev = prevFiscalYear(currentYear);
    const allYears = Array.from(new Set([prev, ...dbYears, currentYear])).sort();
    setAvailableYears(allYears);

    authFetch("/api/cron/tax-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxYear: prev }),
    }).catch(() => {});

    setLoading(false);
  }, []);

  useEffect(() => {
    if (userCtx) loadData(selectedYear);
  }, [userCtx, selectedYear, loadData]);

  // ── Schedule status change ──

  async function handleStatusChange(section: string, stepIndex: number, entityKey: string, newStatus: ScheduleStatus) {
    const key = `${selectedYear}:${section}:${stepIndex}:${entityKey}`;
    setScheduleEntries((prev) => new Map(prev).set(key, newStatus));
    setSavingSchedule((prev) => new Set(prev).add(key));

    const { error } = await supabase.from("tax_schedule_entries").upsert({
      tax_year: selectedYear, section, step_index: stepIndex, entity_key: entityKey,
      status: newStatus, updated_by: userEmail, updated_at: new Date().toISOString(),
    }, { onConflict: "tax_year,section,step_index,entity_key" });

    setSavingSchedule((prev) => { const s = new Set(prev); s.delete(key); return s; });

    if (error) {
      toast.show("Save failed — " + error.message, "error");
      setScheduleEntries((prev) => { const m = new Map(prev); m.delete(key); return m; });
    } else {
      triggerAlertRecompute();
    }
  }

  // ── Filing toggle ──

  async function handleFilingToggle(returnType: ReturnType, entityKey: string, periodKey: string) {
    const key = `${selectedYear}:${returnType}:${entityKey}:${periodKey}`;
    const current = returnFilings.get(key) ?? false;
    const next = !current;

    setReturnFilings((prev) => new Map(prev).set(key, next));
    setSavingFiling((prev) => new Set(prev).add(key));

    const { error } = await supabase.from("tax_return_filings").upsert({
      tax_year: selectedYear, return_type: returnType, entity_key: entityKey, period_key: periodKey,
      filed: next, filed_at: next ? new Date().toISOString() : null,
      filed_by: next ? userEmail : null, updated_at: new Date().toISOString(),
    }, { onConflict: "tax_year,return_type,entity_key,period_key" });

    setSavingFiling((prev) => { const s = new Set(prev); s.delete(key); return s; });

    if (error) {
      toast.show("Save failed — " + error.message, "error");
      setReturnFilings((prev) => new Map(prev).set(key, current));
    } else {
      triggerAlertRecompute();
    }
  }

  // ── Unlock a filed return (canManage only) ──

  async function handleUnlockFiling(entityKey: string, returnType: ReturnType, periodKey: string) {
    const confirmed = window.confirm(
      `Unlock filing for ${entityKey} — ${returnType} — ${periodKey}?\n\nThis will revert to "Not Filed" and be logged in the audit trail.`
    );
    if (!confirmed) return;

    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email || "unknown";

    const { error } = await supabase.from("tax_return_filings").upsert({
      tax_year: selectedYear, return_type: returnType, entity_key: entityKey, period_key: periodKey,
      filed: false, filed_at: null, filed_by: null,
    }, { onConflict: "tax_year,return_type,entity_key,period_key" });

    if (error) { alert("Error unlocking: " + error.message); return; }

    await supabase.from("audit_log").insert({
      user_email: email,
      action: "UNLOCK_TAX_FILING",
      table_name: "tax_return_filings",
      details: JSON.stringify({
        tax_year: selectedYear, return_type: returnType, entity_key: entityKey,
        period_key: periodKey, reverted_to: "not_filed",
      }),
      created_at: new Date().toISOString(),
    });

    const key = `${selectedYear}:${returnType}:${entityKey}:${periodKey}`;
    setReturnFilings((prev) => { const next = new Map(prev); next.set(key, false); return next; });

    triggerAlertRecompute();
  }

  // ── Fire-and-forget alert recompute after each save ──

  function triggerAlertRecompute() {
    authFetch("/api/cron/tax-alerts", { method: "POST" }).catch(() => {/* intentionally ignored */});
  }

  // ── Sign-off helpers ──

  function allStepsComplete(section: string, entityKey: string, entries: Map<string, ScheduleStatus>): boolean {
    for (let i = 1; i <= 5; i++) {
      if (entries.get(`${selectedYear}:${section}:${i}:${entityKey}`) !== "Completed") return false;
    }
    return true;
  }

  async function handleSignoff(section: string, entityKey: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email || user.email.toLowerCase() !== SHAKEEL_EMAIL.toLowerCase()) {
      alert("Only Shakeel can sign off accounts.");
      return;
    }

    const confirmed = window.confirm(
      `Finalise ${section} accounts for ${entityKey}?\n\nThis confirms all steps are complete and accounts are finalised. This action will be logged.`
    );
    if (!confirmed) return;

    const k = `${selectedYear}:${section}:${entityKey}`;
    const now = new Date().toISOString();

    setSignoffs((prev) => new Map(prev).set(k, true));
    setSignoffMeta((prev) => new Map(prev).set(k, { by: user.email!, at: now }));

    const { error } = await supabase.from("tax_accounts_signoffs").upsert({
      tax_year: selectedYear,
      section,
      entity_key: entityKey,
      signed_off: true,
      signed_off_by: user.email,
      signed_off_at: now,
    }, { onConflict: "tax_year,section,entity_key" });

    if (error) {
      setSignoffs((prev) => { const m = new Map(prev); m.delete(k); return m; });
      setSignoffMeta((prev) => { const m = new Map(prev); m.delete(k); return m; });
      alert("Error saving sign-off: " + error.message);
      return;
    }

    await supabase.from("audit_log").insert({
      user_email: user.email,
      action: "ACCOUNTS_FINALISED",
      table_name: "tax_accounts_signoffs",
      details: JSON.stringify({ tax_year: selectedYear, section, entity_key: entityKey }),
      created_at: now,
    });

    fetch("/api/cron/tax-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxYear: selectedYear }),
    }).catch(() => {});
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

  // ── Derived data ──

  const today = new Date();
  const fiscalSections = getFiscalSections(selectedYear);

  // Schedule KPIs — totals across all sections and entities
  function getAllScheduleCounts() {
    let notStarted = 0, inProgress = 0, extAuditors = 0, completed = 0;
    const allSections = [...fiscalSections.map((s) => ({ key: s.key, entities: QUARTERLY_ENTITIES, steps: QUARTERLY_STEPS })),
      { key: "Annual", entities: ANNUAL_ENTITIES, steps: ANNUAL_STEPS }];
    for (const sec of allSections) {
      for (const e of sec.entities) {
        for (let i = 1; i <= sec.steps.length; i++) {
          const s = getScheduleStatus(sec.key, i, e.key);
          if (s === "Completed") completed++;
          else if (s === "In Progress") inProgress++;
          else if (s === "External Auditors") extAuditors++;
          else notStarted++;
        }
      }
    }
    return { notStarted, inProgress, extAuditors, completed };
  }

  // Overdue items for banner
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

  // Return Filings KPIs — all periods across all return types
  function getAllFilingCounts() {
    let filed = 0, notFiled = 0, overdue = 0;
    for (const rt of RETURN_TYPES) {
      if (rt.frequency === "monthly") {
        for (const sec of fiscalSections) {
          for (const month of sec.months) {
            for (const ek of rt.entities) {
              const f = getFiled(rt.key, ek, month);
              if (f) filed++;
              else if (isOverdue(rt.key, month, f, today, selectedYear)) overdue++;
              else notFiled++;
            }
          }
        }
      } else {
        for (const q of ["Q1","Q2","Q3","Q4"] as Quarter[]) {
          for (const ek of rt.entities) {
            const f = getFiled(rt.key, ek, q);
            if (f) filed++;
            else if (isOverdue(rt.key, q, f, today, selectedYear)) overdue++;
            else notFiled++;
          }
        }
      }
    }
    return { filed, notFiled, overdue };
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

  // ── Design tokens ──

  const { NAVY, SLATE, HAIRLINE, CARD, CARD_ALT, CANVAS, GREEN, AMBER, RED, BLUE,
    SUCCESS_SOFT, WARNING_SOFT, DANGER_SOFT, TRACK, INK_700 } = COLOURS;

  const pillTab = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 600,
    cursor: "pointer", border: `1px solid ${active ? NAVY : HAIRLINE}`,
    backgroundColor: active ? NAVY : CARD_ALT,
    color: active ? "#fff" : SLATE,
    transition: "background 0.15s",
  });

  const tableHeaderCell: React.CSSProperties = {
    padding: "8px 10px", fontSize: "10.5px", fontWeight: 600, color: SLATE,
    textAlign: "center", whiteSpace: "nowrap", backgroundColor: CARD_ALT,
    borderBottom: `1px solid ${HAIRLINE}`, minWidth: "130px",
    textTransform: "uppercase", letterSpacing: "0.05em",
  };

  const tableRowLabel = (even: boolean): React.CSSProperties => ({
    padding: "10px 14px", fontSize: "13px", color: NAVY, fontWeight: 500,
    minWidth: isMobile ? "140px" : "200px", borderRight: `1px solid ${HAIRLINE}`,
    backgroundColor: even ? CARD_ALT : CARD, whiteSpace: "nowrap",
    position: "sticky", left: 0, zIndex: 1,
  });

  const tableCell = (even: boolean): React.CSSProperties => ({
    padding: "8px 10px", textAlign: "center", borderBottom: `1px solid ${HAIRLINE}`,
    minWidth: "130px", backgroundColor: even ? CARD_ALT : CARD,
  });

  const statusSelectStyle = (bg: string, text: string, border: string, saving: boolean): React.CSSProperties => ({
    fontSize: "12px", fontWeight: 600,
    padding: "4px 24px 4px 8px",
    borderRadius: RADII.PILL,
    border: `1px solid ${border}`,
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

  const statusChipStyle = (bg: string, text: string, border: string): React.CSSProperties => ({
    fontSize: "12px", fontWeight: 600,
    padding: "4px 10px",
    borderRadius: RADII.PILL,
    border: `1px solid ${border}`,
    backgroundColor: bg, color: text,
    whiteSpace: "nowrap" as const,
    display: "inline-block",
  });

  const filingChipStyle = (filed: boolean, overdue: boolean): React.CSSProperties => ({
    fontSize: "11px", fontWeight: 600,
    padding: "3px 9px",
    borderRadius: RADII.PILL,
    border: `1px solid ${filed ? "#9ED4A3" : overdue ? "#EDB5B2" : HAIRLINE}`,
    backgroundColor: filed ? SUCCESS_SOFT : overdue ? DANGER_SOFT : CARD_ALT,
    color: filed ? GREEN : overdue ? RED : SLATE,
    whiteSpace: "nowrap" as const,
    display: "inline-block",
  });

  const filingButtonStyle = (filed: boolean, overdue: boolean, saving: boolean): React.CSSProperties => ({
    fontSize: "11px", fontWeight: 600,
    padding: "3px 9px",
    borderRadius: RADII.PILL,
    border: `1px solid ${filed ? "#9ED4A3" : overdue ? "#EDB5B2" : HAIRLINE}`,
    backgroundColor: filed ? SUCCESS_SOFT : overdue ? DANGER_SOFT : CARD_ALT,
    color: filed ? GREEN : overdue ? RED : SLATE,
    cursor: saving ? "wait" : "pointer",
    opacity: saving ? 0.6 : 1,
    whiteSpace: "nowrap" as const,
  });

  if (!userCtx && !loading) return null;

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden", backgroundColor: CANVAS, fontFamily: "var(--font-sans, Inter, sans-serif)" }}>
      {toast.element}

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
        <div>
          <PageHeader />
          <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontSize: "22px", fontWeight: 600, color: NAVY, letterSpacing: "-0.01em", marginTop: "4px" }}>
            Accounts & Returns
          </div>
          <div style={{ fontSize: "13px", color: SLATE, marginTop: "3px" }}>
            Quarterly accounts schedule and monthly return filings
          </div>
        </div>

        {/* Year selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", paddingTop: "4px" }}>
          {availableYears.map((y) => (
            <button key={y} style={pillTab(y === selectedYear)} onClick={() => setSelectedYear(y)}>{y}</button>
          ))}
          <button onClick={addNewYear} style={{ ...pillTab(false), color: BLUE }}>
            + New year
          </button>
        </div>
      </div>

      {/* ── Tax Compliance Summary ── */}
      {!loading && (
        <TaxComplianceSummary
          scheduleEntries={scheduleEntries}
          returnFilings={returnFilings}
          selectedYear={selectedYear}
          signoffs={signoffs.size > 0 ? signoffs : undefined}
        />
      )}

      {loading ? (
        <div style={{ color: SLATE, fontSize: "14px", padding: "40px 0" }}>Loading…</div>
      ) : (
        <>
          {/* ══════════════════════════════════════════════════════
              AREA 1 — ACCOUNTS SCHEDULE
          ══════════════════════════════════════════════════════ */}
          <div style={{ marginBottom: "8px" }}>
            <SectionTitle title="Accounts Schedule" style={{ margin: "0 0 12px" }} />

            {/* Schedule KPI cards */}
            {(() => {
              const { notStarted, inProgress, extAuditors, completed } = getAllScheduleCounts();
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "16px" }}>
                  <CountCard label="Not Started" value={notStarted} color={SLATE} />
                  <CountCard label="In Progress" value={inProgress} color={AMBER} />
                  <CountCard label="Ext. Auditors" value={extAuditors} color={BLUE} />
                  <CountCard label="Completed" value={completed} color={GREEN} />
                </div>
              );
            })()}

            {/* Q1–Q4 sections */}
            {fiscalSections.map((sec) => {
              const steps = QUARTERLY_STEPS;
              const entities = QUARTERLY_ENTITIES;
              const summary = getSectionSummary(sec.key, entities, steps);
              const collapsed = collapsedSections.has(sec.key);

              return (
                <div key={sec.key} style={{ border: `1px solid ${HAIRLINE}`, borderTop: `3px solid ${NAVY}`, borderRadius: RADII.CARD, backgroundColor: CARD, overflow: "hidden", marginBottom: "10px" }}>
                  {/* Section header */}
                  <div
                    onClick={() => toggleSection(sec.key)}
                    style={{ padding: "12px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", backgroundColor: CARD_ALT, borderBottom: collapsed ? "none" : `1px solid ${HAIRLINE}` }}
                  >
                    <span style={{ fontSize: "12px", color: SLATE, fontWeight: 600 }}>{collapsed ? "▶" : "▼"}</span>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: NAVY }}>{sec.label}</span>
                    <span style={{ fontSize: "11px", color: SLATE, backgroundColor: CARD, padding: "2px 8px", borderRadius: RADII.PILL, border: `1px solid ${HAIRLINE}` }}>{sec.badge}</span>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginLeft: "4px" }}>
                      {summary.completed > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: SUCCESS_SOFT, color: GREEN, border: `1px solid #9ED4A3` }}>{summary.completed} done</span>}
                      {summary.inProgress > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: WARNING_SOFT, color: AMBER, border: `1px solid #F6D28A` }}>{summary.inProgress} in progress</span>}
                      {summary.notStarted > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: CARD, color: SLATE, border: `1px solid ${HAIRLINE}` }}>{summary.notStarted} not started</span>}
                    </div>
                    {/* Progress bar */}
                    <div style={{ flex: 1, minWidth: "80px", height: "4px", backgroundColor: TRACK, borderRadius: "2px", position: "relative" }}>
                      {summary.pct > 0 && <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${summary.pct}%`, backgroundColor: GREEN, borderRadius: "2px", transition: "width 0.3s" }} />}
                    </div>
                    <span style={{ fontSize: "11px", color: SLATE, fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", minWidth: "28px" }}>{summary.pct}%</span>
                  </div>

                  {/* Section body */}
                  {!collapsed && (
                    <div style={{ overflowX: "auto" }}>
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
                            const even = si % 2 === 1;
                            return (
                              <tr key={stepIndex}>
                                <td style={tableRowLabel(even)}>{stepIndex}. {step}</td>
                                {entities.map((e) => {
                                  const status = getScheduleStatus(sec.key, stepIndex, e.key);
                                  const { bg, text, border } = STATUS_COLOURS[status];
                                  const cellKey = `${selectedYear}:${sec.key}:${stepIndex}:${e.key}`;
                                  const saving = savingSchedule.has(cellKey);
                                  const availableStatuses = getAvailableStatuses(status, canManage);
                                  return (
                                    <td key={e.key} style={tableCell(even)}>
                                      <select
                                        value={status}
                                        disabled={saving}
                                        onChange={(ev) => handleStatusChange(sec.key, stepIndex, e.key, ev.target.value as ScheduleStatus)}
                                        style={statusSelectStyle(bg, text, border, saving)}
                                      >
                                        {availableStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                                      </select>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                          {/* Row 6 — Accounts Finalised sign-off (Q1–Q4 only) */}
                          <tr>
                            <td style={{
                              ...tableRowLabel(true),
                              fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
                              fontWeight: 600,
                              color: NAVY,
                              fontSize: "13px",
                            }}>
                              ★ 6. Accounts Finalised
                            </td>
                            {entities.map((e) => {
                              const k = `${selectedYear}:${sec.key}:${e.key}`;
                              const done = signoffs.get(k) ?? false;
                              const meta = signoffMeta.get(k);
                              const allComplete = allStepsComplete(sec.key, e.key, scheduleEntries);

                              if (done) {
                                return (
                                  <td key={e.key} style={{ ...tableCell(true), verticalAlign: "middle" }}>
                                    <div style={{ textAlign: "center" }}>
                                      <span style={{
                                        display: "inline-flex", alignItems: "center", gap: "4px",
                                        backgroundColor: SUCCESS_SOFT, color: GREEN,
                                        border: `1px solid ${GREEN}33`, borderRadius: RADII.PILL,
                                        padding: "3px 10px", fontSize: "11px", fontWeight: 600,
                                      }}>
                                        ✓ Finalised
                                      </span>
                                      {meta && (
                                        <div style={{ fontSize: "10px", color: SLATE, marginTop: "2px" }}>
                                          {meta.by.split("@")[0]} · {formatDateUK(meta.at.slice(0, 10))}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                );
                              }

                              if (!allComplete) {
                                return (
                                  <td key={e.key} style={{ ...tableCell(true), verticalAlign: "middle" }}>
                                    <div style={{ textAlign: "center" }}>
                                      <span style={{
                                        display: "inline-flex", alignItems: "center", gap: "4px",
                                        backgroundColor: CARD_ALT, color: SLATE,
                                        border: `1px solid ${HAIRLINE}`, borderRadius: RADII.PILL,
                                        padding: "3px 10px", fontSize: "11px", fontWeight: 500,
                                        cursor: "not-allowed", opacity: 0.6,
                                      }}>
                                        🔒 Pending steps
                                      </span>
                                    </div>
                                  </td>
                                );
                              }

                              if (!isShakeel) {
                                return (
                                  <td key={e.key} style={{ ...tableCell(true), verticalAlign: "middle" }}>
                                    <div style={{ textAlign: "center" }}>
                                      <span style={{
                                        display: "inline-flex", alignItems: "center", gap: "4px",
                                        backgroundColor: WARNING_SOFT, color: AMBER,
                                        border: `1px solid ${AMBER}33`, borderRadius: RADII.PILL,
                                        padding: "3px 10px", fontSize: "11px", fontWeight: 500,
                                      }}>
                                        ⏳ Awaiting sign-off
                                      </span>
                                    </div>
                                  </td>
                                );
                              }

                              return (
                                <td key={e.key} style={{ ...tableCell(true), verticalAlign: "middle" }}>
                                  <div style={{ textAlign: "center" }}>
                                    <button
                                      onClick={() => handleSignoff(sec.key, e.key)}
                                      style={{
                                        backgroundColor: NAVY, color: "white",
                                        border: "none", borderRadius: RADII.PILL,
                                        padding: "4px 12px", fontSize: "11px", fontWeight: 600,
                                        cursor: "pointer", display: "inline-flex",
                                        alignItems: "center", gap: "4px",
                                      }}
                                    >
                                      ★ Finalise
                                    </button>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
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
                <div style={{ border: `1px solid ${HAIRLINE}`, borderTop: `3px solid ${NAVY}`, borderRadius: RADII.CARD, backgroundColor: CARD, overflow: "hidden", marginBottom: "10px" }}>
                  <div
                    onClick={() => toggleSection(sectionKey)}
                    style={{ padding: "12px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", backgroundColor: CARD_ALT, borderBottom: collapsed ? "none" : `1px solid ${HAIRLINE}` }}
                  >
                    <span style={{ fontSize: "12px", color: SLATE, fontWeight: 600 }}>{collapsed ? "▶" : "▼"}</span>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: NAVY }}>Annual Returns</span>
                    <span style={{ fontSize: "11px", color: SLATE, backgroundColor: CARD, padding: "2px 8px", borderRadius: RADII.PILL, border: `1px solid ${HAIRLINE}` }}>All entities</span>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginLeft: "4px" }}>
                      {summary.completed > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: SUCCESS_SOFT, color: GREEN, border: `1px solid #9ED4A3` }}>{summary.completed} done</span>}
                      {summary.inProgress > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: WARNING_SOFT, color: AMBER, border: `1px solid #F6D28A` }}>{summary.inProgress} in progress</span>}
                      {summary.notStarted > 0 && <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: CARD, color: SLATE, border: `1px solid ${HAIRLINE}` }}>{summary.notStarted} not started</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: "80px", height: "4px", backgroundColor: TRACK, borderRadius: "2px", position: "relative" }}>
                      {summary.pct > 0 && <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${summary.pct}%`, backgroundColor: GREEN, borderRadius: "2px", transition: "width 0.3s" }} />}
                    </div>
                    <span style={{ fontSize: "11px", color: SLATE, fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", minWidth: "28px" }}>{summary.pct}%</span>
                  </div>

                  {!collapsed && (
                    <div style={{ overflowX: "auto" }}>
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
                            const even = si % 2 === 1;
                            return (
                              <tr key={stepIndex}>
                                <td style={tableRowLabel(even)}>{stepIndex}. {step}</td>
                                {entities.map((e) => {
                                  const status = getScheduleStatus(sectionKey, stepIndex, e.key);
                                  const { bg, text, border } = STATUS_COLOURS[status];
                                  const cellKey = `${selectedYear}:${sectionKey}:${stepIndex}:${e.key}`;
                                  const saving = savingSchedule.has(cellKey);
                                  const availableStatuses = getAvailableStatuses(status, canManage);
                                  return (
                                    <td key={e.key} style={tableCell(even)}>
                                      <select
                                        value={status}
                                        disabled={saving}
                                        onChange={(ev) => handleStatusChange(sectionKey, stepIndex, e.key, ev.target.value as ScheduleStatus)}
                                        style={statusSelectStyle(bg, text, border, saving)}
                                      >
                                        {availableStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                                      </select>
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

          {/* ══════════════════════════════════════════════════════
              AREA 2 — RETURN FILINGS
          ══════════════════════════════════════════════════════ */}
          <div>
            <SectionTitle title="Return Filings" style={{ margin: "0 0 4px" }} />
            <div style={{ fontSize: "13px", color: SLATE, marginBottom: "16px" }}>Monthly and quarterly tax return filing status — due 15th of each period</div>

            {/* Filing KPI cards */}
            {(() => {
              const { filed, notFiled, overdue } = getAllFilingCounts();
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "16px" }}>
                  <CountCard label="Filed" value={filed} color={GREEN} />
                  <CountCard label="Not Filed" value={notFiled} color={SLATE} />
                  {overdue > 0 && <CountCard label="Overdue" value={overdue} color={RED} />}
                </div>
              );
            })()}

            {/* Overdue alert banner */}
            {overdueItems.length > 0 && (
              <div style={{ backgroundColor: DANGER_SOFT, borderLeft: `4px solid ${RED}`, borderRadius: RADII.CARD, padding: "14px 18px", marginBottom: "16px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY, marginBottom: "6px" }}>
                  {overdueItems.length} return{overdueItems.length !== 1 ? "s" : ""} overdue — past 15th deadline and not yet filed
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                  {Object.entries(
                    overdueItems.reduce<Record<string, number>>((acc, item) => {
                      acc[item.returnLabel] = (acc[item.returnLabel] || 0) + 1;
                      return acc;
                    }, {})
                  ).map(([label, count]) => (
                    <span key={label} style={{
                      fontSize: "11px", fontWeight: 600, color: RED,
                      backgroundColor: DANGER_SOFT,
                      padding: "2px 8px", borderRadius: RADII.PILL,
                      border: "1px solid #EDB5B2",
                    }}>
                      {label}: {count}
                    </span>
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

                if (filed) {
                  if (canManage) {
                    return (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span style={filingChipStyle(true, false)}>✓ Filed</span>
                        <span
                          onClick={() => handleUnlockFiling(entityKey, returnType, periodKey)}
                          style={{ cursor: "pointer", fontSize: "11px", color: SLATE, textDecoration: "underline", whiteSpace: "nowrap" }}
                        >
                          ↩ Unlock
                        </span>
                      </span>
                    );
                  }
                  return (
                    <span style={{ ...filingChipStyle(true, false), cursor: "not-allowed" }}>
                      ✓ Filed 🔒
                    </span>
                  );
                }

                if (canManage) {
                  return (
                    <button
                      disabled={saving}
                      onClick={() => handleFilingToggle(returnType, entityKey, periodKey)}
                      style={filingButtonStyle(false, overdue, saving)}
                    >
                      {overdue ? "⚠ Overdue" : "Not filed"}
                    </button>
                  );
                }

                return (
                  <span style={{ ...filingChipStyle(false, overdue), cursor: "not-allowed" }}>
                    {overdue ? "⚠ Overdue" : "Not filed"}
                  </span>
                );
              }

              const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              function monthLabel(ym: string) {
                const m = parseInt(ym.split("-")[1], 10);
                return MONTH_NAMES[m - 1];
              }

              const tableHeaderCellFiling: React.CSSProperties = {
                ...tableHeaderCell,
                minWidth: "90px",
              };

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>

                  {/* Sub-section A: Monthly Returns */}
                  <div>
                    <div style={{ fontSize: "10.5px", fontWeight: 600, color: INK_700, marginBottom: "14px", textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>
                      Monthly Returns
                    </div>
                    {monthlyRTs.map((rt) => (
                      <div key={rt.key} style={{ border: `1px solid ${HAIRLINE}`, borderTop: `3px solid ${NAVY}`, borderRadius: RADII.CARD, backgroundColor: CARD, overflow: "hidden", marginBottom: "10px" }}>
                        <div style={{ padding: "10px 18px", backgroundColor: CARD_ALT, borderBottom: `1px solid ${HAIRLINE}`, display: "flex", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: NAVY }}>{rt.label}</span>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ borderCollapse: "collapse", width: "100%" }}>
                            <thead>
                              <tr>
                                <th style={{ ...tableHeaderCellFiling, textAlign: "left", minWidth: isMobile ? "100px" : "140px" }}>Entity</th>
                                {sec.months.map((m) => (
                                  <th key={m} style={tableHeaderCellFiling}>{monthLabel(m)}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rt.entities.map((ek, ri) => {
                                const entity = QUARTERLY_ENTITIES.find((e) => e.key === ek);
                                const even = ri % 2 === 1;
                                return (
                                  <tr key={ek}>
                                    <td style={tableRowLabel(even)}>{entity?.label ?? ek}</td>
                                    {sec.months.map((m) => (
                                      <td key={m} style={tableCell(even)}>
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
                    <div style={{ fontSize: "10.5px", fontWeight: 600, color: INK_700, marginBottom: "14px", textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>
                      Quarterly Returns
                    </div>
                    {quarterlyRTs.map((rt) => (
                      <div key={rt.key} style={{ border: `1px solid ${HAIRLINE}`, borderTop: `3px solid ${NAVY}`, borderRadius: RADII.CARD, backgroundColor: CARD, overflow: "hidden", marginBottom: "10px" }}>
                        <div style={{ padding: "10px 18px", backgroundColor: CARD_ALT, borderBottom: `1px solid ${HAIRLINE}`, display: "flex", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: NAVY }}>{rt.label}</span>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ borderCollapse: "collapse", width: "100%" }}>
                            <thead>
                              <tr>
                                <th style={{ ...tableHeaderCellFiling, textAlign: "left", minWidth: isMobile ? "100px" : "140px" }}>Entity</th>
                                <th style={tableHeaderCellFiling}>{selectedReturnQuarter} Filing</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rt.entities.map((ek, ri) => {
                                const entity = QUARTERLY_ENTITIES.find((e) => e.key === ek);
                                const even = ri % 2 === 1;
                                return (
                                  <tr key={ek}>
                                    <td style={tableRowLabel(even)}>{entity?.label ?? ek}</td>
                                    <td style={tableCell(even)}>
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
