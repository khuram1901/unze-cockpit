"use client";

import { useState, useEffect, useRef } from "react";
import { supabase, authFetch } from "../lib/supabase";
import { useRouter } from "next/navigation";
import { logAction } from "../lib/audit-log";
import { useToast, COLOURS, RADII, TASK_DESCRIPTION_LIMIT, TASK_COMPANY_CODES } from "../lib/SharedUI";
import { filterAssignableMembers } from "../lib/permissions";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import MentionTextarea, { MentionMember } from "../lib/MentionTextarea";

type Member = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  department: string | null;
  business_unit: string | null;
  company: string | null;
  task_default_company_id: string | null;
};

type DepartmentOwner = {
  id: string;
  department_name: string;
  primary_owner_member_id: string | null;
  primary_owner_name: string | null;
  primary_owner_email: string | null;
};

type Company = {
  id: string;
  name: string;
  short_code: string | null;
};


// Departments are now loaded dynamically from the departments table — see loadInitialData().

// "Completed" is deliberately NOT offered as a starting status — found
// during the 15 Jul 2026 full-app audit that offering it here let anyone
// hand themselves a pre-closed task, skipping HOD review entirely (the
// only door to Completed is meant to be Submitted -> HOD "Mark Complete").
// createTaskCore() also rejects it server-side now, so this isn't just a
// UI-level restriction.
const STATUSES = [
  "Not Started",
  "In Progress",
  "Waiting Reply",
  "Stuck",
  "Submitted",
  "Cancelled",
];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 10px",
  marginTop: "4px",
  marginBottom: "12px",
  border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.SM,
  fontSize: "14px",
  color: COLOURS.NAVY,
  backgroundColor: COLOURS.CARD,
  boxSizing: "border-box",
};

const kickerStyle: React.CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: COLOURS.SLATE,
  display: "block",
};

