"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, loadMyPermissions, authFetch } from "../lib/supabase";
import { formatDateUK, formatMonthUK, todayISO, currentMonthISO, daysAgoISO } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, SectionTitle, useToast, useConfirm } from "../lib/SharedUI";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";
import * as XLSX from "xlsx";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import DateInput from "../lib/DateInput";
import { canEditFinance, isAdminTier, type UserCtx, type PermOverrides } from "../lib/permissions";
import { UTPL_COMPANY_ID } from "../lib/constants";

type OpeningBalance = {
  id: string;
  as_of_date: string;
  opening_amount: number;
  currency: string;
};

type MonthlyPlan = {
  id: string;
  plan_month: string;
  tentative_receivables: number;
  tentative_payouts: number;
};

type DailyPosition = {
  id: string;
  position_date: string;
  opening_balance: number;
  total_receipts: number;
  total_payments: number;
  closing_balance: number;
  post_dated_total: number;
  closing_after_post_dated: number;
};

type PdcWeek = { week_number: number; week_start: string; week_end: string; pdc_due: number; effective_balance: number };

type DeptBudget = { id: string; department: string; budget_month: string; category: string; budgeted_amount: number; actual_amount: number; notes: string | null };
type DeptBudgetSummary = { department: string; budgeted_total: number; actual_total: number };

const COMPANY_DEPTS: Record<string, string[]> = {
  "15884c2d-48a4-4d43-be90-0ef6e130790c": ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit", "Unze Trading Ops"],
  "77921705-8a15-4406-847a-b234f84b5ec3": ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit"],
};

const COMPANY_CATS: Record<string, string[]> = {
  "15884c2d-48a4-4d43-be90-0ef6e130790c": ["Salaries", "Rent/Utilities", "Admin", "Welfare", "Freight", "Travel"],
  "77921705-8a15-4406-847a-b234f84b5ec3": ["Salaries", "Rent/Utilities", "Admin", "Marketing", "Freight", "Travel"],
};

const { NAVY, SLATE, BORDER, GREEN, RED, BLUE, AMBER, HAIRLINE, CARD, CARD_ALT, TRACK, DANGER_SOFT, WARNING_SOFT } = COLOURS;
const MONO = "var(--font-mono, 'JetBrains Mono', monospace)";
const DISPLAY = "var(--font-display, 'Inter Tight', sans-serif)";

function fmt(n: number) {
  return n.toLocaleString();
}

