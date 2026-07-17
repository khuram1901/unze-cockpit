"use client";

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions } from "../../lib/supabase";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, RADII, SHADOWS, cardStyle, PageHeader, SectionTitle, StatusBadge, PriorityBadge, WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR, useConfirm } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { canReviewTasks, canCreateAssignments, canDeleteTask, isTaskProtected, widgetVisible, type UserCtx, type PermOverrides } from "../../lib/permissions";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import NewTaskForm from "../../tasks/NewTaskForm";
import { useUserCtx } from "../../lib/useUserCtx";

type Task = {
  id: string;
  description: string;
  project: string | null;
  assigned_to: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  assigned_by_email: string | null;
};

const today = new Date().toISOString().slice(0, 10);
const STATUSES = ["Not Started", "In Progress", "Waiting Reply", "Completed", "Cancelled"];
const PRIORITY_ORDER: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Normal: 2, Low: 3 };

function isOverdue(t: Task) {
  if (t.status === "Completed" || t.status === "Cancelled") return false;
  return !!t.due_date && t.due_date < today;
}

function daysOverdue(t: Task): number {
  if (!t.due_date || !isOverdue(t)) return 0;
  return Math.floor((Date.now() - new Date(t.due_date + "T00:00:00").getTime()) / 86400000);
}

function sortByPriority(a: Task, b: Task): number {
  const pa = PRIORITY_ORDER[a.priority || "Normal"] ?? 2;
  const pb = PRIORITY_ORDER[b.priority || "Normal"] ?? 2;
  if (pa !== pb) return pa - pb;
  return daysOverdue(b) - daysOverdue(a);
}

const companyColors: Record<string, string> = {
  "Unze Trading PVT Limited":     COLOURS.BLUE,
  "Imperial Footwear PVT Limited": COLOURS.AMBER,
  "Haute Dolci":                  COLOURS.GREEN,
  "Barahn PVT Limited":           COLOURS.PURPLE,
  "K&K Jhang":                    COLOURS.SLATE,
};