export default function NewTaskForm({
  onCreated,
  prefillDescription = "",
  prefillAssigneeId,
  prefillDueDate,
  prefillPriority,
}: {
  onCreated?: () => void;
  prefillDescription?: string;
  prefillAssigneeId?: string;
  prefillDueDate?: string;
  prefillPriority?: string;
} = {}) {
  const router = useRouter();
  const toast = useToast();
  const today = todayDate();

  const [members, setMembers] = useState<Member[]>([]);
  const [departmentOwners, setDepartmentOwners] = useState<DepartmentOwner[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projectAreas, setProjectAreas] = useState<string[]>([]);

  const [description, setDescription] = useState(prefillDescription);
  // Re-sync if the parent updates the prefill after mount (e.g. "More options" called twice
  // in the same session — React 18 batching means the state update and the modal open land
  // in the same render, but this guard covers edge cases where the prop arrives late).
  useEffect(() => { setDescription(prefillDescription); }, [prefillDescription]);
  useEffect(() => { if (prefillDueDate) setDueDate(prefillDueDate); }, [prefillDueDate]);
  useEffect(() => { if (prefillPriority) setPriority(prefillPriority); }, [prefillPriority]);

  // When a prefilled assignee ID arrives (from QuickAddTask → More Options),
  // auto-select them and fill company + department — mirrors the toggleAssignee logic
  // but runs after members have loaded (they may not be ready at initial render).
  const prefillAssigneeApplied = useRef(false);
  useEffect(() => {
    if (!prefillAssigneeId || members.length === 0 || prefillAssigneeApplied.current) return;
    prefillAssigneeApplied.current = true;
    const m = members.find((x) => x.id === prefillAssigneeId);
    if (!m) return;
    setAssignedToIds((prev) => prev.includes(prefillAssigneeId) ? prev : [prefillAssigneeId, ...prev]);
    if (!companyTouched && m.task_default_company_id) {
      setCompanyId(m.task_default_company_id);
      setCompanyTouched(true);
    }
    if (!project && m.department && projectAreas.includes(m.department)) {
      setProject(m.department);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillAssigneeId, members, projectAreas]);
  const [companyId, setCompanyId] = useState<string>(""); // "" = Group / needs review
  const [companyTouched, setCompanyTouched] = useState(false); // must actively pick, "" is a real choice not a default
  const [project, setProject] = useState("");
  const [stage, setStage] = useState("");
  const [priority, setPriority] = useState(prefillPriority || "Normal");
  const [status, setStatus] = useState("Not Started");
  const [dueDate, setDueDate] = useState(prefillDueDate || "");
  const [dueTime, setDueTime] = useState(""); // optional HH:MM — combined with due_date for escalation
  // Multi-owner: Khuram wants the same task assignable to more than one
  // person, each seeing it as their own — not just a heads-up. First
  // person ticked stays the "primary" owner for every existing report/
  // notification/WhatsApp reminder that only knows about one; the rest
  // are additive co-owners stored in task_assignees.
  const [assignedToIds, setAssignedToIds] = useState<string[]>(prefillAssigneeId ? [prefillAssigneeId] : []);
  const [assignedBy, setAssignedBy] = useState("");
  const [assignedByEmail, setAssignedByEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskInput, setSubtaskInput] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");

  // Track which members were added via @mention so we can show them as pills
  // below the notes field. Adding via @mention also auto-ticks them in the
  // assignee checkbox list (same assignedToIds state).
  const [mentionedMemberIds, setMentionedMemberIds] = useState<string[]>([]);

  function handleMentionAdded(member: MentionMember) {
    // Add to assignees if not already there
    setAssignedToIds((prev) => prev.includes(member.id) ? prev : [...prev, member.id]);
    // Track which ones came via @mention (for the pill display)
    setMentionedMemberIds((prev) => prev.includes(member.id) ? prev : [...prev, member.id]);
  }

  useEffect(() => {
    async function loadInitialData() {
      const { data: userData } = await supabase.auth.getUser();
      const currentEmail = userData.user?.email || "";

      setAssignedByEmail(currentEmail);

      const { data: memberData } = await supabase
        .from("members")
        .select("name, role")
        .eq("email", currentEmail)
        .single();

      setAssignedBy(memberData?.name || currentEmail);

      const [membersRes, ownersRes, companiesRes, deptsRes] = await Promise.all([
        supabase
          .from("members")
          .select("id, name, email, role, department, business_unit, company, task_default_company_id")
          .eq("is_active", true)
          .order("name", { ascending: true }),

        supabase
          .from("department_owners")
          .select(
            "id, department_name, primary_owner_member_id, primary_owner_name, primary_owner_email"
          )
          .eq("active", true)
          .order("department_name", { ascending: true }),

        supabase
          .from("companies")
          .select("id, name, short_code")
          .in("short_code", TASK_COMPANY_CODES)
          .order("name", { ascending: true }),

        supabase
          .from("departments")
          .select("department_name")
          .eq("active", true)
          .order("department_name", { ascending: true }),
      ]);

      // CEO assignment lock (Khuram, 24/07/2026): the CEOs never appear
      // as assignable unless the viewer is a CEO account or the PA.
      // Server-side twin lives in createTaskCore.
      if (membersRes.data) setMembers(filterAssignableMembers(membersRes.data, currentEmail));
      if (ownersRes.data) setDepartmentOwners(ownersRes.data);
      if (companiesRes.data) setCompanies(companiesRes.data);
      if (deptsRes.data) setProjectAreas(deptsRes.data.map((d) => d.department_name));
    }

    loadInitialData();
  }, []);

  function handleProjectChange(value: string) {
    setProject(value);

    // E4 fix: only auto-suggest the department owner when no assignee has been
    // manually chosen yet. Changing the department/project must NOT silently
    // override an explicit assignee selection — that was causing Rimsha's form
    // to default to Sundas (Executive Office dept owner) instead of her intended
    // assignee. We use the app manager_id hierarchy for routing, not name/dept matching.
    if (assignedToIds.length === 0) {
      const owner = departmentOwners.find((d) => d.department_name === value);
      if (owner?.primary_owner_member_id && members.some((m) => m.id === owner.primary_owner_member_id)) {
        setAssignedToIds([owner.primary_owner_member_id]);
      }
    }
  }

  function addSubtask() {
    const text = subtaskInput.trim();
    if (!text) return;
    setSubtasks((prev) => [...prev, text]);
    setSubtaskInput("");
  }

  function removeSubtask(index: number) {
    setSubtasks((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!dueDate) {
      toast.show("Due date is required — every task must have a deadline.", "error");
      return;
    }
    // dueTime is optional — the API defaults to 17:00 when omitted.
    if (!companyTouched || !companyId) {
      toast.show("Please choose a Company.", "error");
      return;
    }
    if (assignedToIds.length === 0) {
      toast.show("Select at least one person to assign this to.", "error");
      return;
    }

    setSaving(true);

    const selectedMembers = assignedToIds.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => !!m);
    const [primaryMember, ...coMembers] = selectedMembers;
    const assignedTo = primaryMember.name;
    const assignedToEmail = primaryMember.email;

    const needsReply = status === "Waiting Reply";

    // Routes through the shared task-creation gate (see
    // TASK_NOTIFICATION_AUDIT.md) instead of inserting directly — this
    // form was already the closest to "doing it right," so this mainly
    // just brings it onto the same rails as every other creation path.
    const res = await authFetch("/api/tasks/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskType: "Task",
        description,
        companyId,
        project,
        stage: stage.trim() || null,
        priority,
        status,
        dueDate,
        dueTime: dueTime || null,
        assignedTo,
        assignedToEmail,
        assignedToMemberId: primaryMember.id,
        additionalAssignees: coMembers.map((m) => ({ memberId: m.id, name: m.name, email: m.email })),
        assignedToDepartment: primaryMember.department || project || null,
        assignedToBusinessUnit: primaryMember.business_unit || null,
        notes,
        replyRequired: needsReply,
      }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || result?.error) {
      setSaving(false);
      toast.show("Error saving task: " + (result?.error || "Unknown error"), "error");
      return;
    }

    const newTaskId: string | undefined = result?.taskId;

    if (subtasks.length > 0 && newTaskId) {
      const { error: subtaskError } = await supabase.from("task_subtasks").insert(
        subtasks.map((title, i) => ({ task_id: newTaskId, title, position: i }))
      );
      if (subtaskError) {
        toast.show("Task created, but subtasks failed to save: " + subtaskError.message, "error");
      }
    }

    setSaving(false);

    logAction("Created", "tasks", `Task: ${description} → ${selectedMembers.map((m) => m.name).join(", ")}`);

    setDescription("");
    setCompanyId("");
    setCompanyTouched(false);
    setProject("");
    setStage("");
    setPriority("Normal");
    setStatus("Not Started");
    setDueDate("");
    setAssignedToIds([]);
    setNotes("");
    setSubtasks([]);
    setSubtaskInput("");
    setMentionedMemberIds([]);
    setAssigneeSearch("");

    router.refresh();
    onCreated?.();
  }

  const selectedMembers = assignedToIds.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => !!m);
  const selectedOwner = departmentOwners.find((d) => d.department_name === project);

  function toggleAssignee(id: string, checked: boolean) {
    setAssignedToIds((prev) => {
      const next = checked ? [...prev, id] : prev.filter((x) => x !== id);

      if (checked) {
        const member = members.find((m) => m.id === id);

        // E1+E3 fix: use task_default_company_id (app-trusted, set in app settings)
        // rather than the FlowHCM-synced company string which may not match the companies table.
        if (!companyTouched && member?.task_default_company_id) {
          setCompanyId(member.task_default_company_id);
          setCompanyTouched(true);
        }

        // Auto-fill department (project) from the first assignee when none is set.
        // Only set if the department exists in the departments list to avoid a dangling value.
        if (!project && member?.department && projectAreas.includes(member.department)) {
          setProject(member.department);
        }
      }

      return next;
    });
  }

  return (
    <>
      {toast.element}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "16px 20px",
          backgroundColor: COLOURS.CARD,
        }}
      >
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "14px", letterSpacing: "-0.01em" }}>
          New Task
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 16px" }}>

          <label style={{ gridColumn: "1 / -1" }}>
            <span style={{ ...kickerStyle, display: "flex", justifyContent: "space-between" }}>
              <span>What needs to be done?</span>
              <span style={{ color: description.length > TASK_DESCRIPTION_LIMIT - 20 ? COLOURS.AMBER : COLOURS.SLATE, fontWeight: 600 }}>
                {description.length}/{TASK_DESCRIPTION_LIMIT}
              </span>
            </span>
            <textarea
              style={{ ...inputStyle, height: "80px" }}
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, TASK_DESCRIPTION_LIMIT))}
              maxLength={TASK_DESCRIPTION_LIMIT}
              required
              placeholder="Example: Follow up on MEPCO production shortfall and report recovery plan. One line, not a paragraph."
            />
          </label>

          <label>
            <span style={kickerStyle}>Company *</span>
            <select
              style={{ ...inputStyle, color: companyTouched ? COLOURS.NAVY : COLOURS.SLATE }}
              value={companyTouched ? companyId : "__unselected__"}
              onChange={(e) => {
                setCompanyTouched(true);
                setCompanyId(e.target.value);
              }}
              required
            >
              <option value="__unselected__" disabled>Select…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span style={kickerStyle}>Department / project area *</span>
            <select
              style={inputStyle}
              value={project}
              onChange={(e) => handleProjectChange(e.target.value)}
              required
            >
              <option value="">-- Select department / area --</option>
              <option value="Executive Office">Executive Office</option>
              {projectAreas.map((area) => (
                <option key={area}>{area}</option>
              ))}
            </select>
          </label>

          {project && (
            <div
              style={{
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                padding: "10px 12px",
                marginBottom: "12px",
                backgroundColor: COLOURS.CARD_ALT,
                fontSize: "13px",
                color: COLOURS.SLATE,
                gridColumn: "1 / -1",
              }}
            >
              Default owner:{" "}
              <strong style={{ color: COLOURS.NAVY }}>{selectedOwner?.primary_owner_name || "No owner set for this department"}</strong>
            </div>
          )}

          <label>
            <span style={kickerStyle}>Priority</span>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option>Critical</option>
              <option>Urgent</option>
              <option>Normal</option>
              <option>Low</option>
            </select>
          </label>

          <label>
            <span style={kickerStyle}>Starting status</span>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>

          <label>
            <span style={kickerStyle}>Stage (optional)</span>
            <input
              type="text"
              style={inputStyle}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              placeholder="e.g. Submitted to Civil Dept"
            />
          </label>

          <div>
            <span style={kickerStyle}>Assigned to — tick everyone this applies to; the first person ticked is the primary owner</span>
            <input
              type="text"
              placeholder="Search by name…"
              value={assigneeSearch}
              onChange={(e) => setAssigneeSearch(e.target.value)}
              style={{ ...inputStyle, marginTop: "6px", marginBottom: "4px" }}
            />
            <div style={{
              marginBottom: "12px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
              padding: "8px 10px", maxHeight: "160px", overflowY: "auto", display: "flex", flexWrap: "wrap", gap: "8px",
              backgroundColor: COLOURS.CARD,
            }}>
              {(() => {
                // Filter members by name search only (department filter removed — see comment inside)
                const filtered = members.filter((m) => {
                  // Filter only by name search — department is NOT used to filter assignees because
                  // FlowHCM department names in members (e.g. "Retail Operations") differ from the
                  // department_owners names (e.g. "Retail"), so filtering by dept silently excludes
                  // most staff. The dept field on the task categorises the work, not who can do it.
                  return !assigneeSearch.trim() || m.name.toLowerCase().includes(assigneeSearch.trim().toLowerCase());
                });
                if (filtered.length === 0) {
                  return (
                    <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontStyle: "italic" }}>
                      {assigneeSearch.trim() ? `No members match "${assigneeSearch}"` : "No members found."}
                    </span>
                  );
                }
                return filtered.map((m) => {
                  const checked = assignedToIds.includes(m.id);
                  const isPrimary = assignedToIds[0] === m.id;
                  return (
                    <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: checked ? COLOURS.NAVY : COLOURS.SLATE, cursor: "pointer", fontWeight: checked ? 600 : 400 }}>
                      <input type="checkbox" checked={checked} onChange={(e) => toggleAssignee(m.id, e.target.checked)} style={{ width: "14px", height: "14px" }} />
                      {m.name}{isPrimary && <span style={{ fontSize: "10px", fontWeight: 700, color: COLOURS.BLUE }}> (primary)</span>}{!m.task_default_company_id && <span title="No task company set — please select company manually" style={{ fontSize: "10px", fontWeight: 700, color: COLOURS.AMBER }}> ⚠ no co.</span>}
                    </label>
                  );
                });
              })()}
            </div>
          </div>

          {selectedMembers.length > 0 && (
            <div
              style={{
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                padding: "10px 12px",
                marginBottom: "12px",
                backgroundColor: COLOURS.CARD_ALT,
                fontSize: "13px",
                color: COLOURS.SLATE,
              }}
            >
              <div>Department: <strong style={{ color: COLOURS.NAVY }}>{selectedMembers[0].department || "Not set"}</strong></div>
              <div>Business Unit: <strong style={{ color: COLOURS.NAVY }}>{selectedMembers[0].business_unit || "Not set"}</strong></div>
              {selectedMembers.length > 1 && (
                <div style={{ marginTop: "4px" }}>Also assigned to: <strong style={{ color: COLOURS.NAVY }}>{selectedMembers.slice(1).map((m) => m.name).join(", ")}</strong></div>
              )}
            </div>
          )}

          <div style={{ marginBottom: "12px" }}>
            <span style={kickerStyle}>Assigned by</span>
            <div
              style={{
                marginTop: "4px",
                padding: "7px 10px",
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                backgroundColor: COLOURS.CARD_ALT,
                color: COLOURS.SLATE,
                fontSize: "14px",
              }}
            >
              {assignedBy || assignedByEmail || "Current user"}
            </div>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <span style={kickerStyle}>Assigned date</span>
            <div
              style={{
                marginTop: "4px",
                padding: "7px 10px",
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                backgroundColor: COLOURS.CARD_ALT,
                color: COLOURS.SLATE,
                fontSize: "14px",
              }}
              title="Set automatically when the task is created — never editable, including by Admin."
            >
              {new Date(today + "T00:00:00").toLocaleDateString("en-GB")} — today, locked
            </div>
          </div>

          <label>
            <span style={kickerStyle}>Due date</span>
            <div style={{ marginTop: "4px", marginBottom: "12px" }}>
              <DateInputWithCalendar
                style={{ ...inputStyle, marginTop: 0, marginBottom: 0, width: "auto", flex: 1, display: "block" }}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>
          </label>

          <label>
            <span style={kickerStyle}>Due time <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional — defaults to 17:00)</span></span>
            <input
              type="time"
              style={{ ...inputStyle, marginTop: "4px" }}
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </label>

          <label style={{ gridColumn: "1 / -1" }}>
            <span style={kickerStyle}>Subtasks (optional) — add as many steps as this task needs</span>
            {subtasks.length > 0 && (
              <div style={{ marginTop: "6px", marginBottom: "6px" }}>
                {subtasks.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <span style={{ fontSize: "13.5px", color: COLOURS.NAVY }}>{s}</span>
                    <button
                      type="button"
                      onClick={() => removeSubtask(i)}
                      style={{ background: "none", border: "none", color: COLOURS.RED, fontSize: "11.5px", fontWeight: 600, cursor: "pointer" }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: "4px", marginBottom: "12px" }}>
              <input
                type="text"
                value={subtaskInput}
                onChange={(e) => setSubtaskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
                placeholder="Add a subtask…"
                style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
              />
              <button
                type="button"
                onClick={addSubtask}
                style={{
                  border: `1px solid ${COLOURS.HAIRLINE}`,
                  backgroundColor: COLOURS.CARD_ALT,
                  borderRadius: RADII.SM,
                  padding: "0 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: COLOURS.NAVY,
                  cursor: "pointer",
                }}
              >
                + Add
              </button>
            </div>
          </label>

          <div style={{ gridColumn: "1 / -1" }}>
            <span style={kickerStyle}>
              Notes / context — type @ to mention and assign a colleague
            </span>
            <MentionTextarea
              value={notes}
              onChange={setNotes}
              members={members}
              onMentionAdded={handleMentionAdded}
              placeholder="Add background, numbers, document references, or instructions. Type @ to assign someone inline."
              style={{ ...inputStyle, height: "70px", marginTop: "4px", marginBottom: mentionedMemberIds.length > 0 ? "6px" : "12px" }}
              rows={3}
            />
            {mentionedMemberIds.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginBottom: "12px",
                  padding: "6px 10px",
                  backgroundColor: COLOURS.CARD_ALT,
                  border: `1px solid ${COLOURS.HAIRLINE}`,
                  borderRadius: RADII.SM,
                  fontSize: "12px",
                  color: COLOURS.SLATE,
                }}
              >
                <span style={{ fontWeight: 500 }}>Added via @mention:</span>
                {mentionedMemberIds.map((id) => {
                  const m = members.find((x) => x.id === id);
                  if (!m) return null;
                  return (
                    <span
                      key={id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        backgroundColor: "#E8EDFF",
                        color: COLOURS.BLUE,
                        borderRadius: RADII.PILL,
                        padding: "2px 8px",
                        fontWeight: 600,
                        fontSize: "12px",
                      }}
                    >
                      @{m.name}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            backgroundColor: COLOURS.NAVY,
            color: COLOURS.CARD,
            border: "none",
            borderRadius: RADII.PILL,
            padding: "8px 22px",
            fontSize: "13px",
            cursor: "pointer",
            fontWeight: 600,
            marginTop: "4px",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving..." : "Create Task"}
        </button>
      </form>
    </>
  );
}
