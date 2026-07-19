"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { COMPANIES, getCompanyById } from "../../../lib/constants";
import { formatDateUK } from "../../../lib/dateUtils";
import DateInputWithCalendar from "../../../lib/DateInputWithCalendar";
import { useMobile } from "../../../lib/useMobile";
import { COLOURS, RADII, cardStyle, SectionTitle } from "../../../lib/SharedUI";
import { logAction } from "../../../lib/audit-log";

// ─── Types ───────────────────────────────────────────────────────────────────

type Exit = {
  id: string;
  company_id: string | null;
  member_email: string | null;
  member_name: string;
  department: string | null;
  exit_type: string;
  last_day: string;
  notice_period_days: number | null;
  checklist_state: Record<string, boolean>;
  settlement_amount: number | null;
  settlement_due_date: string | null;
  settlement_paid_at: string | null;
  notes: string | null;
  status: string;
  created_at: string;
};

type Summary = {
  active_exits: number;
  completed_this_month: number;
  settlements_overdue: number;
  voluntary_ytd: number;
};

// ─── Checklist definition ────────────────────────────────────────────────────

const CHECKLIST: { key: string; label: string }[] = [
  { key: "letter_received",        label: "Resignation / termination letter received" },
  { key: "exit_interview_sched",   label: "Exit interview scheduled" },
  { key: "exit_interview_done",    label: "Exit interview completed" },
  { key: "assets_returned",        label: "Assets returned (laptop, access card, keys)" },
  { key: "system_access_revoked",  label: "System & email access revoked" },
  { key: "flowcm_deactivated",     label: "FlowHCM profile deactivated" },
  { key: "settlement_calculated",  label: "Final settlement calculated" },
  { key: "settlement_paid",        label: "Final settlement paid" },
  { key: "eobi_deregistered",      label: "EOBI deregistration submitted" },
  { key: "experience_letter",      label: "Experience letter issued" },
];

const EXIT_TYPES = ["Resignation", "Termination", "Retirement", "Contract End", "Redundancy"];
const DEPARTMENTS = ["Unze Trading Ops", "Finance", "HR", "Admin", "Legal", "Sales", "Audit", "IT"];

// ─── Shared micro-styles ─────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px",
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
  fontSize: "14px", boxSizing: "border-box", color: COLOURS.NAVY,
  backgroundColor: COLOURS.CARD,
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE,
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px",
};
const btnPrimary: React.CSSProperties = {
  backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none",
  borderRadius: RADII.PILL, padding: "8px 18px", fontSize: "13px",
  fontWeight: 600, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  backgroundColor: "transparent", color: COLOURS.SLATE,
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL,
  padding: "7px 14px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function isOverdue(exit: Exit): boolean {
  return (
    exit.status === "Active" &&
    exit.settlement_due_date !== null &&
    exit.settlement_paid_at === null &&
    new Date(exit.settlement_due_date) < new Date()
  );
}

function checklistPct(state: Record<string, boolean>): number {
  const done = CHECKLIST.filter((s) => state[s.key]).length;
  return Math.round((done / CHECKLIST.length) * 100);
}

// ─── Add Exit Form ────────────────────────────────────────────────────────────

