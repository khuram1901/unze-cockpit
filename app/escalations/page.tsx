"use client";

import { useEffect, useState, useCallback } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";
import Link from "next/link";

const { NAVY, SLATE } = COLOURS;

// ── Types ────────────────────────────────────────────────────────────────────

type EscalatedTask = {
  task_id: string;
  description: string;
  assigned_to: string;
  assigned_to_email: string;
  priority: "Critical" | "Urgent" | "High" | "Normal" | "Medium" | "Low";
  status: string;
  due_date: string;
  due_time: string | null;
  hours_overdue: number;
  escalation_level: 1 | 2 | 3;
  company_id: string;
  department: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITY_THRESHOLDS: Record<string, { l1: number; l2: number; l3: number; label: string }> = {
  Critical: { l1: 6,  l2: 12,  l3: 60,  label: "Critical" },
  Urgent:   { l1: 24, l2: 48,  l3: 120, label: "Urgent" },
  High:     { l1: 24, l2: 48,  l3: 120, label: "High" },
  Normal:   { l1: 48, l2: 96,  l3: 216, label: "Normal" },
  Medium:   { l1: 48, l2: 96,  l3: 216, label: "Medium" },
};

const LEVEL_LABELS: Record<number, { label: string; colour: string; bg: string; who: string }> = {
  1: { label: "L1",  colour: "#b45309", bg: "#fef3c7", who: "Direct manager"    },
  2: { label: "L2",  colour: "#7c3aed", bg: "#ede9fe", who: "HOD"               },
  3: { label: "L3",  colour: "#b91c1c", bg: "#fee2e2", who: "CEO / Director"    },
};

const PRIORITY_COLOUR: Record<string, string> = {
  Critical: "#b91c1c",
  Urgent:   "#c2410c",
  High:     "#b45309",
  Normal:   "#1d4ed8",
  Medium:   "#1d4ed8",
  Low:      "#6b7280",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoursLabel(h: number): string {
  if (h < 24) return `${h}h overdue`;
  const days = Math.floor(h / 24);
  const rem  = Math.round(h % 24);
  return rem > 0 ? `${days}d ${rem}h overdue` : `${days}d overdue`;
}

function priorityTier(p: string): "Critical" | "Urgent" | "Normal" {
  if (p === "Critical") return "Critical";
  if (p === "Urgent" || p === "High") return "Urgent";
  return "Normal";
}

// ── Escalation Map component ──────────────────────────────────────────────────

function EscalationMap() {
  const mapStyle: React.CSSProperties = {
    background: "var(--surface, #f8fafc)",
    border: "1px solid var(--border, #e2e8f0)",
    borderRadius: RADII.card,
    padding: "20px 24px",
    marginBottom: 24,
  };
  const tierStyle = (colour: string): React.CSSProperties => ({
    display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12,
  });
  const badge = (colour: string, text: string): React.CSSProperties => ({
    background: colour + "20",
    color: colour,
    border: `1px solid ${colour}40`,
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
    marginTop: 2,
  });

  const rows = [
    { tier: "Critical", thresholds: "L1 @ 6h → L2 @ 12h → L3 @ 60h", colour: "#b91c1c", who: "L1 = Direct manager · L2 = HOD · L3 = CEO / Director" },
    { tier: "Urgent / High", thresholds: "L1 @ 24h → L2 @ 48h → L3 @ 120h", colour: "#c2410c", who: "L1 = Direct manager · L2 = HOD · L3 = CEO / Director" },
    { tier: "Normal / Medium", thresholds: "L1 @ 48h → L2 @ 96h → L3 @ 216h", colour: "#1d4ed8", who: "L1 = Direct manager · L2 = HOD · L3 = CEO / Director" },
  ];

  return (
    <div style={mapStyle}>
      <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: "var(--text-primary, #0f172a)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Escalation Map
      </p>
      {rows.map((r) => (
        <div key={r.tier} style={tierStyle(r.colour)}>
          <span style={badge(r.colour, r.tier)}>{r.tier}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #0f172a)" }}>{r.thresholds}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary, #64748b)", marginTop: 2 }}>{r.who}</div>
          </div>
        </div>
      ))}
      <p style={{ fontSize: 11, color: "var(--text-tertiary, #94a3b8)", marginTop: 8, marginBottom: 0 }}>
        All timers start from the moment the task is created in Pakistan time (PKT = UTC+5). 
        No DST — the clock never changes.
      </p>
    </div>
  );
}

// ── KPI Tile ──────────────────────────────────────────────────────────────────

function KpiTile({ label, count, colour, bg }: { label: string; count: number; colour: string; bg: string }) {
  return (
    <div style={{
      background: bg,
      border: `1px solid ${colour}30`,
      borderRadius: RADII.card,
      padding: "16px 20px",
      flex: 1,
      minWidth: 120,
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: colour, lineHeight: 1 }}>{count}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: colour + "cc", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function EscalationsPageClient() {
  const [tasks, setTasks]       = useState<EscalatedTask[]>([]);
  const [loading, setLoading]   = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<keyof EscalatedTask>("hours_overdue");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("desc");
  const [filterPriority, setFilterPriority] = useState("All");
  const [filterLevel, setFilterLevel]       = useState("All");
  const [filterDept, setFilterDept]         = useState("All");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_my_escalated_tasks");
    if (!error && data) setTasks(data as EscalatedTask[]);
    setLastFetched(new Date());
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  // ── Derived counts ──
  const critical = tasks.filter((t) => t.priority === "Critical").length;
  const highUrgent = tasks.filter((t) => t.priority === "Urgent" || t.priority === "High").length;
  const normal = tasks.filter((t) => priorityTier(t.priority) === "Normal").length;

  const departments = Array.from(new Set(tasks.map((t) => t.department).filter(Boolean))) as string[];

  // ── Filter + Sort ──
  const filtered = tasks
    .filter((t) => filterPriority === "All" || t.priority === filterPriority)
    .filter((t) => filterLevel    === "All" || String(t.escalation_level) === filterLevel)
    .filter((t) => filterDept     === "All" || t.department === filterDept)
    .sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });

  function toggleSort(field: keyof EscalatedTask) {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  }

  const thStyle: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-secondary, #64748b)",
    borderBottom: "2px solid var(--border, #e2e8f0)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    userSelect: "none",
  };

  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 13,
    borderBottom: "1px solid var(--border-subtle, #f1f5f9)",
    verticalAlign: "middle",
  };

  const selectStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--border, #e2e8f0)",
    background: "var(--surface, #f8fafc)",
    fontSize: 13,
    color: "var(--text-primary, #0f172a)",
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "var(--text-primary, #0f172a)" }}>
          🚨 Escalations
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary, #64748b)" }}>
          Tasks overdue beyond their grace window — visible to the responsible level in the chain.
          {lastFetched && (
            <span style={{ marginLeft: 8 }}>
              Last refreshed: {lastFetched.toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" })} PKT
            </span>
          )}
        </p>
      </div>

      {/* ── Escalation Map ── */}
      <EscalationMap />

      {/* ── KPI Tiles ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <KpiTile label="Critical" count={critical}   colour="#b91c1c" bg="#fee2e2" />
        <KpiTile label="High / Urgent" count={highUrgent} colour="#c2410c" bg="#ffedd5" />
        <KpiTile label="Normal / Medium" count={normal}  colour="#1d4ed8" bg="#dbeafe" />
        <KpiTile label="Total" count={tasks.length}   colour="#334155" bg="#f1f5f9" />
      </div>

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <select style={selectStyle} value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
          <option value="All">All priorities</option>
          <option>Critical</option>
          <option>Urgent</option>
          <option>High</option>
          <option>Normal</option>
          <option>Medium</option>
        </select>
        <select style={selectStyle} value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
          <option value="All">All levels</option>
          <option value="1">L1 — Direct manager</option>
          <option value="2">L2 — HOD</option>
          <option value="3">L3 — CEO / Director</option>
        </select>
        <select style={selectStyle} value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
          <option value="All">All departments</option>
          {departments.map((d) => <option key={d}>{d}</option>)}
        </select>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: "6px 14px", borderRadius: 6, border: "none",
            background: NAVY, color: "#fff", fontSize: 13, fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
        <span style={{ fontSize: 12, color: "var(--text-tertiary, #94a3b8)", marginLeft: 4 }}>
          {filtered.length} {filtered.length === 1 ? "task" : "tasks"}
        </span>
      </div>

      {/* ── Table ── */}
      {loading && tasks.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary, #64748b)" }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: 48, textAlign: "center",
          background: "var(--surface, #f8fafc)",
          border: "1px solid var(--border, #e2e8f0)",
          borderRadius: RADII.card,
          color: "var(--text-secondary, #64748b)",
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 600 }}>No escalated tasks</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Everything in your chain is within its grace window.</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: RADII.card, border: "1px solid var(--border, #e2e8f0)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg, #fff)" }}>
            <thead>
              <tr>
                {([
                  ["description",      "Task"],
                  ["assigned_to",      "Assigned to"],
                  ["department",       "Department"],
                  ["priority",         "Priority"],
                  ["hours_overdue",    "Overdue"],
                  ["escalation_level", "Level"],
                  ["status",           "Status"],
                ] as [keyof EscalatedTask, string][]).map(([field, label]) => (
                  <th key={field} style={thStyle} onClick={() => toggleSort(field)}>
                    {label}
                    {sortField === field && <span style={{ marginLeft: 4 }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                ))}
                <th style={{ ...thStyle, cursor: "default" }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const lvl = LEVEL_LABELS[t.escalation_level];
                const pColour = PRIORITY_COLOUR[t.priority] ?? "#64748b";
                return (
                  <tr key={`${t.task_id}-${t.escalation_level}`}
                    style={{ transition: "background 0.15s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface, #f8fafc)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ ...tdStyle, maxWidth: 280 }}>
                      <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {t.description}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.assigned_to}</div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary, #94a3b8)" }}>{t.assigned_to_email}</div>
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-secondary, #64748b)" }}>
                      {t.department ?? "—"}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        background: pColour + "18", color: pColour,
                        border: `1px solid ${pColour}30`,
                        borderRadius: 5, padding: "2px 7px",
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {t.priority}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: t.hours_overdue >= 48 ? "#b91c1c" : t.hours_overdue >= 24 ? "#c2410c" : "#b45309" }}>
                      {hoursLabel(t.hours_overdue)}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        background: lvl.bg, color: lvl.colour,
                        border: `1px solid ${lvl.colour}30`,
                        borderRadius: 5, padding: "2px 7px",
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {lvl.label} · {lvl.who}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-secondary, #64748b)" }}>{t.status}</td>
                    <td style={tdStyle}>
                      <Link
                        href={`/tasks?task=${t.task_id}`}
                        style={{ color: NAVY, fontWeight: 600, fontSize: 12, textDecoration: "none" }}
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function EscalationsPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <EscalationsPageClient />
      </main>
    </AuthWrapper>
  );
}
