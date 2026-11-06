"use client";

// Pre-Audit daily task-ticking system.
// Employee view: monthly calendar heatmap + today's tasks to tick.
// Manager view: week-at-a-glance team grid + MTD compliance table.
// All data assembled in Postgres RPCs — zero JS aggregation.

import { useEffect, useState, useCallback } from "react";
import { authFetch as authedFetch } from "../../lib/supabase";
import { formatDateUK } from "../../lib/dateUtils";
import { COLOURS, RADII } from "../../lib/SharedUI";
import type { UserCtx } from "../../lib/permissions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskRow {
  company_id:   string;
  company_name: string;
  task_date:    string;  // YYYY-MM-DD
  is_complete:  boolean;
  is_late:      boolean;
  completed_at: string | null;
}

interface TeamRow {
  member_id:    string;
  member_name:  string;
  member_email: string;
  company_id:   string;
  company_name: string;
  task_date:    string;
  is_complete:  boolean;
  is_late:      boolean;
  completed_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayPKT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function prevMonday(ref?: Date): string {
  const d = ref ? new Date(ref) : new Date();
  const dow = d.getDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

function isWorkingDay(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

function statusColor(is_complete: boolean, is_late: boolean, isFuture: boolean): string {
  if (isFuture) return "#F1F5F9";
  if (is_complete && is_late) return COLOURS.AMBER;
  if (is_complete)             return COLOURS.GREEN;
  return COLOURS.RED;
}

function statusLabel(is_complete: boolean, is_late: boolean): string {
  if (is_complete && is_late) return "Done (late)";
  if (is_complete)            return "Done";
  return "Overdue";
}

// ── Employee view ─────────────────────────────────────────────────────────────

function EmployeeView({ userCtx }: { userCtx: UserCtx }) {
  const [tasks, setTasks]       = useState<TaskRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [ticking, setTicking]   = useState<string | null>(null); // "companyId|date"
  const [toast, setToast]       = useState("");
  const today                   = todayPKT();
  const [month, setMonth]       = useState(() => monthStart(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    const res = await authedFetch(`/api/preaudit/my-tasks?month=${month}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks || []);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  async function tick(company_id: string, task_date: string) {
    const key = `${company_id}|${task_date}`;
    setTicking(key);
    const res = await authedFetch("/api/preaudit/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id, task_date }),
    });
    if (res.ok) {
      setToast("✓ Marked as done");
      await load();
    } else {
      const e = await res.json();
      setToast("Error: " + (e.error || "unknown"));
    }
    setTicking(null);
    setTimeout(() => setToast(""), 3000);
  }

  // Derive companies from tasks
  const companies = Array.from(new Set(tasks.map(t => t.company_id)))
    .map(id => ({ id, name: tasks.find(t => t.company_id === id)!.company_name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // All working days in the month
  const allDays = Array.from(new Set(tasks.map(t => t.task_date))).sort();

  // Lookup map
  const lookup = new Map<string, TaskRow>();
  tasks.forEach(t => lookup.set(`${t.company_id}|${t.task_date}`, t));

  // KPIs
  const totalTasks    = tasks.length;
  const done          = tasks.filter(t => t.is_complete).length;
  const doneLate      = tasks.filter(t => t.is_complete && t.is_late).length;
  const pastTasks     = tasks.filter(t => t.task_date <= today);
  const overdue       = pastTasks.filter(t => !t.is_complete).length;
  const compliance    = pastTasks.length > 0 ? Math.round((done / pastTasks.length) * 100) : 100;

  // Today's pending tasks
  const todayPending = tasks.filter(t => t.task_date === today && !t.is_complete && isWorkingDay(today));
  // Overdue tasks (past, not done)
  const overdueList  = tasks.filter(t => t.task_date < today && !t.is_complete).sort((a, b) => a.task_date.localeCompare(b.task_date));

  // Month nav
  function changeMonth(delta: number) {
    const d = new Date(month + "T12:00:00Z");
    d.setMonth(d.getMonth() + delta);
    setMonth(monthStart(d));
  }
  const monthLabel = new Date(month + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div>
      {toast && (
        <div style={{ background: COLOURS.GREEN, color: "#fff", borderRadius: RADII.SM, padding: "10px 16px", marginBottom: 16, fontSize: 13, fontWeight: 500 }}>
          {toast}
        </div>
      )}

      {/* KPI tiles */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        {[
          { label: "Done this month", value: `${done} / ${totalTasks}`, color: COLOURS.GREEN },
          { label: "Overdue",         value: overdue,                    color: overdue > 0 ? COLOURS.RED : COLOURS.GREEN },
          { label: "Done late",       value: doneLate,                   color: doneLate > 0 ? COLOURS.AMBER : COLOURS.GREEN },
          { label: "Compliance",      value: `${compliance}%`,           color: compliance >= 95 ? COLOURS.GREEN : compliance >= 80 ? COLOURS.AMBER : COLOURS.RED },
        ].map(k => (
          <div key={k.label} style={{ flex: "1 1 140px", minWidth: 120, background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: COLOURS.SLATE, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{String(k.value)}</div>
          </div>
        ))}
      </div>

      {/* Today's tasks */}
      {isWorkingDay(today) && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLOURS.NAVY, marginBottom: 10 }}>
            Today — {formatDateUK(today)}
          </div>
          {todayPending.length === 0 ? (
            <div style={{ background: "#F0FDF4", border: `1px solid ${COLOURS.GREEN}`, borderRadius: RADII.SM, padding: "10px 14px", fontSize: 13, color: COLOURS.GREEN, fontWeight: 500 }}>
              ✓ All done for today
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {todayPending.map(t => {
                const key = `${t.company_id}|${t.task_date}`;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "10px 14px" }}>
                    <div style={{ fontSize: 13, color: COLOURS.NAVY, fontWeight: 500 }}>{t.company_name}</div>
                    <button
                      disabled={ticking === key}
                      onClick={() => tick(t.company_id, t.task_date)}
                      style={{ padding: "6px 16px", fontSize: 12, fontWeight: 600, background: ticking === key ? COLOURS.SLATE : COLOURS.GREEN, color: "#fff", border: "none", borderRadius: RADII.SM, cursor: ticking === key ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                    >
                      {ticking === key ? "Saving…" : "Tick Done"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Overdue tasks */}
      {overdueList.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLOURS.RED, marginBottom: 10 }}>
            Overdue ({overdueList.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overdueList.map(t => {
              const key = `${t.company_id}|${t.task_date}`;
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: COLOURS.CARD, border: `1px solid ${COLOURS.RED}`, borderRadius: RADII.SM, padding: "10px 14px" }}>
                  <div>
                    <div style={{ fontSize: 13, color: COLOURS.NAVY, fontWeight: 500 }}>{t.company_name}</div>
                    <div style={{ fontSize: 11, color: COLOURS.SLATE, marginTop: 2 }}>{formatDateUK(t.task_date)}</div>
                  </div>
                  <button
                    disabled={ticking === key}
                    onClick={() => tick(t.company_id, t.task_date)}
                    style={{ padding: "6px 16px", fontSize: 12, fontWeight: 600, background: ticking === key ? COLOURS.SLATE : COLOURS.AMBER, color: "#fff", border: "none", borderRadius: RADII.SM, cursor: ticking === key ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  >
                    {ticking === key ? "Saving…" : "Tick Done (Late)"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly calendar heatmap */}
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => changeMonth(-1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLOURS.SLATE, padding: "2px 6px" }}>‹</button>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLOURS.NAVY }}>{monthLabel}</div>
        <button onClick={() => changeMonth(1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLOURS.SLATE, padding: "2px 6px" }}>›</button>
      </div>

      {loading ? (
        <div style={{ color: COLOURS.SLATE, fontSize: 13 }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{ color: COLOURS.SLATE, fontSize: 13 }}>No assignments found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: 400 }}>
            <thead>
              <tr>
                <th style={{ padding: "6px 10px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 600, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap", minWidth: 120 }}>Company</th>
                {allDays.map(d => (
                  <th key={d} style={{ padding: "4px 2px", textAlign: "center", color: d === today ? COLOURS.NAVY : COLOURS.SLATE, fontWeight: d === today ? 700 : 500, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, minWidth: 28 }}>
                    <div>{new Date(d + "T12:00:00Z").getDate()}</div>
                    <div style={{ fontSize: 9, color: COLOURS.SLATE }}>{new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map(co => (
                <tr key={co.id}>
                  <td style={{ padding: "6px 10px", color: COLOURS.NAVY, fontWeight: 500, whiteSpace: "nowrap", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>{co.name}</td>
                  {allDays.map(d => {
                    const t = lookup.get(`${co.id}|${d}`);
                    const isFuture = d > today;
                    const bg = t ? statusColor(t.is_complete, t.is_late, isFuture) : "#F8FAFC";
                    return (
                      <td key={d} style={{ padding: "2px", textAlign: "center", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <div
                          title={t ? statusLabel(t.is_complete, t.is_late) : isFuture ? "Future" : "No data"}
                          style={{ width: 22, height: 22, borderRadius: 4, background: bg, margin: "0 auto", border: d === today ? `2px solid ${COLOURS.NAVY}` : "none" }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
            {[
              { color: COLOURS.GREEN, label: "Done on time" },
              { color: COLOURS.AMBER, label: "Done late" },
              { color: COLOURS.RED,   label: "Overdue" },
              { color: "#F1F5F9",     label: "Future" },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLOURS.SLATE }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Manager view ──────────────────────────────────────────────────────────────

function ManagerView() {
  const [rows, setRows]     = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const today               = todayPKT();
  const [month, setMonth]   = useState(() => monthStart(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    const res = await authedFetch(`/api/preaudit/team-view?month=${month}`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.rows || []);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  // Distinct members
  const members = Array.from(new Map(rows.map(r => [r.member_id, { id: r.member_id, name: r.member_name, email: r.member_email }])).values())
    .sort((a, b) => a.name.localeCompare(b.name));

  // Working days in month
  const allDays = Array.from(new Set(rows.map(r => r.task_date))).sort();

  // This week
  const weekStart = prevMonday();
  const weekDays  = allDays.filter(d => d >= weekStart && d <= today).slice(-5);

  // Per-member per-day: list of company statuses
  type DayStatus = { company_name: string; is_complete: boolean; is_late: boolean };
  const memberDayMap = new Map<string, Map<string, DayStatus[]>>();
  rows.forEach(r => {
    if (!memberDayMap.has(r.member_id)) memberDayMap.set(r.member_id, new Map());
    const dm = memberDayMap.get(r.member_id)!;
    if (!dm.has(r.task_date)) dm.set(r.task_date, []);
    dm.get(r.task_date)!.push({ company_name: r.company_name, is_complete: r.is_complete, is_late: r.is_late });
  });

  // MTD compliance per member
  const mtd = members.map(m => {
    const memberRows = rows.filter(r => r.member_id === m.id && r.task_date <= today);
    const total = memberRows.length;
    const done  = memberRows.filter(r => r.is_complete).length;
    const late  = memberRows.filter(r => r.is_complete && r.is_late).length;
    const over  = memberRows.filter(r => !r.is_complete).length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 100;
    return { ...m, total, done, late, over, pct };
  });

  // Alert: members with overdue tasks today or yesterday
  const alertMembers = members.filter(m => {
    const dm = memberDayMap.get(m.id);
    if (!dm) return false;
    return Array.from(dm.entries()).some(([d, statuses]) => d <= today && statuses.some(s => !s.is_complete));
  });

  function changeMonth(delta: number) {
    const d = new Date(month + "T12:00:00Z");
    d.setMonth(d.getMonth() + delta);
    setMonth(monthStart(d));
  }
  const monthLabel = new Date(month + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div>
      {/* Alert banners */}
      {alertMembers.map(m => (
        <div key={m.id} style={{ background: "#FFF7ED", border: `1px solid ${COLOURS.AMBER}`, borderRadius: RADII.SM, padding: "10px 14px", marginBottom: 10, fontSize: 13, color: COLOURS.NAVY }}>
          ⚠️ <strong>{m.name}</strong> has overdue pre-audit tasks
        </div>
      ))}

      {/* MTD KPIs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        {mtd.map(m => (
          <div key={m.id} style={{ flex: "1 1 180px", minWidth: 160, background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "12px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLOURS.NAVY, marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name.split(" ")[0]}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: m.pct >= 95 ? COLOURS.GREEN : m.pct >= 80 ? COLOURS.AMBER : COLOURS.RED }}>{m.pct}%</div>
            <div style={{ fontSize: 10, color: COLOURS.SLATE, marginTop: 4 }}>
              {m.done}/{m.total} done · {m.over} overdue · {m.late} late
            </div>
          </div>
        ))}
      </div>

      {/* Week-at-a-glance grid */}
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => changeMonth(-1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLOURS.SLATE, padding: "2px 6px" }}>‹</button>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLOURS.NAVY }}>{monthLabel}</div>
        <button onClick={() => changeMonth(1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLOURS.SLATE, padding: "2px 6px" }}>›</button>
      </div>

      {loading ? (
        <div style={{ color: COLOURS.SLATE, fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLOURS.SLATE, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>This week</div>
          <div style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ padding: "6px 10px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 600, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, minWidth: 120 }}>Member</th>
                  {weekDays.map(d => (
                    <th key={d} style={{ padding: "6px 8px", textAlign: "center", color: d === today ? COLOURS.NAVY : COLOURS.SLATE, fontWeight: d === today ? 700 : 500, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, minWidth: 70 }}>
                      {formatDateUK(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const dm = memberDayMap.get(m.id);
                  return (
                    <tr key={m.id}>
                      <td style={{ padding: "8px 10px", color: COLOURS.NAVY, fontWeight: 500, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap" }}>
                        {m.name.split(" ").slice(0, 2).join(" ")}
                      </td>
                      {weekDays.map(d => {
                        const statuses = dm?.get(d) || [];
                        const isFuture = d > today;
                        return (
                          <td key={d} style={{ padding: "6px 8px", textAlign: "center", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                            <div style={{ display: "flex", justifyContent: "center", gap: 3, flexWrap: "wrap" }}>
                              {statuses.length === 0 ? (
                                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#E2E8F0" }} title="No tasks" />
                              ) : statuses.map(s => (
                                <div
                                  key={s.company_name}
                                  title={`${s.company_name}: ${statusLabel(s.is_complete, s.is_late)}`}
                                  style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor(s.is_complete, s.is_late, isFuture) }}
                                />
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Full month MTD table */}
          <div style={{ fontSize: 12, fontWeight: 600, color: COLOURS.SLATE, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>MTD compliance — {monthLabel}</div>
          <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${COLOURS.HAIRLINE}` }}>
                {["Member", "Done", "Overdue", "Done Late", "Compliance"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: h === "Member" ? "left" : "right", color: COLOURS.SLATE, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mtd.map(m => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  <td style={{ padding: "10px 12px", color: COLOURS.NAVY, fontWeight: 500 }}>{m.name}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: COLOURS.GREEN, fontWeight: 600 }}>{m.done}/{m.total}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: m.over > 0 ? COLOURS.RED : COLOURS.SLATE, fontWeight: m.over > 0 ? 600 : 400 }}>{m.over}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: m.late > 0 ? COLOURS.AMBER : COLOURS.SLATE, fontWeight: m.late > 0 ? 600 : 400 }}>{m.late}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: m.pct >= 95 ? COLOURS.GREEN : m.pct >= 80 ? COLOURS.AMBER : COLOURS.RED, fontWeight: 700 }}>{m.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function PreAuditTab({ userCtx }: { userCtx: UserCtx | null }) {
  const isManager = userCtx?.role === "Admin" || userCtx?.role === "Manager";
  const [view, setView] = useState<"my" | "team">(isManager ? "team" : "my");

  if (!userCtx) return null;

  const TAB_BASE: React.CSSProperties = {
    padding: "8px 16px", fontSize: 12, fontWeight: 500, color: COLOURS.SLATE,
    cursor: "pointer", border: "none", borderBottom: "2px solid transparent",
    background: "none", fontFamily: "inherit", transition: "color 0.15s",
  };
  const TAB_ACTIVE: React.CSSProperties = { color: COLOURS.NAVY, borderBottomColor: COLOURS.NAVY, fontWeight: 600 };

  return (
    <div>
      {isManager && (
        <div style={{ display: "flex", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, marginBottom: 20, gap: 0 }}>
          <button style={{ ...TAB_BASE, ...(view === "team" ? TAB_ACTIVE : {}) }} onClick={() => setView("team")}>Team View</button>
          <button style={{ ...TAB_BASE, ...(view === "my"   ? TAB_ACTIVE : {}) }} onClick={() => setView("my")}>My Tasks</button>
        </div>
      )}

      {view === "my"   && <EmployeeView userCtx={userCtx} />}
      {view === "team" && isManager && <ManagerView />}
    </div>
  );
}
