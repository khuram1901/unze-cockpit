"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import { supabase } from "../lib/supabase";
import { formatDateTimeUK, formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard } from "../lib/SharedUI";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

type LogEntry = {
  id: string;
  user_email: string;
  user_name: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  details: string | null;
  created_at: string;
};

const TABLE_LABELS: Record<string, string> = {
  tasks: "Tasks",
  members: "Members",
  audit_plan_items: "Audit",
  legal_notices: "Taxation",
  recruitment_positions: "HR",
  meeting_requests: "Meetings",
  meetings: "Meetings",
  meeting_tasks: "Meetings",
  cash_opening_balance: "Finance",
  monthly_cash_plan: "Finance",
  daily_cash_position: "Finance",
  monthly_budgets: "Finance",
  production_entries: "Production",
  dispatch_entries: "Dispatch",
  breakage_entries: "Breakage",
  machine_issues: "Machines",
  department_owners: "Dept Owners",
  opening_balances: "Opening Bal.",
  receivables: "Receivables",
};

function getDept(tableName: string): string {
  return TABLE_LABELS[tableName] || tableName;
}

const ACTION_COLOURS: Record<string, { bg: string; text: string }> = {
  Created: { bg: "#dcfce7", text: "#16a34a" },
  Updated: { bg: "#fef3c7", text: "#d97706" },
  Deleted: { bg: "#fee2e2", text: "#dc2626" },
};

