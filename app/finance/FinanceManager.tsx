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

function fmt(n: number) {
  return n.toLocaleString();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function FinanceManager() {
  const [loading, setLoading] = useState(true);

  const [opening, setOpening] = useState<OpeningBalance | null>(null);
  const [plan, setPlan] = useState<MonthlyPlan | null>(null);
  const [positions, setPositions] = useState<DailyPosition[]>([]);

  // one-off opening balance form
  const [obDate, setObDate] = useState(todayStr());
  const [obAmount, setObAmount] = useState("");

  // monthly plan form
  const [planMonth, setPlanMonth] = useState(currentMonth());
  const [planRecv, setPlanRecv] = useState("");
  const [planPay, setPlanPay] = useState("");

  // daily position form
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
      supabase.from("cash_opening_balance").select("*").order("as_of_date", { ascending: true }).limit(1),
      supabase.from("monthly_cash_plan").select("*").eq("plan_month", currentMonth()).maybeSingle(),
      supabase.from("daily_cash_position").select("*").order("position_date", { ascending: false }).limit(30),
    ]);

    setOpening(obRes.data && obRes.data.length > 0 ? obRes.data[0] : null);
    setPlan(planRes.data || null);
    setPositions(posRes.data || []);

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function saveOpeningBalance(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!obAmount) {
      setMsg("Enter an opening amount.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("cash_opening_balance").insert({
      as_of_date: obDate,
      opening_amount: Number(obAmount),
      currency: "PKR",
    });
    setSaving(false);
    if (error) {
      setMsg("Error: " + error.message);
      return;
    }
    setMsg("Opening balance saved ✓");
    loadData();
  }

  async function saveMonthlyPlan(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setSaving(true);
    // upsert by plan_month (unique)
    const { error } = await supabase.from("monthly_cash_plan").upsert(
      {
        plan_month: planMonth,
        tentative_receivables: Number(planRecv || 0),
        tentative_payouts: Number(planPay || 0),
        currency: "PKR",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "plan_month" }
    );
    setSaving(false);
    if (error) {
      setMsg("Error: " + error.message);
      return;
    }
    setMsg("Monthly plan saved ✓");
    setPlanRecv("");
    setPlanPay("");
    loadData();
  }

  async function saveDailyPosition(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setSaving(true);
    const closing = Number(dpClosing || 0);
    const postDated = Number(dpPostDated || 0);
    const { error } = await supabase.from("daily_cash_position").upsert(
      {
        position_date: dpDate,
        opening_balance: Number(dpOpening || 0),
        total_receipts: Number(dpReceipts || 0),
        total_payments: Number(dpPayments || 0),
        closing_balance: closing,
        post_dated_total: postDated,
        closing_after_post_dated: closing - postDated,
        currency: "PKR",
        source: "manual",
      },
      { onConflict: "position_date" }
    );
    setSaving(false);
    if (error) {
      setMsg("Error: " + error.message);
      return;
    }
    setMsg("Daily cash position saved ✓");
    setDpOpening("");
    setDpReceipts("");
    setDpPayments("");
    setDpClosing("");
    setDpPostDated("");
    loadData();
  }

  // ---- Month-to-date tracking vs plan ----
  const monthPositions = positions.filter((p) => p.position_date.slice(0, 7) === currentMonth());
  const actualReceiptsMTD = monthPositions.reduce((s, p) => s + p.total_receipts, 0);
  const actualPaymentsMTD = monthPositions.reduce((s, p) => s + p.total_payments, 0);
  const latestPosition = positions[0] || null;

  const plannedRecv = plan?.tentative_receivables || 0;
  const plannedPay = plan?.tentative_payouts || 0;

  const recvBehind = plannedRecv > 0 && actualReceiptsMTD < plannedRecv;
  const payOver = plannedPay > 0 && actualPaymentsMTD > plannedPay;

  // Headline: are we trending below where two-numbers say we should be?
  const openingForMonth = opening?.opening_amount || 0;
  const projectedClosing = openingForMonth + plannedRecv - plannedPay;
  const actualSoFar = (latestPosition?.closing_balance ?? openingForMonth);
  const headlineRed = recvBehind || payOver;

  const cardStyle = {
    border: "1px solid #e0e0e0",
    borderRadius: "10px",
    padding: "20px",
    marginBottom: "24px",
    maxWidth: "900px",
  };
  const inputStyle = {
    padding: "8px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "14px",
    marginRight: "8px",
    marginBottom: "8px",
  };
  const btnStyle = {
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "6px",
    padding: "9px 18px",
    fontSize: "14px",
    cursor: "pointer",
  };

  if (loading) return <p>Loading finance…</p>;

  return (
    <div>
      {msg && (
        <p style={{ color: msg.startsWith("Error") ? "#c0392b" : "#16a34a", fontWeight: "bold" }}>
          {msg}
        </p>
      )}

      {/* ---- CASH HEALTH SUMMARY ---- */}
      <div
        style={{
          ...cardStyle,
          borderTop: `4px solid ${headlineRed ? "#dc2626" : "#16a34a"}`,
        }}
      >
        <h2 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "12px" }}>
          This Month ({currentMonth()}) — Cash Health:{" "}
          <span style={{ color: headlineRed ? "#dc2626" : "#16a34a" }}>
            {headlineRed ? "ATTENTION" : "ON TRACK"}
          </span>
        </h2>
        <div style={{ display: "flex", gap: "30px", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#666", fontSize: "13px" }}>Money In (actual / plan)</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: recvBehind ? "#dc2626" : "#16a34a" }}>
              {fmt(actualReceiptsMTD)} / {fmt(plannedRecv)}
            </div>
          </div>
          <div>
            <div style={{ color: "#666", fontSize: "13px" }}>Money Out (actual / plan)</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: payOver ? "#dc2626" : "#16a34a" }}>
              {fmt(actualPaymentsMTD)} / {fmt(plannedPay)}
            </div>
          </div>
          <div>
            <div style={{ color: "#666", fontSize: "13px" }}>Latest Closing Balance</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#0070f3" }}>
              {fmt(actualSoFar)}
            </div>
          </div>
          <div>
            <div style={{ color: "#666", fontSize: "13px" }}>Projected Month-End</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#555" }}>
              {fmt(projectedClosing)}
            </div>
          </div>
        </div>
      </div>

      {/* ---- ONE-OFF OPENING BALANCE ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px" }}>
          Opening Balance (one-off)
        </h2>
        {opening ? (
          <p style={{ color: "#555" }}>
            Set to <strong>{fmt(opening.opening_amount)}</strong> as of{" "}
            <strong>{opening.as_of_date}</strong>. This is locked — the balance now carries forward
            automatically.
          </p>
        ) : (
          <form onSubmit={saveOpeningBalance}>
            <input
              type="date"
              value={obDate}
              onChange={(e) => setObDate(e.target.value)}
              style={inputStyle}
            />
            <input
              type="number"
              placeholder="Opening amount"
              value={obAmount}
              onChange={(e) => setObAmount(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" disabled={saving} style={btnStyle}>
              {saving ? "Saving…" : "Set Opening Balance"}
            </button>
          </form>
        )}
      </div>

      {/* ---- MONTHLY PLAN ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px" }}>
          Monthly Plan — Expected Receivables &amp; Payouts
        </h2>
        {plan && (
          <p style={{ color: "#555", marginBottom: "10px" }}>
            Current ({plan.plan_month}): expected in <strong>{fmt(plan.tentative_receivables)}</strong>,
            expected out <strong>{fmt(plan.tentative_payouts)}</strong>. Re-submit to update.
          </p>
        )}
        <form onSubmit={saveMonthlyPlan}>
          <input
            type="month"
            value={planMonth}
            onChange={(e) => setPlanMonth(e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            placeholder="Tentative receivables (in)"
            value={planRecv}
            onChange={(e) => setPlanRecv(e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            placeholder="Tentative payouts (out)"
            value={planPay}
            onChange={(e) => setPlanPay(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={saving} style={btnStyle}>
            {saving ? "Saving…" : "Save Monthly Plan"}
          </button>
        </form>
      </div>

      {/* ---- DAILY CASH POSITION ENTRY ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px" }}>
          Daily Cash Position (from accountant&apos;s statement)
        </h2>
        <form onSubmit={saveDailyPosition}>
          <input type="date" value={dpDate} onChange={(e) => setDpDate(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Opening" value={dpOpening} onChange={(e) => setDpOpening(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Receipts" value={dpReceipts} onChange={(e) => setDpReceipts(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Payments" value={dpPayments} onChange={(e) => setDpPayments(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Closing" value={dpClosing} onChange={(e) => setDpClosing(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Post-dated total" value={dpPostDated} onChange={(e) => setDpPostDated(e.target.value)} style={inputStyle} />
          <button type="submit" disabled={saving} style={btnStyle}>
            {saving ? "Saving…" : "Save Today's Cash"}
          </button>
        </form>
      </div>

      {/* ---- RECENT POSITIONS TABLE ---- */}
      <div style={{ ...cardStyle, maxWidth: "1100px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px" }}>
          Recent Daily Positions
        </h2>
        {positions.length === 0 ? (
          <p style={{ color: "#999" }}>No daily cash figures entered yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "700px" }}>
              <thead>
                <tr style={{ backgroundColor: "#fafafa" }}>
                  <th style={th}>Date</th>
                  <th style={th}>Opening</th>
                  <th style={th}>Receipts</th>
                  <th style={th}>Payments</th>
                  <th style={th}>Closing</th>
                  <th style={th}>Post-Dated</th>
                  <th style={th}>After Post-Dated</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>{p.position_date}</td>
                    <td style={td}>{fmt(p.opening_balance)}</td>
                    <td style={{ ...td, color: "#16a34a" }}>{fmt(p.total_receipts)}</td>
                    <td style={{ ...td, color: "#dc2626" }}>{fmt(p.total_payments)}</td>
                    <td style={{ ...td, fontWeight: "bold" }}>{fmt(p.closing_balance)}</td>
                    <td style={td}>{fmt(p.post_dated_total)}</td>
                    <td style={td}>{fmt(p.closing_after_post_dated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const th = {
  textAlign: "left" as const,
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "13px",
};
const td = {
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "13px",
};
