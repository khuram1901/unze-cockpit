"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import { COLOURS, RADII, CountCard, SectionTitle, SkeletonRows } from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${session?.access_token}` },
  });
}

// ── Types ───────────────────────────────────────────────────────────────────────
type DeptRow = { department: string; headcount: number };

type WorkforceData = {
  total_employees: number;
  by_department:   DeptRow[] | null;
  last_synced:     string | null;
};

type AttendanceData = {
  date:       string;
  present:    number;
  late:       number;
  absent:     number;
  half_day:   number;
  absent_list: { employee_name: string; department: string; station: string }[] | null;
  late_list:   { employee_name: string; department: string; check_in: string }[] | null;
  last_synced: string | null;
};

type LeaveData = {
  date:       string;
  count:      number;
  employees:  { employee_name: string; department: string; leave_type: string; from_date: string; to_date: string }[] | null;
  last_synced: string | null;
};

type SyncEntry = {
  module:         string;
  synced_at:      string;
  status:         string;
  records_synced: number;
  error_message:  string | null;
  duration_ms:    number;
};

type StatusPayload = {
  configured: boolean;
  workforce:  WorkforceData | null;
  attendance: AttendanceData | null;
  leave:      LeaveData | null;
  sync_log:   SyncEntry[] | null;
};

// ── Not-connected banner ────────────────────────────────────────────────────────
function NotConnected() {
  return (
    <div style={{
      background: `${COLOURS.AMBER}18`,
      border: `1px solid ${COLOURS.AMBER}`,
      borderRadius: RADII.CARD,
      padding: "24px",
      marginBottom: "24px",
    }}>
      <div style={{ fontWeight: 600, color: COLOURS.NAVY, marginBottom: "6px", fontSize: "15px" }}>
        FlowHCM not yet connected
      </div>
      <div style={{ color: COLOURS.SLATE, fontSize: "13px", lineHeight: "1.6" }}>
        To activate the live sync, add two environment variables in{" "}
        <strong>Vercel → Settings → Environment Variables</strong>:
        <br />
        <code style={{ fontFamily: "monospace", fontSize: "12px" }}>FLOWHCM_API_URL</code> = https://api40.flowhcm.com/api
        <br />
        <code style={{ fontFamily: "monospace", fontSize: "12px" }}>FLOWHCM_TOKEN</code> = &lt;service account token from FlowHCM support&gt;
        <br /><br />
        Once set, this tab will auto-populate every 2 hours. Contact FlowHCM support (Yasir: 03182997352) to request a read-only API token.
      </div>
    </div>
  );
}

// ── Sync status strip ───────────────────────────────────────────────────────────
function SyncStrip({ log, onSync, syncing }: {
  log:     SyncEntry[] | null;
  onSync:  () => void;
  syncing: boolean;
}) {
  const modules = ["employees", "attendance", "leave", "recruitment"];
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      alignItems: "center",
      marginBottom: "20px",
      padding: "10px 14px",
      background: COLOURS.CARD,
      border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: RADII.CARD,
    }}>
      {modules.map(mod => {
        const entry = log?.find(l => l.module === mod);
        const ok    = entry?.status === "success";
        const color = !entry ? COLOURS.SLATE : ok ? COLOURS.GREEN : COLOURS.RED;
        return (
          <div key={mod} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            <span style={{ color: COLOURS.SLATE, textTransform: "capitalize" }}>{mod}</span>
            {entry && (
              <span style={{ color: COLOURS.SLATE, opacity: 0.7 }}>
                {formatDateUK(entry.synced_at.slice(0, 10))} · {entry.records_synced}r
              </span>
            )}
          </div>
        );
      })}
      <div style={{ marginLeft: "auto" }}>
        <button
          onClick={onSync}
          disabled={syncing}
          style={{
            padding: "5px 14px",
            fontSize: "12px",
            fontWeight: 600,
            background: syncing ? COLOURS.HAIRLINE : COLOURS.NAVY,
            color: syncing ? COLOURS.SLATE : "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: syncing ? "not-allowed" : "pointer",
          }}
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
    </div>
  );
}

