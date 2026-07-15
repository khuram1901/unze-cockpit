"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInput from "../lib/DateInput";
import { useMobile } from "../lib/useMobile";
import { COLOURS, RADII, SHADOWS, cardStyle, tableHeaderStyle, PageHeader, SectionTitle, CountCard, SkeletonRows, inputStyle, labelStyle } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";
import { useRequireCapability } from "../lib/useRouteGuard";
import { canEditReceivables, isAdminTier, type UserCtx, type PermOverrides } from "../lib/permissions";

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

// Shared local styles
const inp: React.CSSProperties = { ...inputStyle, fontSize: "14px" };
const lbl: React.CSSProperties = { ...labelStyle, marginBottom: "4px" };

const ghostBtn: React.CSSProperties = {
  padding: "5px 12px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600,
  border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD,
  color: COLOURS.NAVY, cursor: "pointer",
};
const ghostBtnSlate: React.CSSProperties = { ...ghostBtn, color: COLOURS.SLATE };

const scrollNavBtn = (active: boolean): React.CSSProperties => ({
  width: "30px", height: "30px", borderRadius: RADII.PILL,
  border: `1px solid ${COLOURS.HAIRLINE}`,
  backgroundColor: active ? COLOURS.CARD : COLOURS.CARD_ALT,
  color: active ? COLOURS.NAVY : COLOURS.INK_400,
  fontSize: "16px", cursor: active ? "pointer" : "default",
  display: "flex", alignItems: "center", justifyContent: "center",
});

