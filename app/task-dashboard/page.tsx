"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { useUserCtx } from "../lib/useUserCtx";
import { canSeeAllTasks, isPrivileged } from "../lib/permissions";

// ── Types ────────────────────────────────────────────────────────────────────

type DashStats = {
  total_tasks: number;
  completed_count: number;
  open_count: number;
  in_progress_count: number;
  waiting_count: number;
  pending_count: number;
  in_review_count: number;
  stuck_count: number;
  sla_breaches: number;
  active_users: number;
  resolution_rate: number;
  status_distribution: { status: string; count: number }[];
  department_breakdown: { department: string; total: number; completed: number; breached: number }[];
};

type Filters = {
  department: string;
  priority: string;
  assigned_to_email: string;
  date_from: string;
  date_to: string;
};

const EMPTY_STATS: DashStats = {
  total_tasks: 0,
  completed_count: 0,
  open_count: 0,
  in_progress_count: 0,
  waiting_count: 0,
  pending_count: 0,
  in_review_count: 0,
  stuck_count: 0,
  sla_breaches: 0,
  active_users: 0,
  resolution_rate: 0,
  status_distribution: [],
  department_breakdown: [],
};

// ── Colours ───────────────────────────────────────────────────────────────────

const { BLUE, GREEN, AMBER, RED } = COLOURS;

const STATUS_COLOURS: Record<string, string> = {
  Completed: "#22c55e",
  "In Progress": "#3b82f6",
  "Not Started": "#94a3b8",
  Submitted: "#8b5cf6",
  "Waiting Reply": "#f59e0b",
  Stuck: "#ef4444",
  Cancelled: "#6b7280",
};

const PIE_COLOURS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#64748b",
];

// ── Canvas donut chart ────────────────────────────────────────────────────────

