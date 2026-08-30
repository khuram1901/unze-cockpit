"use client";

/**
 * HRFlowData.tsx
 * ─────────────────────────────────────────────────────────────────
 * "Live HR Data" tab — searchable tables for every FlowHCM module.
 * Data is pulled from /api/flowhcm/data?module=<key>.
 */

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import { COLOURS, RADII, SectionTitle, SkeletonRows } from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";

// ── Types ─────────────────────────────────────────────────────────────────────

type ModuleKey =
  | "employees" | "salary_setup" | "advances" | "allowances" | "deductions"
  | "overtime"  | "pf_data"      | "tax"       | "transfers"  | "exits" | "exemptions" | "loans";

type ModuleMeta = { label: string; cols: ColDef[] };
type ColDef     = { key: string; label: string; fmt?: (v: any) => string };

// ── Column definitions per module ─────────────────────────────────────────────

const PKR = (v: any) => v != null ? `PKR ${Number(v).toLocaleString("en-PK")}` : "—";
const DATE = (v: any) => v ? formatDateUK(v.slice(0, 10)) : "—";
const STR  = (v: any) => v ?? "—";
const NUM  = (v: any) => v != null ? String(v) : "—";

const MODULES: Record<ModuleKey, ModuleMeta> = {
  employees: {
    label: "Employees",
    cols: [
      { key: "employee_code", label: "Code" },
      { key: "full_name",     label: "Name",        fmt: STR },
      { key: "designation",   label: "Designation", fmt: STR },
      { key: "department",    label: "Department",  fmt: STR },
      { key: "station",       label: "Station",     fmt: STR },
      { key: "company",       label: "Company",     fmt: STR },
      { key: "status",        label: "Status",      fmt: STR },
      { key: "joining_date",  label: "Joined",      fmt: DATE },
    ],
  },
  salary_setup: {
    label: "Salary Setup",
    cols: [
      { key: "employee_code",  label: "Code" },
      { key: "employee_name",  label: "Name",          fmt: STR },
      { key: "grade",          label: "Grade",          fmt: STR },
      { key: "basic_salary",   label: "Basic",          fmt: PKR },
      { key: "gross_salary",   label: "Gross",          fmt: PKR },
      { key: "currency",       label: "CCY",            fmt: STR },
      { key: "effective_date", label: "Effective",      fmt: DATE },
    ],
  },
  advances: {
    label: "Salary Advances",
    cols: [
      { key: "employee_code",   label: "Code" },
      { key: "employee_name",   label: "Name",         fmt: STR },
      { key: "request_date",    label: "Requested",    fmt: DATE },
      { key: "amount",          label: "Amount",       fmt: PKR },
      { key: "approved_amount", label: "Approved",     fmt: PKR },
      { key: "repayment_months",label: "Repay (mo.)",  fmt: NUM },
      { key: "status",          label: "Status",       fmt: STR },
      { key: "approved_by",     label: "Approved By",  fmt: STR },
    ],
  },
  allowances: {
    label: "Allowances",
    cols: [
      { key: "employee_code",  label: "Code" },
      { key: "employee_name",  label: "Name",          fmt: STR },
      { key: "year",           label: "Year",          fmt: NUM },
      { key: "month",          label: "Month",         fmt: NUM },
      { key: "allowance_type", label: "Type",          fmt: STR },
      { key: "amount",         label: "Amount",        fmt: PKR },
      { key: "status",         label: "Status",        fmt: STR },
    ],
  },
  deductions: {
    label: "Deductions",
    cols: [
      { key: "employee_code",  label: "Code" },
      { key: "employee_name",  label: "Name",          fmt: STR },
      { key: "year",           label: "Year",          fmt: NUM },
      { key: "month",          label: "Month",         fmt: NUM },
      { key: "deduction_type", label: "Type",          fmt: STR },
      { key: "amount",         label: "Amount",        fmt: PKR },
      { key: "status",         label: "Status",        fmt: STR },
    ],
  },
  overtime: {
    label: "Overtime",
    cols: [
      { key: "employee_code",  label: "Code" },
      { key: "employee_name",  label: "Name",          fmt: STR },
      { key: "overtime_date",  label: "Date",          fmt: DATE },
      { key: "hours",          label: "Hours",         fmt: NUM },
      { key: "rate_multiplier",label: "Rate ×",        fmt: NUM },
      { key: "amount",         label: "Amount",        fmt: PKR },
      { key: "status",         label: "Status",        fmt: STR },
      { key: "approved_by",    label: "Approved By",   fmt: STR },
    ],
  },
  pf_data: {
    label: "PF / EOBI",
    cols: [
      { key: "employee_code",          label: "Code" },
      { key: "employee_name",          label: "Name",         fmt: STR },
      { key: "pf_type",                label: "Type",         fmt: STR },
      { key: "employee_contribution",  label: "Employee",     fmt: PKR },
      { key: "employer_contribution",  label: "Employer",     fmt: PKR },
      { key: "effective_date",         label: "Effective",    fmt: DATE },
      { key: "status",                 label: "Status",       fmt: STR },
    ],
  },
  tax: {
    label: "Tax Adjustments",
    cols: [
      { key: "employee_code",   label: "Code" },
      { key: "employee_name",   label: "Name",           fmt: STR },
      { key: "tax_year",        label: "Tax Year",       fmt: NUM },
      { key: "adjustment_type", label: "Type",           fmt: STR },
      { key: "amount",          label: "Amount",         fmt: PKR },
      { key: "reason",          label: "Reason",         fmt: STR },
      { key: "status",          label: "Status",         fmt: STR },
    ],
  },
  transfers: {
    label: "Transfers",
    cols: [
      { key: "employee_code",   label: "Code" },
      { key: "employee_name",   label: "Name",           fmt: STR },
      { key: "from_department", label: "From Dept",      fmt: STR },
      { key: "to_department",   label: "To Dept",        fmt: STR },
      { key: "from_company",    label: "From Co.",       fmt: STR },
      { key: "to_company",      label: "To Co.",         fmt: STR },
      { key: "transfer_date",   label: "Date",           fmt: DATE },
      { key: "status",          label: "Status",         fmt: STR },
    ],
  },
  exits: {
    label: "Exits / Leavers",
    cols: [
      { key: "employee_code",     label: "Code" },
      { key: "employee_name",     label: "Name",          fmt: STR },
      { key: "department",        label: "Department",    fmt: STR },
      { key: "exit_type",         label: "Exit Type",     fmt: STR },
      { key: "joining_date",      label: "Joined",        fmt: DATE },
      { key: "leaving_date",      label: "Left",          fmt: DATE },
      { key: "notice_period_days",label: "Notice (days)", fmt: NUM },
      { key: "clearance_status",  label: "Clearance",     fmt: STR },
    ],
  },
  exemptions: {
    label: "Attendance Exemptions",
    cols: [
      { key: "employee_code",  label: "Code" },
      { key: "employee_name",  label: "Name",        fmt: STR },
      { key: "exemption_date", label: "Date",        fmt: DATE },
      { key: "exemption_type", label: "Type",        fmt: STR },
      { key: "reason",         label: "Reason",      fmt: STR },
      { key: "status",         label: "Status",      fmt: STR },
      { key: "approved_by",    label: "Approved By", fmt: STR },
    ],
  },
  loans: {
    label: "Loans",
    cols: [
      { key: "employee_code",      label: "Code" },
      { key: "employee_name",      label: "Name",          fmt: STR },
      { key: "loan_type",          label: "Type",          fmt: STR },
      { key: "principal_amount",   label: "Principal",     fmt: PKR },
      { key: "outstanding_amount", label: "Outstanding",   fmt: PKR },
      { key: "monthly_deduction",  label: "Monthly",       fmt: PKR },
      { key: "start_date",         label: "Start",         fmt: DATE },
      { key: "expected_end_date",  label: "End",           fmt: DATE },
      { key: "status",             label: "Status",        fmt: STR },
    ],
  },
};

