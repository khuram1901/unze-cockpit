"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { COLOURS, RADII, cardStyle, SHADOWS, SectionTitle, useConfirm, SkeletonRows } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";

// The same recurring_tasks table and scheduling engine as the standalone
// /recurring-tasks page — this is that page's content brought in as a
// tab on /tasks instead of a separate destination, per the mockup Khuram
// approved. Nothing about how templates fire or regenerate changes; only
// where you go to manage them.

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

const STARTER_EXAMPLES = [
  { title: "Weekly Production Report", desc: "Submit weekly output vs target summary to management", freq: "Weekly · Monday", dept: "Operations" },
  { title: "Monthly Payroll Review", desc: "Review and approve payroll figures before processing", freq: "Monthly · Day 25", dept: "Finance" },
  { title: "IT Security Check", desc: "Review access logs and update password rotation tracker", freq: "Weekly · Friday", dept: "IT" },
  { title: "Weekly Team Meeting Agenda", desc: "Prepare and circulate agenda 24 hours in advance", freq: "Weekly · Thursday", dept: "Admin" },
];

const inp: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 10px",
  marginTop: "4px",
  border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.SM,
  fontSize: "14px",
  color: COLOURS.NAVY,
  backgroundColor: COLOURS.CARD,
  boxSizing: "border-box",
};

const lbl: React.CSSProperties = {
  display: "block",
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: COLOURS.SLATE,
  marginBottom: "4px",
};

export default function RecurringTasksPanel({ isPrivileged }: { isPrivileged: boolean }) {
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
    const { error } = await supabase.from("recurring_tasks").insert({
      description: desc, assigned_to: assignTo || null,
      assigned_to_email: member?.email || null, assigned_to_department: member?.department || null,
      assigned_by: "Recurring Template", priority, project: project || null,
      frequency, day_of_week: frequency === "weekly" ? dayOfWeek : null,
      day_of_month: frequency === "monthly" ? dayOfMonth : null,
      due_days_after: Number(dueDays) || 3, active: true,
    });
    setSaving(false);
    if (error) {
      alert("Error saving recurring task: " + error.message);
      return;
    }
    logAction("Created", "recurring_tasks", `${desc} (${frequency})`);
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

  return (
    <div>
      {dlg.element}

      {isPrivileged && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: SHADOWS.MODAL,
          }} title="Add recurring task">{showForm ? "×" : "+"}</button>
        </div>
      )}

      {showForm && isPrivileged && (
        <div style={{ ...cardStyle, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: RADII.CARD, padding: "16px 20px", marginBottom: "14px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px", letterSpacing: "-0.01em" }}>New Recurring Task</div>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr", gap: "8px 16px" }}>
              <label style={lbl}>Task Description <input style={inp} value={desc} onChange={(e) => setDesc(e.target.value)} required placeholder="e.g. Submit weekly production report" /></label>
              <label style={lbl}>Assign To <select style={inp} value={assignTo} onChange={(e) => setAssignTo(e.target.value)} required><option value="">Select</option>{members.map((m) => <option key={memberName(m)} value={memberName(m)}>{memberName(m)}</option>)}</select></label>
              <label style={lbl}>Priority <select style={inp} value={priority} onChange={(e) => setPriority(e.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
              <label style={lbl}>Frequency <select style={inp} value={frequency} onChange={(e) => setFrequency(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
              {frequency === "weekly" && <label style={lbl}>Day <select style={inp} value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
              {frequency === "monthly" && <label style={lbl}>Day of Month <input type="number" min="1" max="28" style={inp} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} /></label>}
              <label style={lbl}>Due after (days) <input type="number" min="1" style={inp} value={dueDays} onChange={(e) => setDueDays(e.target.value)} /></label>
              <label style={lbl}>Department / Project <input style={inp} value={project} onChange={(e) => setProject(e.target.value)} placeholder="Optional" /></label>
            </div>
            <button type="submit" disabled={saving} style={{
              backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: RADII.PILL,
              padding: "8px 22px", fontSize: "13px", fontWeight: 600, cursor: "pointer", marginTop: "10px",
              opacity: saving ? 0.7 : 1,
            }}>{saving ? "Saving..." : "Create Template"}</button>
          </form>
        </div>
      )}

      {loading ? <SkeletonRows count={3} height="48px" /> : templates.length === 0 ? (
        <>
          <div style={{ ...cardStyle, padding: "24px", textAlign: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" }}>No recurring tasks set up yet.</div>
            <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
              {isPrivileged ? "Use the + button to create your first recurring task template. Here are some examples to get you started:" : "None have been set up for you yet."}
            </div>
          </div>

          {isPrivileged && (
            <>
              <SectionTitle title="Example Templates" />
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", marginBottom: "20px" }}>
                {STARTER_EXAMPLES.map((ex) => (
                  <div key={ex.title} style={{ ...cardStyle, padding: "16px 18px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>{ex.title}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "8px", lineHeight: "1.4" }}>{ex.desc}</div>
                    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 7px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.NAVY, border: `1px solid ${COLOURS.HAIRLINE}` }}>{ex.freq}</span>
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 7px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}` }}>{ex.dept}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          {templates.map((t) => (
            <div key={t.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, opacity: t.active ? 1 : 0.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{t.description}</div>
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                    {t.assigned_to || "Unassigned"} · {t.frequency}{t.frequency === "weekly" ? ` (${DAYS[t.day_of_week || 0]})` : t.frequency === "monthly" ? ` (day ${t.day_of_month})` : ""} · Due after {t.due_days_after}d · {t.priority}
                    {t.last_created_at && ` · Last: ${t.last_created_at.slice(0, 10)}`}
                  </div>
                </div>
                {isPrivileged && (
                  <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                    <button onClick={() => toggleActive(t.id, t.active)} style={{
                      backgroundColor: t.active ? COLOURS.AMBER : COLOURS.GREEN,
                      color: "white", border: "none", borderRadius: RADII.SM,
                      padding: "4px 12px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
                    }}>
                      {t.active ? "Pause" : "Resume"}
                    </button>
                    <button onClick={() => deleteTemplate(t.id)} style={{
                      backgroundColor: COLOURS.CARD, color: COLOURS.RED, border: `1px solid ${COLOURS.RED}`,
                      borderRadius: RADII.SM, padding: "4px 12px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
                    }}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