function DonutChart({
  data,
  size = 130,
  centreLabel,
  centreValue,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  centreLabel?: string;
  centreValue?: string | number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const total = data.reduce((s, d) => s + d.value, 0);
    ctx.clearRect(0, 0, size, size);
    if (total === 0) return;
    const cx = size / 2, cy = size / 2, r = size / 2 - 4;
    let angle = -Math.PI / 2;
    for (const seg of data) {
      const slice = (seg.value / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      angle += slice;
    }
    // donut hole
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, 2 * Math.PI);
    ctx.fillStyle = "white";
    ctx.fill();
  }, [data, size]);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <canvas ref={ref} width={size} height={size} style={{ display: "block" }} />
      {centreValue !== undefined && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: "18px", fontWeight: 700, color: RED, lineHeight: 1 }}>
            {centreValue}
          </div>
          {centreLabel && (
            <div style={{ fontSize: "9px", color: "#64748b", marginTop: "2px" }}>
              {centreLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Canvas bar chart ──────────────────────────────────────────────────────────

function DeptBarChart({
  data,
}: {
  data: { label: string; total: number; completed: number; breached: number }[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const W = container.offsetWidth;
      canvas.width = W;
      const H = 160;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      if (data.length === 0) return;

      const maxVal = Math.max(...data.map((d) => d.total), 1);
      const padL = 4, padR = 4, padT = 8, padB = 28;
      const chartH = H - padT - padB;
      const totalBarW = (W - padL - padR) / data.length;
      const barW = Math.max(6, totalBarW * 0.6);
      const barGap = (totalBarW - barW) / 2;

      data.forEach((d, i) => {
        const x = padL + i * totalBarW + barGap;
        const totalH = (d.total / maxVal) * chartH;
        // bg bar
        ctx.fillStyle = "#e2e8f0";
        ctx.roundRect(x, padT + chartH - totalH, barW, totalH, 3);
        ctx.fill();
        // completed
        if (d.completed > 0) {
          const doneH = (d.completed / maxVal) * chartH;
          ctx.fillStyle = "#22c55e";
          ctx.roundRect(x, padT + chartH - doneH, barW, doneH, 3);
          ctx.fill();
        }
        // breached overlay
        if (d.breached > 0) {
          const breachH = Math.min((d.breached / maxVal) * chartH, totalH);
          ctx.fillStyle = "#ef444460";
          ctx.roundRect(x, padT + chartH - totalH, barW, breachH, [3, 3, 0, 0]);
          ctx.fill();
        }
        // label
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px system-ui, sans-serif";
        ctx.textAlign = "center";
        const label = d.label.length > 7 ? d.label.slice(0, 7) + "…" : d.label;
        ctx.fillText(label, x + barW / 2, H - 6);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [data]);

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <canvas ref={ref} style={{ display: "block", width: "100%" }} />
    </div>
  );
}

// ── KPI tile ──────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  sub,
  color,
  icon,
  loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon: string;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: RADII.CARD,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
        <span style={{ fontSize: "16px" }}>{icon}</span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
      {loading ? (
        <div
          style={{
            height: "28px",
            borderRadius: "6px",
            background: "var(--bg-card-hover, #f1f5f9)",
            animation: "tdPulse 1.4s ease-in-out infinite",
          }}
        />
      ) : (
        <div
          style={{
            fontSize: "26px",
            fontWeight: 700,
            color: color || "var(--text-primary)",
            lineHeight: 1.15,
          }}
        >
          {value}
        </div>
      )}
      {sub && (
        <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.3 }}>{sub}</div>
      )}
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  "Accounts & Finance","Admin","CEO Office","Customer Service","Finance & Tax",
  "HR","Internal Audit","IT","Legal","Logistics","Marketing","Operations",
  "Procurement","Retail","Sales","Unze Trading Operations","Warehouse",
];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

function FilterBar({
  filters,
  onChange,
  onReset,
  loading,
}: {
  filters: Filters;
  onChange: (key: keyof Filters, value: string) => void;
  onReset: () => void;
  loading: boolean;
}) {
  const sel: React.CSSProperties = {
    padding: "6px 10px", fontSize: "13px",
    border: "1px solid var(--border-color)", borderRadius: "8px",
    backgroundColor: "var(--bg-input,var(--bg-card))",
    color: "var(--text-primary)", cursor: "pointer",
  };
  const inp: React.CSSProperties = {
    ...sel, cursor: "text",
  };
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center",
        backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
        borderRadius: RADII.CARD, padding: "12px 16px", marginBottom: "20px",
      }}
    >
      <select value={filters.department} onChange={(e) => onChange("department", e.target.value)} style={sel}>
        <option value="">All Departments</option>
        {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>

      <select value={filters.priority} onChange={(e) => onChange("priority", e.target.value)} style={sel}>
        <option value="">All Priorities</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      <input
        type="email"
        placeholder="Assigned to (email)…"
        value={filters.assigned_to_email}
        onChange={(e) => onChange("assigned_to_email", e.target.value)}
        style={{ ...inp, minWidth: "180px" }}
      />

      <input type="date" value={filters.date_from} onChange={(e) => onChange("date_from", e.target.value)} style={inp} title="From date" />
      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>→</span>
      <input type="date" value={filters.date_to} onChange={(e) => onChange("date_to", e.target.value)} style={inp} title="To date" />

      {hasFilters && (
        <button
          onClick={onReset}
          style={{
            padding: "6px 12px", fontSize: "13px", fontWeight: 500,
            border: "1px solid var(--border-color)", borderRadius: "8px",
            backgroundColor: "transparent", color: RED, cursor: "pointer",
          }}
        >
          Clear
        </button>
      )}
      {loading && (
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Refreshing…</span>
      )}
    </div>
  );
}

// ── Legend item ───────────────────────────────────────────────────────────────

function LegendItem({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px" }}>
      <div style={{ width: "9px", height: "9px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
      <span style={{ color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, color: "var(--text-primary)", flexShrink: 0 }}>
        {count.toLocaleString()}
      </span>
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
        borderRadius: RADII.CARD, overflow: "hidden", ...style,
      }}
    >
      <div
        style={{
          padding: "10px 16px", borderBottom: "1px solid var(--border-color)",
          fontSize: "12px", fontWeight: 700, color: "var(--text-muted)",
          textTransform: "uppercase", letterSpacing: "0.07em",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "16px" }}>{children}</div>
    </div>
  );
}

// ── Main inner component ───────────────────────────────────────────────────────

