"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, CountCard } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";

type Stage = { id: string; stage_order: number; stage_name: string; working_day_budget: number };
type Receivable = {
  id: string;
  utility: string;
  plant_id: string;
  invoice_ref: string | null;
  amount: number;
  currency: string;
  date_submitted: string;
  current_stage_order: number;
  current_stage_entered_date: string;
  status: string;
  notes: string | null;
};

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

export default function ReceivablesKanbanPage() {
  const isMobile = useMobile();
  const [stages, setStages] = useState<Stage[]>([]);
  const [bills, setBills] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    const [stagesRes, billsRes] = await Promise.all([
      supabase.from("receivable_stages").select("*").order("stage_order"),
      supabase.from("receivables").select("*").neq("status", "Collected").order("date_submitted"),
    ]);
    setStages(stagesRes.data || []);
    setBills(billsRes.data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function moveToStage(billId: string, newOrder: number) {
    await supabase.from("receivables").update({
      current_stage_order: newOrder,
      current_stage_entered_date: new Date().toISOString().slice(0, 10),
    }).eq("id", billId);
    logAction("Updated", "receivables", `Moved to stage ${newOrder}`, billId);
    loadData();
  }

  async function markCollected(billId: string) {
    await supabase.from("receivables").update({
      status: "Collected",
      received_date: new Date().toISOString().slice(0, 10),
    }).eq("id", billId);
    logAction("Updated", "receivables", "Marked as collected", billId);
    loadData();
  }

  const totalAmount = bills.reduce((s, b) => s + b.amount, 0);
  const stuckBills = bills.filter((b) => {
    const stage = stages.find((s) => s.stage_order === b.current_stage_order);
    if (!stage) return false;
    return workingDaysSince(b.current_stage_entered_date) >= stage.working_day_budget;
  });

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader title="Receivables Pipeline" subtitle="Track bills through collection stages — drag or click to advance" />

        {!loading && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
            <CountCard label="Total Bills" value={bills.length} color={COLOURS.BLUE} />
            <CountCard label="Total Amount" value={Math.round(totalAmount)} color={COLOURS.NAVY} />
            <CountCard label="Stuck" value={stuckBills.length} color={COLOURS.RED} />
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
                  {/* Column header */}
                  <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: "white", borderRadius: "8px 8px 0 0" }}>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{stage.stage_name}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{stageBills.length} bill{stageBills.length !== 1 ? "s" : ""} · Budget: {stage.working_day_budget} days</div>
                  </div>

                  {/* Cards */}
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
                            {bill.invoice_ref && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Ref: {bill.invoice_ref}</div>}

                            <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                              {nextStage && (
                                <button onClick={() => moveToStage(bill.id, nextStage.stage_order)} style={{
                                  backgroundColor: COLOURS.BLUE, color: "white", border: "none", borderRadius: "4px",
                                  padding: "3px 8px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                                }} title={`Move to ${nextStage.stage_name}`}>→ Next</button>
                              )}
                              <button onClick={() => markCollected(bill.id)} style={{
                                backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: "4px",
                                padding: "3px 8px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                              }} title="Mark as collected">✓ Collected</button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}

            {/* Collected column */}
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