export default function AdminDashboard() {
  const isMobile = useMobile();
  const dlg = useConfirm();
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const { ctx: widgetCtx } = useUserCtx();
  const wv = (key: string, defaultVisible: boolean) => !!widgetCtx && widgetVisible(widgetCtx, key, defaultVisible);

  async function loadData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user?.email) {
      const { data: memberData } = await supabase.from("members").select("id, role, department, company").eq("email", userData.user.email).maybeSingle();
      if (memberData) {
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email: userData.user.email, role: memberData.role, department: memberData.department, company: memberData.company, overrides };
        setUserCtx(ctx);
        setCanDelete(canReviewTasks(ctx));
      }
    }
    const { data } = await supabase.from("tasks")
      .select("id, description, project, assigned_to, due_date, priority, status, notes, created_at, assigned_by_email")
      .eq("assigned_to_department", "Admin").order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function updateStatus(id: string, newStatus: string) {
    await supabase.from("tasks").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", id);
    logAction("Updated", "tasks", `Status → ${newStatus}`, id);
    loadData();
  }

  const openTasks = items.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const overdueTasks = openTasks.filter(isOverdue);
  const completed = items.filter((t) => t.status === "Completed").length;
  const urgentCount = openTasks.filter((t) => t.priority === "Urgent" || t.priority === "High").length;

  const donutData = [
    { name: "Overdue", value: overdueTasks.length, color: COLOURS.RED },
    { name: "In Progress", value: openTasks.filter((t) => t.status === "In Progress").length, color: COLOURS.AMBER },
    { name: "Not Started", value: openTasks.filter((t) => t.status === "Not Started").length, color: COLOURS.SLATE },
    { name: "Completed", value: completed, color: COLOURS.GREEN },
  ].filter((d) => d.value > 0);

  const companyDonutData = Array.from(
    openTasks.reduce((map, t) => {
      const c = t.project || "Unassigned";
      map.set(c, (map.get(c) || 0) + 1);
      return map;
    }, new Map<string, number>())
  ).map(([name, value]) => ({
    name: name.replace(" PVT Limited", ""),
    value,
    color: companyColors[name] || COLOURS.SLATE,
  })).sort((a, b) => b.value - a.value);

  // Filter by priority
  const filteredOpen = priorityFilter === "all"
    ? openTasks
    : openTasks.filter((t) => (t.priority || "Normal") === priorityFilter);

  // Group filtered tasks by company, sorted by priority within
  const companyGroups = new Map<string, Task[]>();
  for (const t of filteredOpen) {
    const c = t.project || "Unassigned";
    if (!companyGroups.has(c)) companyGroups.set(c, []);
    companyGroups.get(c)!.push(t);
  }
  for (const tasks of companyGroups.values()) tasks.sort(sortByPriority);
  const companyNames = Array.from(companyGroups.keys()).sort();

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      {dlg.element}
      {/* Header with + button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader />
        {userCtx && canCreateAssignments(userCtx) && (
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: SHADOWS.MODAL,
          }} title="Issue task">{showForm ? "×" : "+"}</button>
        )}
      </div>

      {/* Collapsible add form */}
      {showForm && (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`,
          borderRadius: RADII.CARD, marginBottom: "14px", overflow: "hidden",
        }}>
          <NewTaskForm onCreated={() => { setShowForm(false); loadData(); }} />
        </div>
      )}

      {/* Alert Banner */}
      {wv("dept_admin.attention_banner", true) && !loading && overdueTasks.length > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""}</div>
                <div style={{ fontSize: "12px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>{overdueTasks.slice(0, 3).map((t) => `${t.description.slice(0, 25)}${t.description.length > 25 ? "…" : ""}`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={WARNING_BANNER_INNER}>
              {overdueTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => (
                <div key={t.id} onClick={() => { setExpandedId(t.id); setBannerOpen(false); }} style={{ padding: "8px 16px 8px 48px", borderBottom: `1px solid ${COLOURS.TRACK}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{t.description}</div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>{t.assigned_to || "Unassigned"} · {t.project || "—"}</div>
                  </div>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.RED }}>{daysOverdue(t)}d late</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      {wv("dept_admin.kpi_charts", true) && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          {[
            { label: "Open",        value: openTasks.length },
            { label: "Overdue",     value: overdueTasks.length },
            { label: "Urgent/High", value: urgentCount },
            { label: "Completed",   value: completed },
          ].map(({ label, value }) => (
            <div key={label} style={{ ...cardStyle, padding: "16px 20px" }}>
              <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "10px" }}>{label}</div>
              <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: COLOURS.NAVY }}>{value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Two donuts side by side */}
      {wv("dept_admin.kpi_charts", true) && !loading && (donutData.length > 0 || companyDonutData.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          {donutData.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "16px 20px", backgroundColor: COLOURS.CARD }}>
              <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>By Status</div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                    {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value} task${Number(value) > 1 ? "s" : ""}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                {donutData.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: COLOURS.SLATE }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </div>
          )}
          {companyDonutData.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "16px 20px", backgroundColor: COLOURS.CARD }}>
              <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>By Company</div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={companyDonutData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                    {companyDonutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value} task${Number(value) > 1 ? "s" : ""}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                {companyDonutData.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: COLOURS.SLATE }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Priority filter + section title */}
      {wv("dept_admin.records_table", true) && (
      <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", gap: "8px", flexWrap: "wrap" }}>
        <SectionTitle title="Tasks by Company" />
        <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
          {[
            { key: "all", label: "All" },
            { key: "Urgent", label: "Urgent", color: COLOURS.RED },
            { key: "High", label: "High", color: COLOURS.RED },
            { key: "Normal", label: "Normal", color: COLOURS.BLUE },
            { key: "Low", label: "Low", color: COLOURS.SLATE },
          ].map((f) => (
            <button key={f.key} onClick={() => setPriorityFilter(f.key)} style={{
              backgroundColor: priorityFilter === f.key ? (f.color || COLOURS.NAVY) : COLOURS.CARD,
              color: priorityFilter === f.key ? COLOURS.CARD : COLOURS.NAVY,
              border: priorityFilter === f.key ? "1px solid transparent" : `1px solid ${COLOURS.HAIRLINE}`,
              borderRadius: RADII.SM, padding: "4px 10px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Tasks grouped by company */}
      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : companyNames.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, textAlign: "center" }}>
          {priorityFilter === "all" ? "No open admin tasks." : `No ${priorityFilter} priority tasks.`}
        </div>
      ) : (
        companyNames.map((company) => {
          const tasks = companyGroups.get(company)!;
          const compOverdue = tasks.filter(isOverdue).length;
          const compUrgent = tasks.filter((t) => t.priority === "Urgent" || t.priority === "High").length;
          const compInProgress = tasks.filter((t) => t.status === "In Progress").length;
          const compNotStarted = tasks.filter((t) => t.status === "Not Started").length;
          const companyColor = companyColors[company] || COLOURS.SLATE;

          return (
            <div key={company} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${companyColor}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "12px" }}>
              {/* Company header with mini stats */}
              <div style={{ padding: "10px 16px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{company.replace(" PVT Limited", "")}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE }}>{tasks.length} task{tasks.length > 1 ? "s" : ""}</span>
                </div>
                <div style={{ display: "flex", gap: "12px", fontSize: "13px", flexWrap: "wrap" }}>
                  {compOverdue > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: COLOURS.RED }} />
                      <span style={{ fontWeight: 700, color: COLOURS.RED }}>{compOverdue} overdue</span>
                    </div>
                  )}
                  {compUrgent > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: COLOURS.RED }} />
                      <span style={{ fontWeight: 700, color: COLOURS.RED }}>{compUrgent} urgent/high</span>
                    </div>
                  )}
                  {compInProgress > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: COLOURS.AMBER }} />
                      <span style={{ fontWeight: 600, color: COLOURS.AMBER }}>{compInProgress} in progress</span>
                    </div>
                  )}
                  {compNotStarted > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: COLOURS.SLATE }} />
                      <span style={{ color: COLOURS.SLATE }}>{compNotStarted} not started</span>
                    </div>
                  )}
                  {compOverdue === 0 && compUrgent === 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: COLOURS.GREEN }} />
                      <span style={{ fontWeight: 600, color: COLOURS.GREEN }}>On track</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Task rows sorted by priority */}
              {tasks.map((task) => {
                const isOpen = expandedId === task.id;
                const overdue = isOverdue(task);
                const od = daysOverdue(task);
                return (
                  <div key={task.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <div onClick={() => setExpandedId(isOpen ? null : task.id)} style={{
                      padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                      backgroundColor: overdue ? COLOURS.DANGER_SOFT : isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
                        <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                          <span>{task.assigned_to || "Unassigned"}</span>
                          {task.due_date && <span style={{ color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 700 : 400 }}>{formatDateUK(task.due_date)}{od > 0 && ` (${od}d late)`}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                        {task.priority && <PriorityBadge priority={task.priority} />}
                        <StatusBadge status={task.status} />
                        <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{isOpen ? "▼" : "▶"}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "12px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                        {task.notes && <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginBottom: "6px" }}>Notes: {task.notes}</div>}
                        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Status:</span>
                          <select value={task.status} onChange={(e) => updateStatus(task.id, e.target.value)} style={{ padding: "5px 8px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, fontSize: "14px" }}>
                            {STATUSES.map((s) => <option key={s}>{s}</option>)}
                          </select>
                          <span style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginLeft: "8px" }}>Priority:</span>
                          <select value={task.priority || "Normal"} onChange={(e) => {
                            supabase.from("tasks").update({ priority: e.target.value }).eq("id", task.id).then(() => loadData());
                          }} style={{ padding: "5px 8px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, fontSize: "14px" }}>
                            <option>Low</option><option>Normal</option><option>High</option><option>Urgent</option>
                          </select>
                          {canDelete && userCtx && canDeleteTask(userCtx, task.assigned_by_email) && (
                            <>
                              <div style={{ flex: 1 }} />
                              <button onClick={async () => {
                                if (!await dlg.confirm(`Delete "${task.description}"? This cannot be undone.`, true)) return;
                                await supabase.from("tasks").delete().eq("id", task.id);
                                loadData();
                              }} style={{ backgroundColor: COLOURS.CARD, color: COLOURS.RED, border: `1px solid ${COLOURS.RED}`, borderRadius: RADII.SM, padding: "4px 10px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }} title="Delete this task">Delete</button>
                            </>
                          )}
                          {canDelete && userCtx && !canDeleteTask(userCtx, task.assigned_by_email) && isTaskProtected(task.assigned_by_email) && (
                            <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontStyle: "italic" }}>Protected task — cannot be deleted</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      )}
      </>
      )}
    </main>
  );
}