function AddExitForm({ onSaved }: { onSaved: () => void }) {
  const isMobile = useMobile();
  const today = new Date().toISOString().slice(0, 10);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [name, setName]           = useState("");
  const [email, setEmail]         = useState("");
  const [companyId, setCompanyId] = useState("");
  const [dept, setDept]           = useState("");
  const [exitType, setExitType]   = useState("Resignation");
  const [lastDay, setLastDay]     = useState(today);
  const [noticeDays, setNoticeDays] = useState("");
  const [settlAmount, setSettlAmount] = useState("");
  const [settlDue, setSettlDue]   = useState("");
  const [notes, setNotes]         = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("hr_offboarding_exits").insert({
      member_name: name,
      member_email: email || null,
      company_id: companyId || null,
      department: dept || null,
      exit_type: exitType,
      last_day: lastDay,
      notice_period_days: noticeDays ? Number(noticeDays) : null,
      settlement_amount: settlAmount ? Number(settlAmount) : null,
      settlement_due_date: settlDue || null,
      checklist_state: {},
      status: "Active",
    });
    setSaving(false);
    if (error) { setMsg("Error: " + error.message); return; }
    logAction("Created", "hr_offboarding_exits", name);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: RADII.CARD, padding: "20px", backgroundColor: COLOURS.CARD, marginBottom: "14px" }}>
      {msg && <div style={{ marginBottom: "10px", fontSize: "13px", color: COLOURS.RED }}>{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px" }}>
        <label style={lbl}>Full name <input style={{ ...inp, marginTop: "4px" }} value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Kamran Asif" /></label>
        <label style={lbl}>Email (optional) <input style={{ ...inp, marginTop: "4px" }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="employee@unzegroup.com" /></label>
        <label style={lbl}>
          Company
          <select style={{ ...inp, marginTop: "4px" }} value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
            <option value="">Select</option>
            {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Department
          <select style={{ ...inp, marginTop: "4px" }} value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">Select</option>
            {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Exit type
          <select style={{ ...inp, marginTop: "4px" }} value={exitType} onChange={(e) => setExitType(e.target.value)}>
            {EXIT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Last day
          <DateInputWithCalendar style={{ ...inp, marginTop: "4px" }} value={lastDay} onChange={(e) => setLastDay(e.target.value)} required />
        </label>
        <label style={lbl}>Notice period (days) <input style={{ ...inp, marginTop: "4px" }} type="number" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} placeholder="e.g. 30" /></label>
        <label style={lbl}>Settlement amount (PKR) <input style={{ ...inp, marginTop: "4px" }} type="number" value={settlAmount} onChange={(e) => setSettlAmount(e.target.value)} placeholder="e.g. 85000" /></label>
        <label style={lbl}>
          Settlement due date
          <DateInputWithCalendar style={{ ...inp, marginTop: "4px" }} value={settlDue} onChange={(e) => setSettlDue(e.target.value)} />
        </label>
        <label style={{ ...lbl, gridColumn: isMobile ? undefined : "1 / -1" }}>
          Notes
          <textarea style={{ ...inp, marginTop: "4px", height: "52px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <button type="submit" disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Add exit"}</button>
      </div>
    </form>
  );
}

// ─── Exit row with expandable checklist ──────────────────────────────────────

function ExitRow({ exit, onUpdated }: { exit: Exit; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState]       = useState<Record<string, boolean>>(exit.checklist_state || {});
  const [saving, setSaving]     = useState(false);
  const [showSettleForm, setShowSettleForm] = useState(false);
  const [settlePaid, setSettlePaid] = useState(exit.settlement_paid_at || "");

  const pct      = checklistPct(state);
  const overdue  = isOverdue(exit);
  const daysLeft = daysUntil(exit.last_day);
  const allDone  = CHECKLIST.every((s) => state[s.key]);

  async function toggleStep(key: string) {
    const next = { ...state, [key]: !state[key] };
    setState(next);
    setSaving(true);
    await supabase
      .from("hr_offboarding_exits")
      .update({ checklist_state: next })
      .eq("id", exit.id);
    setSaving(false);
  }

  async function markCompleted() {
    await supabase.from("hr_offboarding_exits").update({ status: "Completed" }).eq("id", exit.id);
    logAction("Updated", "hr_offboarding_exits", `Status → Completed`, exit.id);
    onUpdated();
  }

  async function saveSettlement(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("hr_offboarding_exits").update({ settlement_paid_at: settlePaid }).eq("id", exit.id);
    logAction("Updated", "hr_offboarding_exits", `Settlement paid → ${settlePaid}`, exit.id);
    setShowSettleForm(false);
    onUpdated();
  }

  const company = getCompanyById(exit.company_id || "");

  return (
    <div style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
      {/* Row header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "11px 16px", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px",
          backgroundColor: overdue ? COLOURS.DANGER_SOFT : expanded ? COLOURS.CARD_ALT : COLOURS.CARD,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{exit.member_name}</div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
            {company?.shortCode || "—"} · {exit.department || "—"} · {exit.exit_type} · Last day {formatDateUK(exit.last_day)}
            {daysLeft !== null && daysLeft > 0 && ` · ${daysLeft}d remaining`}
          </div>
          {/* Progress bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
            <div style={{ flex: 1, height: "4px", background: COLOURS.TRACK, borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? COLOURS.GREEN : COLOURS.BLUE, borderRadius: "2px" }} />
            </div>
            <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>{pct}%</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
          {overdue && (
            <span style={{ fontSize: "11px", fontWeight: 500, background: COLOURS.DANGER_SOFT, color: COLOURS.RED, padding: "2px 9px", borderRadius: RADII.PILL }}>
              Settlement overdue
            </span>
          )}
          <span style={{
            fontSize: "11px", fontWeight: 500, padding: "2px 9px", borderRadius: RADII.PILL,
            background: exit.status === "Completed" ? COLOURS.SUCCESS_SOFT : "#FFF4E5",
            color: exit.status === "Completed" ? COLOURS.GREEN : COLOURS.AMBER,
          }}>
            {exit.status}
          </span>
          <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{expanded ? "▼" : "▶"}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "14px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>

            {/* Checklist */}
            <div>
              <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "10px" }}>
                Exit checklist {saving && <span style={{ color: COLOURS.BLUE }}>· Saving…</span>}
              </div>
              {CHECKLIST.map((step) => (
                <div
                  key={step.key}
                  onClick={() => toggleStep(step.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "7px 0",
                    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{
                    width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0,
                    border: `2px solid ${state[step.key] ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                    background: state[step.key] ? COLOURS.GREEN : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {state[step.key] && <span style={{ color: "#fff", fontSize: "11px" }}>✓</span>}
                  </div>
                  <span style={{
                    fontSize: "13px",
                    color: state[step.key] ? COLOURS.SLATE : COLOURS.NAVY,
                    textDecoration: state[step.key] ? "line-through" : "none",
                  }}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Details panel */}
            <div>
              <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "10px" }}>Details</div>

              {/* Settlement */}
              <div style={{ border: `1px solid ${overdue ? COLOURS.RED : COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "12px", backgroundColor: COLOURS.CARD, marginBottom: "10px" }}>
                <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "6px" }}>Final settlement</div>
                {exit.settlement_amount !== null && (
                  <div style={{ fontSize: "20px", fontWeight: 600, color: COLOURS.NAVY, fontVariantNumeric: "tabular-nums", marginBottom: "4px" }}>
                    PKR {exit.settlement_amount.toLocaleString()}
                  </div>
                )}
                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                  {exit.settlement_due_date ? `Due: ${formatDateUK(exit.settlement_due_date)}` : "No due date set"}
                  {exit.settlement_paid_at ? ` · Paid ${formatDateUK(exit.settlement_paid_at)}` : ""}
                </div>
                {!exit.settlement_paid_at && (
                  <>
                    {!showSettleForm ? (
                      <button onClick={() => setShowSettleForm(true)} style={{ ...btnGhost, marginTop: "8px", fontSize: "12px", padding: "5px 12px" }}>
                        Mark as paid
                      </button>
                    ) : (
                      <form onSubmit={saveSettlement} style={{ marginTop: "8px", display: "flex", gap: "6px", alignItems: "flex-end" }}>
                        <label style={{ ...lbl, flex: 1 }}>
                          Payment date
                          <DateInputWithCalendar style={{ ...inp, marginTop: "4px" }} value={settlePaid} onChange={(e) => setSettlePaid(e.target.value)} required />
                        </label>
                        <button type="submit" style={{ ...btnPrimary, padding: "7px 14px" }}>Save</button>
                      </form>
                    )}
                  </>
                )}
                {exit.settlement_paid_at && (
                  <span style={{ fontSize: "11px", fontWeight: 500, background: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, padding: "2px 9px", borderRadius: RADII.PILL, marginTop: "8px", display: "inline-block" }}>
                    ✓ Paid {formatDateUK(exit.settlement_paid_at)}
                  </span>
                )}
              </div>

              {/* Info fields */}
              {[
                { label: "Notice period",   value: exit.notice_period_days ? `${exit.notice_period_days} days` : "—" },
                { label: "Email",           value: exit.member_email || "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{label}</span>
                  <span style={{ fontSize: "12px", color: COLOURS.NAVY, fontWeight: 500 }}>{value}</span>
                </div>
              ))}

              {exit.notes && (
                <div style={{ marginTop: "10px", fontSize: "13px", color: COLOURS.SLATE }}>Notes: {exit.notes}</div>
              )}

              {/* Mark completed */}
              {exit.status === "Active" && allDone && (
                <button onClick={markCompleted} style={{ ...btnPrimary, marginTop: "14px", width: "100%" }}>
                  Mark exit as completed ✓
                </button>
              )}
              {exit.status === "Active" && !allDone && (
                <div style={{ marginTop: "14px", fontSize: "12px", color: COLOURS.SLATE }}>
                  Complete all checklist steps to close this exit.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HROffboarding() {
  const [exits, setExits]       = useState<Exit[]>([]);
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter]     = useState<"Active" | "Completed" | "All">("Active");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: exitData }, { data: summaryData }] = await Promise.all([
      supabase.from("hr_offboarding_exits").select("*").order("last_day", { ascending: true }),
      supabase.rpc("get_offboarding_summary"),
    ]);
    setExits(exitData || []);
    if (summaryData && summaryData.length > 0) setSummary(summaryData[0]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const overdueExits  = exits.filter(isOverdue);
  const filteredExits = exits.filter((e) =>
    filter === "All" ? true : e.status === filter
  );

  const kpis = [
    { label: "Active exits",          value: summary?.active_exits ?? 0,         amber: (summary?.active_exits ?? 0) > 0 },
    { label: "Completed this month",  value: summary?.completed_this_month ?? 0, green: true },
    { label: "Settlements overdue",   value: summary?.settlements_overdue ?? 0,  red: (summary?.settlements_overdue ?? 0) > 0 },
    { label: "Voluntary exits (YTD)", value: summary?.voluntary_ytd ?? 0 },
  ];

  const pillStyle = (f: typeof filter): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 500,
    border: `1px solid ${filter === f ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    background: filter === f ? COLOURS.NAVY : COLOURS.CARD_ALT,
    color: filter === f ? COLOURS.CARD : COLOURS.SLATE,
    cursor: "pointer",
  });

  return (
    <>
      {/* Settlement overdue warning */}
      {!loading && overdueExits.length > 0 && (
        <div style={{
          background: COLOURS.DANGER_SOFT, border: `1px solid ${COLOURS.RED}`,
          borderLeft: `3px solid ${COLOURS.RED}`, borderRadius: RADII.SM,
          padding: "10px 14px", marginBottom: "14px", fontSize: "13px",
          color: COLOURS.RED, fontWeight: 500,
        }}>
          ⚠ {overdueExits.length} final settlement{overdueExits.length > 1 ? "s are" : " is"} overdue:{" "}
          {overdueExits.map((e) => e.member_name).join(", ")}
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "14px" }}>
        {kpis.map(({ label, value, green, amber, red }) => (
          <div key={label} style={{ ...cardStyle, padding: "16px 20px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "8px" }}>{label}</div>
            <div style={{
              fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
              fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              color: red ? COLOURS.RED : green ? COLOURS.GREEN : amber ? COLOURS.AMBER : COLOURS.NAVY,
            }}>
              {loading ? "—" : value}
            </div>
          </div>
        ))}
      </div>

      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
        <SectionTitle title="Exit records" />
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={pillStyle("Active")}    onClick={() => setFilter("Active")}>Active</button>
          <button style={pillStyle("Completed")} onClick={() => setFilter("Completed")}>Completed</button>
          <button style={pillStyle("All")}       onClick={() => setFilter("All")}>All</button>
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none",
            borderRadius: RADII.PILL, padding: "7px 16px", fontSize: "13px",
            fontWeight: 600, cursor: "pointer",
          }}>
            {showForm ? "Cancel" : "+ Add exit"}
          </button>
        </div>
      </div>

      {showForm && <AddExitForm onSaved={() => { setShowForm(false); load(); }} />}

      {/* Exit list */}
      {loading ? (
        <p style={{ color: COLOURS.SLATE }}>Loading…</p>
      ) : filteredExits.length === 0 ? (
        <div style={{ ...cardStyle, padding: "24px", color: COLOURS.SLATE, fontSize: "14px" }}>
          {filter === "Active" ? "No active exits." : filter === "Completed" ? "No completed exits yet." : "No exit records yet."}
        </div>
      ) : (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
          {filteredExits.map((exit) => (
            <ExitRow key={exit.id} exit={exit} onUpdated={load} />
          ))}
        </div>
      )}
    </>
  );
}
