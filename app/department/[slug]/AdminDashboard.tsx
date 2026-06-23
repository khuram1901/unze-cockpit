"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

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
};

const today = new Date().toISOString().slice(0, 10);
const STATUSES = ["Not Started", "In Progress", "Waiting Reply", "Completed", "Cancelled"];
const COMPANIES = ["Unze Trading PVT Limited", "Imperial Footwear PVT Limited", "Haute Dolci", "Barahn PVT Limited", "K&K Jhang"];
const PRIORITY_ORDER: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Normal: 2, Low: 3 };

function isOverdue(t: Task) {
  if (t.status === "Completed" || t.status === "Cancelled") return false;
  return !!t.due_date && t.due_date < today;
}

function daysOverdue(t: Task): number {
  if (!t.due_date || !isOverdue(t)) return 0;
  return Math.floor((Date.now() - new Date(t.due_date + "T00:00:00").getTime()) / 86400000);
}

function priorityColor(p: string | null): string {
  if (p === "Urgent") return "#dc2626";
  if (p === "High") return "#dc2626";
  if (p === "Medium" || p === "Normal") return COLOURS.BLUE;
  return COLOURS.SLATE;
}

function sortByPriority(a: Task, b: Task): number {
  const pa = PRIORITY_ORDER[a.priority || "Normal"] ?? 2;
  const pb = PRIORITY_ORDER[b.priority || "Normal"] ?? 2;
  if (pa !== pb) return pa - pb;
  return daysOverdue(b) - daysOverdue(a);
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px",
};

