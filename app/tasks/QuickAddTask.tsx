"use client";

/**
 * QuickAddTask
 *
 * Ultra-minimal 3-interaction task creation:
 *   1. Type the task description
 *   2. Pick an assignee (type to filter, tap to select)
 *   3. Tap a due-date shortcut (or pick a date)
 *
 * Everything else is inferred automatically:
 *   - Company     ← assignee's business_unit (matched to companies table)
 *   - Department  ← assignee's department
 *   - Priority    = Medium
 *   - Status      = Not Started
 *   - Assigned by = currently logged-in user
 *
 * "More options" opens the full NewTaskForm modal for edge-cases.
 */

import React, { useState, useEffect, useRef } from "react";
import { supabase, authFetch } from "../lib/supabase";
import {
  COLOURS, RADII, useToast, TASK_COMPANY_CODES, TASK_DESCRIPTION_LIMIT,
} from "../lib/SharedUI";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import { logAction } from "../lib/audit-log";
import { useRouter } from "next/navigation";

type Member = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  business_unit: string | null;
};

type Company = {
  id: string;
  name: string;
  short_code: string | null;
};

// Palette from MentionTextarea — kept in sync.
const AVATAR_PALETTE = [
  { bg: "#E8EDFF", text: "#3B4CCA" },
  { bg: "#E7F2ED", text: "#0F7B5F" },
  { bg: "#FBF1DE", text: "#B4791F" },
  { bg: "#F3EEF9", text: "#6E45B8" },
  { bg: "#F8E4E2", text: "#B3261E" },
];