export default function AuditLogPage() {
  const isMobile = useMobile();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [groupBy, setGroupBy] = useState<"time" | "department" | "person">("time");

  useEffect(() => { loadLogs(); }, []);

  async function loadLogs() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    setLogs(data || []);
    setLoading(false);
  }

  const filtered = filter
    ? logs.filter((l) =>
        l.user_name?.toLowerCase().includes(filter.toLowerCase()) ||
        l.user_email.toLowerCase().includes(filter.toLowerCase()) ||
        l.table_name.toLowerCase().includes(filter.toLowerCase()) ||
        l.action.toLowerCase().includes(filter.toLowerCase()) ||
        l.details?.toLowerCase().includes(filter.toLowerCase()) ||
        getDept(l.table_name).toLowerCase().includes(filter.toLowerCase())
      )
    : logs;

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayLogs = filtered.filter((l) => l.created_at.slice(0, 10) === todayStr);
  const created = filtered.filter((l) => l.action === "Created").length;
  const updated = filtered.filter((l) => l.action.startsWith("Updated")).length;
  const deleted = filtered.filter((l) => l.action === "Deleted").length;

  // Action donut
  const actionDonut = [
    { name: "Created", value: created, color: "#16a34a" },
    { name: "Updated", value: updated, color: "#d97706" },
    { name: "Deleted", value: deleted, color: "#dc2626" },
  ].filter((d) => d.value > 0);

  // Department donut
  const deptMap = new Map<string, number>();
  for (const l of filtered) {
    const d = getDept(l.table_name);
    deptMap.set(d, (deptMap.get(d) || 0) + 1);
  }
  const deptColors: Record<string, string> = {
    Tasks: "#d97706", Members: "#2563eb", Audit: "#7c3aed", Taxation: "#dc2626",
    HR: "#059669", Meetings: COLOURS.NAVY, Finance: "#16a34a", Production: "#16a34a",
    Dispatch: "#059669", Breakage: "#dc2626", Machines: "#dc2626",
  };
  const deptDonut = Array.from(deptMap.entries())
    .map(([name, value]) => ({ name, value, color: deptColors[name] || COLOURS.SLATE }))
    .sort((a, b) => b.value - a.value);

  // Group by department
  const deptGroups = new Map<string, LogEntry[]>();
  for (const l of filtered) {
    const d = getDept(l.table_name);
    if (!deptGroups.has(d)) deptGroups.set(d, []);
    deptGroups.get(d)!.push(l);
  }
  const deptNames = Array.from(deptGroups.keys()).sort((a, b) => (deptGroups.get(b)?.length || 0) - (deptGroups.get(a)?.length || 0));

  // Group by person
  const personGroups = new Map<string, LogEntry[]>();
  for (const l of filtered) {
    const p = l.user_name || l.user_email;
    if (!personGroups.has(p)) personGroups.set(p, []);
    personGroups.get(p)!.push(l);
  }
  const personNames = Array.from(personGroups.keys()).sort((a, b) => (personGroups.get(b)?.length || 0) - (personGroups.get(a)?.length || 0));

  function ActionBadge({ action }: { action: string }) {
    const key = action.startsWith("Updated") ? "Updated" : action;
    const c = ACTION_COLOURS[key] || { bg: "#f1f5f9", text: COLOURS.SLATE };
    return (
      <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 7px", borderRadius: "6px", backgroundColor: c.bg, color: c.text }}>{action}</span>
    );
  }

  function LogRow({ log }: { log: LogEntry }) {
    return (
      <div style={{ padding: "8px 14px", borderBottom: `1px solid ${COLOURS.LIGHT}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "14px", color: COLOURS.NAVY, display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{log.user_name || log.user_email}</span>
            <ActionBadge action={log.action} />
            <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.BLUE }}>{getDept(log.table_name)}</span>
          </div>
          {log.details && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.details}</div>}
        </div>
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, whiteSpace: "nowrap", flexShrink: 0 }}>
          {formatDateTimeUK(log.created_at)}
        </div>
      </div>
    );
  }

  return (
    <AuthWrapper>
      <RoleGuard allowedRoles={["Admin"]}>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
          <PageHeader title="Audit Log" subtitle="Who did what and when — system activity trail" />

          {/* KPI Row */}
          {!loading && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
              <CountCard label="Today" value={todayLogs.length} color={COLOURS.BLUE} />
              <CountCard label="Created" value={created} color="#16a34a" />
              <CountCard label="Updated" value={updated} color="#d97706" />
              <CountCard label="Deleted" value={deleted} color="#dc2626" />
              <CountCard label="Total" value={filtered.length} color={COLOURS.NAVY} />
            </div>
          )}

          {/* Charts row */}
          {!loading && filtered.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              {actionDonut.length > 0 && (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>By Action</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={actionDonut} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={2}>
                        {actionDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${value} entries`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                    {actionDonut.map((d) => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: COLOURS.SLATE }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {deptDonut.length > 0 && (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>By Department</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={deptDonut} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={2}>
                        {deptDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${value} entries`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                    {deptDonut.map((d) => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: COLOURS.SLATE }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Search + Group toggle */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <input type="text" placeholder="Search..." value={filter} onChange={(e) => setFilter(e.target.value)}
              style={{ flex: "1 1 200px", maxWidth: "300px", padding: "7px 12px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "14px", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: "3px" }}>
              {(["time", "department", "person"] as const).map((g) => (
                <button key={g} onClick={() => setGroupBy(g)} style={{
                  backgroundColor: groupBy === g ? COLOURS.NAVY : "white",
                  color: groupBy === g ? "white" : COLOURS.NAVY,
                  border: `1px solid ${groupBy === g ? COLOURS.NAVY : COLOURS.BORDER}`,
                  borderRadius: "5px", padding: "5px 12px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                  textTransform: "capitalize",
                }}>{g}</button>
              ))}
            </div>
          </div>

          {/* Log entries */}
          {loading ? <p style={{ color: COLOURS.SLATE }}>Loading...</p> : filtered.length === 0 ? (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", color: COLOURS.SLATE, textAlign: "center" }}>No log entries found.</div>
          ) : groupBy === "time" ? (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
              {filtered.slice(0, 200).map((log) => <LogRow key={log.id} log={log} />)}
              {filtered.length > 200 && <div style={{ padding: "10px 14px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>Showing 200 of {filtered.length}</div>}
            </div>
          ) : groupBy === "department" ? (
            deptNames.map((dept) => {
              const entries = deptGroups.get(dept)!;
              return (
                <div key={dept} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "10px" }}>
                  <div style={{ padding: "8px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{dept}</span>
                    <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{entries.length} entries</span>
                  </div>
                  {entries.slice(0, 20).map((log) => <LogRow key={log.id} log={log} />)}
                  {entries.length > 20 && <div style={{ padding: "8px 14px", textAlign: "center", color: COLOURS.SLATE, fontSize: "12px" }}>+{entries.length - 20} more</div>}
                </div>
              );
            })
          ) : (
            personNames.map((person) => {
              const entries = personGroups.get(person)!;
              return (
                <div key={person} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "10px" }}>
                  <div style={{ padding: "8px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{person}</span>
                    <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{entries.length} actions</span>
                  </div>
                  {entries.slice(0, 20).map((log) => <LogRow key={log.id} log={log} />)}
                  {entries.length > 20 && <div style={{ padding: "8px 14px", textAlign: "center", color: COLOURS.SLATE, fontSize: "12px" }}>+{entries.length - 20} more</div>}
                </div>
              );
            })
          )}
        </main>
      </RoleGuard>
    </AuthWrapper>
  );
}
