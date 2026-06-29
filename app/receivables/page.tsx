"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, SHADOWS, PageHeader, SectionTitle, CountCard, SkeletonRows, inputStyle, labelStyle } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";
import { useRequireCapability } from "../lib/useRouteGuard";
import { canEditReceivables, type UserCtx, type PermOverrides } from "../lib/permissions";

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
  bill_type: string;
  received_date: string | null;
};

const BILL_TYPES = ["Normal", "Sales Tax", "Retention"] as const;
const IC_GRN_STAGE = 2;
const OPS_HOD_EMAIL = "nadeem.khan@unze.co.uk";
function skipsICGRN(billType: string) {
  return billType === "Sales Tax" || billType === "Retention";
}
type Plant = { id: string; name: string; type: string };


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
  const [collectedBills, setCollectedBills] = useState<Receivable[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showCollected, setShowCollected] = useState(false);
  const [dragBillId, setDragBillId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll, bills, stages]);

  function scrollBoard(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const amount = isMobile ? 270 : 260;
    el.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
    setTimeout(checkScroll, 350);
  }

  const [plantId, setPlantId] = useState("");
  const [customer, setCustomer] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [icRef, setIcRef] = useState("");
  const [grnRef, setGrnRef] = useState("");
  const [amount, setAmount] = useState("");
  const [dateSubmitted, setDateSubmitted] = useState(new Date().toISOString().slice(0, 10));
  const [billType, setBillType] = useState<string>("Normal");

  const selectedPlant = plants.find((p) => p.id === plantId);
  const customers = selectedPlant ? customersForPlant(selectedPlant.name) : [];

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email || "";

    if (email) {
      const { data: member } = await supabase.from("members").select("id, role, department, company").eq("email", email).single();
      if (member) {
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email, role: member.role, department: member.department, company: member.company, overrides };
        setCanEdit(canEditReceivables(ctx));
      }
    }

    const [stagesRes, billsRes, collectedRes, plantsRes] = await Promise.all([
      supabase.from("receivable_stages").select("*").order("stage_order"),
      supabase.from("receivables").select("*").neq("status", "Collected").order("date_submitted"),
      supabase.from("receivables").select("*").eq("status", "Collected").order("received_date", { ascending: false }).limit(100),
      supabase.from("plants").select("id, name, type").eq("active", true).order("name"),
    ]);
    setStages(stagesRes.data || []);
    setBills(billsRes.data || []);
    setCollectedBills(collectedRes.data || []);
    setPlants(plantsRes.data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function nextStageFor(bill: Receivable, currentOrder: number): Stage | undefined {
    return stages.find((s) => s.stage_order > currentOrder && !(s.stage_order === IC_GRN_STAGE && skipsICGRN(bill.bill_type)));
  }

  function prevStageFor(bill: Receivable, currentOrder: number): Stage | undefined {
    const eligible = stages.filter((s) => s.stage_order < currentOrder && !(s.stage_order === IC_GRN_STAGE && skipsICGRN(bill.bill_type)));
    return eligible.length > 0 ? eligible[eligible.length - 1] : undefined;
  }

  function canDropOnStage(bill: Receivable, targetOrder: number): boolean {
    if (targetOrder === bill.current_stage_order) return false;
    if (targetOrder === IC_GRN_STAGE && skipsICGRN(bill.bill_type)) return false;
    return true;
  }

  async function moveToStage(billId: string, newOrder: number) {
    if (!canEdit) return;
    const bill = bills.find((b) => b.id === billId);
    const stageName = stages.find((s) => s.stage_order === newOrder)?.stage_name || `Stage ${newOrder}`;
    const direction = bill && newOrder < bill.current_stage_order ? "Sent back" : "Advanced";
    await supabase.from("receivables").update({
      current_stage_order: newOrder,
      current_stage_entered_date: new Date().toISOString().slice(0, 10),
    }).eq("id", billId);
    logAction("Updated", "receivables", `${direction} to ${stageName}`, billId);
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
      ic_ref: skipsICGRN(billType) ? null : (icRef || null),
      grn_ref: skipsICGRN(billType) ? null : (grnRef || null),
      amount: Number(amount),
      currency: "PKR",
      date_submitted: dateSubmitted,
      current_stage_order: 1,
      current_stage_entered_date: dateSubmitted,
      status: "In Progress",
      bill_type: billType,
    });
    setSaving(false);
    if (error) { setMessage("Error: " + error.message); return; }
    logAction("Created", "receivables", `Bill (${billType}): ${customer || selectedPlant?.name} PKR ${amount}`);
    setMessage("Bill added.");
    setTimeout(() => setMessage(""), 3000);
    setInvoiceRef(""); setIcRef(""); setGrnRef(""); setAmount(""); setBillType("Normal");
    loadData();
  }

  // Drag and drop handlers
  function onDragStart(e: React.DragEvent, billId: string) {
    if (!canEdit) { e.preventDefault(); return; }
    e.dataTransfer.setData("text/plain", billId);
    e.dataTransfer.effectAllowed = "move";
    setDragBillId(billId);
  }

  function onDragOver(e: React.DragEvent, stageOrder: number) {
    if (!canEdit || !dragBillId) return;
    const bill = bills.find((b) => b.id === dragBillId);
    if (!bill || !canDropOnStage(bill, stageOrder)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageOrder);
  }

  function onDragLeave() {
    setDragOverStage(null);
  }

  function onDrop(e: React.DragEvent, stageOrder: number) {
    e.preventDefault();
    const billId = e.dataTransfer.getData("text/plain");
    if (!billId || !canEdit) return;
    const bill = bills.find((b) => b.id === billId);
    if (!bill || !canDropOnStage(bill, stageOrder)) return;
    moveToStage(billId, stageOrder);
    setDragBillId(null);
    setDragOverStage(null);
  }

  function onDragEnd() {
    setDragBillId(null);
    setDragOverStage(null);
  }

  // Drop on Collected column
  function onDropCollected(e: React.DragEvent) {
    e.preventDefault();
    const billId = e.dataTransfer.getData("text/plain");
    if (!billId || !canEdit) return;
    markCollected(billId);
    setDragBillId(null);
    setDragOverStage(null);
  }

  const totalAmount = bills.reduce((s, b) => s + b.amount, 0);
  const stuckBills = bills.filter((b) => {
    const stage = stages.find((s) => s.stage_order === b.current_stage_order);
    if (!stage || stage.working_day_budget <= 0) return false;
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

  // Collected bills grouped by plant
  const collectedByPlant = (() => {
    const map = new Map<string, { plant: string; count: number; total: number; bills: Receivable[] }>();
    for (const bill of collectedBills) {
      const plant = plants.find((p) => p.id === bill.plant_id);
      const key = plant?.name || "Unknown";
      if (!map.has(key)) map.set(key, { plant: key, count: 0, total: 0, bills: [] });
      const row = map.get(key)!;
      row.count++;
      row.total += Number(bill.amount) || 0;
      row.bills.push(bill);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  })();

  if (checking) return null;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader />
          {canEdit && (
            <button onClick={() => setShowForm(!showForm)} style={{
              backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
              width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: SHADOWS.MODAL,
            }} title="Add bill">{showForm ? "×" : "+"}</button>
          )}
        </div>

        {message && (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "var(--bg-card, #ffffff)", fontSize: "15px", color: "var(--text-primary, #1e293b)" }}>{message}</div>
        )}

        {/* Add bill form */}
        {showForm && canEdit && (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "10px" }}>Add New Bill</div>
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
                  <label style={lbl}>Bill Type</label>
                  <select style={inp} value={billType} onChange={(e) => setBillType(e.target.value)}>
                    {BILL_TYPES.map((t) => <option key={t}>{t}</option>)}
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
                {!skipsICGRN(billType) && (
                  <div>
                    <label style={lbl}>IC Ref</label>
                    <input style={inp} value={icRef} onChange={(e) => setIcRef(e.target.value)} placeholder="Optional" />
                  </div>
                )}
                {!skipsICGRN(billType) && (
                  <div>
                    <label style={lbl}>GRN Ref</label>
                    <input style={inp} value={grnRef} onChange={(e) => setGrnRef(e.target.value)} placeholder="Optional" />
                  </div>
                )}
              </div>
              <button type="submit" disabled={saving} style={{
                backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
                padding: "8px 16px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "8px",
              }}>{saving ? "Saving..." : "Add Bill"}</button>
            </form>
          </div>
        )}

        {!loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
            <CountCard label="Total Bills" value={bills.length} color={COLOURS.BLUE} />
            <CountCard label="Total Amount" value={Math.round(totalAmount)} color={COLOURS.NAVY} />
            <CountCard label="Stuck" value={stuckBills.length} color={stuckBills.length > 0 ? COLOURS.RED : COLOURS.GREEN} />
            <CountCard label="Collected" value={collectedBills.length} color={COLOURS.GREEN} />
          </div>
        )}

        {/* KANBAN STAGE BOARD — primary working view, must stay at top */}
        {loading ? (
          <SkeletonRows count={4} height="60px" />
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <SectionTitle title="Stage Board" />
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {canEdit && !isMobile && <span style={{ fontSize: "12px", color: "var(--text-secondary, #64748b)", marginRight: "8px" }}>Drag to move</span>}
                <button onClick={() => scrollBoard("left")} disabled={!canScrollLeft} style={{
                  width: "32px", height: "32px", borderRadius: "50%", border: `1px solid ${COLOURS.BORDER}`,
                  backgroundColor: canScrollLeft ? "var(--bg-card, #ffffff)" : "var(--bg-card-hover, #f8fafc)",
                  color: canScrollLeft ? "var(--text-primary, #1e293b)" : "var(--text-secondary, #64748b)",
                  fontSize: "16px", cursor: canScrollLeft ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>&#8249;</button>
                <button onClick={() => scrollBoard("right")} disabled={!canScrollRight} style={{
                  width: "32px", height: "32px", borderRadius: "50%", border: `1px solid ${COLOURS.BORDER}`,
                  backgroundColor: canScrollRight ? "var(--bg-card, #ffffff)" : "var(--bg-card-hover, #f8fafc)",
                  color: canScrollRight ? "var(--text-primary, #1e293b)" : "var(--text-secondary, #64748b)",
                  fontSize: "16px", cursor: canScrollRight ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>&#8250;</button>
              </div>
            </div>
            <div ref={scrollRef} onScroll={checkScroll} style={{
              display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "12px", marginBottom: "14px",
              WebkitOverflowScrolling: "touch", scrollSnapType: "x mandatory",
              scrollbarWidth: "thin",
            }}>
              {stages.map((stage) => {
                const stageBills = bills.filter((b) => b.current_stage_order === stage.stage_order);
                const isDragTarget = dragOverStage === stage.stage_order;
                return (
                  <div
                    key={stage.id}
                    onDragOver={(e) => onDragOver(e, stage.stage_order)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, stage.stage_order)}
                    style={{
                      minWidth: isMobile ? "260px" : "240px", maxWidth: "280px", flex: "0 0 auto",
                      border: `2px solid ${isDragTarget ? COLOURS.BLUE : "var(--border-color, #e2e8f0)"}`,
                      borderRadius: "8px",
                      backgroundColor: isDragTarget ? "rgba(59, 130, 246, 0.05)" : "var(--bg-card-hover, #f8fafc)",
                      transition: "border-color 0.15s, background-color 0.15s",
                      scrollSnapAlign: "start",
                    }}
                  >
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color, #e2e8f0)", backgroundColor: "var(--bg-card, #ffffff)", borderRadius: "6px 6px 0 0" }}>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>
                        {stage.stage_name}
                        {stage.stage_order === IC_GRN_STAGE && <span style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-secondary, #64748b)", marginLeft: "6px" }}>(skip: Tax/Ret.)</span>}
                      </div>
                      <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>{stageBills.length} bill{stageBills.length !== 1 ? "s" : ""} · {stage.working_day_budget > 0 ? `${stage.working_day_budget}d budget` : "Start"}</div>
                    </div>

                    <div style={{ padding: "8px", minHeight: "100px" }}>
                      {stageBills.length === 0 ? (
                        <div style={{ padding: "12px", textAlign: "center", color: "var(--text-secondary, #64748b)", fontSize: "15px" }}>Empty</div>
                      ) : (
                        stageBills.map((bill) => {
                          const elapsed = workingDaysSince(bill.current_stage_entered_date);
                          const isStuck = stage.working_day_budget > 0 && elapsed >= stage.working_day_budget;
                          const isWarning = stage.working_day_budget > 0 && elapsed >= stage.working_day_budget - 1 && !isStuck;
                          const next = nextStageFor(bill, stage.stage_order);
                          const prev = prevStageFor(bill, stage.stage_order);
                          const isDragging = dragBillId === bill.id;
                          return (
                            <div
                              key={bill.id}
                              draggable={canEdit}
                              onDragStart={(e) => onDragStart(e, bill.id)}
                              onDragEnd={onDragEnd}
                              style={{
                                border: `1px solid ${isStuck ? COLOURS.RED : isWarning ? "#d97706" : COLOURS.BORDER}`,
                                borderLeft: `3px solid ${isStuck ? COLOURS.RED : isWarning ? "#d97706" : COLOURS.GREEN}`,
                                borderRadius: "6px", padding: "8px 10px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "6px",
                                cursor: canEdit ? "grab" : "default",
                                opacity: isDragging ? 0.5 : 1,
                                transition: "opacity 0.15s",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{bill.utility}</div>
                                {bill.bill_type !== "Normal" && (
                                  <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 5px", borderRadius: "4px", backgroundColor: bill.bill_type === "Sales Tax" ? "#dbeafe" : "#fef3c7", color: bill.bill_type === "Sales Tax" ? COLOURS.BLUE : "#92400e" }}>{bill.bill_type}</span>
                                )}
                              </div>
                              <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>
                                PKR {bill.amount.toLocaleString()} · {formatDateUK(bill.date_submitted)}
                              </div>
                              <div style={{ fontSize: "13px", color: isStuck ? COLOURS.RED : isWarning ? "#d97706" : "var(--text-secondary, #64748b)", fontWeight: isStuck || isWarning ? 700 : 400, marginTop: "2px" }}>
                                {elapsed}d in stage {isStuck ? "(STUCK)" : isWarning ? "(due soon)" : ""}
                              </div>
                              {bill.invoice_ref && <div style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>Inv: {bill.invoice_ref}</div>}
                              {bill.ic_ref && <div style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>IC: {bill.ic_ref}</div>}
                              {bill.grn_ref && <div style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>GRN: {bill.grn_ref}</div>}

                              {canEdit && (
                                <div style={{ display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" }}>
                                  {prev && (
                                    <button onClick={() => moveToStage(bill.id, prev.stage_order)} style={{
                                      backgroundColor: "#94a3b8", color: "white", border: "none", borderRadius: "4px",
                                      padding: "3px 8px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                                    }} title={`Send back to ${prev.stage_name}`}>Back</button>
                                  )}
                                  {next && (
                                    <button onClick={() => moveToStage(bill.id, next.stage_order)} style={{
                                      backgroundColor: COLOURS.BLUE, color: "white", border: "none", borderRadius: "4px",
                                      padding: "3px 8px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                                    }} title={`Move to ${next.stage_name}`}>Next</button>
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

              {/* Collected column — drop target */}
              <div
                onDragOver={(e) => { if (canEdit && dragBillId) { e.preventDefault(); setDragOverStage(-1); } }}
                onDragLeave={onDragLeave}
                onDrop={onDropCollected}
                style={{
                  minWidth: isMobile ? "260px" : "240px", maxWidth: "280px", flex: "0 0 auto",
                  border: `2px solid ${dragOverStage === -1 ? COLOURS.GREEN : "var(--border-color, #e2e8f0)"}`,
                  borderRadius: "8px",
                  backgroundColor: dragOverStage === -1 ? "rgba(34, 197, 94, 0.05)" : "#f0fdf4",
                  transition: "border-color 0.15s, background-color 0.15s",
                  scrollSnapAlign: "start",
                }}
              >
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color, #e2e8f0)", backgroundColor: "var(--bg-card, #ffffff)", borderRadius: "6px 6px 0 0" }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.GREEN }}>Collected</div>
                  <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>{collectedBills.length} total</div>
                </div>
                <div style={{ padding: "8px", textAlign: "center", color: COLOURS.GREEN, fontSize: "14px" }}>
                  {canEdit ? "Drop here or click Collected" : "Cheque received — bill complete"}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Collected Bills by Plant */}
        {!loading && collectedBills.length > 0 && (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showCollected ? "10px" : "0" }}>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>
                Collected Bills by Plant
              </div>
              <button onClick={() => setShowCollected(!showCollected)} style={{
                background: "none", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "4px",
                padding: "3px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                color: "var(--text-secondary, #64748b)",
              }}>{showCollected ? "Hide" : "Show"}</button>
            </div>
            {showCollected && (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
                {collectedByPlant.map((group) => (
                  <div key={group.plant} style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${COLOURS.GREEN}`, borderRadius: "6px", padding: "10px" }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "4px" }}>{group.plant}</div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)", marginBottom: "8px" }}>
                      {group.count} bill{group.count !== 1 ? "s" : ""} · PKR {group.total.toLocaleString()}
                    </div>
                    {group.bills.slice(0, 5).map((bill) => (
                      <div key={bill.id} style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)", padding: "3px 0", borderBottom: "1px solid var(--border-light, #f1f5f9)" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{bill.utility}</span> · PKR {bill.amount.toLocaleString()} · {bill.received_date ? formatDateUK(bill.received_date) : "—"}
                      </div>
                    ))}
                    {group.bills.length > 5 && (
                      <div style={{ fontSize: "12px", color: "var(--text-secondary, #64748b)", marginTop: "4px" }}>+{group.bills.length - 5} more</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pipeline Stage Summary Bar */}
        {!loading && stages.length > 0 && bills.length > 0 && (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "12px 14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px", color: "var(--text-primary, #1e293b)" }}>Pipeline Stages</div>
            <div style={{ display: "flex", borderRadius: "6px", overflow: "hidden", height: "28px" }}>
              {stages.map((stage) => {
                const count = bills.filter((b) => b.current_stage_order === stage.stage_order).length;
                if (count === 0) return null;
                const pct = (count / bills.length) * 100;
                const stuckInStage = bills.filter((b) => {
                  if (b.current_stage_order !== stage.stage_order) return false;
                  if (stage.working_day_budget <= 0) return false;
                  return workingDaysSince(b.current_stage_entered_date) >= stage.working_day_budget;
                }).length;
                const bg = stuckInStage > 0 ? COLOURS.RED : count > 0 ? COLOURS.GREEN : COLOURS.BLUE;
                return (
                  <div key={stage.id} title={`${stage.stage_name}: ${count} bill${count !== 1 ? "s" : ""}${stuckInStage > 0 ? ` (${stuckInStage} stuck)` : ""}`} style={{
                    width: `${Math.max(pct, 8)}%`, backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "12px", fontWeight: 700, color: "#fff", whiteSpace: "nowrap", padding: "0 4px",
                    borderRight: "1px solid rgba(255,255,255,0.3)",
                  }}>
                    {count}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "12px", marginTop: "6px", flexWrap: "wrap" }}>
              {stages.map((stage) => {
                const count = bills.filter((b) => b.current_stage_order === stage.stage_order).length;
                return (
                  <span key={stage.id} style={{ fontSize: "12px", color: "var(--text-secondary, #64748b)" }}>
                    {stage.stage_name}: <strong>{count}</strong>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Collection Velocity — avg days per stage vs budget */}
        {!loading && stages.length > 0 && bills.length > 0 && (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "12px 14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px", color: "var(--text-primary, #1e293b)" }}>Collection Velocity (avg days in stage)</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: "6px" }}>
              {stages.map((stage) => {
                const stageBills = bills.filter((b) => b.current_stage_order === stage.stage_order);
                const avgDays = stageBills.length > 0
                  ? Math.round(stageBills.reduce((s, b) => s + workingDaysSince(b.current_stage_entered_date), 0) / stageBills.length)
                  : 0;
                const overBudget = stage.working_day_budget > 0 && avgDays > stage.working_day_budget;
                const nearBudget = stage.working_day_budget > 0 && avgDays >= stage.working_day_budget - 1 && !overBudget;
                const color = overBudget ? COLOURS.RED : nearBudget ? "#d97706" : COLOURS.GREEN;
                return (
                  <div key={stage.id} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary, #64748b)", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stage.stage_name}</div>
                    <div style={{ fontSize: "18px", fontWeight: 800, color }}>{avgDays}d</div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary, #64748b)" }}>{stage.working_day_budget > 0 ? `/ ${stage.working_day_budget}d budget` : "Start"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bills in Progress — Customer Summary */}
        {!loading && customerRows.length > 0 && (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "10px", color: "var(--text-primary, #1e293b)" }}>
              Bills in Progress: <span style={{ color: recRed > 0 ? COLOURS.RED : COLOURS.GREEN }}>{recRed > 0 ? `${recRedCount} BILL(S) STUCK` : "ALL ON TRACK"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px", marginBottom: "12px" }}>
              {[
                { label: "Total Tracked", value: totalAmount, color: COLOURS.BLUE },
                { label: "On Time", value: recGreen, color: COLOURS.GREEN },
                { label: "Due Soon", value: recAmber, color: "#d97706" },
                { label: "Stuck", value: recRed, color: COLOURS.RED },
              ].map((c) => (
                <div key={c.label} style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${c.color}`, borderRadius: "6px", padding: "6px 10px" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>{c.label}</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: c.color }}>PKR {c.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "420px" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
                    {["Customer", "On Time", "Due Soon", "Stuck", "Total", "Aging"].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: "1px solid var(--border-color, #e2e8f0)", padding: "6px 10px", fontSize: "15px", color: "var(--text-secondary, #64748b)", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customerRows.map((r) => (
                    <tr key={r.customer}>
                      <td style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{r.customer}</td>
                      <td style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "16px", color: COLOURS.GREEN }}>{r.greenAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "16px", color: "#d97706" }}>{r.amberAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "16px", color: COLOURS.RED, fontWeight: r.redAmount > 0 ? 700 : 400 }}>{r.redAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "16px", fontWeight: 600 }}>{r.totalAmount.toLocaleString()}</td>
                      {(() => { const bucket = customerAging.get(r.customer) || "0-30"; return (
                        <td style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "15px", fontWeight: 700, color: AGING_COLOURS[bucket] }}>{bucket === "90+" ? "90+ days" : `${bucket} days`}</td>
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
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "10px", color: "var(--text-primary, #1e293b)" }}>Bill Aging Report</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
              {([
                { label: "0-30 days", bucket: "0-30" as const },
                { label: "31-60 days", bucket: "31-60" as const },
                { label: "61-90 days", bucket: "61-90" as const },
                { label: "90+ days", bucket: "90+" as const },
              ] as const).map((c) => (
                <div key={c.bucket} style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${AGING_COLOURS[c.bucket]}`, borderRadius: "6px", padding: "8px 10px" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>{c.label}</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: AGING_COLOURS[c.bucket] }}>PKR {agingTotals[c.bucket].toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}

const inp: React.CSSProperties = { ...inputStyle, fontSize: "15px" };
const lbl: React.CSSProperties = { ...labelStyle, marginBottom: "4px" };