function avColour(name: string) {
  return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Selected-state accent (matches COLOURS.BLUE / INFO_SOFT from SharedUI).
const ACCENT = {
  bg:     "#EEF1FC",   // COLOURS.INFO_SOFT
  text:   "#3B4CCA",   // COLOURS.BLUE
  border: "#C0C8EF",
};

// Four quick-pick shortcuts relative to today.
function dateShortcuts(): { label: string; value: string }[] {
  const today = new Date();
  const offset = (n: number) => {
    const d = new Date(today);
    d.setDate(today.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dow = today.getDay(); // 0=Sun … 6=Sat
  // Days until next Friday (if today is Friday, go to the following Friday)
  const toFri = dow === 5 ? 7 : (5 - dow + 7) % 7 || 7;
  // Days until next Monday (if today is Monday, go to next Monday)
  const toMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
  return [
    { label: "Today",       value: offset(0)     },
    { label: "Tomorrow",    value: offset(1)     },
    { label: "This Friday", value: offset(toFri) },
    { label: "Next week",   value: offset(toMon) },
  ];
}

export default function QuickAddTask({
  onCreated,
  onMoreOptions,
}: {
  onCreated?: () => void;
  onMoreOptions?: () => void;
}) {
  const router   = useRouter();
  const toast    = useToast();
  const shortcuts = dateShortcuts();

  // Remote data
  const [members,         setMembers]         = useState<Member[]>([]);
  const [companies,       setCompanies]       = useState<Company[]>([]);
  const [assignedBy,      setAssignedBy]      = useState("");
  const [assignedByEmail, setAssignedByEmail] = useState("");

  // Form state
  const [description, setDescription] = useState("");
  const [search,      setSearch]      = useState("");
  const [selected,    setSelected]    = useState<Member | null>(null);
  const [showDrop,    setShowDrop]    = useState(false);
  const [dropIdx,     setDropIdx]     = useState(0);
  const [dueDate,     setDueDate]     = useState("");
  const [showPicker,  setShowPicker]  = useState(false);
  const [saving,      setSaving]      = useState(false);

  const inputRef   = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── Load members + companies ──────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email || "";
      setAssignedByEmail(email);

      const { data: me } = await supabase
        .from("members")
        .select("name")
        .eq("email", email)
        .single();
      setAssignedBy(me?.name || email);

      const [mRes, cRes] = await Promise.all([
        supabase
          .from("members")
          .select("id, name, email, department, business_unit")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase
          .from("companies")
          .select("id, name, short_code")
          .in("short_code", TASK_COMPANY_CODES)
          .order("name", { ascending: true }),
      ]);

      if (mRes.data) setMembers(mRes.data);
      if (cRes.data) setCompanies(cRes.data);
    }
    load();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────
  const filtered: Member[] = search
    ? members.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
    : members.slice(0, 8);

  // Auto-detect company from the selected member's business_unit
  const autoCompany: Company | null = selected
    ? (companies.find((c) => c.short_code === selected.business_unit) ?? null)
    : null;

  const shortcutLabel = shortcuts.find((s) => s.value === dueDate)?.label;
  const canSubmit     = !!description.trim() && !!selected && !!dueDate && !!autoCompany;

  // ── Assignee interaction ──────────────────────────────────────────────
  function pick(m: Member) {
    setSelected(m);
    setSearch("");
    setShowDrop(false);
  }

  function clear() {
    setSelected(null);
    setSearch("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!showDrop || filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setDropIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp")  { e.preventDefault(); setDropIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter")    { e.preventDefault(); pick(filtered[dropIdx]); }
    else if (e.key === "Escape")   { setShowDrop(false); }
  }

  // ── Submit ────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!description.trim()) { toast.show("Please enter a task description.", "error"); return; }
    if (!selected)           { toast.show("Please assign this task to someone.", "error"); return; }
    if (!dueDate)            { toast.show("Please pick a due date.", "error"); return; }
    if (!autoCompany) {
      toast.show(
        "Can't auto-detect company for this person — use 'More options' to set it manually.",
        "error"
      );
      return;
    }

    setSaving(true);

    const res = await authFetch("/api/tasks/create", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskType:              "Task",
        description:           description.trim(),
        companyId:             autoCompany.id,
        project:               selected.department || null,
        stage:                 null,
        priority:              "Medium",
        status:                "Not Started",
        dueDate,
        assignedTo:            selected.name,
        assignedToEmail:       selected.email,
        assignedToMemberId:    selected.id,
        additionalAssignees:   [],
        assignedToDepartment:  selected.department || null,
        assignedToBusinessUnit: selected.business_unit || null,
        notes:                 "",
        replyRequired:         false,
      }),
    });

    const result = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok || result?.error) {
      toast.show("Error saving task: " + (result?.error || "Unknown error"), "error");
      return;
    }

    logAction("Created", "tasks", `Quick task: ${description.trim()} → ${selected.name}`);

    // Reset
    setDescription("");
    setSelected(null);
    setSearch("");
    setDueDate("");
    setShowPicker(false);

    toast.show("Task added.", "success");
    router.refresh();
    onCreated?.();
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      {toast.element}
      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: COLOURS.CARD,
          border:          `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius:    RADII.CARD,
          padding:         "16px 18px",
          display:         "flex",
          flexDirection:   "column",
          gap:             "12px",
          boxShadow:       "0 2px 12px rgba(15,23,32,0.06)",
          marginBottom:    "16px",
        }}
      >
        {/* Header label */}
        <div style={{
          fontSize:    "10.5px",
          fontWeight:  600,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color:       COLOURS.SLATE,
          display:     "flex",
          alignItems:  "center",
          gap:         "6px",
        }}>
          <span style={{ fontSize: "14px" }}>⚡</span> Quick task
        </div>

        {/* 1 · Description */}
        <textarea
          placeholder="What needs to be done?"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, TASK_DESCRIPTION_LIMIT))}
          rows={2}
          required
          style={{
            display:         "block",
            width:           "100%",
            padding:         "9px 12px",
            border:          `1px solid ${description ? COLOURS.NAVY + "55" : COLOURS.HAIRLINE}`,
            borderRadius:    RADII.SM,
            fontSize:        "14px",
            color:           COLOURS.NAVY,
            backgroundColor: COLOURS.CARD,
            boxSizing:       "border-box",
            resize:          "none",
            lineHeight:      1.45,
            outline:         "none",
            fontFamily:      "inherit",
          }}
        />

        {/* 2 · Assignee */}
        <div ref={wrapperRef} style={{ position: "relative" }}>
          {selected ? (
            /* Selected chip */
            <div style={{
              display:         "flex",
              alignItems:      "center",
              gap:             "10px",
              padding:         "8px 12px",
              border:          `1px solid ${ACCENT.border}`,
              borderRadius:    RADII.SM,
              backgroundColor: ACCENT.bg,
            }}>
              <div style={{
                width:           "30px",
                height:          "30px",
                borderRadius:    "50%",
                backgroundColor: avColour(selected.name).bg,
                color:           avColour(selected.name).text,
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "center",
                fontSize:        "11px",
                fontWeight:      700,
                flexShrink:      0,
                border:          `1px solid ${ACCENT.border}`,
              }}>
                {initials(selected.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: ACCENT.text }}>
                  {selected.name}
                </div>
                {(selected.department || autoCompany) && (
                  <div style={{ fontSize: "11px", color: ACCENT.text, opacity: 0.75 }}>
                    {[selected.department, autoCompany?.short_code].filter(Boolean).join(" · ")}
                    {" "}— auto‑filled
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={clear}
                aria-label="Clear assignee"
                style={{
                  background: "none",
                  border:     "none",
                  padding:    "2px 6px",
                  cursor:     "pointer",
                  color:      ACCENT.text,
                  fontSize:   "16px",
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >×</button>
            </div>
          ) : (
            /* Search input */
            <input
              ref={inputRef}
              type="text"
              placeholder="Assign to — start typing a name"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowDrop(true); setDropIdx(0); }}
              onFocus={() => setShowDrop(true)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              style={{
                display:         "block",
                width:           "100%",
                padding:         "9px 12px",
                border:          `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius:    RADII.SM,
                fontSize:        "14px",
                color:           COLOURS.NAVY,
                backgroundColor: COLOURS.CARD,
                boxSizing:       "border-box",
                outline:         "none",
                fontFamily:      "inherit",
              }}
            />
          )}

          {/* Dropdown */}
          {showDrop && !selected && filtered.length > 0 && (
            <div
              role="listbox"
              aria-label="Select assignee"
              style={{
                position:        "absolute",
                top:             "100%",
                left:            0,
                right:           0,
                zIndex:          300,
                backgroundColor: COLOURS.CARD,
                border:          `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius:    RADII.CARD,
                boxShadow:       "0 8px 30px rgba(15,23,32,0.12)",
                marginTop:       "4px",
                maxHeight:       "220px",
                overflowY:       "auto",
              }}
            >
              {filtered.map((m, i) => {
                const av     = avColour(m.name);
                const active = i === dropIdx;
                return (
                  <div
                    key={m.id}
                    role="option"
                    aria-selected={active}
                    onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                    onMouseEnter={() => setDropIdx(i)}
                    style={{
                      display:         "flex",
                      alignItems:      "center",
                      gap:             "10px",
                      padding:         "8px 12px",
                      cursor:          "pointer",
                      backgroundColor: active ? COLOURS.CARD_ALT : COLOURS.CARD,
                      borderBottom:    i < filtered.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
                    }}
                  >
                    <div style={{
                      width:           "28px",
                      height:          "28px",
                      borderRadius:    "50%",
                      backgroundColor: av.bg,
                      color:           av.text,
                      display:         "flex",
                      alignItems:      "center",
                      justifyContent:  "center",
                      fontSize:        "11px",
                      fontWeight:      600,
                      flexShrink:      0,
                    }}>
                      {initials(m.name)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 500, color: COLOURS.NAVY }}>
                        {m.name}
                      </div>
                      {m.department && (
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{m.department}</div>
                      )}
                    </div>
                    {active && (
                      <div style={{ marginLeft: "auto", fontSize: "10.5px", color: COLOURS.SLATE }} aria-hidden="true">↵</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 3 · Due date quick-picks */}
        <div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            {shortcuts.map((s) => {
              const on = dueDate === s.value;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => { setDueDate(s.value); setShowPicker(false); }}
                  style={{
                    border:          `1px solid ${on ? ACCENT.border : COLOURS.HAIRLINE}`,
                    borderRadius:    "999px",
                    padding:         "5px 14px",
                    fontSize:        "12px",
                    fontWeight:      on ? 600 : 400,
                    color:           on ? ACCENT.text : COLOURS.SLATE,
                    backgroundColor: on ? ACCENT.bg : "transparent",
                    cursor:          "pointer",
                    transition:      "all 0.12s",
                    whiteSpace:      "nowrap",
                  }}
                >
                  {s.label}
                </button>
              );
            })}
            {/* Custom date picker */}
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              style={{
                border:          `1px solid ${showPicker || (dueDate && !shortcutLabel) ? ACCENT.border : COLOURS.HAIRLINE}`,
                borderRadius:    "999px",
                padding:         "5px 14px",
                fontSize:        "12px",
                color:           showPicker || (dueDate && !shortcutLabel) ? ACCENT.text : COLOURS.SLATE,
                backgroundColor: showPicker || (dueDate && !shortcutLabel) ? ACCENT.bg : "transparent",
                cursor:          "pointer",
                whiteSpace:      "nowrap",
              }}
            >
              {dueDate && !shortcutLabel
                ? `📅 ${dueDate.split("-").reverse().join("/")}`
                : "Pick date"}
            </button>
          </div>

          {showPicker && (
            <div style={{ marginTop: "8px" }}>
              <DateInputWithCalendar
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  if (e.target.value) setShowPicker(false);
                }}
                placeholder="DD/MM/YYYY"
              />
            </div>
          )}
        </div>

        {/* Auto-fill summary (only when assignee + company resolved) */}
        {selected && autoCompany && (
          <div style={{
            fontSize:    "11px",
            color:       COLOURS.SLATE,
            paddingTop:  "8px",
            borderTop:   `1px solid ${COLOURS.HAIRLINE}`,
            display:     "flex",
            flexDirection: "column",
            gap:         "2px",
          }}>
            <span>✓ {autoCompany.name} · {selected.department || "No department"} · Priority: Medium</span>
            <span>✓ Status: Not Started · Assigned by {assignedBy || "you"}</span>
          </div>
        )}

        {/* If company can't be detected, warn inline */}
        {selected && !autoCompany && (
          <div style={{
            fontSize:        "11px",
            color:           COLOURS.AMBER,
            backgroundColor: "#FBF1DE",
            border:          `1px solid #E8C97A`,
            borderRadius:    RADII.SM,
            padding:         "7px 10px",
          }}>
            ⚠ Can't detect {selected.name}&apos;s company automatically.{" "}
            <button
              type="button"
              onClick={onMoreOptions}
              style={{ background: "none", border: "none", padding: 0, color: COLOURS.AMBER, fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontSize: "11px" }}
            >
              Use full form
            </button>{" "}
            to set it manually.
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <button
            type="button"
            onClick={onMoreOptions}
            style={{
              background:     "none",
              border:         "none",
              padding:        0,
              fontSize:       "12px",
              color:          COLOURS.SLATE,
              cursor:         "pointer",
              textDecoration: "underline",
            }}
          >
            More options
          </button>

          <button
            type="submit"
            disabled={saving || !canSubmit}
            style={{
              backgroundColor: saving || !canSubmit ? COLOURS.HAIRLINE : COLOURS.NAVY,
              color:           saving || !canSubmit ? COLOURS.SLATE    : COLOURS.CARD,
              border:          "none",
              borderRadius:    "999px",
              padding:         "8px 24px",
              fontSize:        "13px",
              fontWeight:      600,
              cursor:          saving ? "wait" : "pointer",
              transition:      "all 0.15s",
              whiteSpace:      "nowrap",
            }}
          >
            {saving ? "Adding…" : "Add task"}
          </button>
        </div>
      </form>
    </>
  );
}
