"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

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
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function formatDateUK(dateString: string | null) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
function formatMonthUK(monthString: string) {
  const [year, month] = monthString.split("-");
  return `${month}/${year}`;
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontSize: "13px",
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

export default function FinanceManager() {
  const [loading, setLoading] = useState(true);

  const [opening, setOpening] = useState<OpeningBalance | null>(null);
  const [plan, setPlan] = useState<MonthlyPlan | null>(null);
  const [positions, setPositions] = useState<DailyPosition[]>([]);

  // Which edit modal is open: null, 'opening', or 'plan'
  const [openModal, setOpenModal] = useState<null | "opening" | "plan">(null);

  // Opening balance form
  const [obDate, setObDate] = useState(todayStr());
  const [obAmount, setObAmount] = useState("");

  // Monthly plan form
  const [planMonth, setPlanMonth] = useState(currentMonth());
  const [planRecv, setPlanRecv] = useState("");
  const [planPay, setPlanPay] = useState("");

  // Daily position form (always visible)
  const [dpDate, setDpDate] = useState(todayStr());
  const [dpOpening, setDpOpening] = useState("");
  const [dpReceipts, setDpReceipts] = useState("");
  const [dpPayments, setDpPayments] = useState("");
  const [dpClosing, setDpClosing] = useState("");
  const [dpPostDated, setDpPostDated] = useState("");

  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    const [obRes, planRes, posRes] = await Promise.all([
      supabase
        .from("cash_opening_balance")
        .select("*")
        .order("as_of_date", { ascending: true })
        .limit(1),
      supabase
        .from("monthly_cash_plan")
        .select("*")
        .eq("plan_month", currentMonth())
        .maybeSingle(),
      supabase
        .from("daily_cash_position")
        .select("*")
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
      setObDate(todayStr());
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
      setPlanMonth(currentMonth());
      setPlanRecv("");
      setPlanPay("");
    }
    setOpenModal("plan");
  }

  async function saveOpeningBalance(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("cash_opening_balance").insert({
      as_of_date: obDate,
      opening_amount: Number(obAmount) || 0,
      currency: "PKR",
    });
    setSaving(false);
    if (error) {
      showMsg("Error: " + error.message);
      return;
    }
    showMsg("✅ Opening balance saved.");
    setOpenModal(null);
    loadData();
  }

  async function saveMonthlyPlan(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("monthly_cash_plan").upsert(
      {
        plan_month: planMonth,
        tentative_receivables: Number(planRecv) || 0,
        tentative_payouts: Number(planPay) || 0,
      },
      { onConflict: "plan_month" }
    );
    setSaving(false);
    if (error) {
      showMsg("Error: " + error.message);
      return;
    }
    showMsg("✅ Monthly plan saved.");
    setOpenModal(null);
    loadData();
  }

  async function saveDailyPosition(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const closingAfterPD = Number(dpClosing) - Number(dpPostDated);
    const { error } = await supabase.from("daily_cash_position").upsert(
      {
        position_date: dpDate,
        opening_balance: Number(dpOpening) || 0,
        total_receipts: Number(dpReceipts) || 0,
        total_payments: Number(dpPayments) || 0,
        closing_balance: Number(dpClosing) || 0,
        post_dated_total: Number(dpPostDated) || 0,
        closing_after_post_dated: closingAfterPD,
      },
      { onConflict: "position_date" }
    );
    setSaving(false);
    if (error) {
      showMsg("Error: " + error.message);
      return;
    }
    showMsg("✅ Daily position saved.");
    setDpOpening("");
    setDpReceipts("");
    setDpPayments("");
    setDpClosing("");
    setDpPostDated("");
    loadData();
  }

  if (loading) {
    return <p style={{ color: SLATE, fontSize: "13px" }}>Loading finance data…</p>;
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
            fontSize: "13px",
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

      {/* ── DAILY POSITION: FORM + TABLE ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 1fr) minmax(0, 2fr)",
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
          <p style={{ fontSize: "12px", color: SLATE, marginTop: "-4px", marginBottom: "12px" }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
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
            <p style={{ fontSize: "13px", color: SLATE }}>
              No daily positions recorded yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto", flex: 1 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  minWidth: "560px",
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
                  {positions.map((p) => (
                    <tr key={p.id}>
                      <td style={tdBold}>{formatDateUK(p.position_date)}</td>
                      <td style={td}>{fmt(p.opening_balance)}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── MODALS ── */}
      {openModal === "opening" && (
        <Modal title="Opening Balance" onClose={() => setOpenModal(null)}>
          <p style={{ fontSize: "12px", color: SLATE, marginBottom: "12px" }}>
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
          <p style={{ fontSize: "12px", color: SLATE, marginBottom: "12px" }}>
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
          fontSize: "11px",
          marginBottom: "4px",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "15px", fontWeight: 800, color }}>{value}</div>
      {sub && (
        <div style={{ fontSize: "10px", color: SLATE, marginTop: "3px" }}>
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
            fontSize: "10px",
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
          <h2 style={{ fontSize: "15px", fontWeight: 700, color: NAVY, margin: 0 }}>
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
  fontSize: "12px",
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
  fontSize: "13px",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "9px 18px",
  fontSize: "13px",
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
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "4px",
};

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "6px 10px",
  fontSize: "11px",
  color: SLATE,
  fontWeight: 700,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "7px 10px",
  fontSize: "12px",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};