export default function ReceivablesPage() {
  const isMobile = useMobile();
  const { checking } = useRequireCapability("receivables");
  const [stages, setStages] = useState<Stage[]>([]);
  const [bills, setBills] = useState<Receivable[]>([]);
  const [collectedBills, setCollectedBills] = useState<Receivable[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [ragSummary, setRagSummary] = useState<{
    customerRows: { customer: string; greenAmount: number; amberAmount: number; redAmount: number; totalAmount: number; redCount: number }[];
    totalAmount: number;
    recGreen: number; recAmber: number; recRed: number; recRedCount: number;
  }>({ customerRows: [], totalAmount: 0, recGreen: 0, recAmber: 0, recRed: 0, recRedCount: 0 });
  // Found during the 15 Jul 2026 audit: aging totals/per-customer aging
  // were summed in JS from raw bill rows (rule 0 violation). Two RPCs
  // for this already existed (migration 056) but weren't wired up —
  // now used instead of the JS loops.
  const [agingTotals, setAgingTotals] = useState<Record<"0-30" | "31-60" | "61-90" | "90+", number>>({ "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });
  const [customerAging, setCustomerAging] = useState<Map<string, "0-30" | "31-60" | "61-90" | "90+">>(new Map());
  // Also fixes: this used to only ever group the most recent 100
  // collected bills (the client fetch was capped), so plant totals were
  // silently incomplete once more than 100 bills had been collected in
  // total — get_collected_receivables_by_plant() computes true totals
  // over ALL collected bills.
  const [collectedByPlant, setCollectedByPlant] = useState<{ plant: string; count: number; total: number; bills: { id: string; utility: string; amount: number; received_date: string | null }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showCollected, setShowCollected] = useState(false);
  const [dragBillId, setDragBillId] = useState<string | null>(null);

  const [editBillId, setEditBillId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ utility: "", amount: "", date_submitted: "", invoice_ref: "", ic_ref: "", grn_ref: "", notes: "", bill_type: "Normal" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
        setIsAdmin(isAdminTier(ctx));
      }
    }

    const [stagesRes, billsRes, collectedRes, plantsRes, ragRes, agingTotalsRes, agingByCustomerRes, collectedByPlantRes] = await Promise.all([
      supabase.from("receivable_stages").select("id, stage_order, stage_name, working_day_budget").order("stage_order"),
      supabase.from("receivables").select("id, utility, plant_id, invoice_ref, ic_ref, grn_ref, amount, currency, date_submitted, current_stage_order, current_stage_entered_date, status, notes, bill_type, received_date").neq("status", "Collected").order("date_submitted"),
      supabase.from("receivables").select("id, utility, plant_id, invoice_ref, ic_ref, grn_ref, amount, currency, date_submitted, current_stage_order, current_stage_entered_date, status, notes, bill_type, received_date").eq("status", "Collected").order("received_date", { ascending: false }).limit(100),
      supabase.from("plants").select("id, name, type").eq("active", true).order("name"),
      supabase.rpc("get_receivable_rag_by_customer"),
      supabase.rpc("get_receivable_aging_totals"),
      supabase.rpc("get_receivable_aging_by_customer"),
      supabase.rpc("get_collected_receivables_by_plant"),
    ]);
    setStages(stagesRes.data || []);
    setBills(billsRes.data || []);
    setCollectedBills(collectedRes.data || []);
    setPlants(plantsRes.data || []);

    const ragRows = ((ragRes.data || []) as { customer: string; green_amount: number; amber_amount: number; red_amount: number; total_amount: number; red_count: number }[])
      .map((r) => ({
        customer: r.customer,
        greenAmount: Number(r.green_amount) || 0,
        amberAmount: Number(r.amber_amount) || 0,
        redAmount:   Number(r.red_amount)   || 0,
        totalAmount: Number(r.total_amount) || 0,
        redCount:    Number(r.red_count)    || 0,
      }));
    const totGreen = ragRows.reduce((s, r) => s + r.greenAmount, 0);
    const totAmber = ragRows.reduce((s, r) => s + r.amberAmount, 0);
    const totRed   = ragRows.reduce((s, r) => s + r.redAmount,   0);
    const totRedCt = ragRows.reduce((s, r) => s + r.redCount,    0);
    setRagSummary({
      customerRows: ragRows,
      totalAmount: ragRows.reduce((s, r) => s + r.totalAmount, 0),
      recGreen: totGreen, recAmber: totAmber, recRed: totRed, recRedCount: totRedCt,
    });

    const totalsMap: Record<"0-30" | "31-60" | "61-90" | "90+", number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    for (const r of (agingTotalsRes.data || []) as { bucket: "0-30" | "31-60" | "61-90" | "90+"; total: number }[]) {
      totalsMap[r.bucket] = Number(r.total) || 0;
    }
    setAgingTotals(totalsMap);

    const custAging = new Map<string, "0-30" | "31-60" | "61-90" | "90+">();
    for (const r of (agingByCustomerRes.data || []) as { customer: string; b0_30: number; b31_60: number; b61_90: number; b90_plus: number }[]) {
      if (Number(r.b90_plus) > 0) custAging.set(r.customer, "90+");
      else if (Number(r.b61_90) > 0) custAging.set(r.customer, "61-90");
      else if (Number(r.b31_60) > 0) custAging.set(r.customer, "31-60");
      else custAging.set(r.customer, "0-30");
    }
    setCustomerAging(custAging);

    setCollectedByPlant(
      ((collectedByPlantRes.data || []) as { plant_name: string; bill_count: number; total_amount: number; bills: { id: string; utility: string; amount: number; received_date: string | null }[] | null }[])
        .map((r) => ({
          plant: r.plant_name,
          count: Number(r.bill_count) || 0,
          total: Number(r.total_amount) || 0,
          bills: (r.bills || []).map((b) => ({ ...b, amount: Number(b.amount) || 0 })),
        }))
    );

    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function canEditBill(bill: Receivable): boolean {
    if (!canEdit) return false;
    if (isAdmin) return true;
    return bill.current_stage_order === 1;
  }

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

  function startEdit(bill: Receivable) {
    setEditBillId(bill.id);
    setEditForm({
      utility: bill.utility,
      amount: String(bill.amount),
      date_submitted: bill.date_submitted,
      invoice_ref: bill.invoice_ref || "",
      ic_ref: bill.ic_ref || "",
      grn_ref: bill.grn_ref || "",
      notes: bill.notes || "",
      bill_type: bill.bill_type || "Normal",
    });
  }

  async function saveEdit() {
    if (!editBillId) return;
    setSavingEdit(true);
    const { error } = await supabase.from("receivables").update({
      utility: editForm.utility,
      amount: Number(editForm.amount),
      date_submitted: editForm.date_submitted,
      invoice_ref: editForm.invoice_ref || null,
      ic_ref: skipsICGRN(editForm.bill_type) ? null : (editForm.ic_ref || null),
      grn_ref: skipsICGRN(editForm.bill_type) ? null : (editForm.grn_ref || null),
      notes: editForm.notes || null,
      bill_type: editForm.bill_type,
      updated_at: new Date().toISOString(),
    }).eq("id", editBillId);
    setSavingEdit(false);
    if (error) { setMessage("Error: " + error.message); return; }
    logAction("Updated", "receivables", `Edited bill details`, editBillId);
    setEditBillId(null);
    loadData();
  }

  async function deleteBill(billId: string) {
    if (!canEdit) return;
    setDeletingId(billId);
    const { error } = await supabase.from("receivables").delete().eq("id", billId);
    setDeletingId(null);
    if (error) { setMessage("Error: " + error.message); return; }
    logAction("Deleted", "receivables", "Bill deleted", billId);
    loadData();
  }

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

  function onDragLeave() { setDragOverStage(null); }

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

  function onDragEnd() { setDragBillId(null); setDragOverStage(null); }

  function onDropCollected(e: React.DragEvent) {
    e.preventDefault();
    const billId = e.dataTransfer.getData("text/plain");
    if (!billId || !canEdit) return;
    markCollected(billId);
    setDragBillId(null);
    setDragOverStage(null);
  }

  const stuckBills = bills.filter((b) => {
    const stage = stages.find((s) => s.stage_order === b.current_stage_order);
    if (!stage || stage.working_day_budget <= 0) return false;
    return workingDaysSince(b.current_stage_entered_date) >= stage.working_day_budget;
  });

  // RAG summary from Postgres RPC — no client-side aggregation
  const { customerRows, totalAmount, recGreen, recAmber, recRed, recRedCount } = ragSummary;

  const AGING_COLOURS: Record<string, string> = {
    "0-30": COLOURS.GREEN,
    "31-60": COLOURS.AMBER,
    "61-90": COLOURS.RED,
    "90+": COLOURS.RED,
  };

  if (checking) return null;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "14px 18px", maxWidth: "100%", minWidth: 0 }}>
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
          <div style={{
            ...cardStyle, padding: "10px 14px", marginBottom: "14px",
            borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
            fontSize: "13px", color: COLOURS.NAVY,
          }}>{message}</div>
        )}

        {/* Add bill form */}
        {showForm && canEdit && (
          <div style={{ ...cardStyle, padding: "16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "12px", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Add New Bill</div>
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
                  <DateInput style={inp} value={dateSubmitted} onChange={(e) => setDateSubmitted(e.target.value)} required />
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
                backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: RADII.PILL,
                padding: "8px 20px", fontSize: "13px", fontWeight: 500, cursor: "pointer", marginTop: "10px",
                opacity: saving ? 0.7 : 1,
              }}>{saving ? "Saving..." : "Add Bill"}</button>
            </form>
          </div>
        )}

        {/* KPI cards */}
        {!loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
            {[
              { label: "Total Bills", value: bills.length },
              { label: "Outstanding", value: `PKR ${Math.round(totalAmount).toLocaleString()}` },
              { label: "Stuck", value: stuckBills.length },
              { label: "Collected", value: collectedBills.length },
            ].map((c) => (
              <div key={c.label} style={{ ...cardStyle, padding: "12px 14px" }}>
                <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: COLOURS.SLATE, marginBottom: "6px" }}>{c.label}</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: COLOURS.NAVY, fontFamily: "var(--font-mono)" }}>{c.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* KANBAN STAGE BOARD */}
        {loading ? (
          <SkeletonRows count={4} height="60px" />
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <SectionTitle title="Stage Board" />
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {canEdit && !isMobile && <span style={{ fontSize: "11px", color: COLOURS.SLATE, marginRight: "8px" }}>Drag to move</span>}
                <button onClick={() => scrollBoard("left")} disabled={!canScrollLeft} style={scrollNavBtn(canScrollLeft)}>&#8249;</button>
                <button onClick={() => scrollBoard("right")} disabled={!canScrollRight} style={scrollNavBtn(canScrollRight)}>&#8250;</button>
              </div>
            </div>
            <div ref={scrollRef} onScroll={checkScroll} style={{
              display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "12px", marginBottom: "14px",
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
                      minWidth: isMobile ? "255px" : "230px", maxWidth: "270px", flex: "0 0 auto",
                      border: `1px solid ${isDragTarget ? COLOURS.BLUE : COLOURS.HAIRLINE}`,
                      borderRadius: RADII.CARD,
                      backgroundColor: isDragTarget ? `${COLOURS.BLUE}08` : COLOURS.CARD_ALT,
                      transition: "border-color 0.15s, background-color 0.15s",
                      scrollSnapAlign: "start",
                    }}
                  >
                    {/* Stage header */}
                    <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, borderRadius: `${RADII.CARD} ${RADII.CARD} 0 0` }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>
                        {stage.stage_name}
                        {stage.stage_order === IC_GRN_STAGE && <span style={{ fontSize: "10px", fontWeight: 400, color: COLOURS.SLATE, marginLeft: "6px" }}>(skip: Tax/Ret.)</span>}
                      </div>
                      <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px", fontFamily: "var(--font-mono)" }}>
                        {stageBills.length} bill{stageBills.length !== 1 ? "s" : ""} · {stage.working_day_budget > 0 ? `${stage.working_day_budget}d budget` : "Start"}
                      </div>
                    </div>

                    <div style={{ padding: "8px", minHeight: "100px" }}>
                      {stageBills.length === 0 ? (
                        <div style={{ padding: "12px", textAlign: "center", color: COLOURS.SLATE, fontSize: "12px" }}>Empty</div>
                      ) : (
                        stageBills.map((bill) => {
                          const elapsed = workingDaysSince(bill.current_stage_entered_date);
                          const isStuck = stage.working_day_budget > 0 && elapsed >= stage.working_day_budget;
                          const isWarning = stage.working_day_budget > 0 && elapsed >= stage.working_day_budget - 1 && !isStuck;
                          const next = nextStageFor(bill, stage.stage_order);
                          const prev = prevStageFor(bill, stage.stage_order);
                          const isDragging = dragBillId === bill.id;
                          const isEditing = editBillId === bill.id;
                          return (
                            <div
                              key={bill.id}
                              draggable={canEdit && !isEditing}
                              onDragStart={(e) => onDragStart(e, bill.id)}
                              onDragEnd={onDragEnd}
                              style={{
                                border: `1px solid ${isStuck ? COLOURS.RED : isWarning ? COLOURS.AMBER : COLOURS.HAIRLINE}`,
                                borderLeft: `3px solid ${isStuck ? COLOURS.RED : isWarning ? COLOURS.AMBER : COLOURS.GREEN}`,
                                borderRadius: RADII.SM, padding: "8px 10px", backgroundColor: COLOURS.CARD, marginBottom: "6px",
                                cursor: canEdit && !isEditing ? "grab" : "default",
                                opacity: isDragging ? 0.5 : 1,
                                transition: "opacity 0.15s",
                              }}
                            >
                              {isEditing ? (
                                <div>
                                  <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "8px" }}>Edit Bill</div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                                    <div style={{ gridColumn: "1 / -1" }}>
                                      <label style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: "3px" }}>Customer</label>
                                      <input value={editForm.utility} onChange={(e) => setEditForm({ ...editForm, utility: e.target.value })} style={{ ...inp, display: "block", width: "100%", boxSizing: "border-box" as const }} />
                                    </div>
                                    <div>
                                      <label style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: "3px" }}>Amount (PKR)</label>
                                      <input type="number" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} style={{ ...inp, display: "block", width: "100%", boxSizing: "border-box" as const }} />
                                    </div>
                                    <div>
                                      <label style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: "3px" }}>Date Submitted</label>
                                      <DateInput value={editForm.date_submitted} onChange={(e) => setEditForm({ ...editForm, date_submitted: e.target.value })} style={{ ...inp, display: "block", width: "100%", boxSizing: "border-box" as const }} />
                                    </div>
                                    <div>
                                      <label style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: "3px" }}>Bill Type</label>
                                      <select value={editForm.bill_type} onChange={(e) => setEditForm({ ...editForm, bill_type: e.target.value })} style={{ ...inp, display: "block", width: "100%", boxSizing: "border-box" as const }}>
                                        {BILL_TYPES.map((t) => <option key={t}>{t}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: "3px" }}>Invoice Ref</label>
                                      <input value={editForm.invoice_ref} onChange={(e) => setEditForm({ ...editForm, invoice_ref: e.target.value })} style={{ ...inp, display: "block", width: "100%", boxSizing: "border-box" as const }} placeholder="Optional" />
                                    </div>
                                    {!skipsICGRN(editForm.bill_type) && (
                                      <div>
                                        <label style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: "3px" }}>IC Ref</label>
                                        <input value={editForm.ic_ref} onChange={(e) => setEditForm({ ...editForm, ic_ref: e.target.value })} style={{ ...inp, display: "block", width: "100%", boxSizing: "border-box" as const }} placeholder="Optional" />
                                      </div>
                                    )}
                                    {!skipsICGRN(editForm.bill_type) && (
                                      <div>
                                        <label style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: "3px" }}>GRN Ref</label>
                                        <input value={editForm.grn_ref} onChange={(e) => setEditForm({ ...editForm, grn_ref: e.target.value })} style={{ ...inp, display: "block", width: "100%", boxSizing: "border-box" as const }} placeholder="Optional" />
                                      </div>
                                    )}
                                    <div style={{ gridColumn: "1 / -1" }}>
                                      <label style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: "3px" }}>Notes</label>
                                      <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} style={{ ...inp, display: "block", width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const }} placeholder="Optional" />
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                                    <button onClick={saveEdit} disabled={savingEdit} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: RADII.PILL, padding: "5px 12px", fontSize: "11px", fontWeight: 600, cursor: "pointer", opacity: savingEdit ? 0.6 : 1 }}>{savingEdit ? "Saving…" : "Save"}</button>
                                    <button onClick={() => setEditBillId(null)} style={{ backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "5px 12px", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                                    <button onClick={() => { if (confirm("Delete this bill? This cannot be undone.")) deleteBill(bill.id); }} disabled={deletingId === bill.id} style={{ backgroundColor: COLOURS.RED, color: "white", border: "none", borderRadius: RADII.PILL, padding: "5px 12px", fontSize: "11px", fontWeight: 600, cursor: "pointer", marginLeft: "auto", opacity: deletingId === bill.id ? 0.6 : 1 }}>{deletingId === bill.id ? "Deleting…" : "Delete"}</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{bill.utility}</div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                      {bill.bill_type !== "Normal" && (
                                        <span style={{
                                          fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: RADII.PILL,
                                          backgroundColor: bill.bill_type === "Sales Tax" ? COLOURS.CARD_ALT : COLOURS.WARNING_SOFT,
                                          color: bill.bill_type === "Sales Tax" ? COLOURS.BLUE : COLOURS.AMBER,
                                          border: `1px solid ${bill.bill_type === "Sales Tax" ? COLOURS.HAIRLINE : COLOURS.AMBER}`,
                                        }}>{bill.bill_type}</span>
                                      )}
                                      {canEditBill(bill) && (
                                        <button onClick={() => startEdit(bill)} style={{ background: "none", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.XS, padding: "1px 7px", fontSize: "10px", fontWeight: 600, cursor: "pointer", color: COLOURS.SLATE }}>Edit</button>
                                      )}
                                    </div>
                                  </div>
                                  <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", fontFamily: "var(--font-mono)" }}>
                                    PKR {bill.amount.toLocaleString()} · {formatDateUK(bill.date_submitted)}
                                  </div>
                                  <div style={{ fontSize: "11px", color: isStuck ? COLOURS.RED : isWarning ? COLOURS.AMBER : COLOURS.SLATE, fontWeight: isStuck || isWarning ? 600 : 400, marginTop: "2px" }}>
                                    {elapsed}d in stage {isStuck ? "(STUCK)" : isWarning ? "(due soon)" : ""}
                                  </div>
                                  {bill.invoice_ref && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Inv: {bill.invoice_ref}</div>}
                                  {bill.ic_ref && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>IC: {bill.ic_ref}</div>}
                                  {bill.grn_ref && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>GRN: {bill.grn_ref}</div>}
                                  {bill.notes && <div style={{ fontSize: "11px", color: COLOURS.SLATE, fontStyle: "italic", marginTop: "2px" }}>{bill.notes}</div>}
                                  {canEdit && (
                                    <div style={{ display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" }}>
                                      {prev && (
                                        <button onClick={() => moveToStage(bill.id, prev.stage_order)} style={{ backgroundColor: COLOURS.CARD_ALT, color: COLOURS.INK_700, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "3px 8px", fontSize: "10px", fontWeight: 600, cursor: "pointer" }} title={`Send back to ${prev.stage_name}`}>Back</button>
                                      )}
                                      {next && (
                                        <button onClick={() => moveToStage(bill.id, next.stage_order)} style={{ backgroundColor: COLOURS.CARD_ALT, color: COLOURS.BLUE, border: `1px solid ${COLOURS.BLUE}`, borderRadius: RADII.PILL, padding: "3px 8px", fontSize: "10px", fontWeight: 600, cursor: "pointer" }} title={`Move to ${next.stage_name}`}>Next</button>
                                      )}
                                      <button onClick={() => markCollected(bill.id)} style={{ backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, border: `1px solid ${COLOURS.GREEN}`, borderRadius: RADII.PILL, padding: "3px 8px", fontSize: "10px", fontWeight: 600, cursor: "pointer" }}>Collected</button>
                                    </div>
                                  )}
                                </>
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
                  minWidth: isMobile ? "255px" : "230px", maxWidth: "270px", flex: "0 0 auto",
                  border: `1px solid ${dragOverStage === -1 ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                  borderRadius: RADII.CARD,
                  backgroundColor: dragOverStage === -1 ? COLOURS.SUCCESS_SOFT : COLOURS.SUCCESS_SOFT,
                  transition: "border-color 0.15s, background-color 0.15s",
                  scrollSnapAlign: "start",
                }}
              >
                <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, borderRadius: `${RADII.CARD} ${RADII.CARD} 0 0` }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.GREEN, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Collected</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px", fontFamily: "var(--font-mono)" }}>{collectedBills.length} total</div>
                </div>
                <div style={{ padding: "8px", textAlign: "center", color: COLOURS.GREEN, fontSize: "12px" }}>
                  {canEdit ? "Drop here or click Collected" : "Cheque received — bill complete"}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Collected Bills by Plant */}
        {!loading && collectedBills.length > 0 && (
          <div style={{ ...cardStyle, padding: "14px", marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showCollected ? "10px" : "0" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>
                Collected Bills by Plant
              </div>
              <button onClick={() => setShowCollected(!showCollected)} style={ghostBtnSlate}>{showCollected ? "Hide" : "Show"}</button>
            </div>
            {showCollected && (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
                {collectedByPlant.map((group) => (
                  <div key={group.plant} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderLeft: `3px solid ${COLOURS.GREEN}`, borderRadius: RADII.SM, padding: "10px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" }}>{group.plant}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                      {group.count} bill{group.count !== 1 ? "s" : ""} · PKR {group.total.toLocaleString()}
                    </div>
                    {group.bills.slice(0, 5).map((bill) => (
                      <div key={bill.id} style={{ fontSize: "12px", color: COLOURS.SLATE, padding: "3px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <span style={{ fontWeight: 600, color: COLOURS.NAVY }}>{bill.utility}</span> · <span style={{ fontFamily: "var(--font-mono)" }}>PKR {bill.amount.toLocaleString()}</span> · {bill.received_date ? formatDateUK(bill.received_date) : "—"}
                      </div>
                    ))}
                    {group.bills.length > 5 && (
                      <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "4px" }}>+{group.bills.length - 5} more</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pipeline Stage Summary Bar */}
        {!loading && stages.length > 0 && bills.length > 0 && (
          <div style={{ ...cardStyle, padding: "12px 14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px", color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Pipeline Stages</div>
            <div style={{ display: "flex", borderRadius: RADII.PILL, overflow: "hidden", height: "24px", backgroundColor: COLOURS.HAIRLINE }}>
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
                    fontSize: "11px", fontWeight: 600, color: "white", whiteSpace: "nowrap" as const, padding: "0 4px",
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
                  <span key={stage.id} style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                    {stage.stage_name}: <strong style={{ fontFamily: "var(--font-mono)" }}>{count}</strong>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Collection Velocity */}
        {!loading && stages.length > 0 && bills.length > 0 && (
          <div style={{ ...cardStyle, padding: "12px 14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px", color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Collection Velocity (avg days in stage)</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: "6px" }}>
              {stages.map((stage) => {
                const stageBills = bills.filter((b) => b.current_stage_order === stage.stage_order);
                const avgDays = stageBills.length > 0
                  ? Math.round(stageBills.reduce((s, b) => s + workingDaysSince(b.current_stage_entered_date), 0) / stageBills.length)
                  : 0;
                const overBudget = stage.working_day_budget > 0 && avgDays > stage.working_day_budget;
                const nearBudget = stage.working_day_budget > 0 && avgDays >= stage.working_day_budget - 1 && !overBudget;
                const color = overBudget ? COLOURS.RED : nearBudget ? COLOURS.AMBER : COLOURS.GREEN;
                return (
                  <div key={stage.id} style={{ textAlign: "center" as const }}>
                    <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginBottom: "4px", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" }}>{stage.stage_name}</div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{avgDays}d</div>
                    <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>{stage.working_day_budget > 0 ? `/ ${stage.working_day_budget}d budget` : "Start"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bills in Progress — Customer Summary */}
        {!loading && customerRows.length > 0 && (
          <div style={{ ...cardStyle, padding: "14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px", color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>
              Bills in Progress: <span style={{ color: recRed > 0 ? COLOURS.RED : COLOURS.GREEN }}>{recRed > 0 ? `${recRedCount} BILL(S) STUCK` : "ALL ON TRACK"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "8px", marginBottom: "12px" }}>
              {[
                { label: "Total Tracked", value: totalAmount, color: COLOURS.NAVY },
                { label: "On Time", value: recGreen, color: COLOURS.GREEN },
                { label: "Due Soon", value: recAmber, color: COLOURS.AMBER },
                { label: "Stuck", value: recRed, color: COLOURS.RED },
              ].map((c) => (
                <div key={c.label} style={{ ...cardStyle, padding: "8px 10px" }}>
                  <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.06em", fontWeight: 500 }}>{c.label}</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: c.color, fontFamily: "var(--font-mono)", marginTop: "4px" }}>PKR {c.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "420px" }}>
                <thead>
                  <tr>
                    {["Customer", "On Time", "Due Soon", "Stuck", "Total", "Aging"].map((h) => (
                      <th key={h} style={{ ...tableHeaderStyle, textAlign: "left" as const, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "7px 10px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customerRows.map((r) => (
                    <tr key={r.customer}>
                      <td style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "7px 10px", fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{r.customer}</td>
                      <td style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "7px 10px", fontSize: "13px", color: COLOURS.GREEN, fontFamily: "var(--font-mono)" }}>{r.greenAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "7px 10px", fontSize: "13px", color: COLOURS.AMBER, fontFamily: "var(--font-mono)" }}>{r.amberAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "7px 10px", fontSize: "13px", color: COLOURS.RED, fontWeight: r.redAmount > 0 ? 600 : 400, fontFamily: "var(--font-mono)" }}>{r.redAmount.toLocaleString()}</td>
                      <td style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "7px 10px", fontSize: "13px", fontWeight: 600, fontFamily: "var(--font-mono)" }}>{r.totalAmount.toLocaleString()}</td>
                      {(() => { const bucket = customerAging.get(r.customer) || "0-30"; return (
                        <td style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "7px 10px", fontSize: "12px", fontWeight: 600, color: AGING_COLOURS[bucket] }}>{bucket === "90+" ? "90+ days" : `${bucket} days`}</td>
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
          <div style={{ ...cardStyle, padding: "14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px", color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Bill Aging Report</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
              {([
                { label: "0-30 days", bucket: "0-30" as const },
                { label: "31-60 days", bucket: "31-60" as const },
                { label: "61-90 days", bucket: "61-90" as const },
                { label: "90+ days", bucket: "90+" as const },
              ] as const).map((c) => (
                <div key={c.bucket} style={{ ...cardStyle, padding: "10px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.06em", fontWeight: 500 }}>{c.label}</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: AGING_COLOURS[c.bucket], fontFamily: "var(--font-mono)", marginTop: "6px" }}>PKR {agingTotals[c.bucket].toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}
