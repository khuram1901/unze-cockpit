"use client";

/**
 * HRPayroll.tsx
 *
 * Three inner tabs:
 *  "Runs"      — Monthly payroll run tracker, status, KPIs. Default view.
 *  "Import"    — Upload FlowHCM CSV/Excel, map columns, create run + employee records.
 *  "Exceptions"— Cross-run exception log; add, resolve, filter by company.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { COMPANIES, getCompanyById } from "../../../lib/constants";
import { formatDateUK } from "../../../lib/dateUtils";
import DateInputWithCalendar from "../../../lib/DateInputWithCalendar";
import { useMobile } from "../../../lib/useMobile";
import { COLOURS, RADII, cardStyle, SectionTitle } from "../../../lib/SharedUI";
import { logAction } from "../../../lib/audit-log";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────

type RunRow = {
  run_id: string;
  company_id: string;
  company_name: string;
  payroll_month: string;     // e.g. "2026-07-01"
  total_gross: number | null;
  total_net: number | null;
  headcount: number | null;
  status: string;
  paid_date: string | null;
  open_exceptions: number;
  employee_count: number;
};

type Exception = {
  id: string;
  run_id: string | null;
  company_id: string | null;
  exception_type: string;
  employee_name: string | null;
  description: string | null;
  status: string;
  resolved_at: string | null;
  created_at: string;
};

type ParsedEmployee = {
  employee_id: string;
  employee_name: string;
  department: string;
  designation: string;
  basic_salary: number | null;
  allowances: number | null;
  deductions: number | null;
  net_pay: number | null;
  bank_account: string;
};

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

function monthLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function pkr(n: number | null): string {
  if (n === null) return "—";
  return "PKR " + n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    Paid:       { bg: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN },
    Processing: { bg: "#EEF1FC",            color: "#3B5BDB" },
    Pending:    { bg: "#FFF4E5",            color: COLOURS.AMBER },
  };
  const s = map[status] || { bg: COLOURS.TRACK, color: COLOURS.SLATE };
  return (
    <span style={{ fontSize: "11px", fontWeight: 500, padding: "2px 9px", borderRadius: RADII.PILL, background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

// ─── Run detail / expand ─────────────────────────────────────────────────────

function RunDetail({ run, onUpdated }: { run: RunRow; onUpdated: () => void }) {
  const [employees, setEmployees] = useState<ParsedEmployee[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [saving, setSaving]     = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [status, setStatus]     = useState(run.status);
  const [paidDate, setPaidDate] = useState(run.paid_date || "");
  const [notes, setNotes]       = useState("");
  const [showExcForm, setShowExcForm] = useState(false);
  const [excType, setExcType]   = useState("");
  const [excEmp, setExcEmp]     = useState("");
  const [excDesc, setExcDesc]   = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("hr_payroll_employees").select("*").eq("run_id", run.run_id).order("employee_name"),
      supabase.from("hr_payroll_exceptions").select("*").eq("run_id", run.run_id).order("created_at", { ascending: false }),
    ]).then(([{ data: emps }, { data: excs }]) => {
      setEmployees((emps || []) as ParsedEmployee[]);
      setExceptions((excs || []) as Exception[]);
    });
  }, [run.run_id]);

  async function saveStatus(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from("hr_payroll_runs").update({
      status,
      paid_date: status === "Paid" ? (paidDate || null) : null,
      notes: notes || null,
    }).eq("id", run.run_id);
    logAction("Updated", "hr_payroll_runs", `Status → ${status}`, run.run_id);
    setSaving(false);
    setShowEdit(false);
    onUpdated();
  }

  async function addException(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("hr_payroll_exceptions").insert({
      run_id: run.run_id,
      company_id: run.company_id,
      exception_type: excType,
      employee_name: excEmp || null,
      description: excDesc || null,
      status: "Open",
    });
    logAction("Created", "hr_payroll_exceptions", excType);
    setExcType(""); setExcEmp(""); setExcDesc(""); setShowExcForm(false);
    const { data } = await supabase.from("hr_payroll_exceptions").select("*").eq("run_id", run.run_id).order("created_at", { ascending: false });
    setExceptions((data || []) as Exception[]);
    onUpdated();
  }

  async function resolveException(id: string) {
    await supabase.from("hr_payroll_exceptions").update({ status: "Resolved", resolved_at: new Date().toISOString() }).eq("id", id);
    setExceptions((prev) => prev.map((e) => e.id === id ? { ...e, status: "Resolved" } : e));
    onUpdated();
  }

  return (
    <div style={{ padding: "14px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>

        {/* Summary figures */}
        <div style={{ ...cardStyle, padding: "14px 16px" }}>
          <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "10px" }}>Summary</div>
          {[
            { label: "Gross payroll", value: pkr(run.total_gross) },
            { label: "Net payroll",   value: pkr(run.total_net) },
            { label: "Headcount",     value: run.headcount ?? employees.length ?? "—" },
            { label: "Paid date",     value: run.paid_date ? formatDateUK(run.paid_date) : "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
              <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{label}</span>
              <span style={{ fontSize: "13px", color: COLOURS.NAVY, fontWeight: 600 }}>{String(value)}</span>
            </div>
          ))}
          <button onClick={() => setShowEdit(!showEdit)} style={{ ...btnGhost, marginTop: "10px", fontSize: "12px", padding: "5px 12px" }}>
            {showEdit ? "Cancel" : "Update status"}
          </button>
          {showEdit && (
            <form onSubmit={saveStatus} style={{ marginTop: "10px" }}>
              <label style={lbl}>
                Status
                <select style={{ ...inp, marginTop: "4px" }} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {["Pending", "Processing", "Paid"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              {status === "Paid" && (
                <label style={{ ...lbl, marginTop: "8px" }}>
                  Paid date
                  <DateInputWithCalendar style={{ ...inp, marginTop: "4px" }} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                </label>
              )}
              <label style={{ ...lbl, marginTop: "8px" }}>
                Notes
                <textarea style={{ ...inp, marginTop: "4px", height: "50px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <button type="submit" disabled={saving} style={{ ...btnPrimary, marginTop: "8px" }}>{saving ? "Saving…" : "Save"}</button>
            </form>
          )}
        </div>

        {/* Exceptions */}
        <div style={{ ...cardStyle, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE }}>
              Exceptions {exceptions.filter((e) => e.status === "Open").length > 0 && (
                <span style={{ background: COLOURS.DANGER_SOFT, color: COLOURS.RED, borderRadius: RADII.PILL, padding: "1px 7px", fontSize: "10px", marginLeft: "6px" }}>
                  {exceptions.filter((e) => e.status === "Open").length} open
                </span>
              )}
            </div>
            <button onClick={() => setShowExcForm(!showExcForm)} style={{ ...btnGhost, fontSize: "11px", padding: "3px 10px" }}>+ Add</button>
          </div>
          {showExcForm && (
            <form onSubmit={addException} style={{ marginBottom: "10px", padding: "10px", background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM }}>
              <label style={lbl}>Type <input style={{ ...inp, marginTop: "4px" }} value={excType} onChange={(e) => setExcType(e.target.value)} required placeholder="e.g. Missing bank detail" /></label>
              <label style={{ ...lbl, marginTop: "6px" }}>Employee name <input style={{ ...inp, marginTop: "4px" }} value={excEmp} onChange={(e) => setExcEmp(e.target.value)} /></label>
              <label style={{ ...lbl, marginTop: "6px" }}>Notes <input style={{ ...inp, marginTop: "4px" }} value={excDesc} onChange={(e) => setExcDesc(e.target.value)} /></label>
              <button type="submit" style={{ ...btnPrimary, marginTop: "8px", fontSize: "12px", padding: "5px 12px" }}>Add</button>
            </form>
          )}
          {exceptions.length === 0 && <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>No exceptions logged.</div>}
          {exceptions.map((ex) => (
            <div key={ex.id} style={{ padding: "8px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: ex.status === "Resolved" ? COLOURS.SLATE : COLOURS.NAVY, textDecoration: ex.status === "Resolved" ? "line-through" : "none" }}>{ex.exception_type}</div>
                {ex.employee_name && <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{ex.employee_name}</div>}
                {ex.description   && <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{ex.description}</div>}
              </div>
              {ex.status === "Open"
                ? <button onClick={() => resolveException(ex.id)} style={{ ...btnGhost, fontSize: "11px", padding: "3px 10px", flexShrink: 0 }}>Resolve</button>
                : <span style={{ fontSize: "11px", color: COLOURS.GREEN, flexShrink: 0 }}>✓</span>
              }
            </div>
          ))}
        </div>
      </div>

      {/* Employee table */}
      {employees.length > 0 && (
        <>
          <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "8px" }}>
            Employees ({employees.length})
          </div>
          <div style={{ overflowX: "auto", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  {["Name", "Department", "Basic", "Allowances", "Deductions", "Net Pay"].map((h) => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <td style={{ padding: "8px 12px", color: COLOURS.NAVY, fontWeight: 500 }}>{emp.employee_name}</td>
                    <td style={{ padding: "8px 12px", color: COLOURS.SLATE }}>{emp.department || "—"}</td>
                    <td style={{ padding: "8px 12px", color: COLOURS.NAVY, fontVariantNumeric: "tabular-nums" }}>{emp.basic_salary !== null ? emp.basic_salary.toLocaleString() : "—"}</td>
                    <td style={{ padding: "8px 12px", color: COLOURS.NAVY, fontVariantNumeric: "tabular-nums" }}>{emp.allowances !== null ? emp.allowances.toLocaleString() : "—"}</td>
                    <td style={{ padding: "8px 12px", color: COLOURS.RED,  fontVariantNumeric: "tabular-nums" }}>{emp.deductions !== null ? emp.deductions.toLocaleString() : "—"}</td>
                    <td style={{ padding: "8px 12px", color: COLOURS.GREEN, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{emp.net_pay !== null ? emp.net_pay.toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Runs tab ────────────────────────────────────────────────────────────────

function RunsTab({ runs, loading, onUpdated, onAddRun }: {
  runs: RunRow[];
  loading: boolean;
  onUpdated: () => void;
  onAddRun: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // KPIs from current month runs
  const thisMonth = new Date().toISOString().slice(0, 7);
  const currentRuns = runs.filter((r) => r.payroll_month.slice(0, 7) === thisMonth);
  const totalNet    = currentRuns.reduce((s, r) => s + (r.total_net || 0), 0);
  const totalHeads  = currentRuns.reduce((s, r) => s + (r.headcount || r.employee_count || 0), 0);
  const openExc     = runs.reduce((s, r) => s + r.open_exceptions, 0);
  const pendingRuns = runs.filter((r) => r.status !== "Paid").length;

  const kpis = [
    { label: "Total payroll (this month)", value: totalNet > 0 ? pkr(totalNet) : "—" },
    { label: "Total headcount",            value: totalHeads || "—" },
    { label: "Open exceptions",            value: openExc, red: openExc > 0 },
    { label: "Runs awaiting payment",      value: pendingRuns, amber: pendingRuns > 0 },
  ];

  return (
    <>
      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", marginBottom: "14px" }}>
        {kpis.map(({ label, value, red, amber }) => (
          <div key={label} style={{ ...cardStyle, padding: "16px 20px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "8px" }}>{label}</div>
            <div style={{
              fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
              fontSize: "22px", fontWeight: 600, letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              color: red ? COLOURS.RED : amber ? COLOURS.AMBER : COLOURS.NAVY,
            }}>
              {loading ? "—" : String(value)}
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <SectionTitle title="Monthly runs (last 6 months)" />
        <button onClick={onAddRun} style={btnPrimary}>+ New run</button>
      </div>

      {/* FlowHCM note */}
      <div style={{
        background: "#F0F4FF", border: "1px solid #C7D7F8", borderRadius: RADII.SM,
        padding: "10px 14px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px",
      }}>
        <span style={{ fontSize: "18px" }}>💡</span>
        <div style={{ fontSize: "13px", color: "#1e3a8a" }}>
          Export the payroll summary from FlowHCM, then use the <strong>Import</strong> tab to upload it. Figures will populate automatically.
        </div>
      </div>

      {loading ? (
        <p style={{ color: COLOURS.SLATE }}>Loading…</p>
      ) : runs.length === 0 ? (
        <div style={{ ...cardStyle, padding: "24px", color: COLOURS.SLATE, fontSize: "14px" }}>No payroll runs recorded yet.</div>
      ) : (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
          {runs.map((run) => {
            const isExp = expandedId === run.run_id;
            return (
              <div key={run.run_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                <div
                  onClick={() => setExpandedId(isExp ? null : run.run_id)}
                  style={{
                    padding: "11px 16px", cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px",
                    backgroundColor: isExp ? COLOURS.CARD_ALT : COLOURS.CARD,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>
                      {run.company_name} — {monthLabel(run.payroll_month)}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      {run.total_net ? pkr(run.total_net) : "Figures not imported"} · {run.headcount || run.employee_count || 0} employees
                      {run.open_exceptions > 0 && <span style={{ color: COLOURS.RED, marginLeft: "8px" }}>· {run.open_exceptions} exception{run.open_exceptions > 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                    {statusBadge(run.status)}
                    <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{isExp ? "▼" : "▶"}</span>
                  </div>
                </div>
                {isExp && <RunDetail run={run} onUpdated={onUpdated} />}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Add Run form (modal-style) ───────────────────────────────────────────────

function AddRunForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const isMobile = useMobile();
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState("");
  const [companyId, setCompanyId] = useState("");
  const [month, setMonth]         = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [gross, setGross]         = useState("");
  const [net, setNet]             = useState("");
  const [heads, setHeads]         = useState("");
  const [status, setStatus]       = useState("Pending");
  const [notes, setNotes]         = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) { setMsg("Select a company."); return; }
    setSaving(true);
    const { error } = await supabase.from("hr_payroll_runs").insert({
      company_id:    companyId,
      payroll_month: month + "-01",
      total_gross:   gross  ? Number(gross)  : null,
      total_net:     net    ? Number(net)    : null,
      headcount:     heads  ? Number(heads)  : null,
      status,
      notes: notes || null,
    });
    setSaving(false);
    if (error) { setMsg(error.message.includes("unique") ? "A run for this company and month already exists." : "Error: " + error.message); return; }
    logAction("Created", "hr_payroll_runs", `${companyId} ${month}`);
    onSaved();
  }

  return (
    <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: RADII.CARD, padding: "20px", backgroundColor: COLOURS.CARD, marginBottom: "14px" }}>
      <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "14px" }}>New payroll run</div>
      {msg && <div style={{ fontSize: "13px", color: COLOURS.RED, marginBottom: "10px" }}>{msg}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px" }}>
          <label style={lbl}>
            Company
            <select style={{ ...inp, marginTop: "4px" }} value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
              <option value="">Select</option>
              {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={lbl}>
            Month
            <input type="month" style={{ ...inp, marginTop: "4px" }} value={month} onChange={(e) => setMonth(e.target.value)} required />
          </label>
          <label style={lbl}>
            Status
            <select style={{ ...inp, marginTop: "4px" }} value={status} onChange={(e) => setStatus(e.target.value)}>
              {["Pending", "Processing", "Paid"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label style={lbl}>Total gross (PKR) <input style={{ ...inp, marginTop: "4px" }} type="number" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="e.g. 4200000" /></label>
          <label style={lbl}>Total net (PKR)   <input style={{ ...inp, marginTop: "4px" }} type="number" value={net}   onChange={(e) => setNet(e.target.value)}   placeholder="e.g. 3850000" /></label>
          <label style={lbl}>Headcount         <input style={{ ...inp, marginTop: "4px" }} type="number" value={heads} onChange={(e) => setHeads(e.target.value)} placeholder="e.g. 95" /></label>
          <label style={{ ...lbl, gridColumn: isMobile ? undefined : "1 / -1" }}>
            Notes <textarea style={{ ...inp, marginTop: "4px", height: "50px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button type="submit" disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Create run"}</button>
          <button type="button" onClick={onCancel} style={btnGhost}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

// ─── Import tab ───────────────────────────────────────────────────────────────

const EXPECTED_COLS = ["employee_name", "employee_id", "department", "designation", "basic_salary", "allowances", "deductions", "net_pay", "bank_account"];

function ImportTab({ onImported }: { onImported: () => void }) {
  const isMobile = useMobile();
  const fileRef  = useRef<HTMLInputElement>(null);
  const [rows, setRows]         = useState<Record<string, string>[]>([]);
  const [headers, setHeaders]   = useState<string[]>([]);
  const [mapping, setMapping]   = useState<Record<string, string>>({});
  const [companyId, setCompanyId] = useState("");
  const [month, setMonth]       = useState(new Date().toISOString().slice(0, 7));
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState("");
  const [step, setStep]         = useState<"upload" | "map" | "preview" | "done">("upload");

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb   = XLSX.read(ev.target?.result, { type: "binary" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
        if (!data.length) { setMsg("File appears empty."); return; }
        setRows(data);
        const hdrs = Object.keys(data[0]);
        setHeaders(hdrs);
        // Auto-map by fuzzy match on column names
        const autoMap: Record<string, string> = {};
        EXPECTED_COLS.forEach((col) => {
          const needle = col.replace(/_/g, "").toLowerCase();
          const match = hdrs.find((h) => h.replace(/[\s_-]/g, "").toLowerCase().includes(needle));
          if (match) autoMap[col] = match;
        });
        setMapping(autoMap);
        setMsg("");
        setStep("map");
      } catch {
        setMsg("Could not parse file. Export as .xlsx or .csv from FlowHCM.");
      }
    };
    reader.readAsBinaryString(file);
  }

  function parseNum(val: string): number | null {
    const n = parseFloat(String(val).replace(/,/g, ""));
    return isNaN(n) ? null : n;
  }

  function getMapped(row: Record<string, string>, col: string): string {
    const h = mapping[col];
    return h ? (row[h] || "") : "";
  }

  const preview: ParsedEmployee[] = rows.slice(0, 5).map((row) => ({
    employee_id:   getMapped(row, "employee_id"),
    employee_name: getMapped(row, "employee_name"),
    department:    getMapped(row, "department"),
    designation:   getMapped(row, "designation"),
    basic_salary:  parseNum(getMapped(row, "basic_salary")),
    allowances:    parseNum(getMapped(row, "allowances")),
    deductions:    parseNum(getMapped(row, "deductions")),
    net_pay:       parseNum(getMapped(row, "net_pay")),
    bank_account:  getMapped(row, "bank_account"),
  }));

  async function doImport() {
    if (!companyId) { setMsg("Select a company."); return; }
    if (!mapping.employee_name) { setMsg("Map the employee name column first."); return; }
    setSaving(true);

    // Upsert the run record
    const { data: runData, error: runErr } = await supabase
      .from("hr_payroll_runs")
      .upsert({ company_id: companyId, payroll_month: month + "-01", status: "Pending" }, { onConflict: "company_id,payroll_month" })
      .select("id")
      .single();

    if (runErr || !runData) { setMsg("Could not create run: " + (runErr?.message || "unknown")); setSaving(false); return; }
    const runId = runData.id;

    // Clear old employee records for this run and re-insert
    await supabase.from("hr_payroll_employees").delete().eq("run_id", runId);

    const empRows: Record<string, unknown>[] = rows.map((row) => ({
      run_id:        runId,
      employee_id:   getMapped(row, "employee_id") || null,
      employee_name: getMapped(row, "employee_name"),
      department:    getMapped(row, "department") || null,
      designation:   getMapped(row, "designation") || null,
      basic_salary:  parseNum(getMapped(row, "basic_salary")),
      allowances:    parseNum(getMapped(row, "allowances")),
      deductions:    parseNum(getMapped(row, "deductions")),
      net_pay:       parseNum(getMapped(row, "net_pay")),
      bank_account:  getMapped(row, "bank_account") || null,
    })).filter((r) => r.employee_name);

    // Compute totals and update run
    const totalGross  = empRows.reduce((s, r) => s + ((r.basic_salary as number || 0) + (r.allowances as number || 0)), 0);
    const totalDeds   = empRows.reduce((s, r) => s + (r.deductions as number || 0), 0);
    const totalNet    = empRows.reduce((s, r) => s + (r.net_pay as number || 0), 0);

    // Insert in batches of 200
    for (let i = 0; i < empRows.length; i += 200) {
      const { error } = await supabase.from("hr_payroll_employees").insert(empRows.slice(i, i + 200));
      if (error) { setMsg("Import error: " + error.message); setSaving(false); return; }
    }

    await supabase.from("hr_payroll_runs").update({
      headcount:        empRows.length,
      total_gross:      totalGross || null,
      total_deductions: totalDeds  || null,
      total_net:        totalNet   || null,
    }).eq("id", runId);

    logAction("Imported", "hr_payroll_employees", `${empRows.length} rows — ${companyId} ${month}`);
    setSaving(false);
    setStep("done");
    onImported();
  }

  if (step === "done") {
    return (
      <div style={{ ...cardStyle, padding: "32px", textAlign: "center" }}>
        <div style={{ fontSize: "36px", marginBottom: "12px" }}>✅</div>
        <div style={{ fontSize: "16px", fontWeight: 600, color: COLOURS.GREEN, marginBottom: "8px" }}>Import complete</div>
        <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginBottom: "16px" }}>{rows.length} employees imported for {month}</div>
        <button onClick={() => { setStep("upload"); setRows([]); setHeaders([]); setMapping({}); }} style={btnPrimary}>Import another file</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: "#F0F4FF", border: "1px solid #C7D7F8", borderRadius: RADII.SM, padding: "12px 16px", marginBottom: "16px", fontSize: "13px", color: "#1e3a8a" }}>
        <strong>How to export from FlowHCM:</strong> Payroll → Reports → Payroll Summary → Export as Excel (.xlsx). Then upload the file below.
      </div>

      {msg && <div style={{ fontSize: "13px", color: COLOURS.RED, marginBottom: "10px" }}>{msg}</div>}

      {step === "upload" && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          style={{
            border: `2px dashed ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
            padding: "40px", textAlign: "center", cursor: "pointer",
            backgroundColor: COLOURS.CARD_ALT,
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: "10px" }}>📂</div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" }}>Drop FlowHCM export here</div>
          <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>or click to browse — .xlsx or .csv</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {(step === "map" || step === "preview") && (
        <>
          <div style={{ ...cardStyle, padding: "16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "12px" }}>Step 1 — Map columns</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px", marginBottom: "12px" }}>
              {EXPECTED_COLS.map((col) => (
                <label key={col} style={lbl}>
                  {col.replace(/_/g, " ")}
                  <select style={{ ...inp, marginTop: "4px" }} value={mapping[col] || ""} onChange={(e) => setMapping((prev) => ({ ...prev, [col]: e.target.value }))}>
                    <option value="">— not in file —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>

            <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, margin: "16px 0 10px" }}>Step 2 — Which run?</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
              <label style={lbl}>
                Company
                <select style={{ ...inp, marginTop: "4px" }} value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
                  <option value="">Select</option>
                  {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label style={lbl}>
                Month
                <input type="month" style={{ ...inp, marginTop: "4px" }} value={month} onChange={(e) => setMonth(e.target.value)} />
              </label>
            </div>
          </div>

          {/* Preview */}
          <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "8px" }}>
            Preview (first 5 of {rows.length} rows)
          </div>
          <div style={{ overflowX: "auto", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD, marginBottom: "14px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  {["Name", "Dept", "Basic", "Allowances", "Deductions", "Net Pay"].map((h) => (
                    <th key={h} style={{ padding: "7px 10px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 500, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((emp, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <td style={{ padding: "7px 10px", color: COLOURS.NAVY, fontWeight: 500 }}>{emp.employee_name || <span style={{ color: COLOURS.RED }}>⚠ unmapped</span>}</td>
                    <td style={{ padding: "7px 10px", color: COLOURS.SLATE }}>{emp.department || "—"}</td>
                    <td style={{ padding: "7px 10px", color: COLOURS.NAVY, fontVariantNumeric: "tabular-nums" }}>{emp.basic_salary?.toLocaleString() ?? "—"}</td>
                    <td style={{ padding: "7px 10px", color: COLOURS.NAVY, fontVariantNumeric: "tabular-nums" }}>{emp.allowances?.toLocaleString()  ?? "—"}</td>
                    <td style={{ padding: "7px 10px", color: COLOURS.RED,  fontVariantNumeric: "tabular-nums" }}>{emp.deductions?.toLocaleString()   ?? "—"}</td>
                    <td style={{ padding: "7px 10px", color: COLOURS.GREEN, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{emp.net_pay?.toLocaleString() ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={doImport} disabled={saving || !companyId} style={{ ...btnPrimary, opacity: !companyId ? 0.5 : 1 }}>
              {saving ? `Importing ${rows.length} employees…` : `Import ${rows.length} employees →`}
            </button>
            <button onClick={() => { setStep("upload"); setRows([]); setHeaders([]); }} style={btnGhost}>Start over</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Exceptions tab ───────────────────────────────────────────────────────────

function ExceptionsTab({ runs }: { runs: RunRow[] }) {
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filterStatus, setFilterStatus] = useState<"Open" | "All">("Open");
  const [filterCompany, setFilterCompany] = useState("");

  const loadExceptions = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("hr_payroll_exceptions")
      .select("*")
      .order("created_at", { ascending: false });
    setExceptions((data || []) as Exception[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadExceptions(); }, [loadExceptions]);

  async function resolveException(id: string) {
    await supabase.from("hr_payroll_exceptions").update({ status: "Resolved", resolved_at: new Date().toISOString() }).eq("id", id);
    setExceptions((prev) => prev.map((e) => e.id === id ? { ...e, status: "Resolved" } : e));
  }

  const filtered = exceptions.filter((e) => {
    if (filterStatus === "Open" && e.status !== "Open") return false;
    if (filterCompany && e.company_id !== filterCompany) return false;
    return true;
  });

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 500,
    border: `1px solid ${active ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    background: active ? COLOURS.NAVY : COLOURS.CARD_ALT,
    color: active ? COLOURS.CARD : COLOURS.SLATE, cursor: "pointer",
  });

  return (
    <>
      <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <button style={pillStyle(filterStatus === "Open")} onClick={() => setFilterStatus("Open")}>Open</button>
        <button style={pillStyle(filterStatus === "All")}  onClick={() => setFilterStatus("All")}>All</button>
        <select style={{ ...inp, width: "auto", padding: "5px 10px", fontSize: "12px" }} value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)}>
          <option value="">All companies</option>
          {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.shortCode}</option>)}
        </select>
        <span style={{ fontSize: "13px", color: COLOURS.SLATE, marginLeft: "4px" }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : filtered.length === 0 ? (
        <div style={{ ...cardStyle, padding: "24px", color: COLOURS.SLATE, fontSize: "14px" }}>
          {filterStatus === "Open" ? "No open exceptions." : "No exceptions logged."}
        </div>
      ) : (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
          {filtered.map((ex) => {
            const run = runs.find((r) => r.run_id === ex.run_id);
            const company = getCompanyById(ex.company_id || "");
            return (
              <div key={ex.id} style={{ padding: "11px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", backgroundColor: COLOURS.CARD }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: ex.status === "Resolved" ? COLOURS.SLATE : COLOURS.NAVY, textDecoration: ex.status === "Resolved" ? "line-through" : "none" }}>
                    {ex.exception_type}
                  </div>
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                    {ex.employee_name || ""}{ex.employee_name && " · "}
                    {company?.shortCode || "—"}{run ? " · " + monthLabel(run.payroll_month) : ""}
                    {ex.description ? " · " + ex.description : ""}
                  </div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Logged {formatDateUK(ex.created_at)}</div>
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                  <span style={{
                    fontSize: "11px", fontWeight: 500, padding: "2px 9px", borderRadius: RADII.PILL,
                    background: ex.status === "Open" ? COLOURS.DANGER_SOFT : COLOURS.SUCCESS_SOFT,
                    color: ex.status === "Open" ? COLOURS.RED : COLOURS.GREEN,
                  }}>
                    {ex.status}
                  </span>
                  {ex.status === "Open" && (
                    <button onClick={() => resolveException(ex.id)} style={{ ...btnGhost, fontSize: "11px", padding: "3px 10px" }}>Resolve</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function HRPayroll() {
  type Tab = "runs" | "import" | "exceptions";
  const [tab, setTab]         = useState<Tab>("runs");
  const [runs, setRuns]       = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("get_payroll_dashboard");
    setRuns((data || []) as RunRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const pillStyle = (t: Tab): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 500,
    border: `1px solid ${tab === t ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    background: tab === t ? COLOURS.NAVY : COLOURS.CARD_ALT,
    color: tab === t ? COLOURS.CARD : COLOURS.SLATE, cursor: "pointer",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
        <button style={pillStyle("runs")}       onClick={() => setTab("runs")}>Runs</button>
        <button style={pillStyle("import")}     onClick={() => setTab("import")}>Import from FlowHCM</button>
        <button style={pillStyle("exceptions")} onClick={() => setTab("exceptions")}>
          Exceptions
          {runs.reduce((s, r) => s + r.open_exceptions, 0) > 0 && (
            <span style={{ background: COLOURS.RED, color: "#fff", borderRadius: "10px", padding: "1px 6px", fontSize: "10px", marginLeft: "6px" }}>
              {runs.reduce((s, r) => s + r.open_exceptions, 0)}
            </span>
          )}
        </button>
      </div>

      {tab === "runs" && (
        <>
          {showAdd && <AddRunForm onSaved={() => { setShowAdd(false); loadRuns(); }} onCancel={() => setShowAdd(false)} />}
          <RunsTab runs={runs} loading={loading} onUpdated={loadRuns} onAddRun={() => setShowAdd(true)} />
        </>
      )}
      {tab === "import"     && <ImportTab onImported={loadRuns} />}
      {tab === "exceptions" && <ExceptionsTab runs={runs} />}
    </div>
  );
}