export default function AdminDashboard() {
  const isMobile = useMobile();
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  const [desc, setDesc] = useState("");
  const [project, setProject] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [notes, setNotes] = useState("");

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from("tasks").select("*").eq("assigned_to_department", "Admin").order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("tasks").insert({
      description: desc, project: project || null, assigned_to: assignedTo || null,
      due_date: dueDate || null, priority, status: "Not Started",
      assigned_to_department: "Admin", assigned_by: "Department Dashboard",
      assigned_date: today,
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "tasks", desc);
    showMsg("Task added.");
    setDesc(""); setProject(""); setAssignedTo(""); setDueDate(""); setPriority("Normal"); setNotes("");
    setShowForm(false);
    loadData();
  }

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
    { name: "In Progress", value: openTasks.filter((t) => t.status === "In Progress").length, color: "#d97706" },
    { name: "Not Started", value: openTasks.filter((t) => t.status === "Not Started").length, color: COLOURS.SLATE },
    { name: "Completed", value: completed, color: COLOURS.GREEN },
  ].filter((d) => d.value > 0);

  const companyColors: Record<string, string> = {
    "Unze Trading PVT Limited": "#1e293b",
    "Imperial Footwear PVT Limited": "#2563eb",
    "Haute Dolci": "#7c3aed",
    "Barahn PVT Limited": "#059669",
    "K&K Jhang": "#d97706",
  };
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
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
      {/* Header with + button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader title="Administration" subtitle="Admin department task management" />
        <button onClick={() => setShowForm(!showForm)} style={{
          backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
          width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        }} title="Add task">{showForm ? "×" : "+"}</button>
      </div>

      {message && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>{message}</div>
      )}

      {/* Collapsible add form */}
      {showForm && (
        <div style={{
          border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.NAVY}`,
          borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px",
        }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>New Task</div>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <label style={lbl}>Task <input style={inp} value={desc} onChange={(e) => setDesc(e.target.value)} required placeholder="e.g. Collect office rent receipt" /></label>
              <label style={lbl}>Company <select style={inp} value={project} onChange={(e) => setProject(e.target.value)} required><option value="">Select</option>{COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label style={lbl}>Assigned To <input style={inp} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required placeholder="Person name" /></label>
              <label style={lbl}>Due Date <input type="date" style={inp} value={dueDate} onChange={(e) => setDueDate(e.target.value)} required /></label>
              <label style={lbl}>Priority <select style={inp} value={priority} onChange={(e) => setPriority(e.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
              <label style={lbl}>Notes <textarea style={{ ...inp, height: "50px" }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            </div>
            <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving…" : "Add Task"}</button>
          </form>
        </div>
      )}

      {/* Alert Banner */}
      {!loading && overdueTasks.length > 0 && (
        <div style={{ border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "8px", backgroundColor: "#fef2f2", overflow: "hidden", marginBottom: "14px" }}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#991b1b" }}>{overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""}</div>
                <div style={{ fontSize: "13px", color: "#991b1b", marginTop: "1px" }}>{overdueTasks.slice(0, 3).map((t) => `${t.description.slice(0, 25)}${t.description.length > 25 ? "…" : ""}`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#991b1b" }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={{ borderTop: "1px solid #fecaca", backgroundColor: "white" }}>
              {overdueTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => (
                <div key={t.id} onClick={() => { setExpandedId(t.id); setBannerOpen(false); }} style={{ padding: "8px 16px 8px 48px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{t.description}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{t.assigned_to || "Unassigned"} · {t.project || "—"}</div>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626" }}>{daysOverdue(t)}d late</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          <CountCard label="Open" value={openTasks.length} color="#d97706" />
          <CountCard label="Overdue" value={overdueTasks.length} color={COLOURS.RED} />
          <CountCard label="Urgent/High" value={urgentCount} color={COLOURS.RED} />
          <CountCard label="Completed" value={completed} color={COLOURS.GREEN} />
        </div>
      )}

      {/* Two donuts side by side */}
      {!loading && (donutData.length > 0 || companyDonutData.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          {donutData.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>By Status</div>
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
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>By Company</div>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", gap: "8px", flexWrap: "wrap" }}>
        <SectionTitle title="Tasks by Company" />
        <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
          {[
            { key: "all", label: "All" },
            { key: "Urgent", label: "Urgent", color: "#dc2626" },
            { key: "High", label: "High", color: "#dc2626" },
            { key: "Normal", label: "Normal", color: COLOURS.BLUE },
            { key: "Low", label: "Low", color: COLOURS.SLATE },
          ].map((f) => (
            <button key={f.key} onClick={() => setPriorityFilter(f.key)} style={{
              backgroundColor: priorityFilter === f.key ? (f.color || COLOURS.NAVY) : "white",
              color: priorityFilter === f.key ? "white" : COLOURS.NAVY,
              border: `1px solid ${priorityFilter === f.key ? "transparent" : COLOURS.BORDER}`,
              borderRadius: "5px", padding: "4px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Tasks grouped by company */}
      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : companyNames.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", color: COLOURS.SLATE, textAlign: "center" }}>
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
            <div key={company} style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${companyColor}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "12px" }}>
              {/* Company header with mini stats */}
              <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>{company.replace(" PVT Limited", "")}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE }}>{tasks.length} task{tasks.length > 1 ? "s" : ""}</span>
                </div>
                <div style={{ display: "flex", gap: "12px", fontSize: "12px" }}>
                  {compOverdue > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.RED }} />
                      <span style={{ fontWeight: 700, color: COLOURS.RED }}>{compOverdue} overdue</span>
                    </div>
                  )}
                  {compUrgent > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#dc2626" }} />
                      <span style={{ fontWeight: 700, color: "#dc2626" }}>{compUrgent} urgent/high</span>
                    </div>
                  )}
                  {compInProgress > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#d97706" }} />
                      <span style={{ fontWeight: 600, color: "#d97706" }}>{compInProgress} in progress</span>
                    </div>
                  )}
                  {compNotStarted > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.SLATE }} />
                      <span style={{ color: COLOURS.SLATE }}>{compNotStarted} not started</span>
                    </div>
                  )}
                  {compOverdue === 0 && compUrgent === 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.GREEN }} />
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
                  <div key={task.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                    <div onClick={() => setExpandedId(isOpen ? null : task.id)} style={{
                      padding: "9px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                      backgroundColor: overdue ? "#fef2f2" : isOpen ? "#f8fafc" : "white",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                          <span>{task.assigned_to || "Unassigned"}</span>
                          {task.due_date && <span style={{ color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 700 : 400 }}>{formatDateUK(task.due_date)}{od > 0 && ` (${od}d late)`}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                        {task.priority && (
                          <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", color: "white", backgroundColor: priorityColor(task.priority) }}>{task.priority}</span>
                        )}
                        <StatusBadge status={task.status} />
                        <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{isOpen ? "▼" : "▶"}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderTop: `1px solid ${COLOURS.BORDER}` }}>
                        {task.notes && <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "6px" }}>Notes: {task.notes}</div>}
                        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>Status:</span>
                          <select value={task.status} onChange={(e) => updateStatus(task.id, e.target.value)} style={{ padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "13px" }}>
                            {STATUSES.map((s) => <option key={s}>{s}</option>)}
                          </select>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginLeft: "8px" }}>Priority:</span>
                          <select value={task.priority || "Normal"} onChange={(e) => {
                            supabase.from("tasks").update({ priority: e.target.value }).eq("id", task.id).then(() => loadData());
                          }} style={{ padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "13px" }}>
                            <option>Low</option><option>Normal</option><option>High</option><option>Urgent</option>
                          </select>
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
    </main>
  );
}