// ── Department headcount bar chart ──────────────────────────────────────────────
function DeptChart({ rows }: { rows: DeptRow[] }) {
  const max = Math.max(...rows.map(r => r.headcount), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {rows.slice(0, 12).map(r => (
        <div key={r.department} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "160px", fontSize: "12px", color: COLOURS.SLATE, flexShrink: 0, textAlign: "right" }}>
            {r.department || "—"}
          </div>
          <div style={{ flex: 1, background: COLOURS.HAIRLINE, borderRadius: "4px", height: "10px" }}>
            <div style={{
              width: `${(r.headcount / max) * 100}%`,
              background: COLOURS.NAVY,
              borderRadius: "4px",
              height: "10px",
              minWidth: "4px",
            }} />
          </div>
          <div style={{ width: "28px", fontSize: "12px", color: COLOURS.NAVY, fontWeight: 600 }}>
            {r.headcount}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Employee list table ─────────────────────────────────────────────────────────
function EmployeeList({ depts, loading }: { depts: DeptRow[] | null; loading: boolean }) {
  if (loading) return <SkeletonRows count={5} />;
  if (!depts || depts.length === 0) {
    return <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "24px" }}>No employee data synced yet.</div>;
  }
  return <DeptChart rows={depts} />;
}

// ── Absent / Late list ──────────────────────────────────────────────────────────
function PersonList({ items, emptyText, columns }: {
  items:     Record<string, string>[] | null;
  emptyText: string;
  columns:   { key: string; label: string }[];
}) {
  if (!items || items.length === 0) {
    return <div style={{ color: COLOURS.SLATE, fontSize: "13px", padding: "12px 0" }}>{emptyText}</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
            {columns.map(c => (
              <th key={c.key} style={{ padding: "6px 8px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 500, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: "8px 8px", color: COLOURS.NAVY }}>
                  {row[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────
export default function HRWorkforce() {
  const isMobile = useMobile();
  const [data,    setData]    = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/flowhcm/status");
      const json = await res.json() as StatusPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await authedFetch("/api/flowhcm/sync", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const w  = data?.workforce;
  const a  = data?.attendance;
  const lv = data?.leave;

  const col2: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
    gap: "16px",
    marginBottom: "24px",
  };

  const card: React.CSSProperties = {
    background: COLOURS.CARD,
    border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.CARD,
    padding: "20px",
  };

  return (
    <div>
      {/* Not-connected banner */}
      {data && !data.configured && <NotConnected />}

      {/* Sync status strip */}
      {data?.configured && (
        <SyncStrip log={data.sync_log} onSync={handleSync} syncing={syncing} />
      )}

      {error && (
        <div style={{ color: COLOURS.RED, fontSize: "13px", marginBottom: "16px" }}>{error}</div>
      )}

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5,1fr)", gap: "12px", marginBottom: "24px" }}>
        <CountCard label="Total Employees" value={loading ? "…" : (w?.total_employees ?? "—")} color={COLOURS.NAVY} />
        <CountCard label="Present Today"   value={loading ? "…" : (a?.present  ?? "—")} color={COLOURS.GREEN} />
        <CountCard label="Late Today"      value={loading ? "…" : (a?.late     ?? "—")} color={COLOURS.AMBER} />
        <CountCard label="Absent Today"    value={loading ? "…" : (a?.absent   ?? "—")} color={COLOURS.RED} />
        <CountCard label="On Leave"        value={loading ? "…" : (lv?.count   ?? "—")} color={COLOURS.SLATE} />
      </div>

      {/* Dept breakdown + On Leave today */}
      <div style={col2}>
        <div style={card}>
          <SectionTitle title="Headcount by Department" />
          <div style={{ marginTop: "12px" }}>
            <EmployeeList depts={w?.by_department ?? null} loading={loading} />
          </div>
        </div>
        <div style={card}>
          <SectionTitle title="On Leave Today" />
          <div style={{ marginTop: "12px" }}>
            {loading ? <SkeletonRows count={4} /> : (
              <PersonList
                items={(lv?.employees ?? []) as Record<string, string>[]}
                emptyText="No one on approved leave today."
                columns={[
                  { key: "employee_name", label: "Name" },
                  { key: "department",    label: "Dept" },
                  { key: "leave_type",    label: "Type" },
                  { key: "to_date",       label: "Back" },
                ]}
              />
            )}
          </div>
        </div>
      </div>

      {/* Absent today */}
      <div style={{ ...card, marginBottom: "16px" }}>
        <SectionTitle title="Absent Today" />
        <div style={{ marginTop: "12px" }}>
          {loading ? <SkeletonRows count={5} /> : (
            <PersonList
              items={(a?.absent_list ?? []) as Record<string, string>[]}
              emptyText="No absences recorded for today."
              columns={[
                { key: "employee_name", label: "Name" },
                { key: "department",    label: "Department" },
                { key: "station",       label: "Station" },
              ]}
            />
          )}
        </div>
      </div>

      {/* Late today */}
      <div style={card}>
        <SectionTitle title="Late Today" />
        <div style={{ marginTop: "12px" }}>
          {loading ? <SkeletonRows count={5} /> : (
            <PersonList
              items={(a?.late_list ?? []) as Record<string, string>[]}
              emptyText="No late arrivals recorded for today."
              columns={[
                { key: "employee_name", label: "Name" },
                { key: "department",    label: "Department" },
                { key: "check_in",      label: "Check-in" },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