function TaskDashboardInner() {
  const isMobile = useMobile();
  const { userCtx } = useUserCtx();
  const [stats, setStats] = useState<DashStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    department: "", priority: "", assigned_to_email: "", date_from: "", date_to: "",
  });

  // Debounce email input
  const emailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedEmail, setDebouncedEmail] = useState("");
  useEffect(() => {
    if (emailTimer.current) clearTimeout(emailTimer.current);
    emailTimer.current = setTimeout(() => setDebouncedEmail(filters.assigned_to_email), 500);
    return () => { if (emailTimer.current) clearTimeout(emailTimer.current); };
  }, [filters.assigned_to_email]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("get_task_dashboard_stats", {
        p_department: filters.department || null,
        p_company_id: null,
        p_priority: filters.priority || null,
        p_assigned_to_email: debouncedEmail || null,
        p_date_from: filters.date_from || null,
        p_date_to: filters.date_to || null,
      });
      if (rpcErr) throw rpcErr;
      setStats((data as DashStats) || EMPTY_STATS);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filters.department, filters.priority, filters.date_from, filters.date_to, debouncedEmail]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleFilterChange = (key: keyof Filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  const resetFilters = () =>
    setFilters({ department: "", priority: "", assigned_to_email: "", date_from: "", date_to: "" });

  // Permission gate
  const canView = userCtx ? isPrivileged(userCtx) || canSeeAllTasks(userCtx) : false;
  if (userCtx && !canView) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ fontSize: "36px", marginBottom: "12px" }}>🔒</div>
        <p>You don't have access to the Task Performance Dashboard.</p>
      </div>
    );
  }

  // ── Derived chart data ──────────────────────────────────────────────────────

  const statusPieData = stats.status_distribution
    .filter((s) => s.count > 0)
    .map((s, i) => ({
      label: s.status,
      value: s.count,
      color: STATUS_COLOURS[s.status] ?? PIE_COLOURS[i % PIE_COLOURS.length],
    }));

  const slaPieData = [
    { label: "SLA Breached", value: stats.sla_breaches, color: RED },
    { label: "SLA Active", value: Math.max(0, stats.open_count - stats.sla_breaches), color: GREEN },
  ].filter((d) => d.value > 0);

  const barData = stats.department_breakdown.map((d) => ({
    label: d.department,
    total: d.total,
    completed: d.completed,
    breached: d.breached,
  }));

  // ── KPI config ──────────────────────────────────────────────────────────────

  const kpis = [
    { label: "Total Tasks",     value: stats.total_tasks.toLocaleString(),      icon: "📋" },
    { label: "Completed",       value: stats.completed_count.toLocaleString(),  icon: "✅", color: GREEN },
    { label: "Open",            value: stats.open_count.toLocaleString(),       icon: "📂", color: BLUE },
    { label: "In Progress",     value: stats.in_progress_count.toLocaleString(),icon: "⚡", color: BLUE },
    { label: "Not Started",     value: stats.pending_count.toLocaleString(),    icon: "🕐", color: "var(--text-muted)" },
    { label: "In Review",       value: stats.in_review_count.toLocaleString(),  icon: "🔍", color: "#8b5cf6",
      sub: "Submitted, pending sign-off" },
    { label: "Stuck",           value: stats.stuck_count.toLocaleString(),      icon: "🚧", color: AMBER },
    { label: "SLA Breaches",    value: stats.sla_breaches.toLocaleString(),     icon: "🔴", color: RED,
      sub: "Open tasks past due date" },
    { label: "Resolution Rate", value: `${stats.resolution_rate}%`,             icon: "📈",
      color: stats.resolution_rate >= 70 ? GREEN : stats.resolution_rate >= 50 ? AMBER : RED,
      sub: "Completed ÷ non-cancelled" },
    { label: "Active Users",    value: stats.active_users.toLocaleString(),     icon: "👥",
      sub: "People with open tasks" },
  ];

  const p = isMobile ? "12px 14px" : "20px 24px";

  return (
    <div style={{ padding: p, maxWidth: "1400px" }}>
      {/* Pulse animation */}
      <style>{`
        @keyframes tdPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.45; }
        }
      `}</style>

      {/* Filters */}
      <FilterBar filters={filters} onChange={handleFilterChange} onReset={resetFilters} loading={loading} />

      {error && (
        <div style={{
          marginBottom: "16px", padding: "12px 16px",
          backgroundColor: "#fef2f2", border: "1px solid #fca5a5",
          borderRadius: "8px", color: RED, fontSize: "13px",
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* KPI grid — 5 cols desktop, 2 mobile */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)",
        gap: "12px",
        marginBottom: "24px",
      }}>
        {kpis.map((k) => (
          <KpiTile key={k.label} {...k} loading={loading} />
        ))}
      </div>

      {/* Charts row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "200px 200px 1fr",
        gap: "16px",
        marginBottom: "24px",
        alignItems: "start",
      }}>
        {/* Status donut */}
        <Card title="Status Distribution">
          {loading || statusPieData.length === 0 ? (
            <div style={{ height: "140px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              {loading ? "Loading…" : "No data"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
              <DonutChart data={statusPieData} size={120} />
              <div style={{ display: "flex", flexDirection: "column", gap: "5px", width: "100%" }}>
                {statusPieData.map((d) => (
                  <LegendItem key={d.label} color={d.color} label={d.label} count={d.value} />
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* SLA donut */}
        <Card title="SLA Status">
          {loading || slaPieData.length === 0 ? (
            <div style={{ height: "140px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              {loading ? "Loading…" : "No open tasks"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
              <DonutChart
                data={slaPieData}
                size={120}
                centreValue={stats.sla_breaches}
                centreLabel="breached"
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "5px", width: "100%" }}>
                {slaPieData.map((d) => (
                  <LegendItem key={d.label} color={d.color} label={d.label} count={d.value} />
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Department bar */}
        <Card title="By Department">
          {loading || barData.length === 0 ? (
            <div style={{ height: "160px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              {loading ? "Loading…" : "No data"}
            </div>
          ) : (
            <div>
              <DeptBarChart data={barData} />
              <div style={{ display: "flex", gap: "16px", marginTop: "10px", fontSize: "11px", color: "var(--text-muted)", justifyContent: "center" }}>
                <span><span style={{ display: "inline-block", width: "9px", height: "9px", backgroundColor: "#e2e8f0", marginRight: "4px" }} />Total</span>
                <span><span style={{ display: "inline-block", width: "9px", height: "9px", backgroundColor: "#22c55e", marginRight: "4px" }} />Completed</span>
                <span><span style={{ display: "inline-block", width: "9px", height: "9px", backgroundColor: "#ef4444", marginRight: "4px", opacity: 0.7 }} />SLA Breached</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Department table */}
      {!loading && stats.department_breakdown.length > 0 && (
        <Card title="Department Breakdown">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border-color)" }}>
                  {["Department", "Total", "Completed", "Open", "SLA Breaches", "Resolution"].map((h) => (
                    <th key={h} style={{
                      padding: "8px 12px",
                      textAlign: h === "Department" ? "left" : "right",
                      fontSize: "11px", fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      color: "var(--text-muted)", whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.department_breakdown.map((row, i) => {
                  const open = row.total - row.completed;
                  const res = row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0;
                  return (
                    <tr
                      key={row.department}
                      style={{
                        borderBottom: "1px solid var(--border-light,var(--border-color))",
                        backgroundColor: i % 2 === 0 ? "transparent" : "var(--bg-page)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover,#f8fafc)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = i % 2 === 0 ? "transparent" : "var(--bg-page)"; }}
                    >
                      <td style={{ padding: "9px 12px", fontWeight: 500, color: "var(--text-primary)" }}>{row.department}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>{row.total.toLocaleString()}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: GREEN, fontWeight: 500 }}>{row.completed.toLocaleString()}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: BLUE }}>{open.toLocaleString()}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: row.breached > 0 ? RED : "var(--text-muted)", fontWeight: row.breached > 0 ? 600 : 400 }}>
                        {row.breached.toLocaleString()}
                      </td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: "20px",
                          fontSize: "12px", fontWeight: 600,
                          backgroundColor: res >= 70 ? "#dcfce7" : res >= 50 ? "#fef3c7" : "#fef2f2",
                          color: res >= 70 ? "#15803d" : res >= 50 ? "#92400e" : "#b91c1c",
                        }}>
                          {res}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function TaskDashboardPage() {
  return (
    <AuthWrapper>
      <TaskDashboardInner />
    </AuthWrapper>
  );
}
