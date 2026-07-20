"use client";

/**
 * QuickAddTask
 *
 * Ultra-minimal task creation — 3 interactions max:
 *   1. Type (or speak) the task
 *   2. Pick an assignee
 *   3. Tap a due-date shortcut
 *
 * Voice mode: tap the mic button, say something like
 *   "Remind Sundas to get the agreement signed by Friday"
 * Fields auto-fill; user reviews and confirms before saving.
 *
 * Works on: Chrome (desktop), Android Chrome, Edge.
 * iPhone: use Siri shortcut → open app URL with ?voice=1 in Chrome.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase, authFetch } from "../lib/supabase";
import {
  COLOURS, RADII, useToast, TASK_COMPANY_CODES, TASK_DESCRIPTION_LIMIT,
} from "../lib/SharedUI";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import { logAction } from "../lib/audit-log";
import { parseVoiceTask, matchMemberByName } from "../lib/parseVoiceTask";
import { useRouter } from "next/navigation";

type Member = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  business_unit: string | null;
  // company_id added by migration 183 — links directly to companies table
  company_id: string | null;
};

type Company = {
  id: string;
  name: string;
  short_code: string | null;
};

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
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

const ACCENT = { bg: "#EEF1FC", text: "#3B4CCA", border: "#C0C8EF" };

function dateShortcuts(): { label: string; value: string }[] {
  const today = new Date();
  const offset = (n: number) => {
    const d = new Date(today);
    d.setDate(today.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dow = today.getDay();
  const toFri = dow === 5 ? 7 : (5 - dow + 7) % 7 || 7;
  const toMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
  return [
    { label: "Today",       value: offset(0)     },
    { label: "Tomorrow",    value: offset(1)     },
    { label: "This Friday", value: offset(toFri) },
    { label: "Next week",   value: offset(toMon) },
  ];
}

// ── Voice types ───────────────────────────────────────────────────────────────
type VoicePhase = "idle" | "listening" | "parsed";

// SpeechRecognition isn't in this project's DOM lib — declare on window so TS
// doesn't complain when we read it at runtime in Chrome / Android Chrome / Edge.
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: any;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionAny = any;

export default function QuickAddTask({
  onCreated,
  onMoreOptions,
  autoStartVoice = false,
}: {
  onCreated?: () => void;
  onMoreOptions?: () => void;
  autoStartVoice?: boolean;
}) {
  const router    = useRouter();
  const toast     = useToast();
  const shortcuts = dateShortcuts();

  // Remote data
  const [members,   setMembers]   = useState<Member[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  // Form state
  const [description, setDescription] = useState("");
  const [search,      setSearch]      = useState("");
  const [selected,    setSelected]    = useState<Member | null>(null);
  const [showDrop,    setShowDrop]    = useState(false);
  const [dropIdx,     setDropIdx]     = useState(0);
  const [dueDate,     setDueDate]     = useState("");
  const [showPicker,  setShowPicker]  = useState(false);
  const [saving,      setSaving]      = useState(false);

  // Voice state — lazy init checks browser APIs without a useEffect
  const [voicePhase,     setVoicePhase]     = useState<VoicePhase>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [voiceSupported]                    = useState<boolean>(() =>
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
  const recognitionRef  = useRef<SpeechRecognitionAny>(null);
  const transcriptRef   = useRef("");

  const inputRef    = useRef<HTMLInputElement>(null);
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const voiceAutoStartedRef = useRef(false);

  // ── Load members + companies ────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [mRes, cRes] = await Promise.all([
        supabase.from("members").select("id, name, email, department, business_unit, company_id").eq("is_active", true).order("name", { ascending: true }),
        supabase.from("companies").select("id, name, short_code").in("short_code", TASK_COMPANY_CODES).order("name", { ascending: true }),
      ]);
      if (mRes.data) setMembers(mRes.data);
      if (cRes.data) setCompanies(cRes.data);
    }
    load();
  }, []);

  // ── Auto-start voice (from ?voice=1 URL param / Siri shortcut) ─────────
  useEffect(() => {
    if (autoStartVoice && voiceSupported && !voiceAutoStartedRef.current) {
      voiceAutoStartedRef.current = true;
      // Small delay so the form has rendered first
      const t = setTimeout(() => startListening(), 600);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartVoice, voiceSupported]);

  // ── Close assignee dropdown on outside click ────────────────────────────
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ── Cleanup recognition on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => { recognitionRef.current?.abort(); };
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────
  const filtered: Member[] = search
    ? members.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
    : members.slice(0, 8);

  // Resolve company: prefer the direct company_id on the member (migration 183),
  // fall back to business_unit short-code match for older records.
  const autoCompany: Company | null = selected
    ? (companies.find((c) => c.id === selected.company_id)
        ?? companies.find((c) => c.short_code === selected.business_unit)
        ?? null)
    : null;

  const shortcutLabel = shortcuts.find((s) => s.value === dueDate)?.label;
  const canSubmit     = !!description.trim() && !!selected && !!dueDate && !!autoCompany;

  // ── Voice: apply parsed transcript to form fields ───────────────────────
  const applyTranscript = useCallback((transcript: string, currentMembers: Member[]) => {
    if (!transcript.trim()) return;
    const parsed = parseVoiceTask(transcript);

    if (parsed.description) setDescription(parsed.description);
    if (parsed.dueDate)     setDueDate(parsed.dueDate);

    if (parsed.assigneeName) {
      const match = matchMemberByName(parsed.assigneeName, currentMembers);
      if (match) {
        setSelected(match);
        setSearch("");
        setShowDrop(false);
      } else {
        // Name not matched — pre-fill the search box so user can pick manually
        setSearch(parsed.assigneeName);
        setShowDrop(true);
      }
    }

    setVoicePhase("parsed");
  }, []);

  // ── Voice: start listening ───────────────────────────────────────────────
  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast.show("Voice input isn't supported in this browser. Use Chrome or Edge.", "error");
      return;
    }

    transcriptRef.current = "";
    setLiveTranscript("");
    setVoicePhase("listening");

    const rec = new SR();
    rec.lang             = "en-US";
    rec.continuous       = false;
    rec.interimResults   = true;
    rec.maxAlternatives  = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = Array.from(e.results as any[]).map((r: any) => r[0].transcript as string).join("");
      transcriptRef.current = t;
      setLiveTranscript(t);
    };

    rec.onend = () => {
      const final = transcriptRef.current;
      setMembers((current) => {
        // applyTranscript needs current members — read from state inside setter
        applyTranscript(final, current);
        return current;
      });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      setVoicePhase("idle");
      setLiveTranscript("");
      if (e.error !== "aborted") {
        toast.show("Voice input failed — check microphone permissions.", "error");
      }
    };

    recognitionRef.current = rec;
    rec.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function retryVoice() {
    setDescription("");
    setSelected(null);
    setDueDate("");
    setVoicePhase("idle");
    setLiveTranscript("");
    setTimeout(startListening, 150);
  }

  // ── Assignee interaction ─────────────────────────────────────────────────
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

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) { toast.show("Please enter a task description.", "error"); return; }
    if (!selected)           { toast.show("Please assign this task to someone.", "error"); return; }
    if (!dueDate)            { toast.show("Please pick a due date.", "error"); return; }
    if (!autoCompany) {
      toast.show("Can't detect company for this person — use 'More options' to set it manually.", "error");
      return;
    }

    setSaving(true);
    const res = await authFetch("/api/tasks/create", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskType: "Task", description: description.trim(),
        companyId: autoCompany.id, project: selected.department || null,
        stage: null, priority: "Medium", status: "Not Started", dueDate,
        assignedTo: selected.name, assignedToEmail: selected.email,
        assignedToMemberId: selected.id, additionalAssignees: [],
        assignedToDepartment: selected.department || null,
        assignedToBusinessUnit: selected.business_unit || null,
        notes: "", replyRequired: false,
      }),
    });

    const result = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok || result?.error) {
      toast.show("Error saving task: " + (result?.error || "Unknown error"), "error");
      return;
    }

    logAction("Created", "tasks", `Quick task: ${description.trim()} → ${selected.name}`);
    setDescription(""); setSelected(null); setSearch("");
    setDueDate(""); setShowPicker(false); setVoicePhase("idle");

    toast.show("Task added.", "success");
    router.refresh();
    onCreated?.();
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const isListening = voicePhase === "listening";
  const wasParsed   = voicePhase === "parsed";

  return (
    <>
      {/* Keyframes for the voice waveform bars */}
      <style>{`
        @keyframes qa-bar {
          0%, 100% { transform: scaleY(0.35); }
          50%       { transform: scaleY(1);    }
        }
      `}</style>

      {toast.element}

      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: COLOURS.CARD,
          border:          `1px solid ${isListening ? COLOURS.RED + "88" : COLOURS.HAIRLINE}`,
          borderRadius:    RADII.CARD,
          padding:         "16px 18px",
          display:         "flex",
          flexDirection:   "column",
          gap:             "12px",
          boxShadow:       "0 2px 12px rgba(15,23,32,0.06)",
          marginBottom:    "16px",
          transition:      "border-color 0.2s",
        }}
      >
        {/* Header */}
        <div style={{
          fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.07em",
          textTransform: "uppercase", color: COLOURS.SLATE,
          display: "flex", alignItems: "center", gap: "6px",
        }}>
          <span style={{ fontSize: "14px" }}>⚡</span> Quick task
          {wasParsed && (
            <span style={{
              marginLeft: "6px", fontSize: "10px", color: COLOURS.GREEN,
              fontWeight: 600, textTransform: "none", letterSpacing: 0,
              display: "flex", alignItems: "center", gap: "3px",
            }}>
              ✓ Filled from voice — review and confirm
            </span>
          )}
        </div>

        {/* ── Listening overlay ──────────────────────────────────────────── */}
        {isListening && (
          <div style={{
            backgroundColor: "#FFF5F5",
            border:          `1px solid ${COLOURS.RED}44`,
            borderRadius:    RADII.SM,
            padding:         "14px 16px",
            display:         "flex",
            flexDirection:   "column",
            gap:             "10px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {/* Animated waveform bars */}
                <div style={{ display: "flex", alignItems: "center", gap: "3px", height: "24px" }} aria-hidden="true">
                  {[0.8, 0.45, 1, 0.6, 0.9, 0.5, 0.75].map((delay, i) => (
                    <div
                      key={i}
                      style={{
                        width: "3px",
                        height: "20px",
                        backgroundColor: COLOURS.RED,
                        borderRadius: "2px",
                        transformOrigin: "center",
                        animation: `qa-bar ${0.6 + delay * 0.4}s ease-in-out ${delay * 0.15}s infinite`,
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.RED }}>
                  Listening…
                </span>
              </div>
              <button
                type="button"
                onClick={stopListening}
                style={{
                  border:       `1px solid ${COLOURS.RED}`,
                  borderRadius: "999px",
                  padding:      "5px 14px",
                  fontSize:     "12px",
                  fontWeight:   500,
                  color:        COLOURS.RED,
                  background:   "none",
                  cursor:       "pointer",
                }}
              >
                Done
              </button>
            </div>

            {/* Live transcript */}
            <div style={{
              fontSize:   "13px",
              color:      liveTranscript ? COLOURS.NAVY : COLOURS.SLATE,
              fontStyle:  liveTranscript ? "italic" : "normal",
              minHeight:  "20px",
              lineHeight: 1.4,
            }}>
              {liveTranscript
                ? `"${liveTranscript}"`
                : `Say something like: "Remind Sundas to get the agreement signed by Friday"`}
            </div>
          </div>
        )}

        {/* ── Form fields (hidden while listening) ───────────────────────── */}
        {!isListening && (
          <>
            {/* 1 · Description */}
            <textarea
              placeholder="What needs to be done?"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, TASK_DESCRIPTION_LIMIT))}
              rows={2}
              required
              style={{
                display: "block", width: "100%",
                padding: "9px 12px",
                border: `1px solid ${description ? COLOURS.NAVY + "55" : COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM, fontSize: "14px", color: COLOURS.NAVY,
                backgroundColor: COLOURS.CARD, boxSizing: "border-box",
                resize: "none", lineHeight: 1.45, outline: "none", fontFamily: "inherit",
              }}
            />

            {/* 2 · Assignee */}
            <div ref={wrapperRef} style={{ position: "relative" }}>
              {selected ? (
                <div style={{
                  border: `1px solid ${ACCENT.border}`,
                  borderRadius: RADII.SM,
                  backgroundColor: ACCENT.bg,
                  overflow: "hidden",
                }}>
                  {/* Top row: avatar + name + clear */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px" }}>
                    <div style={{
                      width: "32px", height: "32px", borderRadius: "50%",
                      backgroundColor: avColour(selected.name).bg,
                      color: avColour(selected.name).text,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "11px", fontWeight: 700, flexShrink: 0,
                      border: `1px solid ${ACCENT.border}`,
                    }}>
                      {initials(selected.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: ACCENT.text }}>
                        {selected.name}
                      </div>
                    </div>
                    <button type="button" onClick={clear} aria-label="Clear assignee"
                      style={{ background: "none", border: "none", padding: "2px 6px", cursor: "pointer", color: ACCENT.text, fontSize: "16px", lineHeight: 1, flexShrink: 0 }}
                    >×</button>
                  </div>
                  {/* Auto-fill detail row */}
                  <div style={{
                    borderTop: `1px solid ${ACCENT.border}`,
                    padding: "6px 12px",
                    display: "flex", gap: "16px", flexWrap: "wrap",
                  }}>
                    {[
                      { label: "Company",    value: autoCompany?.name ?? "—" },
                      { label: "Department", value: selected.department ?? "—" },
                      { label: "Priority",   value: "Medium" },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                        <span style={{ fontSize: "9.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: ACCENT.text, opacity: 0.6 }}>{label}</span>
                        <span style={{ fontSize: "12px", fontWeight: 500, color: ACCENT.text }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <input
                  ref={inputRef} type="text" autoComplete="off"
                  placeholder="Assign to — start typing a name"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setShowDrop(true); setDropIdx(0); }}
                  onFocus={() => setShowDrop(true)}
                  onKeyDown={onKeyDown}
                  style={{
                    display: "block", width: "100%", padding: "9px 12px",
                    border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
                    fontSize: "14px", color: COLOURS.NAVY, backgroundColor: COLOURS.CARD,
                    boxSizing: "border-box", outline: "none", fontFamily: "inherit",
                  }}
                />
              )}

              {showDrop && !selected && filtered.length > 0 && (
                <div role="listbox" aria-label="Select assignee" style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 300,
                  backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
                  borderRadius: RADII.CARD, boxShadow: "0 8px 30px rgba(15,23,32,0.12)",
                  marginTop: "4px", maxHeight: "220px", overflowY: "auto",
                }}>
                  {filtered.map((m, i) => {
                    const av = avColour(m.name);
                    const active = i === dropIdx;
                    return (
                      <div key={m.id} role="option" aria-selected={active}
                        onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                        onMouseEnter={() => setDropIdx(i)}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "8px 12px", cursor: "pointer",
                          backgroundColor: active ? COLOURS.CARD_ALT : COLOURS.CARD,
                          borderBottom: i < filtered.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
                        }}
                      >
                        <div style={{
                          width: "28px", height: "28px", borderRadius: "50%",
                          backgroundColor: av.bg, color: av.text,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "11px", fontWeight: 600, flexShrink: 0,
                        }}>{initials(m.name)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 500, color: COLOURS.NAVY }}>{m.name}</div>
                          {m.department && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{m.department}</div>}
                        </div>
                        {active && <div style={{ marginLeft: "auto", fontSize: "10.5px", color: COLOURS.SLATE }} aria-hidden="true">↵</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 3 · Due date */}
            <div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                {shortcuts.map((s) => {
                  const on = dueDate === s.value;
                  return (
                    <button key={s.label} type="button"
                      onClick={() => { setDueDate(s.value); setShowPicker(false); }}
                      style={{
                        border: `1px solid ${on ? ACCENT.border : COLOURS.HAIRLINE}`,
                        borderRadius: "999px", padding: "5px 14px",
                        fontSize: "12px", fontWeight: on ? 600 : 400,
                        color: on ? ACCENT.text : COLOURS.SLATE,
                        backgroundColor: on ? ACCENT.bg : "transparent",
                        cursor: "pointer", transition: "all 0.12s", whiteSpace: "nowrap",
                      }}
                    >{s.label}</button>
                  );
                })}
                <button type="button"
                  onClick={() => setShowPicker((v) => !v)}
                  style={{
                    border: `1px solid ${showPicker || (dueDate && !shortcutLabel) ? ACCENT.border : COLOURS.HAIRLINE}`,
                    borderRadius: "999px", padding: "5px 14px", fontSize: "12px",
                    color: showPicker || (dueDate && !shortcutLabel) ? ACCENT.text : COLOURS.SLATE,
                    backgroundColor: showPicker || (dueDate && !shortcutLabel) ? ACCENT.bg : "transparent",
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {dueDate && !shortcutLabel ? `📅 ${dueDate.split("-").reverse().join("/")}` : "Pick date"}
                </button>
              </div>
              {showPicker && (
                <div style={{ marginTop: "8px" }}>
                  <DateInputWithCalendar
                    value={dueDate}
                    onChange={(e) => { setDueDate(e.target.value); if (e.target.value) setShowPicker(false); }}
                    placeholder="DD/MM/YYYY"
                  />
                </div>
              )}
            </div>

            {/* Company unresolved — show compact warning */}
            {selected && !autoCompany && (
              <div style={{
                fontSize: "11px", color: COLOURS.AMBER,
                backgroundColor: "#FBF1DE", border: `1px solid #E8C97A`,
                borderRadius: RADII.SM, padding: "7px 10px",
              }}>
                ⚠ Company not set for {selected.name} yet.{" "}
                <button type="button" onClick={onMoreOptions} style={{
                  background: "none", border: "none", padding: 0,
                  color: COLOURS.AMBER, fontWeight: 600, cursor: "pointer",
                  textDecoration: "underline", fontSize: "11px",
                }}>Use full form</button>{" "}to pick it, or apply migration 183 first.
              </div>
            )}
          </>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          {!isListening ? (
            <button type="button" onClick={onMoreOptions} style={{
              background: "none", border: "none", padding: 0,
              fontSize: "12px", color: COLOURS.SLATE,
              cursor: "pointer", textDecoration: "underline",
            }}>
              More options
            </button>
          ) : (
            <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>
              Speak clearly · pause when done
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Voice / retry button */}
            {voiceSupported && !isListening && (
              <button
                type="button"
                onClick={wasParsed ? retryVoice : startListening}
                title={wasParsed ? "Try again" : "Voice input"}
                aria-label={wasParsed ? "Retry voice input" : "Start voice input"}
                style={{
                  width: "36px", height: "36px",
                  borderRadius: "50%",
                  border: `1px solid ${wasParsed ? COLOURS.HAIRLINE : COLOURS.RED + "66"}`,
                  backgroundColor: wasParsed ? COLOURS.CARD_ALT : "#FFF5F5",
                  color: wasParsed ? COLOURS.SLATE : COLOURS.RED,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", flexShrink: 0,
                  transition: "all 0.15s",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {wasParsed ? (
                    // Retry icon (refresh)
                    <>
                      <path d="M1 4v6h6" /><path d="M23 20v-6h-6" />
                      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                    </>
                  ) : (
                    // Mic icon
                    <>
                      <rect x="9" y="2" width="6" height="11" rx="3" />
                      <path d="M19 10a7 7 0 0 1-14 0" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </>
                  )}
                </svg>
              </button>
            )}

            {/* Add task / confirm */}
            {!isListening && (
              <button type="submit" disabled={saving || !canSubmit} style={{
                backgroundColor: saving || !canSubmit ? COLOURS.HAIRLINE : COLOURS.NAVY,
                color:           saving || !canSubmit ? COLOURS.SLATE    : COLOURS.CARD,
                border: "none", borderRadius: "999px", padding: "8px 24px",
                fontSize: "13px", fontWeight: 600,
                cursor: saving ? "wait" : "pointer",
                transition: "all 0.15s", whiteSpace: "nowrap",
              }}>
                {saving ? "Adding…" : wasParsed ? "Confirm task" : "Add task"}
              </button>
            )}
          </div>
        </div>
      </form>
    </>
  );
}
