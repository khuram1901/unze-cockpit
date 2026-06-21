"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDateUK, formatMonthUK, todayISO, currentMonthISO } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";

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

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";
const GREEN = "#16a34a";
const RED = "#dc2626";
const BLUE = "#0070f3";

function fmt(n: number) {
  return n.toLocaleString();
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontSize: "17px",
        fontWeight: 700,
        color: NAVY,
        margin: "20px 0 10px",
        paddingLeft: "9px",
        borderLeft: `3px solid ${NAVY}`,
      }}
    >
      {title}
    </h2>
  );
}

export default function FinanceManager({ companyId, companyName }: { companyId: string; companyName: string }) {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);

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
    setOpening(obRes.data && obRes.data.length > 0 ? obRes.data[0] : null);
    setPlan(planRes.data || null);
    setPositions(posRes.data || []);
    setLoading(false);
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

    // Validate opening matches previous day's closing
    const prevDay = positions.find((p) => p.position_date < dpDate);
    if (prevDay && Math.abs(Number(dpOpening) - prevDay.closing_balance) > 0.01) {
      const proceed = confirm(
        `Warning: Opening balance (${fmt(Number(dpOpening))}) does not match previous day's closing balance (${fmt(prevDay.closing_balance)} on ${formatDateUK(prevDay.position_date)}).\n\nSave anyway?`
      );
      if (!proceed) return;
    }

    setSaving(true);
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
    return <p style={{ color: SLATE, fontSize: "17px" }}>Loading finance data…</p>;
  }

  const latestPosition = positions[0] || null;

  return (
    <div>
      {msg && (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderLeft: `4px solid ${msg.startsWith("Error") ? RED : GREEN}`,
            borderRadius: "6px",
            padding: "10px 14px",
            marginBottom: "14px",
            backgroundColor: "white",
            fontSize: "17px",
            color: NAVY,
          }}
        >
          {msg}
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
          onEdit={openOpeningModal}
        />
        <SummaryCard
          label="Planned Receivables"
          value={plan ? `PKR ${fmt(plan.tentative_receivables)}` : "Not set"}
          sub={plan ? formatMonthUK(plan.plan_month) : "Click edit to set"}
          color={GREEN}
          onEdit={openPlanModal}
        />
        <SummaryCard
          label="Planned Payouts"
          value={plan ? `PKR ${fmt(plan.tentative_payouts)}` : "Not set"}
          sub={plan ? formatMonthUK(plan.plan_month) : "Click edit to set"}
          color={RED}
          onEdit={openPlanModal}
        />
        <SummaryCard
          label="Latest Closing"
          value={latestPosition ? `PKR ${fmt(latestPosition.closing_balance)}` : "—"}
          sub={latestPosition ? formatDateUK(latestPosition.position_date) : "No entries yet"}
          color={NAVY}
        />
      </div>

      {/* ── GMAIL CONNECTION ── */}
      <SectionTitle title="Automatic Ingestion" />
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: "8px",
          padding: "12px 16px",
          backgroundColor: "white",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div>
          <div style={{ fontSize: "17px", fontWeight: 700, color: NAVY }}>
            Gmail: {gmailConnected ? (
              <span style={{ color: GREEN }}>Connected</span>
            ) : (
              <span style={{ color: SLATE }}>Not connected</span>
            )}
          </div>
          <div style={{ fontSize: "15px", color: SLATE, marginTop: "2px" }}>
            {gmailConnected
              ? "Daily cash flow and bank position PDFs are ingested automatically from your cockpit-cash Gmail label every 2 minutes."
              : "Connect your Gmail to automatically ingest daily cash statements. You'll need a Gmail label called 'cockpit-cash'."
            }
          </div>
        </div>
        <a
          href="/api/google/auth"
          style={{
            ...btnStyle,
            textDecoration: "none",
            display: "inline-block",
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {gmailConnected ? "Add Another Account" : "Connect Gmail"}
        </a>
      </div>

      {/* ── PDF UPLOAD ── */}
      <SectionTitle title="Upload Daily Statement PDFs" />
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: "8px",
          padding: "16px",
          backgroundColor: "white",
          marginBottom: "16px",
        }}
      >
        <p style={{ fontSize: "16px", color: SLATE, marginBottom: "12px" }}>
          Upload the daily Cash Flow and Bank Position PDFs from the accountant. The system will extract the figures, check they balance, and save automatically.
        </p>
        <form onSubmit={handlePDFUpload}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
            <label style={labelStyle}>
              Cash Flow PDF
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setCashFlowFile(e.target.files?.[0] || null)}
                style={{ ...inputStyle, padding: "6px 8px" }}
              />
            </label>
            <label style={labelStyle}>
              Bank Position PDF
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setBankPositionFile(e.target.files?.[0] || null)}
                style={{ ...inputStyle, padding: "6px 8px" }}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={uploading || !cashFlowFile || !bankPositionFile}
            style={{
              ...btnStyle,
              opacity: uploading || !cashFlowFile || !bankPositionFile ? 0.5 : 1,
            }}
          >
            {uploading ? "Parsing…" : "Upload & Parse"}
          </button>
        </form>

        {uploadResult && (
          <div
            style={{
              marginTop: "12px",
              padding: "10px 14px",
              borderRadius: "6px",
              border: `1px solid ${BORDER}`,
              borderLeft: `4px solid ${uploadResult.reconciliation?.matches ? GREEN : RED}`,
              backgroundColor: "#fafbfc",
              fontSize: "16px",
            }}
          >
            {uploadResult.success ? (
              <>
                <div style={{ fontWeight: 700, color: NAVY, marginBottom: "6px" }}>
                  {uploadResult.reconciliation?.matches
                    ? "Balanced — statements match"
                    : "Mismatch — statements do NOT balance"
                  }
                </div>
                <div style={{ color: SLATE }}>
                  Date: {uploadResult.date} &nbsp;|&nbsp;
                  Cash Flow Closing: {uploadResult.reconciliation?.cashFlowClosing?.toLocaleString()} &nbsp;|&nbsp;
                  Bank Total: {uploadResult.reconciliation?.bankPositionTotal?.toLocaleString()}
                  {!uploadResult.reconciliation?.matches && (
                    <span style={{ color: RED, fontWeight: 700 }}>
                      &nbsp;|&nbsp; Difference: {uploadResult.reconciliation?.diff?.toLocaleString()}
                    </span>
                  )}
                </div>
                {(() => {
                  if (!uploadResult.cashFlow || !uploadResult.date) return null;
                  const prevDay = positions.find((p) => p.position_date < uploadResult.date!);
                  const opening = (uploadResult.cashFlow as Record<string, number>).openingBalance;
                  if (prevDay && opening && Math.abs(opening - prevDay.closing_balance) > 0.01) {
                    return (
                      <div style={{ color: RED, fontWeight: 700, marginTop: "6px", fontSize: "15px" }}>
                        ⚠ Opening balance ({opening.toLocaleString()}) does not match previous day closing ({prevDay.closing_balance.toLocaleString()} on {formatDateUK(prevDay.position_date)})
                      </div>
                    );
                  }
                  return null;
                })()}
              </>
            ) : (
              <div style={{ color: RED, fontWeight: 600 }}>{uploadResult.error}</div>
            )}
          </div>
        )}
      </div>

      {/* ── CASH FLOW FORECAST ── */}
      <SectionTitle title="Cash Flow Forecast" />
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: "8px",
          padding: "16px",
          backgroundColor: "white",
          marginBottom: "16px",
        }}
      >
        {/* Tab buttons */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
          <button
            onClick={() => setShowManualForecast(false)}
            style={{
              ...btnStyle,
              backgroundColor: !showManualForecast ? NAVY : "white",
              color: !showManualForecast ? "white" : NAVY,
              border: `1px solid ${!showManualForecast ? NAVY : BORDER}`,
              fontSize: "15px",
              padding: "7px 14px",
              marginTop: 0,
            }}
          >
            Upload Excel
          </button>
          <button
            onClick={() => setShowManualForecast(true)}
            style={{
              ...btnStyle,
              backgroundColor: showManualForecast ? NAVY : "white",
              color: showManualForecast ? "white" : NAVY,
              border: `1px solid ${showManualForecast ? NAVY : BORDER}`,
              fontSize: "15px",
              padding: "7px 14px",
              marginTop: 0,
            }}
          >
            Manual Entry
          </button>
        </div>

        {!showManualForecast ? (
          <>
            <p style={{ fontSize: "16px", color: SLATE, marginBottom: "12px" }}>
              Upload the projected cash flow Excel. The system reads the &quot;Monthly-CF&quot; sheet and saves monthly budgets by category (inflows and outflows).
            </p>

            {/* Template info */}
            <div style={{
              border: `1px solid ${BORDER}`,
              borderRadius: "6px",
              padding: "12px 14px",
              backgroundColor: "#f8fafc",
              marginBottom: "14px",
              fontSize: "15px",
              color: NAVY,
            }}>
              <div style={{ fontWeight: 700, marginBottom: "6px" }}>Excel Template Format:</div>
              <div style={{ color: SLATE, lineHeight: 1.6 }}>
                <div>Sheet name: <strong>Monthly-CF</strong> (or first sheet)</div>
                <div>Row 1: Header row with month dates (Excel serial format, e.g. Jan 2026, Feb 2026...)</div>
                <div>Column A: Category names (e.g. &quot;Sales Revenue&quot;, &quot;Rent&quot;, &quot;Salaries&quot;)</div>
                <div>Section markers: Rows labelled &quot;CASH INFLOW&quot; and &quot;CASH OUTFLOW&quot; to separate inflows from outflows</div>
                <div>Values: Monthly budgeted amounts in each cell</div>
                <div style={{ marginTop: "6px", fontStyle: "italic" }}>Rows labelled TOTAL, CLOSING, or OPENING BALANCE are skipped automatically.</div>
              </div>
              <div style={{ marginTop: "10px" }}>
                <a
                  href="/cash-flow-forecast-template.xlsx"
                  download
                  style={{ fontSize: "15px", fontWeight: 600, color: BLUE, textDecoration: "underline" }}
                >
                  Download Template (.xlsx)
                </a>
              </div>
            </div>

            <form onSubmit={handleForecastUpload}>
              <label style={labelStyle}>
                Cash Flow Forecast Excel (.xlsx)
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setForecastFile(e.target.files?.[0] || null)}
                  style={{ ...inputStyle, padding: "6px 8px" }}
                />
              </label>
              <button
                type="submit"
                disabled={forecastUploading || !forecastFile}
                style={{
                  ...btnStyle,
                  opacity: forecastUploading || !forecastFile ? 0.5 : 1,
                }}
              >
                {forecastUploading ? "Parsing…" : "Upload & Parse Forecast"}
              </button>
            </form>

            {forecastResult && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "10px 14px",
                  borderRadius: "6px",
                  border: `1px solid ${BORDER}`,
                  borderLeft: `4px solid ${forecastResult.success ? GREEN : RED}`,
                  backgroundColor: "#fafbfc",
                  fontSize: "16px",
                }}
              >
                {forecastResult.success ? (
                  <div style={{ color: NAVY }}>
                    <span style={{ fontWeight: 700 }}>Saved</span> — {forecastResult.categories} categories across {forecastResult.months?.join(", ")} ({forecastResult.totalRows} rows)
                  </div>
                ) : (
                  <div style={{ color: RED, fontWeight: 600 }}>{forecastResult.error}</div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: "16px", color: SLATE, marginBottom: "12px" }}>
              Add a single forecast line manually. Use this to add or update individual budget items without uploading a full spreadsheet.
            </p>
            <form onSubmit={saveManualForecast}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                <label style={labelStyle}>
                  Category
                  <input
                    type="text"
                    value={mfCategory}
                    onChange={(e) => setMfCategory(e.target.value)}
                    placeholder="e.g. Sales Revenue, Rent, Salaries"
                    style={inputStyle}
                    required
                  />
                </label>
                <label style={labelStyle}>
                  Type
                  <select
                    value={mfFlowType}
                    onChange={(e) => setMfFlowType(e.target.value as "inflow" | "outflow")}
                    style={inputStyle}
                  >
                    <option value="inflow">Inflow (money in)</option>
                    <option value="outflow">Outflow (money out)</option>
                  </select>
                </label>
                <label style={labelStyle}>
                  Month
                  <input
                    type="month"
                    value={mfMonth}
                    onChange={(e) => setMfMonth(e.target.value)}
                    style={inputStyle}
                    required
                  />
                </label>
                <label style={labelStyle}>
                  Budgeted Amount (PKR)
                  <input
                    type="number"
                    value={mfAmount}
                    onChange={(e) => setMfAmount(e.target.value)}
                    placeholder="0"
                    style={inputStyle}
                    required
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={mfSaving}
                style={{ ...btnStyle, opacity: mfSaving ? 0.5 : 1 }}
              >
                {mfSaving ? "Saving…" : "Save Forecast Entry"}
              </button>
            </form>
          </>
        )}
      </div>

      {/* ── DAILY POSITION: FORM + TABLE ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(280px, 1fr) minmax(0, 2fr)",
          gap: "16px",
          alignItems: "stretch",
          marginTop: "16px",
        }}
      >
        {/* LEFT — Daily entry form */}
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: "8px",
            padding: "16px",
            backgroundColor: "white",
          }}
        >
          <SectionTitle title="Record Daily Position" />
          <p style={{ fontSize: "16px", color: SLATE, marginTop: "-4px", marginBottom: "12px" }}>
            Enter today's figures from the accountant's statement.
          </p>
          <form onSubmit={saveDailyPosition}>
            <label style={labelStyle}>
              Date
              <input
                type="date"
                value={dpDate}
                onChange={(e) => setDpDate(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
              <label style={labelStyle}>
                Opening (PKR)
                <input
                  type="number"
                  value={dpOpening}
                  onChange={(e) => setDpOpening(e.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Closing (PKR)
                <input
                  type="number"
                  value={dpClosing}
                  onChange={(e) => setDpClosing(e.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Receipts (PKR)
                <input
                  type="number"
                  min="0"
                  value={dpReceipts}
                  onChange={(e) => setDpReceipts(e.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Payments (PKR)
                <input
                  type="number"
                  min="0"
                  value={dpPayments}
                  onChange={(e) => setDpPayments(e.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
              </label>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                Post-dated total (PKR)
                <input
                  type="number"
                  min="0"
                  value={dpPostDated}
                  onChange={(e) => setDpPostDated(e.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
              </label>
            </div>
            <button type="submit" disabled={saving} style={btnStyle}>
              {saving ? "Saving…" : "Save Daily Position"}
            </button>
          </form>
        </div>

        {/* RIGHT — History table */}
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: "8px",
            padding: "16px",
            backgroundColor: "white",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <SectionTitle title="Daily Position — Last 30 Days" />
          {positions.length === 0 ? (
            <p style={{ fontSize: "17px", color: SLATE }}>
              No daily positions recorded yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto", flex: 1 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  minWidth: "0",
                }}
              >
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
                    const mismatch = prevDay && Math.abs(p.opening_balance - prevDay.closing_balance) > 0.01;
                    return (
                      <tr key={p.id} style={mismatch ? { backgroundColor: "#fef2f2" } : undefined}>
                        <td style={tdBold}>
                          {formatDateUK(p.position_date)}
                          {mismatch && (
                            <div style={{ fontSize: "12px", color: RED, fontWeight: 700, marginTop: "2px" }}>
                              ⚠ Opening does not match previous closing ({fmt(prevDay.closing_balance)})
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
                        <td style={{ ...td, fontWeight: 700 }}>
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
          <p style={{ fontSize: "16px", color: SLATE, marginBottom: "12px" }}>
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
          <p style={{ fontSize: "16px", color: SLATE, marginBottom: "12px" }}>
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
      <div
        style={{
          color: SLATE,
          fontSize: "15px",
          marginBottom: "4px",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "17px", fontWeight: 800, color }}>{value}</div>
      {sub && (
        <div style={{ fontSize: "14px", color: SLATE, marginTop: "3px" }}>
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
          <h2 style={{ fontSize: "17px", fontWeight: 700, color: NAVY, margin: 0 }}>
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
  fontSize: "16px",
  fontWeight: 600,
  color: NAVY,
  marginBottom: "10px",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  fontSize: "17px",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "9px 18px",
  fontSize: "17px",
  fontWeight: 700,
  cursor: "pointer",
  marginTop: "4px",
};

const cancelBtnStyle: React.CSSProperties = {
  backgroundColor: "white",
  color: NAVY,
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  padding: "9px 18px",
  fontSize: "17px",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "4px",
};

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "6px 10px",
  fontSize: "15px",
  color: SLATE,
  fontWeight: 700,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "7px 10px",
  fontSize: "16px",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};