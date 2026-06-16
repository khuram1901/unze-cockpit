"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

type Stage = {
  id: string;
  stage_order: number;
  stage_name: string;
  working_day_budget: number;
};

type Receivable = {
  id: string;
  utility: string;
  plant_id: string;
  invoice_ref: string | null;
  ic_ref: string | null;
  grn_ref: string | null;
  amount: number;
  currency: string;
  date_submitted: string;
  current_stage_order: number;
  current_stage_entered_date: string;
  status: string;
  received_date: string | null;
  notes: string | null;
};

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

// Per-plant customer list. First entry is the default.
// Plants not listed here fall back to using the plant name itself.
const PLANT_CUSTOMERS: Record<string, string[]> = {
  FIEDMC: ["FESCO", "GEPCO", "LESCO"],
  MEPCO: ["MEPCO"],
  PESCO: ["PESCO"],
  "Smart Meter Plant": ["Meters"],
};

function customersForPlant(plantName: string): string[] {
  return PLANT_CUSTOMERS[plantName] || [plantName];
}

// Count working days (Mon–Fri) elapsed in the current stage.
function workingDaysSince(dateStr: string): number {
  const start = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (start > today) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= today) {
    const day = cur.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(0, count - 1);
}

function fmtMoney(n: number) {
  return n.toLocaleString();
}