const MODULE_ORDER: ModuleKey[] = [
  "employees", "salary_setup", "advances", "allowances", "deductions",
  "overtime", "pf_data", "tax", "loans", "transfers", "exits", "exemptions",
];

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ v }: { v: string }) {
  const s   = (v ?? "").toLowerCase();
  const col = s.includes("approv") || s === "active"  ? COLOURS.GREEN
            : s.includes("reject") || s === "inactive" ? COLOURS.RED
            : s.includes("pend")                        ? COLOURS.AMBER
            : COLOURS.SLATE;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "99px",
      fontSize: "11px",
      fontWeight: 600,
      background: `${col}18`,
      color: col,
    }}>{v ?? "—"}</span>
  );
}

// ── Sync meta banner ──────────────────────────────────────────────────────────

function SyncMeta({ last_synced, sync_status, sync_error, total }: {
  last_synced: string | null;
  sync_status: string | null;
  sync_error:  string | null;
  total:       number;
}) {
  const ok  = sync_status === "success";
  const col = ok ? COLOURS.GREEN : COLOURS.RED;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
      fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px",
    }}>
      <span style={{ color: col, fontWeight: 600 }}>
        {ok ? "✓ Synced" : "⚠ Sync error"}
      </span>
      {last_synced && (
        <span>Last run: {formatDateUK(last_synced.slice(0, 10))} {last_synced.slice(11, 16)} UTC</span>
      )}
      <span>{total.toLocaleString()} records</span>
      {sync_error && (
        <span style={{ color: COLOURS.RED }}>{sync_error}</span>
      )}
    </div>
  );
}

// ── Data table ────────────────────────────────────────────────────────────────

