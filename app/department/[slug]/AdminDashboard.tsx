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

function isOverdue(t: Task) {
  if (t.status === "Completed" || t.status === "Cancelled") return false;
  return !!t.due_date && t.due_date < today;
}

function daysOverdue(t: Task): number {
  if (!t.due_date || !isOverdue(t)) return 0;
  return Math.floor((Date.now() - new Date(t.due_date + "T00:00:00").getTime()) / 86400000);
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
  const [groupBy, setGroupBy] = useState<"company" | "all">("company");

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

  const donutData = [
    { name: "Overdue", value: overdueTasks.length, color: COLOURS.RED },
    { name: "In Progress", value: openTasks.filter((t) => t.status === "In Progress").length, color: "#d97706" },
    { name: "Not Started", value: openTasks.filter((t) => t.status === "Not Started").length, color: COLOURS.SLATE },
    { name: "Completed", value: completed, color: COLOURS.GREEN },
  ].filter((d) => d.value > 0);

  // Group by company
  const companyGroups = new Map<string, Task[]>();
  for (const t of openTasks) {
    const c = t.project || "Unassigned";
    if (!companyGroups.has(c)) companyGroups.set(c, []);
    companyGroups.get(c)!.push(t);
  }
  const companyNames = Array.from(companyGroups.keys()).sort();

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
      <PageHeader title="Administration" subtitle="Admin department task management" />

      {message && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>{message}</div>
      )}

      {/* Alert Banner */}
      {!loading && overdueTasks.length > 0 && (
        <div style={{ border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "8px", backgroundColor: "#fef2f2", overflow: "hidden", marginBottom: "14px" }}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#991b1b" }}>{overdueTasks.length} overdue admin task{overdueTasks.length > 1 ? "s" : ""}</div>
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

      {/* KPI + Donut */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
            <CountCard label="Open" value={openTasks.length} color="#d97706" />
            <CountCard label="Overdue" value={overdueTasks.length} color={COLOURS.RED} />
            <CountCard label="Completed" value={completed} color={COLOURS.GREEN} />
            <CountCard label="Total" value={items.length} color={COLOURS.BLUE} />
          </div>
          {donutData.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>Task Status</div>
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
        </div>
      )}

      {/* Add + Group toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px", flexWrap: "wrap" }}>
        <SectionTitle title="Tasks" />
        <div style={{ display: "flex", gap: "4px" }}>
          <button onClick={() => setGroupBy(groupBy === "company" ? "all" : "company")} style={{
            backgroundColor: "white", color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`,
            borderRadius: "6px", padding: "6px 12px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
          }}>{groupBy === "company" ? "Show all" : "Group by company"}</button>
          <button onClick={() => setShowForm(!showForm)} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>{showForm ? "Cancel" : "+ Add"}</button>
        </div>
      </div>

      {showForm && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
              <label style={lbl}>Task <input style={inp} value={desc} onChange={(e) => setDesc(e.target.value)} required placeholder="e.g. Collect office rent receipt" /></label>
              <label style={lbl}>Company <select style={inp} value={project} onChange={(e) => setProject(e.target.value)} required><option value="">Select</option>{COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label style={lbl}>Assigned To <input style={inp} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required placeholder="Person name" /></label>
              <label style={lbl}>Due Date <input type="date" style={inp} value={dueDate} onChange={(e) => setDueDate(e.target.value)} required /></label>
              <label style={lbl}>Priority <select style={inp} value={priority} onChange={(e) => setPriority(e.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
              <label style={lbl}>Notes <textarea style={{ ...inp, height: "50px" }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            </div>
            <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving…" : "Save"}</button>
          </form>
        </div>
      )}

      {/* Records */}
      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : openTasks.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", color: COLOURS.SLATE }}>No open admin tasks.</div>
      ) : (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
          {groupBy === "company" ? (
            companyNames.map((company) => {
              const tasks = companyGroups.get(company)!;
              return (
                <div key={company}>
                  <div style={{ padding: "8px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{company}</span>
                    <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{tasks.length} task{tasks.length > 1 ? "s" : ""}</span>
                  </div>
                  {tasks.map((t) => <TaskRow key={t.id} task={t} isOpen={expandedId === t.id} onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)} onStatusChange={updateStatus} />)}
                </div>
              );
            })
          ) : (
            openTasks.map((t) => <TaskRow key={t.id} task={t} isOpen={expandedId === t.id} onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)} onStatusChange={updateStatus} />)
          )}
        </div>
      )}
    </main>
  );
}

function TaskRow({ task, isOpen, onToggle, onStatusChange }: { task: Task; isOpen: boolean; onToggle: () => void; onStatusChange: (id: string, s: string) => void }) {
  const overdue = isOverdue(task);
  const od = daysOverdue(task);
  const STATUSES_LIST = ["Not Started", "In Progress", "Waiting Reply", "Completed", "Cancelled"];
  return (
    <div style={{ borderBottom: `1px solid ${COLOURS.BORDER}` }}>
      <div onClick={onToggle} style={{
        padding: "9px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
        backgroundColor: overdue ? "#fef2f2" : isOpen ? "#f8fafc" : "white",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
            {task.assigned_to || "Unassigned"}
            {task.due_date && <span style={{ color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 700 : 400, marginLeft: "6px" }}>{formatDateUK(task.due_date)}{od > 0 && ` (${od}d late)`}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
          <StatusBadge status={task.status} />
          <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{isOpen ? "▼" : "▶"}</span>
        </div>
      </div>
      {isOpen && (
        <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderTop: `1px solid ${COLOURS.BORDER}` }}>
          {task.notes && <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "6px" }}>Notes: {task.notes}</div>}
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>Status:</span>
            <select value={task.status} onChange={(e) => onStatusChange(task.id, e.target.value)} style={{ padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "13px" }}>
              {STATUSES_LIST.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