export default function FinanceManager({ companyId, companyName }: { companyId: string; companyName: string }) {
  const companySlug = companyId === UTPL_COMPANY_ID ? "unze-trading" : "imperial";
  const googleReturnTo = `/finance/${companySlug}`;
  const isMobile = useMobile();
  const toast = useToast();
  const dlg = useConfirm();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>("Member");
  const [userCanEdit, setUserCanEdit] = useState(false);
  const [userIsAdmin, setUserIsAdmin] = useState(false);

  const [opening, setOpening] = useState<OpeningBalance | null>(null);
  const [plan, setPlan] = useState<MonthlyPlan | null>(null);
  const [positions, setPositions] = useState<DailyPosition[]>([]);
  const [pdcOutlook, setPdcOutlook] = useState<PdcWeek[]>([]);

  // Which edit modal is open: null, 'opening', or 'plan'
  const [openModal, setOpenModal] = useState<null | "opening" | "plan">(null);

  // Opening balance form
  const [obDate, setObDate] = useState(todayISO());
  const [obAmount, setObAmount] = useState("");

  // Monthly plan form
  const [planMonth, setPlanMonth] = useState(currentMonthISO());
  const [planRecv, setPlanRecv] = useState("");
  const [planPay, setPlanPay] = useState("");

  // Daily position form (always visible)
  const [dpDate, setDpDate] = useState(todayISO());
  const [dpOpening, setDpOpening] = useState("");
  const [dpReceipts, setDpReceipts] = useState("");
  const [dpPayments, setDpPayments] = useState("");
  const [dpClosing, setDpClosing] = useState("");
  const [dpPostDated, setDpPostDated] = useState("");

  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [dailyEntryTab, setDailyEntryTab] = useState<"upload" | "manual">("upload");
  const [gmailConnected, setGmailConnected] = useState(false);

  // Forecast upload state
  const [forecastFile, setForecastFile] = useState<File | null>(null);
  const [forecastUploading, setForecastUploading] = useState(false);
  const [forecastResult, setForecastResult] = useState<{
    success: boolean;
    months?: string[];
    categories?: number;
    totalRows?: number;
    error?: string;
  } | null>(null);

  // Manual forecast entry state
  const [showManualForecast, setShowManualForecast] = useState(false);
  const [mfCategory, setMfCategory] = useState("");
  const [mfFlowType, setMfFlowType] = useState<"inflow" | "outflow">("inflow");
  const [mfMonth, setMfMonth] = useState(currentMonthISO());
  const [mfAmount, setMfAmount] = useState("");
  const [mfSaving, setMfSaving] = useState(false);

  const [budgets, setBudgets] = useState<DeptBudget[]>([]);
  const [budgetSummary, setBudgetSummary] = useState<DeptBudgetSummary[]>([]);
  const [showBudgets, setShowBudgets] = useState(false);
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetMonth, setBudgetMonth] = useState(currentMonthISO());
  const [bdDept, setBdDept] = useState("");
  const [bdCategory, setBdCategory] = useState("");
  const [bdBudgeted, setBdBudgeted] = useState("");
  const [bdActual, setBdActual] = useState("");
  const [bdNotes, setBdNotes] = useState("");
  const [bdSaving, setBdSaving] = useState(false);

  async function handleForecastUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!forecastFile) return;
    setForecastUploading(true);
    setForecastResult(null);
    try {
      const formData = new FormData();
      formData.append("file", forecastFile);
      formData.append("uploadedBy", "manual");
      formData.append("companyId", companyId);
      const res = await authFetch("/api/finance/upload-forecast", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setForecastResult({ success: false, error: data.error });
        showMsg("Error: " + (data.error || "Upload failed"));
      } else {
        setForecastResult({
          success: true,
          months: data.months,
          categories: data.categories,
          totalRows: data.totalRows,
        });
        showMsg("Cash flow forecast uploaded — " + data.categories + " categories across " + data.months.length + " months.");
        setForecastFile(null);
      }
    } catch {
      setForecastResult({ success: false, error: "Network error" });
    }
    setForecastUploading(false);
  }

  async function saveManualForecast(e: React.FormEvent) {
    e.preventDefault();
    if (!mfCategory.trim() || !mfAmount) {
      showMsg("Error: Category and amount are required.");
      return;
    }
    setMfSaving(true);
    const { error } = await supabase.from("monthly_budgets").upsert(
      {
        company_id: companyId,
        budget_month: mfMonth,
        flow_type: mfFlowType,
        category: mfCategory.trim(),
        budgeted_amount: Number(mfAmount) || 0,
        uploaded_by: "manual",
      },
      { onConflict: "company_id,budget_month,category" }
    );
    setMfSaving(false);
    if (error) {
      showMsg("Error: " + error.message);
      return;
    }
    logAction("Created", "monthly_budgets", `Forecast: ${mfCategory} ${mfFlowType} ${mfMonth} = ${mfAmount}`);
    showMsg("Forecast entry saved.");
    setMfCategory("");
    setMfAmount("");
  }

  // PDF upload state
  const [dropFiles, setDropFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadResults, setUploadResults] = useState<{ filename: string; status: string; date?: string }[]>([]);
  const dropInputRef = useRef<HTMLInputElement>(null);

  const onDropFiles = useCallback((incoming: FileList | File[]) => {
    const pdfs = Array.from(incoming).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return;
    setDropFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...pdfs.filter((f) => !existing.has(f.name))];
    });
    setUploadResults([]);
  }, []);

  async function handlePDFUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!dropFiles.length) return;
    setUploading(true);
    setUploadResults([]);
    try {
      const formData = new FormData();
      for (const f of dropFiles) formData.append("files", f);
      const res = await authFetch("/api/finance/upload-pdfs", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        showMsg("Error: " + (data.error || "Upload failed"));
      } else {
        setUploadResults(data.results || []);
        const saved = (data.results || []).filter((r: { status: string }) => r.status.startsWith("saved")).length;
        const errors = (data.results || []).filter((r: { status: string }) => r.status.startsWith("error")).length;
        showMsg(errors > 0 ? `${saved} saved, ${errors} failed — check results below.` : `${saved} file${saved !== 1 ? "s" : ""} saved successfully.`);
        setDropFiles([]);
        loadData();
      }
    } catch {
      showMsg("Error: Network error during upload.");
    }
    setUploading(false);
  }

  async function loadData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user?.email) {
      const { data: memberData } = await supabase.from("members").select("id, role, department, company").eq("email", userData.user.email).maybeSingle();
      if (memberData) {
        setUserRole(memberData.role);
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email: userData.user.email, role: memberData.role, department: memberData.department, company: memberData.company, overrides };
        setUserCanEdit(canEditFinance(ctx));
        setUserIsAdmin(isAdminTier(ctx));
      }
    }
    const [obRes, planRes, posRes, pdcRes] = await Promise.all([
      supabase
        .from("cash_opening_balance")
        .select("id, as_of_date, opening_amount, currency")
        .eq("company_id", companyId)
        .order("as_of_date", { ascending: true })
        .limit(1),
      supabase
        .from("monthly_cash_plan")
        .select("id, plan_month, tentative_receivables, tentative_payouts")
        .eq("company_id", companyId)
        .eq("plan_month", currentMonthISO())
        .maybeSingle(),
      supabase
        .from("daily_cash_position")
        .select("id, position_date, opening_balance, total_receipts, total_payments, closing_balance, post_dated_total, closing_after_post_dated")
        .eq("company_id", companyId)
        // Rolling last 30 calendar days (today minus 30 through today), not a
        // row-count limit — a row-count limit drifts further back than 30
        // days whenever there are gaps (weekends, missed reports), and Khuram
        // wants the window to always be "the last 30 days," full stop.
        .gte("position_date", daysAgoISO(30))
        .order("position_date", { ascending: false }),
      supabase.rpc("get_pdc_outlook", { p_company_id: companyId, p_today: todayISO() }),
    ]);
    if (obRes.error) console.error("Opening balance error:", obRes.error);
    if (planRes.error) console.error("Monthly plan error:", planRes.error);
    if (posRes.error) console.error("Positions error:", posRes.error);
    if (pdcRes.error) console.error("PDC outlook error:", pdcRes.error);
    setOpening(obRes.data && obRes.data.length > 0 ? obRes.data[0] : null);
    setPlan(planRes.data || null);
    // closing_after_post_dated is trusted as stored for both companies — see the save
    // handler below for why (15 Jul 2026 fix: this used to be recomputed here as
    // closing + post_dated for Imperial only, which contradicted every Imperial row
    // ever ingested from a real bank statement PDF). It's kept in the data model for
    // reference, but per Khuram's 15 Jul correction it's no longer treated as "the"
    // balance anywhere in this UI — see Cash in Hand / PDC Outstanding split below.
    setPositions(posRes.data || []);
    setPdcOutlook((pdcRes.data || []) as PdcWeek[]);

    const [{ data: budgetData }, { data: summaryData }] = await Promise.all([
      supabase.from("department_budgets").select("id, department, budget_month, category, budgeted_amount, actual_amount, notes").eq("company_id", companyId).eq("budget_month", budgetMonth).order("department"),
      supabase.rpc("get_department_budget_summary", { p_company_id: companyId, p_month: budgetMonth }),
    ]);
    setBudgets(budgetData || []);
    setBudgetSummary(summaryData || []);

    setLoading(false);
  }

  // Found during the 15 Jul 2026 audit: totals (grand total + per-
  // department subtotals) used to be summed in JS from the raw budgets
  // fetch (rule 0 violation) — now computed in get_department_budget_summary().
  // The raw per-category rows are still fetched separately above since
  // each one is individually editable inline.
  async function loadBudgets(month?: string) {
    const m = month || budgetMonth;
    const [{ data }, { data: summaryData }] = await Promise.all([
      supabase.from("department_budgets").select("id, department, budget_month, category, budgeted_amount, actual_amount, notes").eq("company_id", companyId).eq("budget_month", m).order("department"),
      supabase.rpc("get_department_budget_summary", { p_company_id: companyId, p_month: m }),
    ]);
    setBudgets(data || []);
    setBudgetSummary(summaryData || []);
  }

  async function handleAddBudget(e: React.FormEvent) {
    e.preventDefault();
    setBdSaving(true);
    const { error } = await supabase.from("department_budgets").upsert({
      company_id: companyId, department: bdDept, budget_month: budgetMonth, category: bdCategory,
      budgeted_amount: Number(bdBudgeted) || 0, actual_amount: Number(bdActual) || 0, notes: bdNotes || null,
    }, { onConflict: "company_id,department,budget_month,category" });
    setBdSaving(false);
    if (error) { setMsg("Error: " + error.message); return; }
    logAction("Created", "department_budgets", `${bdDept} ${bdCategory} ${budgetMonth}`);
    setBdCategory(""); setBdBudgeted(""); setBdActual(""); setBdNotes("");
    loadBudgets();
  }

  async function updateBudgetActual(id: string, value: number) {
    await supabase.from("department_budgets").update({ actual_amount: value }).eq("id", id);
    loadBudgets();
  }

  async function deleteBudgetEntry(id: string) {
    if (!await dlg.confirm("Delete this budget entry?", true)) return;
    await supabase.from("department_budgets").delete().eq("id", id);
    loadBudgets();
  }

  useEffect(() => {
    loadData();

    // Check Google connection status via server-side route (avoids RLS)
    authFetch("/api/google/status")
      .then((r) => r.json())
      .then((data) => { if (data.connected) setGmailConnected(true); })
      .catch(() => {});

    // Check URL params for Google OAuth result
    const params = new URLSearchParams(window.location.search);
    const googleStatus = params.get("google");
    if (googleStatus === "connected") {
      setGmailConnected(true);
      showMsg("Google connected — Drive and Calendar access is active.");
      window.history.replaceState({}, "", googleReturnTo);
    } else if (googleStatus === "error") {
      showMsg("Error: Failed to connect Google. Please try again.");
      window.history.replaceState({}, "", googleReturnTo);
    } else if (googleStatus === "denied") {
      showMsg("Error: Google access was denied. Please try again and grant all permissions.");
      window.history.replaceState({}, "", googleReturnTo);
    }
  }, []);

  function showMsg(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(""), 4000);
  }

  function openOpeningModal() {
    if (opening) {
      setObDate(opening.as_of_date);
      setObAmount(String(opening.opening_amount));
    } else {
      setObDate(todayISO());
      setObAmount("");
    }
    setOpenModal("opening");
  }

  function openPlanModal() {
    if (plan) {
      setPlanMonth(plan.plan_month);
      setPlanRecv(String(plan.tentative_receivables));
      setPlanPay(String(plan.tentative_payouts));
    } else {
      setPlanMonth(currentMonthISO());
      setPlanRecv("");
      setPlanPay("");
    }
    setOpenModal("plan");
  }

  async function saveOpeningBalance(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("cash_opening_balance").insert({
      company_id: companyId,
      as_of_date: obDate,
      opening_amount: Number(obAmount) || 0,
      currency: "PKR",
    });
    setSaving(false);
    if (error) {
      showMsg("Error: " + error.message);
      return;
    }
    logAction("Updated", "cash_opening_balance", `Opening balance: ${obAmount} as of ${obDate}`);
    showMsg("✅ Opening balance saved.");
    setOpenModal(null);
    loadData();
  }

  async function saveMonthlyPlan(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("monthly_cash_plan").upsert(
      {
        company_id: companyId,
        plan_month: planMonth,
        tentative_receivables: Number(planRecv) || 0,
        tentative_payouts: Number(planPay) || 0,
      },
      { onConflict: "company_id,plan_month" }
    );
    setSaving(false);
    if (error) {
      showMsg("Error: " + error.message);
      return;
    }
    logAction("Updated", "monthly_cash_plan", `Plan for ${planMonth}: recv ${planRecv}, pay ${planPay}`);
    showMsg("✅ Monthly plan saved.");
    setOpenModal(null);
    loadData();
  }

  async function saveDailyPosition(e: React.FormEvent) {
    e.preventDefault();

    // Validate opening matches previous day's closing (only warn for consecutive days)
    const prevDay = positions.find((p) => p.position_date < dpDate);
    if (prevDay) {
      const diffDays = (new Date(dpDate).getTime() - new Date(prevDay.position_date).getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays <= 1 && Math.abs(Number(dpOpening) - prevDay.closing_balance) > 0.01 && Math.abs(Math.abs(Number(dpOpening)) - Math.abs(prevDay.closing_balance)) > 0.01) {
        const proceed = await dlg.confirm(
          `Warning: Opening balance (${fmt(Number(dpOpening))}) does not match previous day's closing (${fmt(prevDay.closing_balance)} on ${formatDateUK(prevDay.position_date)}). Save anyway?`
        );
        if (!proceed) return;
      }
    }

    setSaving(true);
    // Post-dated cheques reduce available cash for both companies — confirmed against every
    // Imperial row ever ingested from a real bank statement PDF (parseImperial() in
    // cash-flow-parser.ts derives closingAfterPDC as closing minus the PDC total, never a
    // sum). A previous version of this formula added post-dated cheques for Imperial only,
    // which never matched any real Imperial data (fixed 15 Jul 2026).
    const closingAfterPD = Number(dpClosing) - Number(dpPostDated);
    const { error } = await supabase.from("daily_cash_position").upsert(
      {
        company_id: companyId,
        position_date: dpDate,
        opening_balance: Number(dpOpening) || 0,
        total_receipts: Number(dpReceipts) || 0,
        total_payments: Number(dpPayments) || 0,
        closing_balance: Number(dpClosing) || 0,
        post_dated_total: Number(dpPostDated) || 0,
        closing_after_post_dated: closingAfterPD,
      },
      { onConflict: "company_id,position_date" }
    );
    setSaving(false);
    if (error) {
      showMsg("Error: " + error.message);
      return;
    }
    logAction("Created", "daily_cash_position", `Position for ${dpDate}: closing ${dpClosing}`);
    showMsg("✅ Daily position saved.");
    setDpOpening("");
    setDpReceipts("");
    setDpPayments("");
    setDpClosing("");
    setDpPostDated("");
    loadData();
  }

  if (loading) {
    return <p style={{ color: SLATE, fontSize: "15px" }}>Loading finance data…</p>;
  }

  const latestPosition = positions[0] || null;
  const canEditAll = userCanEdit;
  const staleDays = latestPosition ? Math.floor((Date.now() - new Date(latestPosition.position_date + "T00:00:00").getTime()) / 86400000) : 999;

  // Alert items
  const alerts: string[] = [];
  if (positions.length === 0) alerts.push("No daily position entered yet");
  else if (staleDays > 1) alerts.push(`Cash data is ${staleDays} days old`);
  if (!plan) alerts.push("No monthly plan set");
  if (!opening) alerts.push("No opening balance set");
  const hasAlerts = alerts.length > 0;

  return (
    <div>
      {toast.element}
      {dlg.element}
      {msg && (
        <div style={{
          border: `1px solid ${HAIRLINE}`,
          borderLeft: `3px solid ${msg.startsWith("Error") ? RED : GREEN}`,
          borderRadius: "10px", padding: "10px 14px", marginBottom: "14px",
          backgroundColor: msg.startsWith("Error") ? DANGER_SOFT : COLOURS.SUCCESS_SOFT,
          fontSize: "14px", color: NAVY,
        }}>
          {msg}
        </div>
      )}

      {/* ── ALERT BANNER ── */}
      {hasAlerts && (
        <div style={{
          border: `1px solid ${HAIRLINE}`,
          borderLeft: `3px solid ${staleDays > 1 ? RED : AMBER}`,
          borderRadius: "10px", padding: "12px 16px", marginBottom: "14px",
          backgroundColor: staleDays > 1 ? DANGER_SOFT : WARNING_SOFT,
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ fontSize: "18px", flexShrink: 0 }}>⚠</span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: staleDays > 1 ? RED : AMBER }}>
              Setup needed
            </div>
            <div style={{ fontSize: "12px", color: staleDays > 1 ? RED : AMBER, marginTop: "1px" }}>
              {alerts.join(" · ")}
            </div>
          </div>
        </div>
      )}

      {/* ── SUMMARY CARDS ROW ── */}
      <SectionTitle title="Cash Position Overview" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)",
          gap: "12px",
          marginBottom: "8px",
        }}
      >
        <SummaryCard
          label="Opening Balance"
          value={opening ? `PKR ${fmt(opening.opening_amount)}` : "Not set"}
          sub={opening ? `as of ${formatDateUK(opening.as_of_date)}` : "Click edit to set"}
          onEdit={canEditAll ? openOpeningModal : undefined}
        />
        <SummaryCard
          label="Planned Receivables"
          value={plan ? `PKR ${fmt(plan.tentative_receivables)}` : "Not set"}
          sub={plan ? formatMonthUK(plan.plan_month) : "Click edit to set"}
          valueColor={GREEN}
          onEdit={canEditAll ? openPlanModal : undefined}
        />
        <SummaryCard
          label="Planned Payouts"
          value={plan ? `PKR ${fmt(plan.tentative_payouts)}` : "Not set"}
          sub={plan ? formatMonthUK(plan.plan_month) : "Click edit to set"}
          valueColor={RED}
          onEdit={canEditAll ? openPlanModal : undefined}
        />
        {/* 15 Jul 2026, per Khuram: cash in hand and PDC are two different
            things — a PDC he's issued isn't out of his hand yet, so it must
            never be silently blended into the headline balance. This card
            used to show closing_after_post_dated (cash minus every
            outstanding PDC); it's now the plain actual closing balance,
            with PDC Outstanding broken out as its own card next to it. */}
        <SummaryCard
          label="Cash in Hand"
          value={latestPosition ? `PKR ${fmt(latestPosition.closing_balance)}` : "—"}
          sub={latestPosition ? formatDateUK(latestPosition.position_date) : "No entries yet"}
          isHero
        />
        <SummaryCard
          label="PDC Outstanding"
          value={latestPosition ? `PKR ${fmt(latestPosition.post_dated_total)}` : "—"}
          sub="Issued, not yet cleared — see outlook below"
          valueColor={AMBER}
        />
      </div>

      {/* ── PDC OUTLOOK — next 8 weeks ──
          Khuram: "treat it as a cash flow statement rather than a net
          balance statement... show me, for the next 8 weeks, what my
          balance may look like considering the PDC commitment." Built from
          get_pdc_outlook() (migration 132) — reads the latest report's
          cash-in-hand plus that report's dated PDC buckets, and walks the
          balance down week by week as each bucket comes due. Numbers, not
          just a chart, per his explicit ask ("need numbers per week so we
          can see the amount and effective balance"). ── */}
      {pdcOutlook.length > 0 && (
        <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "20px 24px", backgroundColor: CARD, marginBottom: "14px" }}>
          <SectionTitle title="PDC Outlook — Next 8 Weeks" style={{ margin: "0 0 4px" }} />
          <div style={{ fontSize: "12.5px", color: SLATE, marginBottom: "14px" }}>
            Starting from today&apos;s cash in hand ({latestPosition ? `PKR ${fmt(latestPosition.closing_balance)}` : "—"}), assuming every scheduled PDC clears on time and nothing else changes.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                  <th style={{ textAlign: "left", padding: "6px 10px", color: SLATE, fontWeight: 600 }}>Week</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", color: SLATE, fontWeight: 600 }}>Period</th>
                  <th style={{ textAlign: "right", padding: "6px 10px", color: SLATE, fontWeight: 600 }}>PDC Due</th>
                  <th style={{ textAlign: "right", padding: "6px 10px", color: SLATE, fontWeight: 600 }}>Effective Balance</th>
                </tr>
              </thead>
              <tbody>
                {pdcOutlook.map((w) => (
                  <tr key={w.week_number} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600, color: NAVY }}>Week {w.week_number}</td>
                    <td style={{ padding: "7px 10px", color: SLATE, fontFamily: MONO }}>
                      {formatDateUK(w.week_start)} – {formatDateUK(w.week_end)}
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: w.pdc_due > 0 ? AMBER : SLATE, fontWeight: w.pdc_due > 0 ? 600 : 400 }}>
                      {w.pdc_due > 0 ? `PKR ${fmt(w.pdc_due)}` : "—"}
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: w.effective_balance < 0 ? RED : NAVY }}>
                      PKR {fmt(w.effective_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ROW: INGESTION + PDF UPLOAD side by side (Admin only) ── */}
      {userIsAdmin && (
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "24px", backgroundColor: CARD, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <SectionTitle title="Automatic Ingestion" style={{ margin: "0 0 12px" }} />
            <div style={{ fontSize: "14px", fontWeight: 600, color: NAVY, marginBottom: "4px" }}>
              Gmail: {gmailConnected ? <span style={{ color: GREEN }}>Connected</span> : <span style={{ color: SLATE }}>Not connected</span>}
            </div>
            <div style={{ fontSize: "13px", color: SLATE, marginBottom: "16px", lineHeight: 1.5 }}>
              {gmailConnected ? "Daily statements ingested automatically from your cockpit-cash Gmail label." : "Connect Gmail to auto-ingest daily cash statements. Label: 'cockpit-cash'."}
            </div>
          </div>
          <a href={`/api/google/auth?returnTo=${encodeURIComponent(googleReturnTo)}`} style={{ ...btnStyle, textDecoration: "none", display: "inline-block", textAlign: "center", whiteSpace: "nowrap", alignSelf: "flex-start" }}>
            {gmailConnected ? "Reconnect Google" : "Connect Google"}
          </a>
        </div>

        {/* Add Daily Position — Manual or Upload */}
        <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "24px", backgroundColor: CARD }}>
          <SectionTitle title="Add Daily Position" style={{ margin: "0 0 12px" }} />
          <div style={{ display: "flex", gap: "0", marginBottom: "16px", borderBottom: `1px solid ${HAIRLINE}` }}>
            {([{ key: "upload", label: "Upload PDF" }, { key: "manual", label: "Manual Entry" }] as const).map((tab) => (
              <button key={tab.key} onClick={() => setDailyEntryTab(tab.key)} style={{
                padding: "7px 14px", fontSize: "13px", fontWeight: dailyEntryTab === tab.key ? 600 : 400,
                color: dailyEntryTab === tab.key ? NAVY : SLATE, backgroundColor: "transparent", border: "none",
                borderBottom: dailyEntryTab === tab.key ? `2px solid ${NAVY}` : "2px solid transparent",
                cursor: "pointer", marginBottom: "-1px",
              }}>{tab.label}</button>
            ))}
          </div>

          {dailyEntryTab === "upload" && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); onDropFiles(e.dataTransfer.files); }}
                onClick={() => dropInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? NAVY : HAIRLINE}`,
                  borderRadius: "10px", padding: "20px 16px", textAlign: "center",
                  backgroundColor: dragOver ? CARD_ALT : CARD_ALT,
                  cursor: "pointer", transition: "border-color 0.15s", marginBottom: "10px",
                }}
              >
                <div style={{ fontSize: "22px", marginBottom: "4px" }}>📄</div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY }}>Drop PDFs here or click to browse</div>
                <div style={{ fontSize: "12px", color: SLATE, marginTop: "2px" }}>Cash flow + bank position — any number of files</div>
                <input ref={dropInputRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
                  onChange={(e) => e.target.files && onDropFiles(e.target.files)} />
              </div>

              {dropFiles.length > 0 && (
                <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "10px", marginBottom: "10px", overflow: "hidden" }}>
                  {dropFiles.map((f, i) => (
                    <div key={f.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderBottom: i < dropFiles.length - 1 ? `1px solid ${HAIRLINE}` : "none", fontSize: "13px", color: NAVY }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.name}</span>
                      {!uploading && (
                        <button onClick={() => setDropFiles((p) => p.filter((x) => x.name !== f.name))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: SLATE, fontSize: "16px", marginLeft: "8px", lineHeight: 1 }}>×</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {uploadResults.length > 0 && (
                <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "10px", marginBottom: "10px", overflow: "hidden" }}>
                  {uploadResults.map((r, i) => {
                    const ok = r.status.startsWith("saved");
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderBottom: i < uploadResults.length - 1 ? `1px solid ${HAIRLINE}` : "none", fontSize: "13px" }}>
                        <span style={{ color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.filename}</span>
                        <span style={{ color: ok ? GREEN : RED, fontWeight: 600, marginLeft: "8px", whiteSpace: "nowrap" }}>{ok ? "Saved" : "Error"}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <form onSubmit={handlePDFUpload}>
                <button type="submit" disabled={uploading || dropFiles.length === 0}
                  style={{ ...btnStyle, fontSize: "13px", padding: "7px 16px", opacity: uploading || dropFiles.length === 0 ? 0.5 : 1 }}>
                  {uploading ? "Processing..." : `Upload ${dropFiles.length || ""} file${dropFiles.length !== 1 ? "s" : ""}`}
                </button>
              </form>
            </>
          )}

          {dailyEntryTab === "manual" && (
            <>
              <p style={{ fontSize: "13px", color: SLATE, marginBottom: "12px" }}>Enter today's figures from the accountant's statement.</p>
              <form onSubmit={saveDailyPosition}>
                <label style={labelStyle}>Date
                  <DateInput value={dpDate} onChange={(e) => setDpDate(e.target.value)} style={inputStyle} required />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
                  <label style={labelStyle}>Opening (PKR)
                    <input type="number" value={dpOpening} onChange={(e) => setDpOpening(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                  <label style={labelStyle}>Closing (PKR)
                    <input type="number" value={dpClosing} onChange={(e) => setDpClosing(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                  <label style={labelStyle}>Receipts (PKR)
                    <input type="number" min="0" value={dpReceipts} onChange={(e) => setDpReceipts(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                  <label style={labelStyle}>Payments (PKR)
                    <input type="number" min="0" value={dpPayments} onChange={(e) => setDpPayments(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                  <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Post-dated total (PKR)
                    <input type="number" min="0" value={dpPostDated} onChange={(e) => setDpPostDated(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                </div>
                <button type="submit" disabled={saving} style={btnStyle}>{saving ? "Saving..." : "Save Daily Position"}</button>
              </form>
            </>
          )}
        </div>
      </div>
      )}

      {/* ── FORECAST + DEPARTMENT BUDGETS side by side ── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px", alignItems: "start" }}>
      <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "24px", backgroundColor: CARD }}>
        <SectionTitle title="Cash Flow Forecast" style={{ margin: "0 0 12px" }} />
        <div style={{ display: "flex", gap: "0", marginBottom: "16px", borderBottom: `1px solid ${HAIRLINE}` }}>
          {([{ key: false, label: "Upload Excel" }, { key: true, label: "Manual Entry" }] as const).map((tab) => (
            <button key={String(tab.key)} onClick={() => setShowManualForecast(tab.key)} style={{
              padding: "7px 14px", fontSize: "13px", fontWeight: showManualForecast === tab.key ? 600 : 400,
              color: showManualForecast === tab.key ? NAVY : SLATE, backgroundColor: "transparent", border: "none",
              borderBottom: showManualForecast === tab.key ? `2px solid ${NAVY}` : "2px solid transparent",
              cursor: "pointer", marginBottom: "-1px",
            }}>{tab.label}</button>
          ))}
        </div>

        {!showManualForecast ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", alignItems: "end" }}>
            <div>
              <form onSubmit={handleForecastUpload} style={{ display: "flex", gap: "6px", alignItems: "end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "150px" }}>
                  <label style={kickerLabel}>Forecast Excel (.xlsx)</label>
                  <input type="file" accept=".xlsx,.xls" onChange={(e) => setForecastFile(e.target.files?.[0] || null)} style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }} />
                </div>
                <button type="submit" disabled={forecastUploading || !forecastFile}
                  style={{ ...btnStyle, fontSize: "13px", padding: "7px 14px", opacity: forecastUploading || !forecastFile ? 0.5 : 1 }}>
                  {forecastUploading ? "Parsing..." : "Upload"}
                </button>
              </form>
              {forecastResult && (
                <div style={{ marginTop: "6px", fontSize: "12px", color: forecastResult.success ? GREEN : RED, fontWeight: 600 }}>
                  {forecastResult.success ? `Saved: ${forecastResult.categories} categories, ${forecastResult.totalRows} rows` : forecastResult.error}
                </div>
              )}
            </div>
            <div style={{ fontSize: "12px", color: SLATE }}>
              <a href={companyName.startsWith("Imperial") ? "/cash-flow-forecast-imperial.xlsx" : "/cash-flow-forecast-unze-trading.xlsx"}
                download style={{ fontWeight: 600, color: BLUE, textDecoration: "underline" }}>
                Download template
              </a>
              <span> · Sheet: Monthly-CF · Row 1 = months · Col A = categories</span>
            </div>
          </div>
        ) : (
          <form onSubmit={saveManualForecast}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr auto", gap: "6px", alignItems: "end" }}>
              <div><label style={kickerLabel}>Category</label>
                <input type="text" value={mfCategory} onChange={(e) => setMfCategory(e.target.value)} placeholder="e.g. Salaries" style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }} required />
              </div>
              <div><label style={kickerLabel}>Type</label>
                <select value={mfFlowType} onChange={(e) => setMfFlowType(e.target.value as "inflow" | "outflow")} style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }}>
                  <option value="inflow">Inflow</option><option value="outflow">Outflow</option>
                </select>
              </div>
              <div><label style={kickerLabel}>Month</label>
                <input type="month" value={mfMonth} onChange={(e) => setMfMonth(e.target.value)} style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }} required />
              </div>
              <div><label style={kickerLabel}>Amount (PKR)</label>
                <input type="number" value={mfAmount} onChange={(e) => setMfAmount(e.target.value)} placeholder="0" style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }} required />
              </div>
              <button type="submit" disabled={mfSaving} style={{ ...btnStyle, fontSize: "13px", padding: "7px 12px" }}>{mfSaving ? "..." : "Save"}</button>
            </div>
          </form>
        )}
      </div>

      {/* RIGHT — Department Budgets */}
      <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "24px", backgroundColor: CARD }}>
        <SectionTitle title="Department Budgets" style={{ margin: "0 0 12px" }} />
        {(() => {
          const validDepts = COMPANY_DEPTS[companyId] || ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit"];
          const validCats = COMPANY_CATS[companyId] || ["Salaries", "Rent/Utilities", "Admin", "Freight", "Travel"];
          // Totals come from get_department_budget_summary() (DB-side
          // sums); reducing this small, already-aggregated ~8-row summary
          // for the grand total is the same accepted pattern used for the
          // receivables RAG summary elsewhere in the app — not a raw-row sum.
          const totalB = budgetSummary.reduce((s, r) => s + r.budgeted_total, 0);
          const totalA = budgetSummary.reduce((s, r) => s + r.actual_total, 0);
          const groups = new Map<string, DeptBudget[]>();
          for (const b of budgets) { if (!groups.has(b.department)) groups.set(b.department, []); groups.get(b.department)!.push(b); }
          return (
          <>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
              <input type="month" value={budgetMonth} onChange={(e) => { setBudgetMonth(e.target.value); loadBudgets(e.target.value); }}
                style={{ padding: "5px 8px", border: `1px solid ${HAIRLINE}`, borderRadius: "10px", fontSize: "13px" }} />
              <button onClick={() => setShowBudgetForm(!showBudgetForm)} style={{
                backgroundColor: NAVY, color: "white", border: "none", borderRadius: "999px",
                padding: "5px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
              }}>{showBudgetForm ? "Cancel" : "+ Add"}</button>
              <ImportExportButtons
                onExport={() => {
                  const headers = ["Department", "Category", "Budgeted", "Actual", "Notes"];
                  const rows = budgets.map((b) => [b.department, b.category, String(b.budgeted_amount), String(b.actual_amount), b.notes || ""]);
                  downloadCSV(`dept-budgets-${companyName.replace(/\s+/g, "-")}-${budgetMonth}.csv`, headers, rows);
                }}
                onImport={async (rows) => {
                  const errors: string[] = [];
                  const valid: { dept: string; cat: string; budgeted: number; actual: number; notes: string }[] = [];
                  for (let i = 0; i < rows.length; i++) {
                    const row = rows[i]; const line = i + 2;
                    const dept = row["Department"]?.trim(); const cat = row["Category"]?.trim();
                    if (!dept && !cat) continue;
                    if (!dept || !validDepts.includes(dept)) { errors.push("Row " + line + ": Invalid department: " + (dept || "(empty)")); continue; }
                    if (!cat || !validCats.includes(cat)) { errors.push("Row " + line + ": Invalid category: " + (cat || "(empty)")); continue; }
                    valid.push({ dept, cat, budgeted: Number(row["Budgeted"]) || 0, actual: Number(row["Actual"]) || 0, notes: row["Notes"]?.trim() || "" });
                  }
                  if (errors.length > 0) { toast.show(`Upload rejected: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` ...and ${errors.length - 5} more` : ""}`, "error"); return; }
                  if (valid.length === 0) { toast.show("No valid rows.", "error"); return; }
                  for (const r of valid) {
                    await supabase.from("department_budgets").upsert({
                      company_id: companyId, department: r.dept, budget_month: budgetMonth, category: r.cat,
                      budgeted_amount: r.budgeted, actual_amount: r.actual, notes: r.notes || null,
                    }, { onConflict: "company_id,department,budget_month,category" });
                  }
                  setMsg(`Imported ${valid.length} entries.`); loadBudgets();
                }}
                templateHeaders={["Department", "Category", "Budgeted", "Actual", "Notes"]}
                templateFilename={`budget-template-${companyName.replace(/\s+/g, "-")}.csv`}
                exportLabel="Export" importLabel="Import"
              />
            </div>

            {showBudgetForm && (
              <form onSubmit={handleAddBudget} style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "10px", padding: "12px", marginBottom: "12px", backgroundColor: CARD_ALT }}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "6px", alignItems: "end" }}>
                  <div><label style={kickerLabel}>Department</label>
                    <select style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }} value={bdDept} onChange={(e) => setBdDept(e.target.value)} required>
                      <option value="">Select</option>{validDepts.map((d) => <option key={d}>{d}</option>)}
                    </select></div>
                  <div><label style={kickerLabel}>Category</label>
                    <select style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }} value={bdCategory} onChange={(e) => setBdCategory(e.target.value)} required>
                      <option value="">Select</option>{validCats.map((c) => <option key={c}>{c}</option>)}
                    </select></div>
                  <div><label style={kickerLabel}>Budgeted</label>
                    <input type="number" style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }} value={bdBudgeted} onChange={(e) => setBdBudgeted(e.target.value)} required placeholder="0" /></div>
                  <div><label style={kickerLabel}>Actual</label>
                    <input type="number" style={{ ...inputStyle, padding: "5px 8px", fontSize: "13px" }} value={bdActual} onChange={(e) => setBdActual(e.target.value)} placeholder="0" /></div>
                </div>
                <button type="submit" disabled={bdSaving} style={{ ...btnStyle, fontSize: "13px", padding: "6px 14px", marginTop: "8px" }}>{bdSaving ? "..." : "Save"}</button>
              </form>
            )}

            {budgets.length > 0 && (
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                {[{ label: "Budgeted", val: totalB, col: BLUE }, { label: "Actual", val: totalA, col: totalA > totalB ? RED : GREEN }, { label: "Variance", val: totalB - totalA, col: totalB - totalA >= 0 ? GREEN : RED }].map((c) => (
                  <div key={c.label} style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "10px", padding: "6px 12px", backgroundColor: CARD_ALT }}>
                    <div style={{ fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em" }}>{c.label}</div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: c.col, fontFamily: DISPLAY, fontVariantNumeric: "tabular-nums" }}>PKR {c.val.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}

            {Array.from(groups.entries()).map(([deptName, items]) => {
              const deptTotals = budgetSummary.find((r) => r.department === deptName);
              const dB = deptTotals?.budgeted_total ?? 0;
              const dA = deptTotals?.actual_total ?? 0;
              const over = dA > dB;
              return (
                <div key={deptName} style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "10px", overflow: "hidden", marginBottom: "8px" }}>
                  <div style={{ padding: "8px 12px", backgroundColor: CARD_ALT, borderBottom: `1px solid ${HAIRLINE}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: NAVY }}>{deptName}</span>
                      <span style={{ fontSize: "10.5px", fontWeight: 600, color: over ? RED : GREEN, fontFamily: MONO }}>PKR {dA.toLocaleString()} / {dB.toLocaleString()} ({dB > 0 ? Math.round((dA / dB) * 100) : 0}%)</span>
                    </div>
                    <div style={{ height: "3px", backgroundColor: TRACK, borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min((dA / Math.max(dB, 1)) * 100, 100)}%`, backgroundColor: over ? RED : (dA / Math.max(dB, 1)) > 0.8 ? AMBER : GREEN, borderRadius: "2px", transition: "width 0.3s" }} />
                    </div>
                  </div>
                  {items.map((b) => (
                    <div key={b.id} style={{ padding: "5px 12px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 500, color: NAVY }}>{b.category}</span>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", flexShrink: 0 }}>
                        <span style={{ color: SLATE, fontFamily: MONO }}>PKR {b.budgeted_amount.toLocaleString()}</span>
                        <input type="number" defaultValue={b.actual_amount} onBlur={(e) => { const v = Number(e.target.value); if (v !== b.actual_amount) updateBudgetActual(b.id, v); }}
                          style={{ width: "70px", padding: "2px 5px", border: `1px solid ${HAIRLINE}`, borderRadius: "6px", fontSize: "12px", fontFamily: MONO }} />
                        {canEditAll && <button onClick={() => deleteBudgetEntry(b.id)} style={{ background: "transparent", border: "none", color: RED, fontSize: "14px", cursor: "pointer", lineHeight: 1 }}>×</button>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {budgets.length === 0 && (
              <div style={{ padding: "12px", color: SLATE, textAlign: "center", fontSize: "13px" }}>No budget entries for {budgetMonth}.</div>
            )}
          </>
          );
        })()}
      </div>
      </div>

      {/* ── CHARTS ── */}
      {positions.length > 1 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: "14px",
          marginBottom: "14px",
        }}>
          <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "24px", backgroundColor: CARD }}>
            <div style={{ fontSize: "13px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "16px" }}>
              Cash Balance — Last 30 Days
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={[...positions].reverse().map((p) => ({ date: p.position_date.slice(5), closing: p.closing_balance, net: p.closing_after_post_dated }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: SLATE }} />
                <YAxis tick={{ fontSize: 11, fill: SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: "12px" }} />
                <Line type="monotone" dataKey="closing" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} name="Closing Balance" />
                <Line type="monotone" dataKey="net" stroke={NAVY} strokeWidth={2} dot={{ r: 3 }} name="After Post-dated" strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "24px", backgroundColor: CARD }}>
            <div style={{ fontSize: "13px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "16px" }}>
              Daily Receipts vs Payments
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[...positions].reverse().map((p) => ({ date: p.position_date.slice(5), receipts: p.total_receipts, payments: p.total_payments }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: SLATE }} />
                <YAxis tick={{ fontSize: 11, fill: SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                <Legend iconType="square" wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="receipts" fill={GREEN} name="Money In" radius={[3, 3, 0, 0]} />
                <Bar dataKey="payments" fill={RED} name="Money Out" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── DAILY POSITION HISTORY (full width) ── */}
      <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <SectionTitle title="Daily Position — Last 30 Days" />
        {positions.length > 0 && (
          <button onClick={() => {
            const headers = ["Date", "Opening", "Receipts", "Payments", "Closing", "Post-dated", "Net"];
            const rows = positions.map((p) => [formatDateUK(p.position_date), String(p.opening_balance), String(p.total_receipts), String(p.total_payments), String(p.closing_balance), String(p.post_dated_total), String(p.closing_after_post_dated)]);
            downloadCSV(`cash-positions-${companyName.replace(/ /g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
          }} style={{ backgroundColor: CARD, color: NAVY, border: `1px solid ${HAIRLINE}`, borderRadius: "999px", padding: "6px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            Export CSV
          </button>
        )}
      </div>
      <div
        style={{
          border: `1px solid ${HAIRLINE}`,
          borderRadius: "14px",
          overflow: "hidden",
          backgroundColor: CARD,
          marginBottom: "16px",
        }}
      >
        {positions.length === 0 ? (
          <p style={{ fontSize: "14px", color: SLATE, padding: "24px" }}>
            No daily positions recorded yet.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ backgroundColor: CARD_ALT }}>
                  <th style={th}>Date</th>
                  <th style={th}>Opening</th>
                  <th style={th}>Receipts</th>
                  <th style={th}>Payments</th>
                  <th style={th}>Closing</th>
                  <th style={th}>Post-dated</th>
                  <th style={th}>Net</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, idx) => {
                  const prevDay = positions[idx + 1];
                  const isConsecutive = prevDay && (() => {
                    const curr = new Date(p.position_date);
                    const prev = new Date(prevDay.position_date);
                    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
                    return diffDays <= 1;
                  })();
                  const mismatch = prevDay && isConsecutive
                    && Math.abs(p.opening_balance - prevDay.closing_balance) > 0.01
                    && Math.abs(Math.abs(p.opening_balance) - Math.abs(prevDay.closing_balance)) > 0.01;
                  return (
                    <tr key={p.id} style={mismatch ? { backgroundColor: DANGER_SOFT } : undefined}>
                      <td style={tdBold}>
                        {formatDateUK(p.position_date)}
                        {mismatch && (
                          <div style={{ fontSize: "11px", color: RED, fontWeight: 600, marginTop: "2px", fontFamily: MONO }}>
                            Opening ≠ prev closing ({fmt(prevDay.closing_balance)})
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, color: mismatch ? RED : undefined, fontWeight: mismatch ? 600 : undefined }}>
                        {fmt(p.opening_balance)}
                      </td>
                      <td style={{ ...td, color: GREEN, fontWeight: 600 }}>
                        {fmt(p.total_receipts)}
                      </td>
                      <td style={{ ...td, color: RED, fontWeight: 600 }}>
                        {fmt(p.total_payments)}
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: NAVY }}>
                        {fmt(p.closing_balance)}
                      </td>
                      <td style={{ ...td, color: SLATE }}>
                        {fmt(p.post_dated_total)}
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: p.closing_after_post_dated < 0 ? RED : GREEN }}>
                        {fmt(p.closing_after_post_dated)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </div>

      {/* ── MODALS ── */}
      {openModal === "opening" && (
        <Modal title="Opening Balance" onClose={() => setOpenModal(null)}>
          <p style={{ fontSize: "13px", color: SLATE, marginBottom: "16px", lineHeight: 1.5 }}>
            Set the starting cash balance. The system counts forward from here.
          </p>
          <form onSubmit={saveOpeningBalance}>
            <label style={labelStyle}>
              <span style={kickerLabel}>As of date</span>
              <DateInput
                value={obDate}
                onChange={(e) => setObDate(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              <span style={kickerLabel}>Opening amount (PKR)</span>
              <input
                type="number"
                min="0"
                value={obAmount}
                onChange={(e) => setObAmount(e.target.value)}
                placeholder="0"
                style={inputStyle}
                required
              />
            </label>
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} style={{ ...btnStyle, flex: 1 }}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {openModal === "plan" && (
        <Modal title="Monthly Cash Plan" onClose={() => setOpenModal(null)}>
          <p style={{ fontSize: "13px", color: SLATE, marginBottom: "16px", lineHeight: 1.5 }}>
            Set expected receivables and payouts for the month. Used to calculate cash health on the Executive dashboard.
          </p>
          <form onSubmit={saveMonthlyPlan}>
            <label style={labelStyle}>
              <span style={kickerLabel}>Plan month</span>
              <input
                type="month"
                value={planMonth}
                onChange={(e) => setPlanMonth(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              <span style={kickerLabel}>Expected receivables (PKR)</span>
              <input
                type="number"
                min="0"
                value={planRecv}
                onChange={(e) => setPlanRecv(e.target.value)}
                placeholder="0"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              <span style={kickerLabel}>Expected payouts (PKR)</span>
              <input
                type="number"
                min="0"
                value={planPay}
                onChange={(e) => setPlanPay(e.target.value)}
                placeholder="0"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} style={{ ...btnStyle, flex: 1 }}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  valueColor,
  isHero,
  onEdit,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  isHero?: boolean;
  onEdit?: () => void;
}) {
  if (isHero) {
    return (
      <div
        style={{
          border: `1px solid ${NAVY}`,
          borderRadius: "14px",
          padding: "24px",
          backgroundColor: NAVY,
          position: "relative",
        }}
      >
        <div style={{
          fontSize: "10.5px", fontWeight: 500, color: "rgba(255,255,255,0.55)",
          textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px",
          fontFamily: DISPLAY,
        }}>
          {label}
        </div>
        <div style={{
          fontSize: "40px", fontWeight: 600, color: "white",
          fontFamily: DISPLAY, lineHeight: 1, letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
        }}>
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", marginTop: "6px" }}>
            {sub}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        border: `1px solid ${HAIRLINE}`,
        borderRadius: "14px",
        padding: "20px",
        backgroundColor: CARD,
        position: "relative",
      }}
    >
      <div style={{
        fontSize: "10.5px", fontWeight: 500, color: SLATE,
        textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: "22px", fontWeight: 600, color: valueColor || NAVY,
        fontFamily: DISPLAY, lineHeight: 1, letterSpacing: "-0.01em",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "12px", color: SLATE, marginTop: "6px" }}>
          {sub}
        </div>
      )}
      {onEdit && (
        <button
          onClick={onEdit}
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            background: CARD,
            border: `1px solid ${HAIRLINE}`,
            borderRadius: "999px",
            padding: "3px 12px",
            fontSize: "12px",
            fontWeight: 500,
            color: NAVY,
            cursor: "pointer",
          }}
        >
          Edit
        </button>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15,23,32,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: CARD,
          borderRadius: "14px",
          padding: "24px",
          maxWidth: "420px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(15,23,32,0.15)",
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            paddingBottom: "16px",
            borderBottom: `1px solid ${HAIRLINE}`,
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: NAVY, margin: 0, fontFamily: DISPLAY }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: CARD_ALT,
              border: `1px solid ${HAIRLINE}`,
              borderRadius: "999px",
              fontSize: "16px",
              color: SLATE,
              cursor: "pointer",
              padding: "2px 8px",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const kickerLabel: React.CSSProperties = {
  display: "block",
  fontSize: "10.5px",
  fontWeight: 500,
  color: SLATE,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: "6px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "12px",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: "4px",
  border: `1px solid ${HAIRLINE}`,
  borderRadius: "10px",
  fontSize: "14px",
  boxSizing: "border-box",
  color: NAVY,
};

const btnStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: "white",
  border: "none",
  borderRadius: "999px",
  padding: "8px 20px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "4px",
};

const cancelBtnStyle: React.CSSProperties = {
  backgroundColor: CARD,
  color: NAVY,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: "999px",
  padding: "8px 20px",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
  marginTop: "4px",
};

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${HAIRLINE}`,
  padding: "10px 14px",
  fontSize: "10.5px",
  color: SLATE,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: CARD_ALT,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid ${HAIRLINE}`,
  padding: "10px 14px",
  fontSize: "13px",
  fontFamily: MONO,
  fontVariantNumeric: "tabular-nums",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontFamily: "var(--font-sans, Inter, sans-serif)",
  fontWeight: 600,
  color: NAVY,
  fontSize: "13px",
};