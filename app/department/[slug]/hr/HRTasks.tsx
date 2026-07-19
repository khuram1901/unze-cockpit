"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import DateInput from "../../../lib/DateInput";
import { useUserCtx } from "../../../lib/useUserCtx";
import {
  COLOURS, RADII, SectionTitle, CountCard, SkeletonRows,
  useToast, primaryButtonStyle, inputStyle,
} from "../../../lib/SharedUI";

// ─── Types ───────────────────────────────────────────────────────────────────

type Task = {
  id:             string;
  company_id:     string | null;
  company_name:   string | null;
  title:          string;
  description:    string | null;
  assigned_to:    string | null;
  department:     string | null;
  employee_name:  string | null;
  priority:       "High" | "Medium" | "Low";
  status:         "Open" | "In Progress" | "Done" | "Cancelled";
  due_date:       string | null;
  is_recurring:   boolean;
  recurrence:     string | null;
  parent_task_id: string | null;
  created_by:     string | null;
  created_at:     string;
  updated_at:     string;
};

type TaskSummary = {
  open_count:           number;
  in_progress_count:    number;
  overdue_count:        number;
  due_today_count:      number;
  completed_this_month: number;
  high_priority_open:   number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function canWrite(role: string | null | undefined) {
  return role === "Admin" || role === "CEO" || role === "Manager";
}

function isOverdue(task: Task): boolean {
  return (
    task.due_date != null &&
    task.due_date < new Date().toISOString().split("T")[0] &&
    task.status !== "Done" &&
    task.status !== "Cancelled"
  );
}

function isDueToday(task: Task): boolean {
  return task.due_date === new Date().toISOString().split("T")[0] && task.status !== "Done" && task.status !== "Cancelled";
}

// ─── Priority pill ────────────────────────────────────────────────────────────

function PriorityPill({ priority }: { priority: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    High:   { bg: COLOURS.DANGER_SOFT,  color: COLOURS.RED   },
    Medium: { bg: COLOURS.WARNING_SOFT, color: COLOURS.AMBER },
    Low:    { bg: COLOURS.HAIRLINE,     color: COLOURS.SLATE },
  };
  const c = map[priority] ?? map["Medium"];
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, padding: "2px 7px",
      borderRadius: RADII.PILL, backgroundColor: c.bg, color: c.color, whiteSpace: "nowrap",
    }}>{priority}</span>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    "Open":        { bg: COLOURS.INFO_SOFT,    color: COLOURS.BLUE  },
    "In Progress": { bg: COLOURS.WARNING_SOFT, color: COLOURS.AMBER },
    "Done":        { bg: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN },
    "Cancelled":   { bg: COLOURS.HAIRLINE,     color: COLOURS.SLATE },
  };
  const c = map[status] ?? map["Open"];
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, padding: "2px 7px",
      borderRadius: RADII.PILL, backgroundColor: c.bg, color: c.color, whiteSpace: "nowrap",
    }}>{status}</span>
  );
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  userRole,
  onUpdate,
}: {
  task:     Task;
  userRole: string | null | undefined;
  onUpdate: () => void;
}) {
  const { show, element } = useToast();
  const [expanded, setExpanded]   = useState(false);
  const [editStatus, setEditStatus] = useState(task.status);
  const [saving, setSaving] = useState(false);

  const overdue = isOverdue(task);
  const today   = isDueToday(task);

  async function changeStatus(newStatus: string) {
    setSaving(true);
    const { error } = await supabase
      .from("hr_tasks")
      .update({ status: newStatus })
      .eq("id", task.id);
    if (error) { show(error.message, "error"); setSaving(false); return; }
    setEditStatus(newStatus as Task["status"]);
    setSaving(false);
    onUpdate();
  }

  const rowBg = overdue ? "#FFF8F8" : today ? "#FFFDF0" : "white";

  return (
    <>
      {element}
      <tr
        style={{
          borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
          backgroundColor: rowBg,
          cursor: "pointer",
        }}
        onClick={() => setExpanded(e => !e)}
      >
        <td style={{ padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {task.is_recurring && (
              <span title="Recurring" style={{ fontSize: "11px", color: COLOURS.SLATE }}>↺</span>
            )}
            <span style={{ fontWeight: 600, color: COLOURS.NAVY }}>{task.title}</span>
            {overdue && (
              <span style={{
                fontSize: "9px", fontWeight: 700, padding: "1px 5px",
                borderRadius: RADII.PILL, backgroundColor: COLOURS.DANGER_SOFT, color: COLOURS.RED,
              }}>OVERDUE</span>
            )}
            {today && !overdue && (
              <span style={{
                fontSize: "9px", fontWeight: 700, padding: "1px 5px",
                borderRadius: RADII.PILL, backgroundColor: COLOURS.WARNING_SOFT, color: COLOURS.AMBER,
              }}>TODAY</span>
            )}
          </div>
          {task.employee_name && (
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
              Re: {task.employee_name}
            </div>
          )}
        </td>
        <td style={{ padding: "10px 12px", color: COLOURS.SLATE, fontSize: "12px" }}>
          {task.department ?? "—"}
        </td>
        <td style={{ padding: "10px 12px", color: COLOURS.SLATE, fontSize: "12px" }}>
          {task.company_name ?? "All"}
        </td>
        <td style={{ padding: "10px 12px" }}>
          <PriorityPill priority={task.priority} />
        </td>
        <td style={{ padding: "10px 12px" }}>
          <StatusPill status={editStatus} />
        </td>
        <td style={{ padding: "10px 12px", fontSize: "12px", color: overdue ? COLOURS.RED : COLOURS.SLATE, whiteSpace: "nowrap" }}>
          {task.due_date ? formatDateUK(task.due_date) : "—"}
        </td>
        <td style={{ padding: "10px 12px", fontSize: "12px", color: COLOURS.SLATE }}>
          {task.assigned_to?.split("@")[0] ?? "—"}
        </td>
      </tr>
      {expanded && (
        <tr style={{ backgroundColor: "#F8FAFC", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
          <td colSpan={7} style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {task.description && (
                <div style={{ fontSize: "13px", color: COLOURS.INK_700 }}>{task.description}</div>
              )}
              {task.is_recurring && task.recurrence && (
                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                  ↺ Repeats {task.recurrence.toLowerCase()}
                </div>
              )}
              {canWrite(userRole) && task.status !== "Done" && task.status !== "Cancelled" && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {task.status === "Open" && (
                    <button
                      onClick={e => { e.stopPropagation(); changeStatus("In Progress"); }}
                      disabled={saving}
                      style={{
                        padding: "6px 14px", fontSize: "12px", fontWeight: 600,
                        border: `1px solid ${COLOURS.AMBER}`, borderRadius: RADII.CARD,
                        color: COLOURS.AMBER, background: "white", cursor: "pointer",
                      }}
                    >Mark In Progress</button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); changeStatus("Done"); }}
                    disabled={saving}
                    style={{
                      padding: "6px 14px", fontSize: "12px", fontWeight: 600,
                      border: `1px solid ${COLOURS.GREEN}`, borderRadius: RADII.CARD,
                      color: COLOURS.GREEN, background: "white", cursor: "pointer",
                    }}
                  >Mark Done</button>
                  <button
                    onClick={e => { e.stopPropagation(); changeStatus("Cancelled"); }}
                    disabled={saving}
                    style={{
                      padding: "6px 14px", fontSize: "12px", fontWeight: 600,
                      border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
                      color: COLOURS.SLATE, background: "white", cursor: "pointer",
                    }}
                  >Cancel</button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Add Task Form ────────────────────────────────────────────────────────────

function AddTaskForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { show, element } = useToast();
  const { member } = useUserCtx();
  const [saving, setSaving]   = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers]     = useState<{ email: string }[]>([]);
  const [form, setForm] = useState({
    company_id:    "",
    title:         "",
    description:   "",
    assigned_to:   "",
    department:    "",
    employee_name: "",
    priority:      "Medium",
    due_date:      "",
    is_recurring:  false,
    recurrence:    "Monthly",
  });

  useEffect(() => {
    Promise.all([
      supabase.from("companies").select("id, name"),
      supabase.from("members").select("email").order("email"),
    ]).then(([{ data: co }, { data: mb }]) => {
      if (co) setCompanies(co);
      if (mb) setMembers(mb);
      if (co?.[0] && !form.company_id) setForm(p => ({ ...p, company_id: co[0].id }));
      if (member?.email && !form.assigned_to) setForm(p => ({ ...p, assigned_to: member.email }));
    });
  }, []);

  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }));

  const labelStyle: React.CSSProperties = {
    fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, display: "block", marginBottom: "4px",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { show("Title is required.", "error"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("hr_tasks").insert({
        company_id:    form.company_id || null,
        title:         form.title.trim(),
        description:   form.description.trim() || null,
        assigned_to:   form.assigned_to || null,
        department:    form.department.trim() || null,
        employee_name: form.employee_name.trim() || null,
        priority:      form.priority,
        due_date:      form.due_date || null,
        is_recurring:  form.is_recurring,
        recurrence:    form.is_recurring ? form.recurrence : null,
        created_by:    member?.email ?? null,
      });
      if (error) { show(error.message, "error"); return; }
      show("Task created.", "success");
      onSuccess();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {element}
      <form onSubmit={handleSubmit} style={{
        border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
        padding: "20px", backgroundColor: "#F8FAFC",
      }}>
        <div style={{ fontWeight: 700, fontSize: "14px", color: COLOURS.NAVY, marginBottom: "16px" }}>
          New HR Task
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Title *</label>
            <input
              value={form.title} onChange={e => set("title", e.target.value)} required
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              placeholder="e.g. Collect updated CVs from Production department"
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={form.description} onChange={e => set("description", e.target.value)}
              rows={2} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" }}
            />
          </div>
          <div>
            <label style={labelStyle}>Company</label>
            <select value={form.company_id} onChange={e => set("company_id", e.target.value)} style={inputStyle}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <input
              value={form.department} onChange={e => set("department", e.target.value)}
              placeholder="e.g. Production, Finance" style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Assigned To</label>
            <select value={form.assigned_to} onChange={e => set("assigned_to", e.target.value)} style={inputStyle}>
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.email} value={m.email}>{m.email.split("@")[0]}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select value={form.priority} onChange={e => set("priority", e.target.value)} style={inputStyle}>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Due Date</label>
            <DateInput value={form.due_date} onChange={v => set("due_date", v)} placeholder="DD/MM/YYYY" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Linked Employee (optional)</label>
            <input
              value={form.employee_name} onChange={e => set("employee_name", e.target.value)}
              placeholder="e.g. Ahmed Khan" style={inputStyle}
            />
          </div>
          {/* Recurring toggle */}
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="checkbox" id="is_recurring" checked={form.is_recurring}
              onChange={e => set("is_recurring", e.target.checked)}
              style={{ width: "16px", height: "16px", cursor: "pointer" }}
            />
            <label htmlFor="is_recurring" style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, cursor: "pointer" }}>
              Recurring task
            </label>
            {form.is_recurring && (
              <select value={form.recurrence} onChange={e => set("recurrence", e.target.value)} style={{ ...inputStyle, marginLeft: "8px" }}>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Annually">Annually</option>
              </select>
            )}
          </div>
          {form.is_recurring && (
            <div style={{ gridColumn: "1 / -1", fontSize: "12px", color: COLOURS.SLATE, backgroundColor: COLOURS.INFO_SOFT, padding: "8px 12px", borderRadius: RADII.CARD }}>
              A new instance of this task will be automatically generated at the start of each {form.recurrence.toLowerCase()} period, due on the same day of the month as above.
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" }}>
          <button type="button" onClick={onCancel} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600,
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
            background: "white", cursor: "pointer", color: COLOURS.SLATE,
          }}>Cancel</button>
          <button type="submit" disabled={saving} style={primaryButtonStyle}>
            {saving ? "Saving…" : "Create Task"}
          </button>
        </div>
      </form>
    </>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function HRTasks() {
  const { member } = useUserCtx();
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [summary, setSummary]     = useState<TaskSummary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [filterStatus, setFilterStatus]   = useState<string>("Active");
  const [filterPriority, setFilterPriority] = useState<string>("All");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: summaryData }, { data: taskData }] = await Promise.all([
      supabase.rpc("get_hr_tasks_summary"),
      supabase
        .from("hr_tasks")
        .select("*, companies(name)")
        .is("parent_task_id", null)  // show master tasks and one-offs; instances appear below
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("priority", { ascending: true })
        .limit(300),
    ]);
    if (summaryData?.[0]) setSummary(summaryData[0] as TaskSummary);
    if (taskData) {
      setTasks(taskData.map((r: unknown) => {
        const row = r as Record<string, unknown>;
        const companies = row.companies as Record<string, unknown> | null;
        return { ...row, company_name: companies?.name ?? null } as Task;
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = summary;
  const filtered = tasks.filter(t => {
    const statusMatch =
      filterStatus === "All"    ? true :
      filterStatus === "Active" ? ["Open","In Progress"].includes(t.status) :
      t.status === filterStatus;
    const priorityMatch = filterPriority === "All" || t.priority === filterPriority;
    return statusMatch && priorityMatch;
  });

  const pillStyle = (active: string, val: string): React.CSSProperties => ({
    padding: "4px 10px", fontSize: "12px", fontWeight: 600, borderRadius: RADII.PILL,
    border: `1px solid ${active === val ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: active === val ? COLOURS.NAVY : "white",
    color: active === val ? "white" : COLOURS.SLATE, cursor: "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "10px" }}>
        <CountCard label="Open"             value={s?.open_count           ?? 0} colour={COLOURS.BLUE}  />
        <CountCard label="In Progress"      value={s?.in_progress_count    ?? 0} colour={COLOURS.AMBER} />
        <CountCard label="Overdue"          value={s?.overdue_count        ?? 0} colour={COLOURS.RED}   />
        <CountCard label="Due Today"        value={s?.due_today_count      ?? 0} colour={COLOURS.AMBER} />
        <CountCard label="Done This Month"  value={s?.completed_this_month ?? 0} colour={COLOURS.GREEN} />
        <CountCard label="High Priority"    value={s?.high_priority_open   ?? 0} colour={COLOURS.RED}   />
      </div>

      {/* Overdue warning */}
      {(s?.overdue_count ?? 0) > 0 && (
        <div style={{
          border: `1px solid ${COLOURS.RED}`, borderRadius: RADII.CARD,
          padding: "10px 14px", backgroundColor: COLOURS.DANGER_SOFT,
          color: COLOURS.RED, fontSize: "13px", fontWeight: 600,
        }}>
          ⚠ {s?.overdue_count} task{s!.overdue_count !== 1 ? "s are" : " is"} overdue and need attention.
        </div>
      )}

      {/* Filters + Add button */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        {["Active","All","Open","In Progress","Done","Cancelled"].map(v => (
          <button key={v} style={pillStyle(filterStatus, v)} onClick={() => setFilterStatus(v)}>{v}</button>
        ))}
        <div style={{ width: "1px", backgroundColor: COLOURS.HAIRLINE, margin: "0 2px" }} />
        {["All","High","Medium","Low"].map(v => (
          <button key={v} style={pillStyle(filterPriority, v)} onClick={() => setFilterPriority(v)}>{v}</button>
        ))}
        {canWrite(member?.role) && (
          <button
            onClick={() => setShowAdd(v => !v)}
            style={{ ...primaryButtonStyle, marginLeft: "auto" }}
          >
            {showAdd ? "Cancel" : "+ New Task"}
          </button>
        )}
      </div>

      {/* Add form */}
      {showAdd && canWrite(member?.role) && (
        <AddTaskForm
          onSuccess={() => { setShowAdd(false); load(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Task table */}
      {loading ? <SkeletonRows n={10} /> : (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC" }}>
                {["Task","Department","Company","Priority","Status","Due Date","Assigned To"].map(h => (
                  <th key={h} style={{
                    padding: "8px 12px", textAlign: "left", fontSize: "11px",
                    fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase",
                    letterSpacing: "0.05em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                    whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(task => (
                <TaskRow key={task.id} task={task} userRole={member?.role} onUpdate={load} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "40px", textAlign: "center", color: COLOURS.SLATE }}>
                    No tasks found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
