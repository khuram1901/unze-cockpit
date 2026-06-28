"use client";

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { formatDateUK, formatMonthUK, todayISO, currentMonthISO } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, SectionTitle, PageHeader } from "../lib/SharedUI";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";
import * as XLSX from "xlsx";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { canEditFinance, type UserCtx, type PermOverrides } from "../lib/permissions";

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

type DeptBudget = { id: string; department: string; budget_month: string; category: string; budgeted_amount: number; actual_amount: number; notes: string | null };

const COMPANY_DEPTS: Record<string, string[]> = {
  "15884c2d-48a4-4d43-be90-0ef6e130790c": ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit", "Unze Trading Ops"],
  "77921705-8a15-4406-847a-b234f84b5ec3": ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit"],
};

const COMPANY_CATS: Record<string, string[]> = {
  "15884c2d-48a4-4d43-be90-0ef6e130790c": ["Salaries", "Rent/Utilities", "Admin", "Welfare", "Freight", "Travel"],
  "77921705-8a15-4406-847a-b234f84b5ec3": ["Salaries", "Rent/Utilities", "Admin", "Marketing", "Freight", "Travel"],
};

const { NAVY, SLATE, BORDER, GREEN, RED, BLUE } = COLOURS;

function fmt(n: number) {
  return n.toLocaleString();
}