export default function ReceivablesSection({
  plantId,
  plantName,
}: {
  plantId: string;
  plantName: string;
}) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [bills, setBills] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const customers = customersForPlant(plantName);

  // new bill form
  const [customer, setCustomer] = useState(customers[0]);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [icRef, setIcRef] = useState("");
  const [grnRef, setGrnRef] = useState("");
  const [amount, setAmount] = useState("");
  const [dateSubmitted, setDateSubmitted] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    const [stagesRes, billsRes] = await Promise.all([
      supabase.from("receivable_stages").select("*").order("stage_order"),
      supabase
        .from("receivables")
        .select("*")
        .eq("plant_id", plantId)
        .neq("status", "Collected")
        .order("date_submitted", { ascending: false }),
    ]);
    setStages(stagesRes.data || []);
    setBills(billsRes.data || []);
    setLoading(false);
  }, [plantId]);

  useEffect(() => {
    setCustomer(customersForPlant(plantName)[0]);
    loadData();
  }, [plantId, plantName, loadData]);

  function stageName(order: number) {
    return stages.find((s) => s.stage_order === order)?.stage_name || `Stage ${order}`;
  }

  function stageBudget(order: number) {
    return stages.find((s) => s.stage_order === order)?.working_day_budget || 0;
  }

  function billStatus(bill: Receivable): "green" | "amber" | "red" {
    const budget = stageBudget(bill.current_stage_order);
    const elapsed = workingDaysSince(bill.current_stage_entered_date);
    if (budget <= 0) return "green";
    if (elapsed >= budget) return "red";
    if (elapsed >= budget - 1) return "amber";
    return "green";
  }

  const statusColor = { green: "#16a34a", amber: "#d97706", red: "#dc2626" };

  async function addBill() {
    setMsg("");
    if (!amount) {
      setMsg("Enter the bill amount.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("receivables").insert({
      utility: customer,
      plant_id: plantId,
      invoice_ref: invoiceRef || null,
      ic_ref: icRef || null,
      grn_ref: grnRef || null,
      amount: Number(amount),
      currency: "PKR",
      date_submitted: dateSubmitted,
      current_stage_order: 1,
      current_stage_entered_date: dateSubmitted,
      status: "In Progress",
    });
    setSaving(false);
    if (error) {
      setMsg("Error: " + error.message);
      return;
    }
    setMsg("Bill added ✓");
    setInvoiceRef("");
    setIcRef("");
    setGrnRef("");
    setAmount("");
    loadData();
  }

  async function moveStage(bill: Receivable, newOrder: number) {
    setMsg("");
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("receivables")
      .update({
        current_stage_order: newOrder,
        current_stage_entered_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bill.id);
    if (error) {
      setMsg("Error: " + error.message);
      return;
    }
    loadData();
  }

  async function markCollected(bill: Receivable) {
    setMsg("");
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("receivables")
      .update({
        status: "Collected",
        received_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bill.id);
    if (error) {
      setMsg("Error: " + error.message);
      return;
    }
    setMsg("Bill marked as collected ✓");
    loadData();
  }

  const inputStyle = {
    display: "block",
    width: "100%",
    padding: "7px 9px",
    marginTop: "3px",
    marginBottom: "10px",
    border: `1px solid ${BORDER}`,
    borderRadius: "6px",
    fontSize: "13px",
  };
  const sectionStyle = {
    border: `1px solid ${BORDER}`,
    borderRadius: "8px",
    padding: "14px",
    marginBottom: "14px",
    backgroundColor: "white",
  };
  const hint = { fontSize: "12px", color: SLATE, marginBottom: "10px" };
  const h3 = { fontSize: "13px", fontWeight: 700 as const, color: NAVY, marginBottom: "4px", paddingLeft: "9px", borderLeft: `3px solid ${NAVY}` };

  if (loading) return <div style={sectionStyle}>Loading receivables…</div>;

  return (
    <div style={sectionStyle}>
      <h3 style={h3}>Receivables (bills) for this plant</h3>
      <p style={hint}>
        Add a bill (Invoice + IC + GRN) and move it through the stages. A bill turns amber on its
        final budgeted day and red once it is over its stage time. Red bills escalate to the
        executive dashboard and create a task for the Trading Ops owner.
      </p>

      {msg && (
        <p
          style={{
            color: msg.startsWith("Error") ? "#c0392b" : "#16a34a",
            fontWeight: 700,
            fontSize: "13px",
          }}
        >
          {msg}
        </p>
      )}

      {/* Existing bills — flow into columns across the page */}
      {bills.length === 0 ? (
        <p style={{ color: SLATE, fontSize: "13px", marginBottom: "14px" }}>
          No open bills for this plant yet.
        </p>
      ) : (
        <div
                  <div style={{ marginBottom: "14px" }}>

          {bills.map((bill) => {
            const st = billStatus(bill);
            const elapsed = workingDaysSince(bill.current_stage_entered_date);
            const budget = stageBudget(bill.current_stage_order);
            return (
              <div
                key={bill.id}
                style={{
                  border: `1px solid ${BORDER}`,
                  borderLeft: `5px solid ${statusColor[st]}`,
                  borderRadius: "8px",
                  padding: "12px",
                  backgroundColor: "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
                  <div style={{ fontWeight: 700, fontSize: "13px", color: NAVY }}>
                    {bill.utility} — {fmtMoney(bill.amount)} {bill.currency}
                  </div>
                  <div style={{ color: statusColor[st], fontWeight: 700, fontSize: "12px" }}>
                    {st.toUpperCase()}
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: SLATE, marginTop: "4px" }}>
                  Invoice: {bill.invoice_ref || "—"} | IC: {bill.ic_ref || "—"} | GRN:{" "}
                  {bill.grn_ref || "—"}
                </div>
                <div style={{ fontSize: "12px", color: SLATE, marginTop: "4px" }}>
                  Stage {bill.current_stage_order}: <strong>{stageName(bill.current_stage_order)}</strong>{" "}
                  — {elapsed} of {budget} working day(s) used
                </div>
                <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <select
                    value={bill.current_stage_order}
                    onChange={(e) => moveStage(bill, Number(e.target.value))}
                    style={{
                      padding: "6px 8px",
                      border: `1px solid ${BORDER}`,
                      borderRadius: "6px",
                      fontSize: "12px",
                      flex: 1,
                      minWidth: "180px",
                    }}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.stage_order}>
                        {s.stage_order}. {s.stage_name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => markCollected(bill)}
                    style={{
                      backgroundColor: "#16a34a",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Mark Collected
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new bill — compact two-column block */}
      <h3 style={{ ...h3, marginTop: "10px" }}>Add a new bill</h3>
            <div>
        {customers.length > 1 ? (
          <label>
            Customer
            <select
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              style={inputStyle}
            >
              {customers.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        ) : (
          <div style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: SLATE }}>Customer</div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: NAVY }}>{customers[0]}</div>
          </div>
        )}
        <label>
          Invoice reference
          <input
            type="text"
            style={inputStyle}
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Invoice no."
          />
        </label>
        <label>
          IC reference (optional)
          <input
            type="text"
            style={inputStyle}
            value={icRef}
            onChange={(e) => setIcRef(e.target.value)}
            placeholder="Inspection Certificate no."
          />
        </label>
        <label>
          GRN reference (optional)
          <input
            type="text"
            style={inputStyle}
            value={grnRef}
            onChange={(e) => setGrnRef(e.target.value)}
            placeholder="Goods Receive Note no."
          />
        </label>
        <label>
          Amount (PKR)
          <input
            type="number"
            min="0"
            style={inputStyle}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          Date submitted
          <input
            type="date"
            style={inputStyle}
            value={dateSubmitted}
            onChange={(e) => setDateSubmitted(e.target.value)}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={addBill}
        disabled={saving}
        style={{
          backgroundColor: NAVY,
          color: "white",
          border: "none",
          borderRadius: "6px",
          padding: "8px 18px",
          fontSize: "13px",
          cursor: "pointer",
          fontWeight: 700,
          marginTop: "4px",
        }}
      >
        {saving ? "Adding…" : "Add Bill"}
      </button>
    </div>
  );
}
