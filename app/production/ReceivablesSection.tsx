"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { logAction } from "../lib/audit-log";

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

const inputStyle = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  marginBottom: "10px",
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  fontSize: "17px",
};

const sectionStyle = {
  border: `1px solid ${BORDER}`,
  borderRadius: "8px",
  padding: "14px",
  marginBottom: "14px",
  backgroundColor: "white",
};

const hint = { fontSize: "16px", color: SLATE, marginBottom: "10px" };

const h3 = {
  fontSize: "17px",
  fontWeight: 700 as const,
  color: NAVY,
  marginBottom: "4px",
  paddingLeft: "9px",
  borderLeft: `3px solid ${NAVY}`,
};

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
    logAction("Created", "receivables", `Bill: ${customer} ${amount} PKR`);
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
    logAction("Updated", "receivables", "Bill marked as collected", bill.id);
    setMsg("Bill marked as collected ✓");
    loadData();
  }

  const th: React.CSSProperties = {
    textAlign: "left",
    borderBottom: `1px solid ${BORDER}`,
    padding: "6px 8px",
    fontSize: "15px",
    color: SLATE,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };

  const td: React.CSSProperties = {
    borderBottom: `1px solid #f1f5f9`,
    padding: "6px 8px",
    fontSize: "16px",
    verticalAlign: "middle",
  };

  return (
    <div style={sectionStyle}>
      <h3 style={h3}>Receivables (bills) for this plant</h3>
      <p style={hint}>
        Add a bill (Invoice + IC + GRN) on the left, then track every open bill in the table below.
        A bill turns amber on its final budgeted day and red once it is over its stage time. Red
        bills escalate to the executive dashboard and create a task for the Trading Ops owner.
      </p>

      {msg && (
        <p
          style={{
            color: msg.startsWith("Error") ? "#c0392b" : "#16a34a",
            fontWeight: 700,
            fontSize: "17px",
          }}
        >
          {msg}
        </p>
      )}

      {/* Two areas side by side: compact add-form (left) + tracking table (right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "16px",
          alignItems: "start",
        }}
      >
        {/* LEFT: add a new bill */}
        <div style={{ borderRight: `1px solid ${BORDER}`, paddingRight: "16px" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "8px" }}>
            Add a new bill
          </div>
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
              <div style={{ fontSize: "15px", color: SLATE }}>Customer</div>
              <div style={{ fontSize: "17px", fontWeight: 700, color: NAVY }}>{customers[0]}</div>
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
              fontSize: "17px",
              cursor: "pointer",
              fontWeight: 700,
              marginTop: "4px",
            }}
          >
            {saving ? "Adding…" : "Add Bill"}
          </button>
        </div>

        {/* RIGHT: tracking table */}
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "8px" }}>
            Open bills ({bills.length})
          </div>
          {loading ? (
            <p style={{ color: SLATE, fontSize: "17px" }}>Loading receivables…</p>
          ) : bills.length === 0 ? (
            <p style={{ color: SLATE, fontSize: "17px" }}>No open bills for this plant yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Customer</th>
                    <th style={th}>Amount</th>
                    <th style={th}>Invoice / IC / GRN</th>
                    <th style={th}>Stage</th>
                    <th style={th}>Days</th>
                    <th style={th}>Status</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill) => {
                    const st = billStatus(bill);
                    const elapsed = workingDaysSince(bill.current_stage_entered_date);
                    const budget = stageBudget(bill.current_stage_order);
                    return (
                      <tr key={bill.id}>
                        <td style={{ ...td, fontWeight: 700, color: NAVY }}>{bill.utility}</td>
                        <td style={td}>
                          {fmtMoney(bill.amount)} {bill.currency}
                        </td>
                        <td style={{ ...td, color: SLATE }}>
                          {bill.invoice_ref || "—"} / {bill.ic_ref || "—"} / {bill.grn_ref || "—"}
                        </td>
                        <td style={td}>
                          <select
                            value={bill.current_stage_order}
                            onChange={(e) => moveStage(bill, Number(e.target.value))}
                            style={{
                              padding: "4px 6px",
                              border: `1px solid ${BORDER}`,
                              borderRadius: "6px",
                              fontSize: "16px",
                              minWidth: "150px",
                            }}
                          >
                            {stages.map((s) => (
                              <option key={s.id} value={s.stage_order}>
                                {s.stage_order}. {s.stage_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {elapsed} / {budget}
                        </td>
                        <td style={{ ...td, color: statusColor[st], fontWeight: 700 }}>
                          {st.toUpperCase()}
                        </td>
                        <td style={td}>
                          <button
                            onClick={() => markCollected(bill)}
                            style={{
                              backgroundColor: "#16a34a",
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              padding: "5px 10px",
                              fontSize: "16px",
                              cursor: "pointer",
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                            }}
                          >
                            Collected
                          </button>
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
    </div>
  );
}