function DataTable({ rows, cols, loading }: {
  rows:    Record<string, any>[];
  cols:    ColDef[];
  loading: boolean;
}) {
  const thStyle: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "left",
    fontSize: "11px",
    fontWeight: 600,
    color: COLOURS.SLATE,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
    whiteSpace: "nowrap",
    background: COLOURS.CARD,
    position: "sticky",
    top: 0,
  };
  const tdStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: "13px",
    color: COLOURS.NAVY,
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
    whiteSpace: "nowrap",
    maxWidth: "220px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  if (loading) return (
    <div style={{ padding: "16px 0" }}><SkeletonRows n={8} /></div>
  );

  if (!rows.length) return (
    <div style={{
      padding: "40px",
      textAlign: "center",
      color: COLOURS.SLATE,
      fontSize: "14px",
      border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: RADII.CARD,
      background: COLOURS.CARD,
    }}>
      No records found. The next 10-minute sync will populate this.
    </div>
  );

  return (
    <div style={{ overflowX: "auto", borderRadius: RADII.CARD, border: `1px solid ${COLOURS.HAIRLINE}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {cols.map(c => <th key={c.key} style={thStyle}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? COLOURS.CARD : `${COLOURS.NAVY}04` }}>
              {cols.map(c => {
                const raw = row[c.key];
                const isStatus = c.key === "status" || c.key === "clearance_status";
                return (
                  <td key={c.key} style={tdStyle} title={raw != null ? String(raw) : undefined}>
                    {isStatus && raw
                      ? <StatusBadge v={raw} />
                      : (c.fmt ? c.fmt(raw) : (raw ?? "—"))
                    }
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HRFlowData() {
  const isMobile = useMobile();
  const [activeModule, setActiveModule] = useState<ModuleKey>("employees");
  const [search, setSearch]             = useState("");
  const [debouncedSearch, setDebounced] = useState("");
  const [loading, setLoading]           = useState(false);
  const [rows, setRows]                 = useState<Record<string, any>[]>([]);
  const [total, setTotal]               = useState(0);
  const [lastSynced, setLastSynced]     = useState<string | null>(null);
  const [syncStatus, setSyncStatus]     = useState<string | null>(null);
  const [syncError, setSyncError]       = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadData = useCallback(async (mod: ModuleKey, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ module: mod, limit: "200" });
      if (q) params.set("search", q);
      const res = await authFetch(`/api/flowhcm/data?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
      setLastSynced(json.last_synced ?? null);
      setSyncStatus(json.sync_status ?? null);
      setSyncError(json.sync_error ?? null);
    } catch (e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setRows([]);
    loadData(activeModule, debouncedSearch);
  }, [activeModule, debouncedSearch, loadData]);

  // Sub-tab strip
  const subTabBar: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    marginBottom: "16px",
  };
  const subTab = (k: ModuleKey): React.CSSProperties => ({
    padding: isMobile ? "5px 10px" : "6px 14px",
    fontSize: "12px",
    fontWeight: 500,
    borderRadius: RADII.PILL,
    border: `1px solid ${activeModule === k ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    background: activeModule === k ? COLOURS.NAVY : COLOURS.CARD,
    color: activeModule === k ? "#fff" : COLOURS.SLATE,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  const meta = MODULES[activeModule];

  return (
    <div>
      <SectionTitle>Live HR Data</SectionTitle>
      <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "16px", marginTop: "-4px" }}>
        Synced automatically every 10 minutes from FlowHCM.
      </p>

      {/* Module picker */}
      <div style={subTabBar}>
        {MODULE_ORDER.map(k => (
          <button
            key={k}
            style={subTab(k)}
            onClick={() => { setActiveModule(k); setSearch(""); }}
          >
            {MODULES[k].label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search by code or name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: "7px 12px",
            border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.PILL,
            fontSize: "13px",
            color: COLOURS.NAVY,
            background: COLOURS.CARD,
            width: isMobile ? "100%" : "280px",
            outline: "none",
          }}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            style={{
              fontSize: "12px", color: COLOURS.SLATE, cursor: "pointer",
              background: "none", border: "none", padding: "4px 8px",
            }}
          >
            Clear
          </button>
        )}
        <button
          onClick={() => loadData(activeModule, debouncedSearch)}
          style={{
            padding: "7px 14px",
            border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.PILL,
            fontSize: "12px",
            color: COLOURS.SLATE,
            background: COLOURS.CARD,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {/* Sync metadata */}
      <SyncMeta
        last_synced={lastSynced}
        sync_status={syncStatus}
        sync_error={syncError}
        total={total}
      />

      {/* Table */}
      <DataTable rows={rows} cols={meta.cols} loading={loading} />

      {total > rows.length && (
        <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "8px", textAlign: "right" }}>
          Showing {rows.length} of {total.toLocaleString()} records. Use search to narrow down.
        </p>
      )}
    </div>
  );
}
