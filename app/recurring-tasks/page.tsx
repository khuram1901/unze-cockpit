"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { useRequireCapability } from "../lib/useRouteGuard";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { COLOURS, SHADOWS, PageHeader, SectionTitle, useConfirm, SkeletonRows } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";

type Template = {
  id: string;
  description: string;
  assigned_to: string | null;
  assigned_to_email: string | null;
  assigned_to_department: string | null;
  assigned_by: string | null;
  priority: string | null;
  project: string | null;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  due_days_after: number | null;
  active: boolean;
  last_created_at: string | null;
};

type Member = { name: string; email: string | null; department: string | null; first_name: string | null; last_name: string | null };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function RecurringTasksPage() {
  const { checking } = useRequireCapability("recurring_tasks");
  const isMobile = useMobile();
  const dlg = useConfirm();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [desc, setDesc] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [project, setProject] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [dueDays, setDueDays] = useState("3");

  async function loadData() {
    setLoading(true);
    const [tmplRes, memRes] = await Promise.all([
      supabase.from("recurring_tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("members").select("name, email, department, first_name, last_name"),
    ]);
    setTemplates(tmplRes.data || []);
    setMembers(memRes.data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function memberName(m: Member) { return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name; }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const member = members.find((m) => memberName(m) === assignTo);
    await supabase.from("recurring_tasks").insert({
      description: desc, assigned_to: assignTo || null,
      assigned_to_email: member?.email || null, assigned_to_department: member?.department || null,
      assigned_by: "Recurring Template", priority, project: project || null,
      frequency, day_of_week: frequency === "weekly" ? dayOfWeek : null,
      day_of_month: frequency === "monthly" ? dayOfMonth : null,
      due_days_after: Number(dueDays) || 3, active: true,
    });
    logAction("Created", "recurring_tasks", `${desc} (${frequency})`);
    setSaving(false);
    setDesc(""); setAssignTo(""); setPriority("Normal"); setProject(""); setFrequency("weekly"); setDueDays("3");
    setShowForm(false);
    loadData();
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from("recurring_tasks").update({ active: !active }).eq("id", id);
    loadData();
  }

  async function deleteTemplate(id: string) {
    if (!await dlg.confirm("Delete this recurring task template?", true)) return;
    await supabase.from("recurring_tasks").delete().eq("id", id);
    loadData();
  }

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: "var(--text-secondary, #64748b)" }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
        {dlg.element}
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
            <PageHeader />
            <button onClick={() => setShowForm(!showForm)} style={{
              backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
              width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: SHADOWS.MODAL,
            }} title="Add recurring task">{showForm ? "×" : "+"}</button>
          </div>

          {showForm && (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "10px" }}>New Recurring Task</div>
              <form onSubmit={handleAdd}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr", gap: "8px" }}>
                  <label style={lbl}>Task Description <input style={inp} value={desc} onChange={(e) => setDesc(e.target.value)} required placeholder="e.g. Submit weekly production report" /></label>
                  <label style={lbl}>Assign To <select style={inp} value={assignTo} onChange={(e) => setAssignTo(e.target.value)} required><option value="">Select</option>{members.map((m) => <option key={memberName(m)} value={memberName(m)}>{memberName(m)}</option>)}</select></label>
                  <label style={lbl}>Priority <select style={inp} value={priority} onChange={(e) => setPriority(e.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
                  <label style={lbl}>Frequency <select style={inp} value={frequency} onChange={(e) => setFrequency(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                  {frequency === "weekly" && <label style={lbl}>Day <select style={inp} value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
                  {frequency === "monthly" && <label style={lbl}>Day of Month <input type="number" min="1" max="28" style={inp} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} /></label>}
                  <label style={lbl}>Due after (days) <input type="number" min="1" style={inp} value={dueDays} onChange={(e) => setDueDays(e.target.value)} /></label>
                  <label style={lbl}>Department/Project <input style={inp} value={project} onChange={(e) => setProject(e.target.value)} placeholder="Optional" /></label>
                </div>
                <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving..." : "Create Template"}</button>
              </form>
            </div>
          )}

          {loading ? <SkeletonRows count={3} height="48px" /> : templates.length === 0 ? (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)", textAlign: "center" }}>No recurring tasks set up yet.</div>
          ) : (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden" }}>
              {templates.map((t) => (
                <div key={t.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-light, #f1f5f9)", opacity: t.active ? 1 : 0.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{t.description}</div>
                      <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>
                        {t.assigned_to || "Unassigned"} · {t.frequency}{t.frequency === "weekly" ? ` (${DAYS[t.day_of_week || 0]})` : t.frequency === "monthly" ? ` (day ${t.day_of_month})` : ""} · Due after {t.due_days_after}d · {t.priority}
                        {t.last_created_at && ` · Last: ${t.last_created_at.slice(0, 10)}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                      <button onClick={() => toggleActive(t.id, t.active)} style={{ backgroundColor: t.active ? "#d97706" : COLOURS.GREEN, color: "white", border: "none", borderRadius: "5px", padding: "4px 10px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                        {t.active ? "Pause" : "Resume"}
                      </button>
                      <button onClick={() => deleteTemplate(t.id)} style={{ backgroundColor: "var(--bg-card, #ffffff)", color: COLOURS.RED, border: `1px solid ${COLOURS.RED}`, borderRadius: "5px", padding: "4px 10px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
    </AuthWrapper>
  );
}

const inp: React.CSSProperties = { display: "block", width: "100%", padding: "7px 10px", marginTop: "3px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", fontSize: "15px", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)", marginBottom: "4px" };
