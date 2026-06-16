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

const UTILITIES = ["PESCO", "MEPCO", "FESCO", "Meters"];

// Count working days (Mon–Fri) elapsed from a date up to today, inclusive of start.
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
  // days "in" the stage = working days from entry to today minus the entry day itself
  return Math.max(0, count - 1);
}

function bestUtilityForPlant(plantName: string): string {
  const n = (plantName || "").toUpperCase();
  if (n.includes("PESCO")) return "PESCO";
  if (n.includes("MEPCO")) return "MEPCO";
  if (n.includes("FESCO")) return "FESCO";
  if (n.includes("METER")) return "Meters";
  return "PESCO";
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

  // new bill form
  const [utility, setUtility] = useState("PESCO");
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
    setUtility(bestUtilityForPlant(plantName));
    loadData();
  }, [plantId, plantName, loadData]);

  function stageName(order: number) {
    return stages.find((s) => s.stage_order === order)?.stage_name || `Stage ${order}`;
  }

  function stageBudget(order: number) {
    return stages.find((s) => s.stage_order === order)?.working_day_budget || 0;
  }

  // green / amber / red for a bill based on working days in current stage
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
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("receivables").insert({
      utility,
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
    maxWidth: "300px",
    padding: "10px",
    marginTop: "4px",
    marginBottom: "14px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "15px",
  };
  const sectionStyle = {
    border: "1px solid #e0e0e0",
    borderRadius: "8px",
    padding: "20px",
    marginBottom: "20px",
  };
  const hint = { fontSize: "13px", color: "#888", marginBottom: "14px" };
  const h3 = { fontSize: "16px", fontWeight: "bold" as const, marginBottom: "4px" };

  if (loading) return <div style={sectionStyle}>Loading receivables…</div>;

  return (
    <div style={{ ...sectionStyle, maxWidth: "640px" }}>
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
            fontWeight: "bold",
            fontSize: "14px",
          }}
        >
          {msg}
        </p>
      )}

      {/* Existing bills */}
      {bills.length === 0 ? (
        <p style={{ color: "#999", fontSize: "14px" }}>No open bills for this plant yet.</p>
      ) : (
        <div style={{ marginBottom: "20px" }}>
          {bills.map((bill) => {
            const st = billStatus(bill);
            const elapsed = workingDaysSince(bill.current_stage_entered_date);
            const budget = stageBudget(bill.current_stage_order);
            return (
              <div
                key={bill.id}
                style={{
                  border: "1px solid #e0e0e0",
                  borderLeft: `5px solid ${statusColor[st]}`,
                  borderRadius: "8px",
                  padding: "14px",
                  marginBottom: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: "bold" }}>
                    {bill.utility} — {fmtMoney(bill.amount)} {bill.currency}
                  </div>
                  <div style={{ color: statusColor[st], fontWeight: "bold" }}>
                    {st.toUpperCase()}
                  </div>
                </div>
                <div style={{ fontSize: "13px", color: "#666", marginTop: "4px" }}>
                  Invoice: {bill.invoice_ref || "—"} | IC: {bill.ic_ref || "—"} | GRN:{" "}
                  {bill.grn_ref || "—"}
                </div>
                <div style={{ fontSize: "13px", color: "#666", marginTop: "4px" }}>
                  Stage {bill.current_stage_order}: <strong>{stageName(bill.current_stage_order)}</strong>{" "}
                  — {elapsed} of {budget} working day(s) used
                </div>
                <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <select
                    value={bill.current_stage_order}
                    onChange={(e) => moveStage(bill, Number(e.target.value))}
                    style={{
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      fontSize: "14px",
                      maxWidth: "320px",
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
                      padding: "8px 14px",
                      fontSize: "14px",
                      cursor: "pointer",
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

      {/* Add new bill */}
      <h3 style={{ ...h3, marginTop: "10px" }}>Add a new bill</h3>
            <div>
        <label>
          Utility
          <select
            value={utility}
            onChange={(e) => setUtility(e.target.value)}
            style={inputStyle}
          >
            {UTILITIES.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
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
            backgroundColor: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: "6px",
            padding: "10px 20px",
            fontSize: "15px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          {saving ? "Adding…" : "Add Bill"}
                </button>
      </div>
    </div>
  );
}