export default function FinanceManager({ companyId, companyName }: { companyId: string; companyName: string }) {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>("Member");
  const [userCanEdit, setUserCanEdit] = useState(false);

  const [opening, setOpening] = useState<OpeningBalance | null>(null);
  const [plan, setPlan] = useState<MonthlyPlan | null>(null);
  const [positions, setPositions] = useState<DailyPosition[]>([]);

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
      const res = await fetch("/api/finance/upload-forecast", {
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
  const [cashFlowFile, setCashFlowFile] = useState<File | null>(null);
  const [bankPositionFile, setBankPositionFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    date?: string;
    reconciliation?: { matches: boolean; cashFlowClosing: number; bankPositionTotal: number; diff: number };
    cashFlow?: Record<string, number>;
    error?: string;
  } | null>(null);

  async function handlePDFUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!cashFlowFile || !bankPositionFile) {
      showMsg("Error: Please select both PDF files.");
      return;
    }
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append("cashFlow", cashFlowFile);
      formData.append("bankPosition", bankPositionFile);
      formData.append("uploadedBy", "manual");
      formData.append("companyId", companyId);

      const res = await fetch("/api/finance/parse-cash-flow", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadResult({ success: false, error: data.error || "Upload failed" });
        showMsg("Error: " + (data.error || "Upload failed"));
      } else {
        setUploadResult({
          success: true,
          date: data.date,
          reconciliation: data.reconciliation,
          cashFlow: data.cashFlow,
        });
        showMsg(data.reconciliation?.matches
          ? "Statements parsed and balanced. Saved."
          : "Statements parsed but NOT balanced — please review."
        );
        setCashFlowFile(null);
        setBankPositionFile(null);
        loadData();
      }
    } catch {
      setUploadResult({ success: false, error: "Network error" });
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
      }
    }
    const [obRes, planRes, posRes] = await Promise.all([
      supabase
        .from("cash_opening_balance")
        .select("*")
        .eq("company_id", companyId)
        .order("as_of_date", { ascending: true })
        .limit(1),
      supabase
        .from("monthly_cash_plan")
        .select("*")
        .eq("company_id", companyId)
        .eq("plan_month", currentMonthISO())
        .maybeSingle(),
      supabase
        .from("daily_cash_position")
        .select("*")
        .eq("company_id", companyId)
        .order("position_date", { ascending: false })
        .limit(30),
    ]);
    if (obRes.error) console.error("Opening balance error:", obRes.error);
    if (planRes.error) console.error("Monthly plan error:", planRes.error);
    if (posRes.error) console.error("Positions error:", posRes.error);
    setOpening(obRes.data && obRes.data.length > 0 ? obRes.data[0] : null);
    setPlan(planRes.data || null);
    const isImperial = companyId === "77921705-8a15-4406-847a-b234f84b5ec3";
    const rawPositions: DailyPosition[] = posRes.data || [];
    if (isImperial) {
      for (const p of rawPositions) {
        p.closing_after_post_dated = p.closing_balance + p.post_dated_total;
      }
    }
    setPositions(rawPositions);

    const { data: budgetData } = await supabase.from("department_budgets").select("*").eq("company_id", companyId).eq("budget_month", budgetMonth).order("department");
    setBudgets(budgetData || []);

    setLoading(false);
  }

  async function loadBudgets(month?: string) {
    const { data } = await supabase.from("department_budgets").select("*").eq("company_id", companyId).eq("budget_month", month || budgetMonth).order("department");
    setBudgets(data || []);
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
    if (!confirm("Delete this budget entry?")) return;
    await supabase.from("department_budgets").delete().eq("id", id);
    loadBudgets();
  }

  useEffect(() => {
    loadData();

    // Check Google connection status via server-side route (avoids RLS)
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((data) => { if (data.connected) setGmailConnected(true); })
      .catch(() => {});

    // Check URL params for Google OAuth result
    const params = new URLSearchParams(window.location.search);
    const googleStatus = params.get("google");
    if (googleStatus === "connected") {
      setGmailConnected(true);
      showMsg("Gmail connected successfully. Daily statements will be ingested automatically.");
      window.history.replaceState({}, "", "/finance");
    } else if (googleStatus === "error") {
      showMsg("Error: Failed to connect Gmail. Please try again.");
      window.history.replaceState({}, "", "/finance");
    } else if (googleStatus === "denied") {
      showMsg("Error: Gmail access was denied. Please try again and grant permissions.");
      window.history.replaceState({}, "", "/finance");
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
        const proceed = confirm(
          `Warning: Opening balance (${fmt(Number(dpOpening))}) does not match previous day's closing balance (${fmt(prevDay.closing_balance)} on ${formatDateUK(prevDay.position_date)}).\n\nSave anyway?`
        );
        if (!proceed) return;
      }
    }

    setSaving(true);
    const isImperial = companyId === "77921705-8a15-4406-847a-b234f84b5ec3";
    const closingAfterPD = isImperial
      ? Number(dpClosing) + Number(dpPostDated)
      : Number(dpClosing) - Number(dpPostDated);
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
      {msg && (
        <div style={{
          border: `1px solid ${BORDER}`,
          borderLeft: `4px solid ${msg.startsWith("Error") ? RED : GREEN}`,
          borderRadius: "6px", padding: "10px 14px", marginBottom: "14px",
          backgroundColor: "white", fontSize: "15px", color: NAVY,
        }}>
          {msg}
        </div>
      )}

      {/* ── ALERT BANNER ── */}
      {hasAlerts && (
        <div style={{
          border: `1px solid ${staleDays > 1 ? "#fecaca" : BORDER}`,
          borderLeft: `4px solid ${staleDays > 1 ? RED : "#d97706"}`,
          borderRadius: "8px", padding: "12px 16px", marginBottom: "14px",
          backgroundColor: staleDays > 1 ? "#fef2f2" : "#fffbeb",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ fontSize: "20px", flexShrink: 0 }}>⚠</span>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: staleDays > 1 ? "#991b1b" : "#92400e" }}>
              Setup needed
            </div>
            <div style={{ fontSize: "13px", color: staleDays > 1 ? "#991b1b" : "#92400e", marginTop: "1px" }}>
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
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "10px",
          marginBottom: "8px",
        }}
      >
        <SummaryCard
          label="Opening Balance"
          value={opening ? `PKR ${fmt(opening.opening_amount)}` : "Not set"}
          sub={opening ? `as of ${formatDateUK(opening.as_of_date)}` : "Click edit to set"}
          color={BLUE}
          onEdit={canEditAll ? openOpeningModal : undefined}
        />
        <SummaryCard
          label="Planned Receivables"
          value={plan ? `PKR ${fmt(plan.tentative_receivables)}` : "Not set"}
          sub={plan ? formatMonthUK(plan.plan_month) : "Click edit to set"}
          color={GREEN}
          onEdit={canEditAll ? openPlanModal : undefined}
        />
        <SummaryCard
          label="Planned Payouts"
          value={plan ? `PKR ${fmt(plan.tentative_payouts)}` : "Not set"}
          sub={plan ? formatMonthUK(plan.plan_month) : "Click edit to set"}
          color={RED}
          onEdit={canEditAll ? openPlanModal : undefined}
        />
        <SummaryCard
          label="Net Position"
          value={latestPosition ? `PKR ${fmt(latestPosition.closing_after_post_dated)}` : "—"}
          sub={latestPosition ? formatDateUK(latestPosition.position_date) : "No entries yet"}
          color={latestPosition && latestPosition.closing_after_post_dated < 0 ? RED : GREEN}
        />
      </div>

      {/* ── ROW: INGESTION + PDF UPLOAD side by side (Admin/Executive only) ── */}
      {canEditAll && (
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px 16px", backgroundColor: "white", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <SectionTitle title="Automatic Ingestion" />
            <div style={{ fontSize: "14px", fontWeight: 700, color: NAVY, marginBottom: "4px" }}>
              Gmail: {gmailConnected ? <span style={{ color: GREEN }}>Connected</span> : <span style={{ color: SLATE }}>Not connected</span>}
            </div>
            <div style={{ fontSize: "14px", color: SLATE, marginBottom: "10px" }}>
              {gmailConnected ? "Daily statements ingested automatically from your cockpit-cash Gmail label." : "Connect Gmail to auto-ingest daily cash statements. Label: 'cockpit-cash'."}
            </div>
          </div>
          <a href="/api/google/auth" style={{ ...btnStyle, textDecoration: "none", display: "inline-block", textAlign: "center", whiteSpace: "nowrap", alignSelf: "flex-start" }}>
            {gmailConnected ? "Add Another Account" : "Connect Gmail"}
          </a>
        </div>

        {/* Add Daily Position — Manual or Upload */}
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px 16px", backgroundColor: "white" }}>
          <SectionTitle title="Add Daily Position" />
          <div style={{ display: "flex", gap: "0", marginBottom: "12px", borderBottom: `2px solid ${BORDER}` }}>
            {([{ key: "upload", label: "Upload PDF" }, { key: "manual", label: "Manual Entry" }] as const).map((tab) => (
              <button key={tab.key} onClick={() => setDailyEntryTab(tab.key)} style={{
                padding: "8px 16px", fontSize: "14px", fontWeight: dailyEntryTab === tab.key ? 700 : 500,
                color: dailyEntryTab === tab.key ? NAVY : SLATE, backgroundColor: "transparent", border: "none",
                borderBottom: dailyEntryTab === tab.key ? `3px solid ${NAVY}` : "3px solid transparent",
                cursor: "pointer", marginBottom: "-2px",
              }}>{tab.label}</button>
            ))}
          </div>

          {dailyEntryTab === "upload" && (
            <>
              <p style={{ fontSize: "13px", color: SLATE, marginBottom: "8px" }}>Upload Cash Flow + Bank Position PDFs. System extracts, reconciles, and saves.</p>
              <form onSubmit={handlePDFUpload}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
                  <label style={{ ...labelStyle, fontSize: "13px" }}>Cash Flow PDF
                    <input type="file" accept=".pdf" onChange={(e) => setCashFlowFile(e.target.files?.[0] || null)} style={{ ...inputStyle, padding: "5px 6px", fontSize: "13px" }} />
                  </label>
                  <label style={{ ...labelStyle, fontSize: "13px" }}>Bank Position PDF
                    <input type="file" accept=".pdf" onChange={(e) => setBankPositionFile(e.target.files?.[0] || null)} style={{ ...inputStyle, padding: "5px 6px", fontSize: "13px" }} />
                  </label>
                </div>
                <button type="submit" disabled={uploading || !cashFlowFile || !bankPositionFile}
                  style={{ ...btnStyle, fontSize: "14px", padding: "6px 14px", opacity: uploading || !cashFlowFile || !bankPositionFile ? 0.5 : 1 }}>
                  {uploading ? "Parsing..." : "Upload & Parse"}
                </button>
              </form>
              {uploadResult && (
                <div style={{ marginTop: "10px", padding: "8px 12px", borderRadius: "6px", border: `1px solid ${BORDER}`, borderLeft: `4px solid ${uploadResult.reconciliation?.matches ? GREEN : RED}`, backgroundColor: "#fafbfc", fontSize: "13px" }}>
                  {uploadResult.success ? (
                    <>
                      <div style={{ fontWeight: 700, color: NAVY, marginBottom: "4px" }}>{uploadResult.reconciliation?.matches ? "Balanced — statements match" : "Mismatch — NOT balanced"}</div>
                      <div style={{ color: SLATE }}>
                        Date: {uploadResult.date} | CF Closing: {uploadResult.reconciliation?.cashFlowClosing?.toLocaleString()} | Bank: {uploadResult.reconciliation?.bankPositionTotal?.toLocaleString()}
                        {!uploadResult.reconciliation?.matches && <span style={{ color: RED, fontWeight: 700 }}> | Diff: {uploadResult.reconciliation?.diff?.toLocaleString()}</span>}
                      </div>
                      {(() => {
                        if (!uploadResult.cashFlow || !uploadResult.date) return null;
                        const prevDay = positions.find((p) => p.position_date < uploadResult.date!);
                        if (!prevDay) return null;
                        const diffDays = (new Date(uploadResult.date!).getTime() - new Date(prevDay.position_date).getTime()) / (1000 * 60 * 60 * 24);
                        if (diffDays > 1) return null;
                        const opening = (uploadResult.cashFlow as Record<string, number>).openingBalance;
                        if (opening && Math.abs(opening - prevDay.closing_balance) > 0.01 && Math.abs(Math.abs(opening) - Math.abs(prevDay.closing_balance)) > 0.01) {
                          return <div style={{ color: RED, fontWeight: 700, marginTop: "4px", fontSize: "12px" }}>Opening ({opening.toLocaleString()}) does not match previous closing ({prevDay.closing_balance.toLocaleString()})</div>;
                        }
                        return null;
                      })()}
                    </>
                  ) : (
                    <div style={{ color: RED, fontWeight: 600 }}>{uploadResult.error}</div>
                  )}
                </div>
              )}
            </>
          )}

          {dailyEntryTab === "manual" && (
            <>
              <p style={{ fontSize: "13px", color: SLATE, marginBottom: "8px" }}>Enter today's figures from the accountant's statement.</p>
              <form onSubmit={saveDailyPosition}>
                <label style={{ ...labelStyle, fontSize: "13px" }}>Date
                  <input type="date" value={dpDate} onChange={(e) => setDpDate(e.target.value)} style={inputStyle} required />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
                  <label style={{ ...labelStyle, fontSize: "13px" }}>Opening (PKR)
                    <input type="number" value={dpOpening} onChange={(e) => setDpOpening(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                  <label style={{ ...labelStyle, fontSize: "13px" }}>Closing (PKR)
                    <input type="number" value={dpClosing} onChange={(e) => setDpClosing(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                  <label style={{ ...labelStyle, fontSize: "13px" }}>Receipts (PKR)
                    <input type="number" min="0" value={dpReceipts} onChange={(e) => setDpReceipts(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                  <label style={{ ...labelStyle, fontSize: "13px" }}>Payments (PKR)
                    <input type="number" min="0" value={dpPayments} onChange={(e) => setDpPayments(e.target.value)} placeholder="0" style={inputStyle} />
                  </label>
                  <label style={{ ...labelStyle, fontSize: "13px", gridColumn: "1 / -1" }}>Post-dated total (PKR)
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
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px 16px", backgroundColor: "white" }}>
        <SectionTitle title="Cash Flow Forecast" />
        <div style={{ display: "flex", gap: "0", marginBottom: "10px", borderBottom: `2px solid ${BORDER}` }}>
          {([{ key: false, label: "Upload Excel" }, { key: true, label: "Manual Entry" }] as const).map((tab) => (
            <button key={String(tab.key)} onClick={() => setShowManualForecast(tab.key)} style={{
              padding: "6px 14px", fontSize: "13px", fontWeight: showManualForecast === tab.key ? 700 : 500,
              color: showManualForecast === tab.key ? NAVY : SLATE, backgroundColor: "transparent", border: "none",
              borderBottom: showManualForecast === tab.key ? `3px solid ${NAVY}` : "3px solid transparent",
              cursor: "pointer", marginBottom: "-2px",
            }}>{tab.label}</button>
          ))}
        </div>

        {!showManualForecast ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", alignItems: "end" }}>
            <div>
              <form onSubmit={handleForecastUpload} style={{ display: "flex", gap: "6px", alignItems: "end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "150px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: SLATE }}>Forecast Excel (.xlsx)</label>
                  <input type="file" accept=".xlsx,.xls" onChange={(e) => setForecastFile(e.target.files?.[0] || null)} style={{ ...inputStyle, padding: "4px 6px", fontSize: "13px" }} />
                </div>
                <button type="submit" disabled={forecastUploading || !forecastFile}
                  style={{ ...btnStyle, fontSize: "13px", padding: "6px 12px", opacity: forecastUploading || !forecastFile ? 0.5 : 1 }}>
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
              <div><label style={{ fontSize: "12px", fontWeight: 600, color: SLATE }}>Category</label>
                <input type="text" value={mfCategory} onChange={(e) => setMfCategory(e.target.value)} placeholder="e.g. Salaries" style={{ ...inputStyle, padding: "4px 6px", fontSize: "13px" }} required />
              </div>
              <div><label style={{ fontSize: "12px", fontWeight: 600, color: SLATE }}>Type</label>
                <select value={mfFlowType} onChange={(e) => setMfFlowType(e.target.value as "inflow" | "outflow")} style={{ ...inputStyle, padding: "4px 6px", fontSize: "13px" }}>
                  <option value="inflow">Inflow</option><option value="outflow">Outflow</option>
                </select>
              </div>
              <div><label style={{ fontSize: "12px", fontWeight: 600, color: SLATE }}>Month</label>
                <input type="month" value={mfMonth} onChange={(e) => setMfMonth(e.target.value)} style={{ ...inputStyle, padding: "4px 6px", fontSize: "13px" }} required />
              </div>
              <div><label style={{ fontSize: "12px", fontWeight: 600, color: SLATE }}>Amount (PKR)</label>
                <input type="number" value={mfAmount} onChange={(e) => setMfAmount(e.target.value)} placeholder="0" style={{ ...inputStyle, padding: "4px 6px", fontSize: "13px" }} required />
              </div>
              <button type="submit" disabled={mfSaving} style={{ ...btnStyle, fontSize: "13px", padding: "5px 10px" }}>{mfSaving ? "..." : "Save"}</button>
            </div>
          </form>
        )}
      </div>

      {/* RIGHT — Department Budgets */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px 16px", backgroundColor: "white" }}>
        <SectionTitle title="Department Budgets" />
        {(() => {
          const validDepts = COMPANY_DEPTS[companyId] || ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit"];
          const validCats = COMPANY_CATS[companyId] || ["Salaries", "Rent/Utilities", "Admin", "Freight", "Travel"];
          const totalB = budgets.reduce((s, b) => s + b.budgeted_amount, 0);
          const totalA = budgets.reduce((s, b) => s + b.actual_amount, 0);
          const groups = new Map<string, DeptBudget[]>();
          for (const b of budgets) { if (!groups.has(b.department)) groups.set(b.department, []); groups.get(b.department)!.push(b); }
          return (
          <>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
              <input type="month" value={budgetMonth} onChange={(e) => { setBudgetMonth(e.target.value); loadBudgets(e.target.value); }}
                style={{ padding: "4px 6px", border: `1px solid ${BORDER}`, borderRadius: "4px", fontSize: "12px" }} />
              <button onClick={() => setShowBudgetForm(!showBudgetForm)} style={{
                backgroundColor: NAVY, color: "white", border: "none", borderRadius: "4px",
                padding: "4px 10px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
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
                  if (errors.length > 0) { alert(`Upload rejected:\n\n${errors.slice(0, 15).join("\n")}`); return; }
                  if (valid.length === 0) { alert("No valid rows."); return; }
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
              <form onSubmit={handleAddBudget} style={{ border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "8px", marginBottom: "10px", backgroundColor: "#f8fafc" }}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "4px", alignItems: "end" }}>
                  <div><label style={{ fontSize: "10px", fontWeight: 600, color: SLATE }}>Department</label>
                    <select style={{ ...inputStyle, padding: "4px 5px", fontSize: "12px" }} value={bdDept} onChange={(e) => setBdDept(e.target.value)} required>
                      <option value="">Select</option>{validDepts.map((d) => <option key={d}>{d}</option>)}
                    </select></div>
                  <div><label style={{ fontSize: "10px", fontWeight: 600, color: SLATE }}>Category</label>
                    <select style={{ ...inputStyle, padding: "4px 5px", fontSize: "12px" }} value={bdCategory} onChange={(e) => setBdCategory(e.target.value)} required>
                      <option value="">Select</option>{validCats.map((c) => <option key={c}>{c}</option>)}
                    </select></div>
                  <div><label style={{ fontSize: "10px", fontWeight: 600, color: SLATE }}>Budgeted</label>
                    <input type="number" style={{ ...inputStyle, padding: "4px 5px", fontSize: "12px" }} value={bdBudgeted} onChange={(e) => setBdBudgeted(e.target.value)} required placeholder="0" /></div>
                  <div><label style={{ fontSize: "10px", fontWeight: 600, color: SLATE }}>Actual</label>
                    <input type="number" style={{ ...inputStyle, padding: "4px 5px", fontSize: "12px" }} value={bdActual} onChange={(e) => setBdActual(e.target.value)} placeholder="0" /></div>
                </div>
                <button type="submit" disabled={bdSaving} style={{ backgroundColor: NAVY, color: "white", border: "none", borderRadius: "4px", padding: "4px 10px", fontSize: "12px", fontWeight: 700, cursor: "pointer", marginTop: "6px" }}>{bdSaving ? "..." : "Save"}</button>
              </form>
            )}

            {budgets.length > 0 && (
              <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
                {[{ label: "Budgeted", val: totalB, col: BLUE }, { label: "Actual", val: totalA, col: totalA > totalB ? RED : GREEN }, { label: "Variance", val: totalB - totalA, col: totalB - totalA >= 0 ? GREEN : RED }].map((c) => (
                  <div key={c.label} style={{ border: `1px solid ${BORDER}`, borderTop: `3px solid ${c.col}`, borderRadius: "5px", padding: "4px 10px" }}>
                    <div style={{ fontSize: "10px", color: SLATE }}>{c.label}</div>
                    <div style={{ fontSize: "13px", fontWeight: 800, color: c.col }}>PKR {c.val.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}

            {Array.from(groups.entries()).map(([deptName, items]) => {
              const dB = items.reduce((s, i) => s + i.budgeted_amount, 0);
              const dA = items.reduce((s, i) => s + i.actual_amount, 0);
              const over = dA > dB;
              return (
                <div key={deptName} style={{ border: `1px solid ${BORDER}`, borderTop: `2px solid ${over ? RED : GREEN}`, borderRadius: "5px", overflow: "hidden", marginBottom: "6px" }}>
                  <div style={{ padding: "4px 10px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: NAVY }}>{deptName}</span>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: over ? RED : GREEN }}>PKR {dA.toLocaleString()} / {dB.toLocaleString()}</span>
                  </div>
                  {items.map((b) => (
                    <div key={b.id} style={{ padding: "3px 10px", borderBottom: `1px solid ${COLOURS.LIGHT}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: NAVY }}>{b.category}</span>
                      <div style={{ display: "flex", gap: "4px", alignItems: "center", fontSize: "11px", flexShrink: 0 }}>
                        <span style={{ color: SLATE }}>PKR {b.budgeted_amount.toLocaleString()}</span>
                        <input type="number" defaultValue={b.actual_amount} onBlur={(e) => { const v = Number(e.target.value); if (v !== b.actual_amount) updateBudgetActual(b.id, v); }}
                          style={{ width: "70px", padding: "1px 4px", border: `1px solid ${BORDER}`, borderRadius: "3px", fontSize: "11px" }} />
                        {canEditAll && <button onClick={() => deleteBudgetEntry(b.id)} style={{ background: "transparent", border: "none", color: RED, fontSize: "12px", cursor: "pointer" }}>×</button>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {budgets.length === 0 && (
              <div style={{ padding: "10px", color: SLATE, textAlign: "center", fontSize: "13px" }}>No budget entries for {budgetMonth}.</div>
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
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>
              Cash Balance — Last 30 Days
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={[...positions].reverse().map((p) => ({ date: p.position_date.slice(5), closing: p.closing_balance, net: p.closing_after_post_dated }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: SLATE }} />
                <YAxis tick={{ fontSize: 11, fill: SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: "13px" }} />
                <Line type="monotone" dataKey="closing" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} name="Closing Balance (solid blue)" />
                <Line type="monotone" dataKey="net" stroke={NAVY} strokeWidth={2} dot={{ r: 3, strokeDasharray: "" }} name="After Post-dated (dashed)" strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>
              Daily Receipts vs Payments
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[...positions].reverse().map((p) => ({ date: p.position_date.slice(5), receipts: p.total_receipts, payments: p.total_payments }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: SLATE }} />
                <YAxis tick={{ fontSize: 11, fill: SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                <Legend iconType="square" wrapperStyle={{ fontSize: "13px" }} />
                <Bar dataKey="receipts" fill="#16a34a" name="Money In" radius={[3, 3, 0, 0]} />
                <Bar dataKey="payments" fill="#dc2626" name="Money Out" radius={[3, 3, 0, 0]} />
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
          }} style={{ backgroundColor: "white", color: NAVY, border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "6px 12px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            Export CSV
          </button>
        )}
      </div>
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: "8px",
          padding: "14px",
          backgroundColor: "white",
          marginBottom: "16px",
        }}
      >
        {positions.length === 0 ? (
          <p style={{ fontSize: "14px", color: SLATE }}>
            No daily positions recorded yet.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
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
                    <tr key={p.id} style={mismatch ? { backgroundColor: "#fef2f2" } : undefined}>
                      <td style={tdBold}>
                        {formatDateUK(p.position_date)}
                        {mismatch && (
                          <div style={{ fontSize: "12px", color: RED, fontWeight: 700, marginTop: "2px" }}>
                            Opening != prev closing ({fmt(prevDay.closing_balance)})
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, color: mismatch ? RED : undefined, fontWeight: mismatch ? 700 : undefined }}>
                        {fmt(p.opening_balance)}
                      </td>
                      <td style={{ ...td, color: GREEN, fontWeight: 600 }}>
                        {fmt(p.total_receipts)}
                      </td>
                      <td style={{ ...td, color: RED, fontWeight: 600 }}>
                        {fmt(p.total_payments)}
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: NAVY }}>
                        {fmt(p.closing_balance)}
                      </td>
                      <td style={{ ...td, color: SLATE }}>
                        {fmt(p.post_dated_total)}
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: p.closing_after_post_dated < 0 ? RED : GREEN }}>
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
          <p style={{ fontSize: "14px", color: SLATE, marginBottom: "12px" }}>
            Set the starting cash balance. The system counts forward from here.
          </p>
          <form onSubmit={saveOpeningBalance}>
            <label style={labelStyle}>
              As of date
              <input
                type="date"
                value={obDate}
                onChange={(e) => setObDate(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              Opening amount (PKR)
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
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
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
          <p style={{ fontSize: "14px", color: SLATE, marginBottom: "12px" }}>
            Set expected receivables and payouts for the month. Used to calculate cash health on the Executive dashboard.
          </p>
          <form onSubmit={saveMonthlyPlan}>
            <label style={labelStyle}>
              Plan month
              <input
                type="month"
                value={planMonth}
                onChange={(e) => setPlanMonth(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              Expected receivables (PKR)
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
              Expected payouts (PKR)
              <input
                type="number"
                min="0"
                value={planPay}
                onChange={(e) => setPlanPay(e.target.value)}
                placeholder="0"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
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
  color,
  onEdit,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  onEdit?: () => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderTop: `3px solid ${color}`,
        borderRadius: "7px",
        padding: "10px 12px",
        backgroundColor: "white",
        position: "relative",
      }}
    >
      <div style={{ color: SLATE, fontSize: "13px", marginBottom: "2px", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: "18px", fontWeight: 800, color }}>{value}</div>
      {sub && (
        <div style={{ fontSize: "12px", color: SLATE, marginTop: "2px" }}>
          {sub}
        </div>
      )}
      {onEdit && (
        <button
          onClick={onEdit}
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            background: "transparent",
            border: `1px solid ${BORDER}`,
            borderRadius: "5px",
            padding: "2px 8px",
            fontSize: "14px",
            fontWeight: 600,
            color: SLATE,
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
        backgroundColor: "rgba(15,23,42,0.45)",
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
          backgroundColor: "white",
          borderRadius: "10px",
          padding: "20px",
          maxWidth: "420px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 10px 30px rgba(15,23,42,0.20)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            paddingBottom: "10px",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <h2 style={{ fontSize: "14px", fontWeight: 700, color: NAVY, margin: 0 }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "20px",
              color: SLATE,
              cursor: "pointer",
              padding: "0 4px",
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

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "14px",
  fontWeight: 600,
  color: NAVY,
  marginBottom: "8px",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  fontSize: "15px",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "8px 16px",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
  marginTop: "4px",
};

const cancelBtnStyle: React.CSSProperties = {
  backgroundColor: "white",
  color: NAVY,
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  padding: "8px 16px",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "4px",
};

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "6px 10px",
  fontSize: "14px",
  color: SLATE,
  fontWeight: 700,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid ${COLOURS.LIGHT}`,
  padding: "7px 10px",
  fontSize: "15px",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};