"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";
import { useRequireCapability } from "../lib/useRouteGuard";

type Stage = { id: string; stage_order: number; stage_name: string; working_day_budget: number };
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
  notes: string | null;
};
type Plant = { id: string; name: string; type: string };

const EDIT_EMAILS = ["asif.shakoor@unze.co.uk", "usman.arshad@unze.co.uk"];
const VIEW_EMAILS = ["sania.saleem@unze.co.uk", "nadeem.khan@unze.co.uk"];

const PLANT_CUSTOMERS: Record<string, string[]> = {
  FIEDMC: ["FESCO", "GEPCO", "LESCO"],
  MEPCO: ["MEPCO"],
  PESCO: ["PESCO"],
  "Smart Meter Plant": ["Meters"],
};

function customersForPlant(plantName: string): string[] {
  return PLANT_CUSTOMERS[plantName] || [plantName];
}

function workingDaysSince(dateStr: string): number {
  const start = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (start > now) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= now) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(0, count - 1);
}

export default function ReceivablesPage() {
  const isMobile = useMobile();
  const { checking } = useRequireCapability("receivables");
  const [stages, setStages] = useState<Stage[]>([]);
  const [bills, setBills] = useState<Receivable[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [plantId, setPlantId] = useState("");
  const [customer, setCustomer] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [icRef, setIcRef] = useState("");
  const [grnRef, setGrnRef] = useState("");
  const [amount, setAmount] = useState("");
  const [dateSubmitted, setDateSubmitted] = useState(new Date().toISOString().slice(0, 10));

  const selectedPlant = plants.find((p) => p.id === plantId);
  const customers = selectedPlant ? customersForPlant(selectedPlant.name) : [];

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email || "";

    if (email) {
      const { data: member } = await supabase.from("members").select("role").eq("email", email).single();
      const role = member?.role || "Member";
      setCanEdit(role === "Admin" || role === "Executive" || EDIT_EMAILS.includes(email));
    }

    const [stagesRes, billsRes, plantsRes] = await Promise.all([
      supabase.from("receivable_stages").select("*").order("stage_order"),
      supabase.from("receivables").select("*").neq("status", "Collected").order("date_submitted"),
      supabase.from("plants").select("id, name, type").eq("active", true).order("name"),
    ]);
    setStages(stagesRes.data || []);
    setBills(billsRes.data || []);
    setPlants(plantsRes.data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function moveToStage(billId: string, newOrder: number) {
    if (!canEdit) return;
    await supabase.from("receivables").update({
      current_stage_order: newOrder,
      current_stage_entered_date: new Date().toISOString().slice(0, 10),
    }).eq("id", billId);
    logAction("Updated", "receivables", `Moved to stage ${newOrder}`, billId);
    loadData();
  }

  async function markCollected(billId: string) {
    if (!canEdit) return;
    await supabase.from("receivables").update({
      status: "Collected",
      received_date: new Date().toISOString().slice(0, 10),
    }).eq("id", billId);
    logAction("Updated", "receivables", "Marked as collected", billId);
    loadData();
  }

  async function addBill(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !plantId || !amount) return;
    setSaving(true);
    const { error } = await supabase.from("receivables").insert({
      utility: customer || customers[0] || selectedPlant?.name || "",
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
    if (error) { setMessage("Error: " + error.message); return; }
    logAction("Created", "receivables", `Bill: ${customer || selectedPlant?.name} PKR ${amount}`);
    setMessage("Bill added.");
    setTimeout(() => setMessage(""), 3000);
    setInvoiceRef(""); setIcRef(""); setGrnRef(""); setAmount("");
    loadData();
  }

  const totalAmount = bills.reduce((s, b) => s + b.amount, 0);
  const stuckBills = bills.filter((b) => {
    const stage = stages.find((s) => s.stage_order === b.current_stage_order);
    if (!stage) return false;
    return workingDaysSince(b.current_stage_entered_date) >= stage.working_day_budget;
  });

  // Build customer summary (same logic as executive dashboard)
  const customerRows = (() => {
    type CustRow = { customer: string; greenAmount: number; amberAmount: number; redAmount: number; totalAmount: number; redCount: number };
    const map = new Map<string, CustRow>();
    for (const bill of bills) {
      const key = bill.utility || "Unknown";
      if (!map.has(key)) map.set(key, { customer: key, greenAmount: 0, amberAmount: 0, redAmount: 0, totalAmount: 0, redCount: 0 });
      const row = map.get(key)!;
      const stage = stages.find((s) => s.stage_order === bill.current_stage_order);
      const elapsed = workingDaysSince(bill.current_stage_entered_date);
      const budget = stage?.working_day_budget || 0;
      const rag = budget <= 0 ? "green" : elapsed >= budget ? "red" : elapsed >= budget - 1 ? "amber" : "green";
      const amt = Number(bill.amount) || 0;
      row.totalAmount += amt;
      if (rag === "green") row.greenAmount += amt;
      else if (rag === "amber") row.amberAmount += amt;
      else { row.redAmount += amt; row.redCount += 1; }
    }
    return Array.from(map.values()).sort((a, b) => b.redAmount - a.redAmount || b.totalAmount - a.totalAmount);
  })();
  const recGreen = customerRows.reduce((s, r) => s + r.greenAmount, 0);
  const recAmber = customerRows.reduce((s, r) => s + r.amberAmount, 0);
  const recRed = customerRows.reduce((s, r) => s + r.redAmount, 0);
  const recRedCount = customerRows.reduce((s, r) => s + r.redCount, 0);

  // Bill Aging — calendar days since date_submitted
  function calendarDaysSince(dateStr: string): number {
    const start = new Date(dateStr + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (start > now) return 0;
    return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }
  function agingBucket(dateStr: string): "0-30" | "31-60" | "61-90" | "90+" {
    const days = calendarDaysSince(dateStr);
    if (days <= 30) return "0-30";
    if (days <= 60) return "31-60";
    if (days <= 90) return "61-90";
    return "90+";
  }
  const AGING_COLOURS: Record<string, string> = { "0-30": COLOURS.GREEN, "31-60": "#d97706", "61-90": COLOURS.RED, "90+": "#991b1b" };

  const agingTotals = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const bill of bills) {
    agingTotals[agingBucket(bill.date_submitted)] += Number(bill.amount) || 0;
  }

  // Per-customer aging: worst (oldest) non-zero bucket
  const customerAging = (() => {
    const map = new Map<string, { "0-30": number; "31-60": number; "61-90": number; "90+": number }>();
    for (const bill of bills) {
      const key = bill.utility || "Unknown";
      if (!map.has(key)) map.set(key, { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });
      const row = map.get(key)!;
      row[agingBucket(bill.date_submitted)] += Number(bill.amount) || 0;
    }
    const result = new Map<string, string>();
    for (const [cust, buckets] of map) {
      if (buckets["90+"] > 0) result.set(cust, "90+");
      else if (buckets["61-90"] > 0) result.set(cust, "61-90");
      else if (buckets["31-60"] > 0) result.set(cust, "31-60");
      else result.set(cust, "0-30");
    }
    return result;
  })();

  if (checking) return null;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader title="Receivables Pipeline" subtitle="Track bills through collection stages" />
          {canEdit && (
            <button onClick={() => setShowForm(!showForm)} style={{
              backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
              width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            }} title="Add bill">{showForm ? "×" : "+"}</button>
          )}
        </div>

        {message && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>{message}</div>
        )}

        {/* Add bill form */}
        {showForm && canEdit && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>Add New Bill</div>
            <form onSubmit={addBill}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: "8px" }}>
                <div>
                  <label style={lbl}>Plant</label>
                  <select style={inp} value={plantId} onChange={(e) => { setPlantId(e.target.value); const p = plants.find((x) => x.id === e.target.value); if (p) setCustomer(customersForPlant(p.name)[0] || p.name); }} required>
                    <option value="">Select</option>
                    {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Customer</label>
                  <select style={inp} value={customer} onChange={(e) => setCustomer(e.target.value)}>
                    {customers.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Amount (PKR)</label>
                  <input type="number" style={inp} value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0" />
                </div>
                <div>
                  <label style={lbl}>Date Submitted</label>
                  <input type="date" style={inp} value={dateSubmitted} onChange={(e) => setDateSubmitted(e.target.value)} required />
                </div>
                <div>
                  <label style={lbl}>Invoice Ref</label>
                  <input style={inp} value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label style={lbl}>IC Ref</label>
                  <input style={inp} value={icRef} onChange={(e) => setIcRef(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label style={lbl}>GRN Ref</label>
                  <input style={inp} value={grnRef} onChange={(e) => setGrnRef(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <button type="submit" disabled={saving} style={{
                backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
                padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer", marginTop: "8px",
              }}>{saving ? "Saving..." : "Add Bill"}</button>
            </form>
          </div>
        )}

        {!loading && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
            <CountCard label="Total Bills" value={bills.length} color={COLOURS.BLUE} />
            <CountCard label="Total Amount" value={Math.round(totalAmount)} color={COLOURS.NAVY} />
            <CountCard label="Stuck" value={stuckBills.length} color={stuckBills.length > 0 ? COLOURS.RED : COLOURS.GREEN} />
          </div>
        )}

        {/* Bills in Progress — Customer Summary */}
        {!loading && customerRows.length > 0 && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "10px", color: COLOURS.NAVY }}>
              Bills in Progress: <span style={{ color: recRed > 0 ? COLOURS.RED : COLOURS.GREEN }}>{recRed > 0 ? `${recRedCount} BILL(S) STUCK` : "ALL ON TRACK"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px", marginBottom: "12px" }}>
              {[
                { label: "Total Tracked", value: totalAmount, color: COLOURS.BLUE },
                { label: "On Time", value: recGreen, color: COLOURS.GREEN },
                { label: "Due Soon", value: recAmber, color: "#d97706" },
                { label: "Stuck", value: recRed, color: COLOURS.RED },
              ].map((c) => (
                <div key={c.label} style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${c.color}`, borderRadius: "6px", padding: "6px 10px" }}>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{c.label}</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: c.color }}>PKR {c.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "420px" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8fafc" }}>
                    {["Customer", "On Time", "Due Soon", "Stuck", "Total", "Aging"].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "6px 10px", fontSize: "13px", color: COLOURS.SLATE, fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customerRows.map((r) => (
                    <tr key={r.customer}>
                      <td style={{ borderBottom: `1px solid #f1f5f9`, padding: "7px 10px", fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{r.customer}</td>
                      <td style={{ borderBottom: `1px solid #f1f5f9`, padding: "7px 10px", fontSize: "14px", color: COLOURS.GREEN }}>{r.greenAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: `1px solid #f1f5f9`, padding: "7px 10px", fontSize: "14px", color: "#d97706" }}>{r.amberAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: `1px solid #f1f5f9`, padding: "7px 10px", fontSize: "14px", color: COLOURS.RED, fontWeight: r.redAmount > 0 ? 700 : 400 }}>{r.redAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: `1px solid #f1f5f9`, padding: "7px 10px", fontSize: "14px", fontWeight: 600 }}>{r.totalAmount.toLocaleString()}</td>
                      {(() => { const bucket = customerAging.get(r.customer) || "0-30"; return (
                        <td style={{ borderBottom: `1px solid #f1f5f9`, padding: "7px 10px", fontSize: "13px", fontWeight: 700, color: AGING_COLOURS[bucket] }}>{bucket === "90+" ? "90+ days" : `${bucket} days`}</td>
                      ); })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Bill Aging Report */}
        {!loading && bills.length > 0 && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "10px", color: COLOURS.NAVY }}>Bill Aging Report</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
              {([
                { label: "0-30 days", bucket: "0-30" as const },
                { label: "31-60 days", bucket: "31-60" as const },
                { label: "61-90 days", bucket: "61-90" as const },
                { label: "90+ days", bucket: "90+" as const },
              ] as const).map((c) => (
                <div key={c.bucket} style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${AGING_COLOURS[c.bucket]}`, borderRadius: "6px", padding: "8px 10px" }}>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{c.label}</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: AGING_COLOURS[c.bucket] }}>PKR {agingTotals[c.bucket].toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ color: COLOURS.SLATE }}>Loading receivables...</p>
        ) : (
          <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "12px" }}>
            {stages.map((stage) => {
              const stageBills = bills.filter((b) => b.current_stage_order === stage.stage_order);
              const nextStage = stages.find((s) => s.stage_order > stage.stage_order);
              return (
                <div key={stage.id} style={{
                  minWidth: isMobile ? "260px" : "240px", maxWidth: "280px", flex: "0 0 auto",
                  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "#f8fafc",
                }}>
                  <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: "white", borderRadius: "8px 8px 0 0" }}>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{stage.stage_name}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{stageBills.length} bill{stageBills.length !== 1 ? "s" : ""} · Budget: {stage.working_day_budget} days</div>
                  </div>

                  <div style={{ padding: "8px", minHeight: "100px" }}>
                    {stageBills.length === 0 ? (
                      <div style={{ padding: "12px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>Empty</div>
                    ) : (
                      stageBills.map((bill) => {
                        const elapsed = workingDaysSince(bill.current_stage_entered_date);
                        const isStuck = elapsed >= stage.working_day_budget;
                        const isWarning = elapsed >= stage.working_day_budget - 1 && !isStuck;
                        return (
                          <div key={bill.id} style={{
                            border: `1px solid ${isStuck ? COLOURS.RED : isWarning ? "#d97706" : COLOURS.BORDER}`,
                            borderLeft: `3px solid ${isStuck ? COLOURS.RED : isWarning ? "#d97706" : COLOURS.GREEN}`,
                            borderRadius: "6px", padding: "8px 10px", backgroundColor: "white", marginBottom: "6px",
                          }}>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>{bill.utility}</div>
                            <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                              PKR {bill.amount.toLocaleString()} · {formatDateUK(bill.date_submitted)}
                            </div>
                            <div style={{ fontSize: "11px", color: isStuck ? COLOURS.RED : isWarning ? "#d97706" : COLOURS.SLATE, fontWeight: isStuck || isWarning ? 700 : 400, marginTop: "2px" }}>
                              {elapsed}d in stage {isStuck ? "(STUCK)" : isWarning ? "(due soon)" : ""}
                            </div>
                            {bill.invoice_ref && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Inv: {bill.invoice_ref}</div>}
                            {bill.ic_ref && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>IC: {bill.ic_ref}</div>}
                            {bill.grn_ref && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>GRN: {bill.grn_ref}</div>}

                            {canEdit && (
                              <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                                {nextStage && (
                                  <button onClick={() => moveToStage(bill.id, nextStage.stage_order)} style={{
                                    backgroundColor: COLOURS.BLUE, color: "white", border: "none", borderRadius: "4px",
                                    padding: "3px 8px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                                  }} title={`Move to ${nextStage.stage_name}`}>Next</button>
                                )}
                                <button onClick={() => markCollected(bill.id)} style={{
                                  backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: "4px",
                                  padding: "3px 8px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                                }}>Collected</button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}

            <div style={{
              minWidth: isMobile ? "260px" : "240px", maxWidth: "280px", flex: "0 0 auto",
              border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "#f0fdf4",
            }}>
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: "white", borderRadius: "8px 8px 0 0" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.GREEN }}>Collected</div>
              </div>
              <div style={{ padding: "8px", textAlign: "center", color: COLOURS.GREEN, fontSize: "13px" }}>
                Bills move here when marked as collected
              </div>
            </div>
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}

const inp: React.CSSProperties = { display: "block", width: "100%", padding: "7px 10px", marginTop: "3px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" };
