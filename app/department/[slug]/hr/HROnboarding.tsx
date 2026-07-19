"use client";

/**
 * HROnboarding.tsx
 *
 * Three sub-views, toggled by an inner pill-tab strip:
 *
 *  1. "Overview"    — KPI cards + active joiner checklists (default for everyone)
 *  2. "Orientation" — The self-service player (any employee sees this and works
 *                     through videos, documents, and a quiz at their own pace)
 *  3. "Manage"      — Admin-only: create/edit orientation modules, sections,
 *                     and quiz questions; view completion records
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { COMPANIES } from "../../../lib/constants";
import { formatDateUK } from "../../../lib/dateUtils";
import { useMobile } from "../../../lib/useMobile";
import { COLOURS, RADII, cardStyle, SectionTitle } from "../../../lib/SharedUI";
import { logAction } from "../../../lib/audit-log";

// ─── Types ───────────────────────────────────────────────────────────────────

type Module = {
  id: string;
  company_id: string | null;
  title: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

type Section = {
  id: string;
  module_id: string;
  order_index: number;
  section_type: "video" | "document" | "text";
  title: string;
  content_url: string | null;
  folderit_file_id: string | null;
  content_text: string | null;
};

type QuizQuestion = {
  id: string;
  module_id: string;
  order_index: number;
  question: string;
  options: string[];
  correct_option: number;
};

type Completion = {
  id: string;
  module_id: string;
  member_email: string;
  member_name: string | null;
  started_at: string;
  sections_viewed: string[];
  quiz_started_at: string | null;
  quiz_completed_at: string | null;
  quiz_score: number | null;
  quiz_passed: boolean | null;
  completed_at: string | null;
};

type Joiner = {
  id: string;
  name: string | null;
  email: string;
  department: string | null;
  company: string | null;
  created_at: string;
};

// ─── Shared styles ───────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px",
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
  fontSize: "14px", boxSizing: "border-box", color: COLOURS.NAVY,
  backgroundColor: COLOURS.CARD,
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE,
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px",
};
const btnPrimary: React.CSSProperties = {
  backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none",
  borderRadius: RADII.PILL, padding: "8px 18px", fontSize: "13px",
  fontWeight: 600, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  backgroundColor: "transparent", color: COLOURS.SLATE,
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL,
  padding: "7px 14px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
};

// ─── Checklist steps for a new joiner ───────────────────────────────────────

const CHECKLIST_STEPS = [
  "Offer letter issued",
  "CNIC and documents collected",
  "FlowHCM profile created",
  "EOBI registration submitted",
  "IT access provisioned",
  "Orientation completed",
  "Induction with line manager",
];

// ─── Sub-view: Overview ──────────────────────────────────────────────────────

function Overview({
  completions,
  modules,
  onStartOrientation,
  myCompletion,
}: {
  completions: Completion[];
  modules: Module[];
  onStartOrientation: () => void;
  myCompletion: Completion | null;
}) {
  const isMobile = useMobile();
  // Recent joiners (members created in last 60 days who haven't completed orientation)
  const [joiners, setJoiners] = useState<Joiner[]>([]);
  const [expandedJoiner, setExpandedJoiner] = useState<string | null>(null);
  const [checklistState, setChecklistState] = useState<Record<string, boolean[]>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("members")
      .select("id, name, email, department, company, created_at")
      .gte("created_at", new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setJoiners(data || []);
        // Initialise checklist state
        const init: Record<string, boolean[]> = {};
        (data || []).forEach((j: Joiner) => {
          init[j.id] = Array(CHECKLIST_STEPS.length).fill(false);
        });
        setChecklistState(init);
      });
  }, []);

  function toggleStep(joinerId: string, stepIndex: number) {
    setChecklistState((prev) => {
      const arr = [...(prev[joinerId] || Array(CHECKLIST_STEPS.length).fill(false))];
      arr[stepIndex] = !arr[stepIndex];
      return { ...prev, [joinerId]: arr };
    });
  }

  const completed    = completions.filter((c) => c.completed_at).length;
  const inProgress   = completions.filter((c) => !c.completed_at).length;
  const avgScore     = completions.filter((c) => c.quiz_score !== null).reduce((s, c) => s + (c.quiz_score ?? 0), 0) / Math.max(completions.filter((c) => c.quiz_score !== null).length, 1);
  const passRate     = completions.length > 0 ? Math.round((completions.filter((c) => c.quiz_passed).length / completions.length) * 100) : 0;

  const kpis = [
    { label: "Active joiners (60d)",    value: joiners.length },
    { label: "Orientations completed",  value: completed, green: true },
    { label: "In progress",             value: inProgress, amber: completed === 0 && inProgress > 0 },
    { label: "Quiz pass rate",          value: `${passRate}%`, green: passRate >= 80 },
  ];

  return (
    <>
      {/* My orientation banner */}
      {myCompletion && !myCompletion.completed_at && (
        <div style={{
          background: "#EEF1FC", border: "1px solid #C7D7F8", borderRadius: RADII.CARD,
          padding: "14px 18px", marginBottom: "14px",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px",
          flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e3a8a" }}>Your orientation is in progress</div>
            <div style={{ fontSize: "13px", color: "#3B5BDB", marginTop: "2px" }}>
              {myCompletion.sections_viewed.length} section{myCompletion.sections_viewed.length !== 1 ? "s" : ""} viewed — continue where you left off
            </div>
          </div>
          <button onClick={onStartOrientation} style={btnPrimary}>Continue orientation →</button>
        </div>
      )}

      {!myCompletion && modules.filter((m) => m.is_active).length > 0 && (
        <div style={{
          background: "#EEF1FC", border: "1px solid #C7D7F8", borderRadius: RADII.CARD,
          padding: "14px 18px", marginBottom: "14px",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px",
          flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e3a8a" }}>Complete your orientation</div>
            <div style={{ fontSize: "13px", color: "#3B5BDB", marginTop: "2px" }}>Watch the videos, read the policies, then take the quiz</div>
          </div>
          <button onClick={onStartOrientation} style={btnPrimary}>Start orientation →</button>
        </div>
      )}

      {myCompletion?.completed_at && (
        <div style={{
          background: COLOURS.SUCCESS_SOFT, border: `1px solid ${COLOURS.GREEN}`, borderRadius: RADII.CARD,
          padding: "14px 18px", marginBottom: "14px",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ fontSize: "20px" }}>✅</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.GREEN }}>Orientation complete</div>
            <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px" }}>
              Completed {formatDateUK(myCompletion.completed_at)} · Score: {myCompletion.quiz_score}%
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "14px" }}>
        {kpis.map(({ label, value, green, amber }) => (
          <div key={label} style={{ ...cardStyle, padding: "16px 20px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "8px" }}>{label}</div>
            <div style={{
              fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
              fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              color: green ? COLOURS.GREEN : amber ? COLOURS.AMBER : COLOURS.NAVY,
            }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Active joiner checklists */}
      <SectionTitle title="Recent joiners (last 60 days)" />
      {joiners.length === 0 ? (
        <div style={{ ...cardStyle, padding: "20px", color: COLOURS.SLATE, fontSize: "14px", marginTop: "8px" }}>
          No new joiners in the last 60 days.
        </div>
      ) : (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden", marginTop: "8px", marginBottom: "14px" }}>
          {joiners.map((joiner) => {
            const steps = checklistState[joiner.id] || Array(CHECKLIST_STEPS.length).fill(false);
            const doneCount = steps.filter(Boolean).length;
            const isExpanded = expandedJoiner === joiner.id;
            const pct = Math.round((doneCount / CHECKLIST_STEPS.length) * 100);
            const orientationDone = completions.some((c) => c.member_email === joiner.email && c.completed_at);

            return (
              <div key={joiner.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                <div
                  onClick={() => setExpandedJoiner(isExpanded ? null : joiner.id)}
                  style={{
                    padding: "10px 16px", cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                    backgroundColor: isExpanded ? COLOURS.CARD_ALT : COLOURS.CARD,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{joiner.name || joiner.email}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      {joiner.company || "—"} · {joiner.department || "—"} · Joined {formatDateUK(joiner.created_at)}
                    </div>
                    {/* Progress bar */}
                    <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ flex: 1, height: "4px", background: COLOURS.TRACK, borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? COLOURS.GREEN : COLOURS.BLUE, borderRadius: "2px" }} />
                      </div>
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>{doneCount}/{CHECKLIST_STEPS.length}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                    {orientationDone
                      ? <span style={{ fontSize: "11px", fontWeight: 500, background: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, padding: "2px 9px", borderRadius: RADII.PILL }}>Orientation ✓</span>
                      : <span style={{ fontSize: "11px", fontWeight: 500, background: "#FFF4E5", color: COLOURS.AMBER, padding: "2px 9px", borderRadius: RADII.PILL }}>Orientation pending</span>
                    }
                    <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{isExpanded ? "▼" : "▶"}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: "14px 16px 14px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "10px" }}>Checklist</div>
                    {CHECKLIST_STEPS.map((step, idx) => (
                      <div
                        key={idx}
                        onClick={() => toggleStep(joiner.id, idx)}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "8px 0", borderBottom: idx < CHECKLIST_STEPS.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{
                          width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0,
                          border: `2px solid ${steps[idx] ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                          background: steps[idx] ? COLOURS.GREEN : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {steps[idx] && <span style={{ color: "#fff", fontSize: "11px", lineHeight: 1 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: "13px", color: steps[idx] ? COLOURS.SLATE : COLOURS.NAVY, textDecoration: steps[idx] ? "line-through" : "none" }}>{step}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Sub-view: Orientation Player ────────────────────────────────────────────

function OrientationPlayer({
  modules,
  myEmail,
  myName,
  existingCompletion,
  onComplete,
}: {
  modules: Module[];
  myEmail: string;
  myName: string | null;
  existingCompletion: Completion | null;
  onComplete: () => void;
}) {
  const activeModules = modules.filter((m) => m.is_active);
  const [selectedModuleId, setSelectedModuleId] = useState<string>(
    existingCompletion?.module_id || activeModules[0]?.id || ""
  );
  const [sections, setSections]       = useState<Section[]>([]);
  const [questions, setQuestions]     = useState<QuizQuestion[]>([]);
  const [completion, setCompletion]   = useState<Completion | null>(existingCompletion);
  const [currentStep, setCurrentStep] = useState<number>(0); // index into sections array; sections.length = quiz
  const [quizAnswers, setQuizAnswers] = useState<(number | null)[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizResult, setQuizResult]   = useState<{ score: number; passed: boolean } | null>(null);
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    if (!selectedModuleId) return;
    setSections([]); setQuestions([]); setCurrentStep(0); setQuizAnswers([]); setQuizSubmitted(false); setQuizResult(null);
    Promise.all([
      supabase.from("hr_onboarding_sections").select("*").eq("module_id", selectedModuleId).order("order_index"),
      supabase.from("hr_onboarding_quiz_questions").select("*").eq("module_id", selectedModuleId).order("order_index"),
    ]).then(([{ data: secs }, { data: qs }]) => {
      setSections(secs || []);
      setQuestions(qs || []);
      setQuizAnswers(Array((qs || []).length).fill(null));
    });
  }, [selectedModuleId]);

  async function ensureCompletionRecord(): Promise<Completion> {
    if (completion) return completion;
    const { data, error } = await supabase
      .from("hr_onboarding_completions")
      .upsert({
        module_id: selectedModuleId,
        member_email: myEmail,
        member_name: myName,
        started_at: new Date().toISOString(),
        sections_viewed: [],
      }, { onConflict: "module_id,member_email" })
      .select()
      .single();
    if (!error && data) {
      setCompletion(data as Completion);
      return data as Completion;
    }
    throw new Error("Could not create completion record");
  }

  async function markSectionViewed(sectionId: string) {
    const rec = await ensureCompletionRecord();
    const viewed = Array.from(new Set([...(rec.sections_viewed || []), sectionId]));
    const { data } = await supabase
      .from("hr_onboarding_completions")
      .update({ sections_viewed: viewed })
      .eq("id", rec.id)
      .select()
      .single();
    if (data) setCompletion(data as Completion);
  }

  async function goToStep(idx: number) {
    if (idx < sections.length) {
      const sec = sections[idx];
      await markSectionViewed(sec.id);
    } else {
      // About to show quiz — record quiz_started_at
      const rec = await ensureCompletionRecord();
      if (!rec.quiz_started_at) {
        const { data } = await supabase
          .from("hr_onboarding_completions")
          .update({ quiz_started_at: new Date().toISOString() })
          .eq("id", rec.id)
          .select()
          .single();
        if (data) setCompletion(data as Completion);
      }
    }
    setCurrentStep(idx);
  }

  async function submitQuiz() {
    if (quizAnswers.some((a) => a === null)) return; // shouldn't happen but guard
    const correct = questions.filter((q, i) => quizAnswers[i] === q.correct_option).length;
    const score   = Math.round((correct / questions.length) * 100);
    const passed  = score >= 80;
    setSaving(true);
    const rec = await ensureCompletionRecord();
    const now = new Date().toISOString();
    const { data } = await supabase
      .from("hr_onboarding_completions")
      .update({
        quiz_answers: quizAnswers,
        quiz_completed_at: now,
        quiz_score: score,
        quiz_passed: passed,
        completed_at: passed ? now : null,
      })
      .eq("id", rec.id)
      .select()
      .single();
    if (data) setCompletion(data as Completion);
    setSaving(false);
    setQuizSubmitted(true);
    setQuizResult({ score, passed });
    if (passed) {
      logAction("Completed", "hr_onboarding_completions", `Orientation passed — ${score}%`);
      setTimeout(onComplete, 2000);
    }
  }

  if (activeModules.length === 0) {
    return (
      <div style={{ ...cardStyle, padding: "32px", textAlign: "center", color: COLOURS.SLATE }}>
        No orientation modules have been created yet. Ask your HR manager to set one up.
      </div>
    );
  }

  const viewedIds     = completion?.sections_viewed || [];
  const allViewed     = sections.length > 0 && sections.every((s) => viewedIds.includes(s.id));
  const isQuizStep    = currentStep >= sections.length && sections.length > 0;
  const currentSection = !isQuizStep ? sections[currentStep] : null;

  return (
    <div>
      {/* Module picker (if multiple) */}
      {activeModules.length > 1 && (
        <div style={{ marginBottom: "14px" }}>
          <label style={lbl}>
            Module
            <select style={inp} value={selectedModuleId} onChange={(e) => setSelectedModuleId(e.target.value)}>
              {activeModules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </label>
        </div>
      )}

      {/* Step progress bar */}
      {sections.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
            {sections.map((s, i) => (
              <div
                key={s.id}
                title={s.title}
                style={{
                  flex: 1, height: "4px", borderRadius: "2px",
                  background: viewedIds.includes(s.id) ? COLOURS.GREEN : currentStep === i ? COLOURS.BLUE : COLOURS.TRACK,
                  cursor: "pointer",
                }}
                onClick={() => goToStep(i)}
              />
            ))}
            {questions.length > 0 && (
              <div style={{ width: "20px", height: "4px", borderRadius: "2px", background: isQuizStep ? COLOURS.AMBER : COLOURS.TRACK, cursor: allViewed ? "pointer" : "default" }} onClick={() => { if (allViewed) goToStep(sections.length); }} />
            )}
          </div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
            {isQuizStep ? "Quiz" : `Section ${currentStep + 1} of ${sections.length}`} · {viewedIds.length} of {sections.length} section{sections.length !== 1 ? "s" : ""} viewed
          </div>
        </div>
      )}

      {/* Content area */}
      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "14px" }}>
        {!isQuizStep && currentSection && (
          <div>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "18px" }}>
                {currentSection.section_type === "video" ? "🎬" : currentSection.section_type === "document" ? "📄" : "📝"}
              </span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{currentSection.title}</div>
                <div style={{ fontSize: "12px", color: COLOURS.SLATE, textTransform: "capitalize" }}>{currentSection.section_type}</div>
              </div>
            </div>
            <div style={{ padding: "18px" }}>
              {/* Video */}
              {currentSection.section_type === "video" && currentSection.content_url && (
                <div>
                  <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, borderRadius: RADII.SM, overflow: "hidden", background: "#000", marginBottom: "12px" }}>
                    <iframe
                      src={currentSection.content_url}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
                      allowFullScreen
                      allow="autoplay; fullscreen"
                    />
                  </div>
                  <p style={{ fontSize: "13px", color: COLOURS.SLATE }}>Watch the full video before moving to the next section.</p>
                </div>
              )}
              {currentSection.section_type === "video" && !currentSection.content_url && (
                <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No video link set for this section.</p>
              )}

              {/* Document */}
              {currentSection.section_type === "document" && currentSection.content_url && (
                <div>
                  <p style={{ fontSize: "14px", color: COLOURS.SLATE, marginBottom: "12px" }}>Read the document below, then mark it as viewed to continue.</p>
                  <a
                    href={currentSection.content_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "6px",
                      background: "#EEF1FC", color: "#1e3a8a", border: "1px solid #C7D7F8",
                      borderRadius: RADII.PILL, padding: "8px 16px", fontSize: "13px",
                      fontWeight: 600, textDecoration: "none",
                    }}
                  >
                    📄 Open document in Folder.it →
                  </a>
                </div>
              )}

              {/* Text */}
              {currentSection.section_type === "text" && (
                <div
                  style={{ fontSize: "14px", color: COLOURS.NAVY, lineHeight: 1.7 }}
                  dangerouslySetInnerHTML={{ __html: currentSection.content_text || "" }}
                />
              )}
            </div>
          </div>
        )}

        {/* Quiz */}
        {isQuizStep && !quizSubmitted && (
          <div>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
              <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>📋 Knowledge check</div>
              <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px" }}>Answer all {questions.length} questions. You need 80% to pass.</div>
            </div>
            <div style={{ padding: "18px" }}>
              {questions.map((q, qi) => (
                <div key={q.id} style={{ marginBottom: "24px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "10px" }}>
                    {qi + 1}. {q.question}
                  </div>
                  {q.options.map((opt, oi) => (
                    <div
                      key={oi}
                      onClick={() => setQuizAnswers((prev) => { const a = [...prev]; a[qi] = oi; return a; })}
                      style={{
                        padding: "10px 14px", marginBottom: "6px", borderRadius: RADII.SM, cursor: "pointer",
                        border: `1px solid ${quizAnswers[qi] === oi ? COLOURS.BLUE : COLOURS.HAIRLINE}`,
                        background: quizAnswers[qi] === oi ? "#EEF1FC" : COLOURS.CARD,
                        fontSize: "14px", color: quizAnswers[qi] === oi ? "#1e3a8a" : COLOURS.NAVY,
                        display: "flex", alignItems: "center", gap: "10px",
                      }}
                    >
                      <div style={{
                        width: "16px", height: "16px", borderRadius: "50%", flexShrink: 0,
                        border: `2px solid ${quizAnswers[qi] === oi ? COLOURS.BLUE : COLOURS.SLATE}`,
                        background: quizAnswers[qi] === oi ? COLOURS.BLUE : "transparent",
                      }} />
                      {opt}
                    </div>
                  ))}
                </div>
              ))}
              <button
                onClick={submitQuiz}
                disabled={saving || quizAnswers.some((a) => a === null)}
                style={{ ...btnPrimary, opacity: quizAnswers.some((a) => a === null) ? 0.5 : 1 }}
              >
                {saving ? "Submitting…" : "Submit quiz"}
              </button>
            </div>
          </div>
        )}

        {/* Quiz result */}
        {isQuizStep && quizSubmitted && quizResult && (
          <div style={{ padding: "32px", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>{quizResult.passed ? "🎉" : "📖"}</div>
            <div style={{ fontSize: "22px", fontWeight: 600, color: quizResult.passed ? COLOURS.GREEN : COLOURS.AMBER, marginBottom: "8px" }}>
              {quizResult.passed ? "Orientation complete!" : "Not quite — have another go"}
            </div>
            <div style={{ fontSize: "15px", color: COLOURS.SLATE, marginBottom: "16px" }}>
              You scored <strong>{quizResult.score}%</strong>. {quizResult.passed ? "Well done." : "You need 80% to pass. Review the sections and try again."}
            </div>
            {!quizResult.passed && (
              <button onClick={() => { setQuizSubmitted(false); setQuizAnswers(Array(questions.length).fill(null)); }} style={btnPrimary}>
                Retry quiz
              </button>
            )}
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      {!isQuizStep && sections.length > 0 && !quizSubmitted && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            disabled={currentStep === 0}
            onClick={() => goToStep(currentStep - 1)}
            style={{ ...btnGhost, opacity: currentStep === 0 ? 0.4 : 1 }}
          >
            ← Previous
          </button>
          {currentStep < sections.length - 1 ? (
            <button onClick={() => goToStep(currentStep + 1)} style={btnPrimary}>
              Next →
            </button>
          ) : questions.length > 0 ? (
            <button
              onClick={() => goToStep(sections.length)}
              disabled={!allViewed}
              style={{ ...btnPrimary, opacity: allViewed ? 1 : 0.5 }}
              title={!allViewed ? "View all sections first" : ""}
            >
              Take quiz →
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Sub-view: Manage (admin) ─────────────────────────────────────────────────

function ManageModules({
  modules,
  completions,
  reload,
}: {
  modules: Module[];
  completions: Completion[];
  reload: () => void;
}) {
  const isMobile = useMobile();
  const [showModuleForm, setShowModuleForm] = useState(false);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [sections, setSections]   = useState<Section[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState("");

  // Module form state
  const [mTitle, setMTitle]   = useState("");
  const [mDesc, setMDesc]     = useState("");
  const [mCompany, setMCompany] = useState("");

  // Section form state
  const [showSecForm, setShowSecForm] = useState(false);
  const [secType, setSecType]   = useState<"video" | "document" | "text">("video");
  const [secTitle, setSecTitle] = useState("");
  const [secUrl, setSecUrl]     = useState("");
  const [secText, setSecText]   = useState("");

  // Quiz question form state
  const [showQForm, setShowQForm] = useState(false);
  const [qText, setQText]     = useState("");
  const [qOpts, setQOpts]     = useState(["", "", "", ""]);
  const [qCorrect, setQCorrect] = useState(0);

  function showMsg(t: string) { setMsg(t); setTimeout(() => setMsg(""), 4000); }

  async function loadModuleDetail(mod: Module) {
    setSelectedModule(mod);
    const [{ data: secs }, { data: qs }] = await Promise.all([
      supabase.from("hr_onboarding_sections").select("*").eq("module_id", mod.id).order("order_index"),
      supabase.from("hr_onboarding_quiz_questions").select("*").eq("module_id", mod.id).order("order_index"),
    ]);
    setSections(secs || []);
    setQuestions(qs || []);
  }

  async function saveModule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("hr_onboarding_modules").insert({
      title: mTitle, description: mDesc || null, company_id: mCompany || null, is_active: true,
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "hr_onboarding_modules", mTitle);
    setMTitle(""); setMDesc(""); setMCompany(""); setShowModuleForm(false);
    showMsg("Module created.");
    reload();
  }

  async function toggleActive(mod: Module) {
    await supabase.from("hr_onboarding_modules").update({ is_active: !mod.is_active }).eq("id", mod.id);
    logAction("Updated", "hr_onboarding_modules", `Active → ${!mod.is_active}`, mod.id);
    if (selectedModule?.id === mod.id) setSelectedModule({ ...mod, is_active: !mod.is_active });
    reload();
  }

  async function addSection(e: React.FormEvent) {
    if (!selectedModule) return;
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("hr_onboarding_sections").insert({
      module_id: selectedModule.id,
      order_index: sections.length,
      section_type: secType,
      title: secTitle,
      content_url: secType !== "text" ? (secUrl || null) : null,
      content_text: secType === "text" ? (secText || null) : null,
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "hr_onboarding_sections", secTitle);
    setSecType("video"); setSecTitle(""); setSecUrl(""); setSecText(""); setShowSecForm(false);
    showMsg("Section added.");
    loadModuleDetail(selectedModule);
  }

  async function deleteSection(id: string) {
    if (!confirm("Delete this section?")) return;
    await supabase.from("hr_onboarding_sections").delete().eq("id", id);
    logAction("Deleted", "hr_onboarding_sections", id);
    if (selectedModule) loadModuleDetail(selectedModule);
  }

  async function addQuestion(e: React.FormEvent) {
    if (!selectedModule) return;
    e.preventDefault();
    if (qOpts.some((o) => !o.trim())) { showMsg("Fill in all 4 options."); return; }
    setSaving(true);
    const { error } = await supabase.from("hr_onboarding_quiz_questions").insert({
      module_id: selectedModule.id,
      order_index: questions.length,
      question: qText,
      options: qOpts,
      correct_option: qCorrect,
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "hr_onboarding_quiz_questions", qText.slice(0, 40));
    setQText(""); setQOpts(["", "", "", ""]); setQCorrect(0); setShowQForm(false);
    showMsg("Question added.");
    loadModuleDetail(selectedModule);
  }

  async function deleteQuestion(id: string) {
    if (!confirm("Delete this question?")) return;
    await supabase.from("hr_onboarding_quiz_questions").delete().eq("id", id);
    if (selectedModule) loadModuleDetail(selectedModule);
  }

  const modCompletions = selectedModule ? completions.filter((c) => c.module_id === selectedModule.id) : [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "260px 1fr", gap: "14px" }}>

      {/* Left: module list */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <SectionTitle title="Modules" />
          <button onClick={() => setShowModuleForm(!showModuleForm)} style={btnPrimary}>
            {showModuleForm ? "Cancel" : "+ New"}
          </button>
        </div>

        {msg && (
          <div style={{
            border: `1px solid ${COLOURS.HAIRLINE}`, borderLeft: `4px solid ${msg.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
            borderRadius: RADII.SM, padding: "8px 12px", marginBottom: "10px",
            fontSize: "13px", color: COLOURS.NAVY, backgroundColor: COLOURS.CARD,
          }}>
            {msg}
          </div>
        )}

        {showModuleForm && (
          <form onSubmit={saveModule} style={{ ...cardStyle, padding: "16px", marginBottom: "10px", borderTop: `3px solid ${COLOURS.NAVY}` }}>
            <label style={lbl}>Title <input style={inp} value={mTitle} onChange={(e) => setMTitle(e.target.value)} required placeholder="e.g. UTPL New Joiner Orientation" /></label>
            <label style={{ ...lbl, marginTop: "8px" }}>Description <textarea style={{ ...inp, height: "60px", marginTop: "4px" }} value={mDesc} onChange={(e) => setMDesc(e.target.value)} /></label>
            <label style={{ ...lbl, marginTop: "8px" }}>
              Company
              <select style={{ ...inp, marginTop: "4px" }} value={mCompany} onChange={(e) => setMCompany(e.target.value)}>
                <option value="">All companies</option>
                {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button type="submit" disabled={saving} style={{ ...btnPrimary, marginTop: "10px" }}>{saving ? "Saving…" : "Create module"}</button>
          </form>
        )}

        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
          {modules.length === 0 && (
            <div style={{ padding: "16px", color: COLOURS.SLATE, fontSize: "13px" }}>No modules yet.</div>
          )}
          {modules.map((mod) => (
            <div
              key={mod.id}
              onClick={() => loadModuleDetail(mod)}
              style={{
                padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                background: selectedModule?.id === mod.id ? COLOURS.CARD_ALT : COLOURS.CARD,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{mod.title}</div>
                <span style={{
                  fontSize: "10px", fontWeight: 500, padding: "2px 7px", borderRadius: RADII.PILL,
                  background: mod.is_active ? COLOURS.SUCCESS_SOFT : COLOURS.TRACK,
                  color: mod.is_active ? COLOURS.GREEN : COLOURS.SLATE,
                }}>
                  {mod.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              {mod.description && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>{mod.description}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Right: module detail */}
      {!selectedModule ? (
        <div style={{ ...cardStyle, padding: "32px", textAlign: "center", color: COLOURS.SLATE, fontSize: "14px" }}>
          Select a module on the left to edit its sections, quiz questions, and view completion records.
        </div>
      ) : (
        <div>
          {/* Module header */}
          <div style={{ ...cardStyle, padding: "14px 18px", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: COLOURS.NAVY }}>{selectedModule.title}</div>
              {selectedModule.description && <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px" }}>{selectedModule.description}</div>}
            </div>
            <button onClick={() => toggleActive(selectedModule)} style={btnGhost}>
              {selectedModule.is_active ? "Deactivate" : "Activate"}
            </button>
          </div>

          {/* Sections */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <SectionTitle title="Content sections" />
              <button onClick={() => setShowSecForm(!showSecForm)} style={btnPrimary}>{showSecForm ? "Cancel" : "+ Add section"}</button>
            </div>

            {showSecForm && (
              <form onSubmit={addSection} style={{ ...cardStyle, padding: "14px", marginBottom: "10px", borderTop: `3px solid ${COLOURS.NAVY}` }}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
                  <label style={lbl}>
                    Type
                    <select style={{ ...inp, marginTop: "4px" }} value={secType} onChange={(e) => setSecType(e.target.value as "video" | "document" | "text")}>
                      <option value="video">Video</option>
                      <option value="document">Document (Folder.it)</option>
                      <option value="text">Text / Policy</option>
                    </select>
                  </label>
                  <label style={lbl}>Title <input style={{ ...inp, marginTop: "4px" }} value={secTitle} onChange={(e) => setSecTitle(e.target.value)} required placeholder="e.g. Welcome & Company Overview" /></label>
                </div>
                {(secType === "video" || secType === "document") && (
                  <label style={{ ...lbl, marginTop: "8px" }}>
                    {secType === "video" ? "Video embed URL (Folder.it share link)" : "Document URL (Folder.it link)"}
                    <input style={{ ...inp, marginTop: "4px" }} value={secUrl} onChange={(e) => setSecUrl(e.target.value)} placeholder="https://…" />
                  </label>
                )}
                {secType === "text" && (
                  <label style={{ ...lbl, marginTop: "8px" }}>
                    Content (plain text or HTML)
                    <textarea style={{ ...inp, marginTop: "4px", height: "80px" }} value={secText} onChange={(e) => setSecText(e.target.value)} />
                  </label>
                )}
                <button type="submit" disabled={saving} style={{ ...btnPrimary, marginTop: "10px" }}>{saving ? "Saving…" : "Add section"}</button>
              </form>
            )}

            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
              {sections.length === 0 && <div style={{ padding: "16px", color: COLOURS.SLATE, fontSize: "13px" }}>No sections yet. Add content above.</div>}
              {sections.map((s, idx) => (
                <div key={s.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", alignItems: "center", gap: "10px", backgroundColor: COLOURS.CARD }}>
                  <span style={{ fontSize: "18px" }}>{s.section_type === "video" ? "🎬" : s.section_type === "document" ? "📄" : "📝"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{idx + 1}. {s.title}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, textTransform: "capitalize" }}>{s.section_type}</div>
                  </div>
                  <button onClick={() => deleteSection(s.id)} style={{ ...btnGhost, padding: "4px 10px", fontSize: "12px", color: COLOURS.RED, borderColor: COLOURS.RED }}>Delete</button>
                </div>
              ))}
            </div>
          </div>

          {/* Quiz questions */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <SectionTitle title="Quiz questions" />
              <button onClick={() => setShowQForm(!showQForm)} style={btnPrimary}>{showQForm ? "Cancel" : "+ Add question"}</button>
            </div>

            {showQForm && (
              <form onSubmit={addQuestion} style={{ ...cardStyle, padding: "14px", marginBottom: "10px", borderTop: `3px solid ${COLOURS.NAVY}` }}>
                <label style={lbl}>Question <input style={{ ...inp, marginTop: "4px" }} value={qText} onChange={(e) => setQText(e.target.value)} required placeholder="e.g. What is Unze Group's core business?" /></label>
                <div style={{ marginTop: "10px" }}>
                  <div style={lbl}>Options (select the correct one)</div>
                  {qOpts.map((opt, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                      <input
                        type="radio"
                        name="correct"
                        checked={qCorrect === i}
                        onChange={() => setQCorrect(i)}
                        style={{ width: "16px", height: "16px", flexShrink: 0, cursor: "pointer" }}
                      />
                      <input
                        style={{ ...inp, marginTop: 0 }}
                        value={opt}
                        onChange={(e) => { const a = [...qOpts]; a[i] = e.target.value; setQOpts(a); }}
                        placeholder={`Option ${i + 1}`}
                        required
                      />
                    </div>
                  ))}
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "6px" }}>Select the radio button next to the correct answer.</div>
                </div>
                <button type="submit" disabled={saving} style={{ ...btnPrimary, marginTop: "12px" }}>{saving ? "Saving…" : "Add question"}</button>
              </form>
            )}

            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
              {questions.length === 0 && <div style={{ padding: "16px", color: COLOURS.SLATE, fontSize: "13px" }}>No quiz questions yet.</div>}
              {questions.map((q, idx) => (
                <div key={q.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "6px" }}>{idx + 1}. {q.question}</div>
                      {q.options.map((opt, oi) => (
                        <div key={oi} style={{ fontSize: "12px", color: oi === q.correct_option ? COLOURS.GREEN : COLOURS.SLATE, marginBottom: "2px" }}>
                          {oi === q.correct_option ? "✓ " : "  "}{opt}
                        </div>
                      ))}
                    </div>
                    <button onClick={() => deleteQuestion(q.id)} style={{ ...btnGhost, padding: "4px 10px", fontSize: "12px", color: COLOURS.RED, borderColor: COLOURS.RED, flexShrink: 0 }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Completion records */}
          <div>
            <SectionTitle title="Completion records" />
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden", marginTop: "8px" }}>
              {modCompletions.length === 0 && <div style={{ padding: "16px", color: COLOURS.SLATE, fontSize: "13px" }}>No one has started this module yet.</div>}
              {modCompletions.map((c) => (
                <div key={c.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", backgroundColor: COLOURS.CARD }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{c.member_name || c.member_email}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      Started {formatDateUK(c.started_at)}
                      {c.completed_at ? ` · Completed ${formatDateUK(c.completed_at)}` : ""}
                      {c.quiz_score !== null ? ` · Score: ${c.quiz_score}%` : ""}
                    </div>
                  </div>
                  <span style={{
                    fontSize: "11px", fontWeight: 500, padding: "2px 9px", borderRadius: RADII.PILL,
                    background: c.completed_at ? COLOURS.SUCCESS_SOFT : "#FFF4E5",
                    color: c.completed_at ? COLOURS.GREEN : COLOURS.AMBER,
                  }}>
                    {c.completed_at ? (c.quiz_passed ? `Passed (${c.quiz_score}%)` : "Failed") : "In progress"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function HROnboarding() {
  type InnerTab = "overview" | "orientation" | "manage";
  const [innerTab, setInnerTab] = useState<InnerTab>("overview");
  const [modules,     setModules]     = useState<Module[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [myEmail, setMyEmail]         = useState("");
  const [myName,  setMyName]          = useState<string | null>(null);
  const [myRole,  setMyRole]          = useState<string>("");
  const [loading, setLoading]         = useState(true);

  const loadAll = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || "";
    setMyEmail(email);

    const [{ data: mods }, { data: comps }, { data: member }] = await Promise.all([
      supabase.from("hr_onboarding_modules").select("*").order("created_at", { ascending: false }),
      supabase.from("hr_onboarding_completions").select("*").order("started_at", { ascending: false }),
      supabase.from("members").select("name, role").eq("email", email).maybeSingle(),
    ]);
    setModules(mods || []);
    setCompletions(comps || []);
    if (member) { setMyName(member.name); setMyRole(member.role); }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const myCompletion = completions.find((c) => c.member_email === myEmail) || null;
  const isAdmin      = ["Admin", "CEO", "Manager"].includes(myRole);

  const pillTabStyle = (key: InnerTab): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 500,
    border: `1px solid ${innerTab === key ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    background: innerTab === key ? COLOURS.NAVY : COLOURS.CARD_ALT,
    color: innerTab === key ? COLOURS.CARD : COLOURS.SLATE,
    cursor: "pointer",
  });

  if (loading) return <p style={{ color: COLOURS.SLATE }}>Loading…</p>;

  return (
    <div>
      {/* Inner pill-tab strip */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
        <button style={pillTabStyle("overview")}     onClick={() => setInnerTab("overview")}>Overview</button>
        <button style={pillTabStyle("orientation")}  onClick={() => setInnerTab("orientation")}>Orientation</button>
        {isAdmin && <button style={pillTabStyle("manage")} onClick={() => setInnerTab("manage")}>Manage modules</button>}
      </div>

      {innerTab === "overview" && (
        <Overview
          completions={completions}
          modules={modules}
          myCompletion={myCompletion}
          onStartOrientation={() => setInnerTab("orientation")}
        />
      )}
      {innerTab === "orientation" && (
        <OrientationPlayer
          modules={modules}
          myEmail={myEmail}
          myName={myName}
          existingCompletion={myCompletion}
          onComplete={() => { loadAll(); setInnerTab("overview"); }}
        />
      )}
      {innerTab === "manage" && isAdmin && (
        <ManageModules
          modules={modules}
          completions={completions}
          reload={loadAll}
        />
      )}
    </div>
  );
}
