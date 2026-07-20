"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch, supabase } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import DateInput from "../../../lib/DateInput";
import { useMobile } from "../../../lib/useMobile";
import { useUserCtx } from "../../../lib/useUserCtx";
import {
  COLOURS, RADII, SectionTitle, CountCard, SkeletonRows,
  useToast, primaryButtonStyle, inputStyle,
} from "../../../lib/SharedUI";

// ─── Helpers ─────────────────────────────────────────────────────────────────


function fmtPKR(n: number | null | undefined) {
  if (n == null) return "—";
  return "PKR " + n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

function canWrite(role: string | null | undefined) {
  return role === "Admin" || role === "CEO" || role === "Manager";
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS    = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ─── Types ───────────────────────────────────────────────────────────────────

type TdSummary = {
  planned_this_month:   number;
  completed_this_month: number;
  total_attendees_ytd:  number;
  total_cost_ytd:       number;
  avg_feedback_score:   number | null;
  upcoming_count:       number;
};

type CalSession = {
  session_id:     string;
  company_name:   string;
  title:          string;
  session_type:   string;
  department:     string | null;
  trainer:        string | null;
  session_date:   string;
  duration_hours: number | null;
  status:         string;
  cost_pkr:       number | null;
  attendee_count: number;
  attended_count: number;
  feedback_count: number;
  avg_rating:     number | null;
};

type Attendee = {
  id:            string;
  employee_name: string;
  employee_id:   string | null;
  department:    string | null;
  attended:      boolean | null;
  passed:        boolean | null;
  certificate_url: string | null;
  notes:         string | null;
};

type FeedbackRow = {
  id:               string;
  employee_name:    string;
  overall_rating:   number;
  content_rating:   number | null;
  trainer_rating:   number | null;
  relevance_rating: number | null;
  comments:         string | null;
  submitted_at:     string;
};

type FullSession = CalSession & {
  notes:              string | null;
  max_attendees:      number | null;
  location:           string | null;
  feedback_sheet_id:  string | null;
  feedback_synced_at: string | null;
  company_id:         string;
  attendees:          Attendee[];
  feedback:           FeedbackRow[];
};

// ─── Star rating display ──────────────────────────────────────────────────────

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span style={{ color: COLOURS.SLATE }}>—</span>;
  return (
    <span title={`${rating}/5`}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= Math.round(rating) ? COLOURS.AMBER : COLOURS.HAIRLINE, fontSize: "14px" }}>★</span>
      ))}
      <span style={{ fontSize: "11px", color: COLOURS.SLATE, marginLeft: "4px" }}>{rating.toFixed(1)}</span>
    </span>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    Planned:   { bg: COLOURS.INFO_SOFT,    color: COLOURS.BLUE   },
    Completed: { bg: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN  },
    Cancelled: { bg: COLOURS.DANGER_SOFT,  color: COLOURS.RED    },
  };
  const c = map[status] ?? { bg: COLOURS.HAIRLINE, color: COLOURS.SLATE };
  return (
    <span style={{
      fontSize: "11px", fontWeight: 700, padding: "2px 8px",
      borderRadius: RADII.PILL, backgroundColor: c.bg, color: c.color, whiteSpace: "nowrap",
    }}>{status}</span>
  );
}

// ─── Session detail panel ─────────────────────────────────────────────────────

function SessionDetail({
  session,
  userRole,
  onClose,
  onRefresh,
}: {
  session: FullSession;
  userRole: string | null | undefined;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { show, element } = useToast();
  const [innerTab, setInnerTab] = useState<"info"|"attendees"|"feedback">("info");
  const [syncing, setSyncing] = useState(false);
  const [addingAttendee, setAddingAttendee] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDept, setNewDept] = useState("");

  async function syncFeedback() {
    setSyncing(true);
    try {
      const res  = await authFetch("/api/hr/td/sync-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: session.session_id }),
      });
      const json = await res.json();
      if (!res.ok) { show(json.error ?? "Sync failed.", "error"); return; }
      const r = json.results?.[0];
      show(r ? `Synced ${r.synced} feedback responses.` : "No new responses found.", "success");
      onRefresh();
    } finally {
      setSyncing(false);
    }
  }

  async function markAttendance(attendeeId: string, attended: boolean) {
    const { error } = await supabase
      .from("hr_td_attendees")
      .update({ attended })
      .eq("id", attendeeId);
    if (error) { show(error.message, "error"); return; }
    onRefresh();
  }

  async function addAttendee() {
    if (!newName.trim()) return;
    const { error } = await supabase.from("hr_td_attendees").insert({
      session_id: session.session_id,
      employee_name: newName.trim(),
      department: newDept.trim() || null,
    });
    if (error) { show(error.message, "error"); return; }
    setNewName(""); setNewDept(""); setAddingAttendee(false);
    onRefresh();
  }

  async function updateStatus(status: string) {
    const { error } = await supabase
      .from("hr_td_sessions")
      .update({ status })
      .eq("id", session.session_id);
    if (error) { show(error.message, "error"); return; }
    show(`Session marked as ${status}.`, "success");
    onRefresh();
  }

  const pillStyle = (tab: typeof innerTab): React.CSSProperties => ({
    padding: "4px 12px", fontSize: "12px", fontWeight: 600, borderRadius: RADII.PILL,
    border: `1px solid ${innerTab === tab ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: innerTab === tab ? COLOURS.NAVY : "white",
    color: innerTab === tab ? "white" : COLOURS.SLATE,
    cursor: "pointer",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, backgroundColor: "rgba(15,23,32,0.4)",
      display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
      zIndex: 200, padding: "16px",
    }}>
      {element}
      <div style={{
        background: "white", borderRadius: RADII.CARD,
        width: "560px", maxWidth: "100%", maxHeight: "calc(100vh - 32px)",
        overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY }}>{session.title}</div>
            <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px" }}>
              {formatDateUK(session.session_date)} · {session.company_name}
              {session.department && ` · ${session.department}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: COLOURS.SLATE }}>×</button>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <StatusPill status={session.status} />
          <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{session.session_type}</span>
          {session.trainer && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>· {session.trainer}</span>}
          {session.duration_hours && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>· {session.duration_hours}h</span>}
          {session.cost_pkr != null && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>· {fmtPKR(session.cost_pkr)}</span>}
        </div>

        {/* Action buttons */}
        {canWrite(userRole) && session.status === "Planned" && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => updateStatus("Completed")} style={{
              ...primaryButtonStyle, backgroundColor: COLOURS.GREEN,
            }}>Mark Completed</button>
            <button onClick={() => updateStatus("Cancelled")} style={{
              padding: "8px 14px", fontSize: "13px", fontWeight: 600,
              border: `1px solid ${COLOURS.RED}`, borderRadius: RADII.CARD,
              color: COLOURS.RED, background: "white", cursor: "pointer",
            }}>Cancel</button>
          </div>
        )}

        {/* Inner tabs */}
        <div style={{ display: "flex", gap: "6px" }}>
          {(["info","attendees","feedback"] as const).map(t => (
            <button key={t} style={pillStyle(t)} onClick={() => setInnerTab(t)}>
              {t === "info" ? "Info" : t === "attendees" ? `Attendees (${session.attendee_count})` : `Feedback (${session.feedback_count})`}
            </button>
          ))}
        </div>

        {/* Info tab */}
        {innerTab === "info" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
            {session.location && <div><span style={{ color: COLOURS.SLATE }}>Location:</span> {session.location}</div>}
            {session.max_attendees && <div><span style={{ color: COLOURS.SLATE }}>Max attendees:</span> {session.max_attendees}</div>}
            {session.notes && <div style={{ color: COLOURS.SLATE, fontStyle: "italic" }}>{session.notes}</div>}
            <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "12px" }}>
              <div style={{ fontWeight: 600, fontSize: "12px", color: COLOURS.NAVY, marginBottom: "8px" }}>
                Google Forms Feedback Integration
              </div>
              {session.feedback_sheet_id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                    Sheet ID: <code style={{ backgroundColor: COLOURS.HAIRLINE, padding: "1px 4px", borderRadius: "4px" }}>{session.feedback_sheet_id}</code>
                  </div>
                  {session.feedback_synced_at && (
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                      Last synced: {formatDateUK(session.feedback_synced_at.split("T")[0])}
                    </div>
                  )}
                  <button onClick={syncFeedback} disabled={syncing} style={primaryButtonStyle}>
                    {syncing ? "Syncing…" : "Sync Feedback Now"}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                  No Google Sheet linked. Edit the session to add the Sheet ID from your Google Form.
                </div>
              )}
            </div>
            <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "12px" }}>
              <div style={{ display: "flex", gap: "16px" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: COLOURS.NAVY }}>{session.attended_count}</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Attended</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: COLOURS.NAVY }}>{session.feedback_count}</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Feedback</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: session.avg_rating ? COLOURS.AMBER : COLOURS.SLATE }}>
                    {session.avg_rating ? session.avg_rating.toFixed(1) : "—"}
                  </div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Avg Rating</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Attendees tab */}
        {innerTab === "attendees" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {session.attendees.length === 0 ? (
              <div style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No attendees added yet.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr>
                    {["Name","Department","Attended","Passed"].map(h => (
                      <th key={h} style={{
                        padding: "6px 8px", textAlign: "left", fontSize: "11px",
                        fontWeight: 700, color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {session.attendees.map(a => (
                    <tr key={a.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                      <td style={{ padding: "8px", fontWeight: 500 }}>{a.employee_name}</td>
                      <td style={{ padding: "8px", color: COLOURS.SLATE }}>{a.department ?? "—"}</td>
                      <td style={{ padding: "8px" }}>
                        {canWrite(userRole) ? (
                          <select
                            value={a.attended === null ? "" : a.attended ? "yes" : "no"}
                            onChange={e => {
                              if (e.target.value === "") return;
                              markAttendance(a.id, e.target.value === "yes");
                            }}
                            style={{ ...inputStyle, padding: "3px 6px", fontSize: "12px" }}
                          >
                            <option value="">Not recorded</option>
                            <option value="yes">✓ Attended</option>
                            <option value="no">✗ Absent</option>
                          </select>
                        ) : (
                          <span>{a.attended === null ? "—" : a.attended ? "✓" : "✗"}</span>
                        )}
                      </td>
                      <td style={{ padding: "8px", color: COLOURS.SLATE }}>
                        {a.passed === null ? "—" : a.passed ? "✓ Passed" : "✗ Failed"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canWrite(userRole) && (
              addingAttendee ? (
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="Employee name" style={{ ...inputStyle, flex: 1, minWidth: "140px" }}
                  />
                  <input
                    value={newDept} onChange={e => setNewDept(e.target.value)}
                    placeholder="Department (optional)" style={{ ...inputStyle, flex: 1, minWidth: "120px" }}
                  />
                  <button onClick={addAttendee} style={primaryButtonStyle}>Add</button>
                  <button onClick={() => setAddingAttendee(false)} style={{
                    padding: "8px 12px", fontSize: "13px", border: `1px solid ${COLOURS.HAIRLINE}`,
                    borderRadius: RADII.CARD, background: "white", cursor: "pointer", color: COLOURS.SLATE,
                  }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setAddingAttendee(true)} style={{
                  alignSelf: "flex-start", padding: "7px 14px", fontSize: "13px", fontWeight: 600,
                  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
                  background: "white", cursor: "pointer", color: COLOURS.NAVY,
                }}>+ Add Attendee</button>
              )
            )}
          </div>
        )}

        {/* Feedback tab */}
        {innerTab === "feedback" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {session.feedback.length === 0 ? (
              <div style={{ color: COLOURS.SLATE, fontSize: "13px" }}>
                No feedback yet.{session.feedback_sheet_id
                  ? " Click 'Sync Feedback Now' on the Info tab to pull from Google Forms."
                  : " Link a Google Form Sheet ID to enable automatic feedback collection."}
              </div>
            ) : (
              <>
                {/* Aggregate */}
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px",
                  padding: "12px", backgroundColor: "#F8FAFC",
                  borderRadius: RADII.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
                }}>
                  {[
                    { label: "Overall",   val: session.avg_rating },
                    { label: "Content",   val: session.feedback.reduce((s,f) => s + (f.content_rating ?? 0), 0) / session.feedback.filter(f => f.content_rating).length || null },
                    { label: "Trainer",   val: session.feedback.reduce((s,f) => s + (f.trainer_rating ?? 0), 0) / session.feedback.filter(f => f.trainer_rating).length || null },
                    { label: "Relevance", val: session.feedback.reduce((s,f) => s + (f.relevance_rating ?? 0), 0) / session.feedback.filter(f => f.relevance_rating).length || null },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: COLOURS.AMBER }}>
                        {val ? val.toFixed(1) : "—"}
                      </div>
                      <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>{label}</div>
                    </div>
                  ))}
                </div>
                {/* Individual rows */}
                {session.feedback.map(f => (
                  <div key={f.id} style={{
                    border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "12px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px", color: COLOURS.NAVY }}>{f.employee_name}</span>
                      <Stars rating={f.overall_rating} />
                    </div>
                    <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: COLOURS.SLATE, flexWrap: "wrap" }}>
                      {f.content_rating   != null && <span>Content: {f.content_rating}/5</span>}
                      {f.trainer_rating   != null && <span>Trainer: {f.trainer_rating}/5</span>}
                      {f.relevance_rating != null && <span>Relevance: {f.relevance_rating}/5</span>}
                    </div>
                    {f.comments && (
                      <div style={{ marginTop: "6px", fontSize: "13px", color: COLOURS.INK_700, fontStyle: "italic" }}>
                        "{f.comments}"
                      </div>
                    )}
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "4px" }}>
                      Submitted {formatDateUK(f.submitted_at.split("T")[0])}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Add Session Form ─────────────────────────────────────────────────────────

function AddSessionForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { show, element } = useToast();
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    company_id:       "",
    title:            "",
    session_type:     "Internal",
    department:       "",
    trainer:          "",
    session_date:     "",
    duration_hours:   "",
    location:         "",
    cost_pkr:         "",
    max_attendees:    "",
    notes:            "",
    feedback_sheet_id: "",
  });

  useEffect(() => {
    supabase.from("companies").select("id, name").then(({ data }) => {
      if (data) setCompanies(data);
      if (data?.[0] && !form.company_id) setForm(p => ({ ...p, company_id: data[0].id }));
    });
  }, []);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const labelStyle: React.CSSProperties = {
    fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, display: "block", marginBottom: "4px",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.session_date || !form.company_id) {
      show("Title, company, and date are required.", "error"); return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("hr_td_sessions").insert({
        company_id:        form.company_id,
        title:             form.title.trim(),
        session_type:      form.session_type,
        department:        form.department.trim() || null,
        trainer:           form.trainer.trim() || null,
        session_date:      form.session_date,
        duration_hours:    form.duration_hours ? parseFloat(form.duration_hours) : null,
        location:          form.location.trim() || null,
        cost_pkr:          form.cost_pkr ? parseFloat(form.cost_pkr) : null,
        max_attendees:     form.max_attendees ? parseInt(form.max_attendees, 10) : null,
        notes:             form.notes.trim() || null,
        feedback_sheet_id: form.feedback_sheet_id.trim() || null,
      });
      if (error) { show(error.message, "error"); return; }
      show("Session created.", "success");
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
          New Training Session
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Session Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} required style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="e.g. Customer Service Excellence" />
          </div>
          <div>
            <label style={labelStyle}>Company *</label>
            <select value={form.company_id} onChange={e => set("company_id", e.target.value)} required style={inputStyle}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={form.session_type} onChange={e => set("session_type", e.target.value)} style={inputStyle}>
              <option value="Internal">Internal</option>
              <option value="External">External</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Date *</label>
            <DateInput value={form.session_date} onChange={e => set("session_date", e.target.value)} placeholder="DD/MM/YYYY" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Duration (hours)</label>
            <input type="number" min="0.5" step="0.5" value={form.duration_hours} onChange={e => set("duration_hours", e.target.value)} placeholder="e.g. 3" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <input value={form.department} onChange={e => set("department", e.target.value)} placeholder="e.g. Production, HR" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Trainer / Provider</label>
            <input value={form.trainer} onChange={e => set("trainer", e.target.value)} placeholder="e.g. Ahmed Ali" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Location</label>
            <input value={form.location} onChange={e => set("location", e.target.value)} placeholder="e.g. Head Office, Room 3" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max Attendees</label>
            <input type="number" min="1" value={form.max_attendees} onChange={e => set("max_attendees", e.target.value)} placeholder="Optional" style={inputStyle} />
          </div>
          {form.session_type === "External" && (
            <div>
              <label style={labelStyle}>Cost (PKR)</label>
              <input type="number" min="0" value={form.cost_pkr} onChange={e => set("cost_pkr", e.target.value)} placeholder="Optional" style={inputStyle} />
            </div>
          )}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Google Forms Feedback Sheet ID</label>
            <input
              value={form.feedback_sheet_id}
              onChange={e => set("feedback_sheet_id", e.target.value)}
              placeholder="Paste the Sheet ID from the URL: docs.google.com/spreadsheets/d/[SHEET_ID]/edit"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px" }}>
              Create a Google Form for feedback → open the linked Sheet → copy the ID from the URL. Feedback will sync automatically every hour.
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" }}>
          <button type="button" onClick={onCancel} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600,
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
            background: "white", cursor: "pointer", color: COLOURS.SLATE,
          }}>Cancel</button>
          <button type="submit" disabled={saving} style={primaryButtonStyle}>
            {saving ? "Saving…" : "Create Session"}
          </button>
        </div>
      </form>
    </>
  );
}

// ─── Calendar Tab ─────────────────────────────────────────────────────────────

function CalendarTab({
  userRole,
  onSelectSession,
}: {
  userRole: string | null | undefined;
  onSelectSession: (id: string) => void;
}) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [sessions, setSessions] = useState<CalSession[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("get_td_calendar", { p_year: year, p_month: month });
    setSessions((data as CalSession[]) ?? []);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  // Monday=0 offset
  let startOffset = (firstDay.getDay() + 6) % 7;

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const sessionsByDay: Record<number, CalSession[]> = {};
  for (const s of sessions) {
    const day = parseInt(s.session_date.split("-")[2], 10);
    if (!sessionsByDay[day]) sessionsByDay[day] = [];
    sessionsByDay[day].push(s);
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  const STATUS_DOT: Record<string, string> = {
    Planned:   COLOURS.BLUE,
    Completed: COLOURS.GREEN,
    Cancelled: COLOURS.RED,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Nav */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button onClick={prevMonth} style={{
          padding: "6px 10px", fontSize: "13px", border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.CARD, background: "white", cursor: "pointer",
        }}>←</button>
        <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY, minWidth: "160px", textAlign: "center" }}>
          {MONTH_NAMES[month - 1]} {year}
        </div>
        <button onClick={nextMonth} style={{
          padding: "6px 10px", fontSize: "13px", border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.CARD, background: "white", cursor: "pointer",
        }}>→</button>
        <div style={{ marginLeft: "auto", fontSize: "12px", color: COLOURS.SLATE, display: "flex", gap: "10px" }}>
          {Object.entries(STATUS_DOT).map(([s, col]) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: col, display: "inline-block" }} />
              {s}
            </span>
          ))}
        </div>
      </div>

      {loading ? <SkeletonRows count={5} /> : (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", backgroundColor: "#F8FAFC" }}>
            {WEEKDAYS.map(d => (
              <div key={d} style={{
                padding: "8px 0", textAlign: "center", fontSize: "11px",
                fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase",
                borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
              }}>{d}</div>
            ))}
          </div>
          {/* Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {cells.map((day, i) => {
              const isToday = day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear();
              const daySessions = day ? (sessionsByDay[day] ?? []) : [];
              return (
                <div
                  key={i}
                  style={{
                    minHeight: "80px", padding: "6px",
                    borderRight: (i + 1) % 7 !== 0 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
                    borderBottom: i < cells.length - 7 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
                    backgroundColor: !day ? "#FAFAFA" : "white",
                  }}
                >
                  {day && (
                    <>
                      <div style={{
                        fontSize: "12px", fontWeight: isToday ? 700 : 400,
                        color: isToday ? "white" : COLOURS.NAVY,
                        width: "22px", height: "22px", borderRadius: "50%",
                        backgroundColor: isToday ? COLOURS.NAVY : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        marginBottom: "4px",
                      }}>{day}</div>
                      {daySessions.map(s => (
                        <div
                          key={s.session_id}
                          onClick={() => onSelectSession(s.session_id)}
                          title={s.title}
                          style={{
                            fontSize: "10px", fontWeight: 600, padding: "2px 5px",
                            borderRadius: "4px", marginBottom: "2px",
                            backgroundColor: STATUS_DOT[s.status] + "20",
                            color: STATUS_DOT[s.status],
                            cursor: "pointer", overflow: "hidden",
                            whiteSpace: "nowrap", textOverflow: "ellipsis",
                          }}
                        >
                          {s.title}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sessions List Tab ────────────────────────────────────────────────────────

function SessionsTab({
  userRole,
  onSelectSession,
}: {
  userRole: string | null | undefined;
  onSelectSession: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<CalSession[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [filterType, setFilterType]     = useState<string>("All");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("hr_td_sessions")
      .select(`
        id, title, session_type, department, trainer, session_date,
        duration_hours, status, cost_pkr, company_id,
        companies!inner(name)
      `)
      .order("session_date", { ascending: false })
      .limit(200);

    if (data) {
      const rows = (data as unknown[]).map((r: unknown) => {
        const row = r as Record<string, unknown>;
        const companies = row.companies as Record<string, unknown>;
        return {
          session_id:     row.id as string,
          company_id:     row.company_id as string,
          company_name:   companies?.name as string ?? "",
          title:          row.title as string,
          session_type:   row.session_type as string,
          department:     row.department as string | null,
          trainer:        row.trainer as string | null,
          session_date:   row.session_date as string,
          duration_hours: row.duration_hours as number | null,
          status:         row.status as string,
          cost_pkr:       row.cost_pkr as number | null,
          attendee_count: 0,
          attended_count: 0,
          feedback_count: 0,
          avg_rating:     null,
        } as CalSession;
      });
      setSessions(rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = sessions.filter(s =>
    (filterStatus === "All" || s.status === filterStatus) &&
    (filterType   === "All" || s.session_type === filterType)
  );

  const pillFilter = (active: string, val: string, set: (v: string) => void): React.CSSProperties => ({
    padding: "4px 10px", fontSize: "12px", fontWeight: 600, borderRadius: RADII.PILL,
    border: `1px solid ${active === val ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: active === val ? COLOURS.NAVY : "white",
    color: active === val ? "white" : COLOURS.SLATE, cursor: "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {["All","Planned","Completed","Cancelled"].map(s => (
          <button key={s} style={pillFilter(filterStatus, s, setFilterStatus)} onClick={() => setFilterStatus(s)}>{s}</button>
        ))}
        <div style={{ width: "1px", backgroundColor: COLOURS.HAIRLINE, margin: "0 4px" }} />
        {["All","Internal","External"].map(t => (
          <button key={t} style={pillFilter(filterType, t, setFilterType)} onClick={() => setFilterType(t)}>{t}</button>
        ))}
      </div>

      {loading ? <SkeletonRows count={8} /> : (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC" }}>
                {["Date","Title","Company","Type","Department","Trainer","Status","Duration"].map(h => (
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
              {filtered.map(s => (
                <tr
                  key={s.session_id}
                  onClick={() => onSelectSession(s.session_id)}
                  style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#F8FAFC")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "")}
                >
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{formatDateUK(s.session_date)}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: COLOURS.NAVY }}>{s.title}</td>
                  <td style={{ padding: "10px 12px", color: COLOURS.SLATE }}>{s.company_name}</td>
                  <td style={{ padding: "10px 12px", color: COLOURS.SLATE }}>{s.session_type}</td>
                  <td style={{ padding: "10px 12px", color: COLOURS.SLATE }}>{s.department ?? "—"}</td>
                  <td style={{ padding: "10px 12px", color: COLOURS.SLATE }}>{s.trainer ?? "—"}</td>
                  <td style={{ padding: "10px 12px" }}><StatusPill status={s.status} /></td>
                  <td style={{ padding: "10px 12px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>
                    {s.duration_hours ? `${s.duration_hours}h` : "—"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "40px", textAlign: "center", color: COLOURS.SLATE }}>
                    No sessions found.
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

// ─── Main export ─────────────────────────────────────────────────────────────

type TdInnerTab = "calendar" | "sessions" | "add";
const INNER_TABS: { key: TdInnerTab; label: string }[] = [
  { key: "calendar",  label: "Calendar" },
  { key: "sessions",  label: "All Sessions" },
  { key: "add",       label: "+ Add Session" },
];

export default function HRTraining() {
  const { ctx: member } = useUserCtx();
  const [activeTab, setActiveTab]     = useState<TdInnerTab>("calendar");
  const [summary, setSummary]         = useState<TdSummary | null>(null);
  const [summaryLoading, setLoading]  = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession]     = useState<FullSession | null>(null);
  const [loadingDetail, setLoadingDetail]         = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("get_td_summary");
    if (data?.[0]) setSummary(data[0] as TdSummary);
    setLoading(false);
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary, refreshKey]);

  // Load full session detail when selected
  useEffect(() => {
    if (!selectedSessionId) { setSelectedSession(null); return; }
    (async () => {
      setLoadingDetail(true);
      const [{ data: sess }, { data: attendees }, { data: feedback }] = await Promise.all([
        supabase.from("hr_td_sessions").select("*, companies(name)").eq("id", selectedSessionId).single(),
        supabase.from("hr_td_attendees").select("*").eq("session_id", selectedSessionId).order("employee_name"),
        supabase.from("hr_td_feedback").select("*").eq("session_id", selectedSessionId).order("submitted_at", { ascending: false }),
      ]);

      if (sess) {
        const s = sess as Record<string, unknown>;
        const companies = s.companies as Record<string, unknown>;
        setSelectedSession({
          session_id:         s.id as string,
          company_id:         s.company_id as string,
          company_name:       companies?.name as string ?? "",
          title:              s.title as string,
          session_type:       s.session_type as string,
          department:         s.department as string | null,
          trainer:            s.trainer as string | null,
          session_date:       s.session_date as string,
          duration_hours:     s.duration_hours as number | null,
          status:             s.status as string,
          cost_pkr:           s.cost_pkr as number | null,
          notes:              s.notes as string | null,
          location:           s.location as string | null,
          max_attendees:      s.max_attendees as number | null,
          feedback_sheet_id:  s.feedback_sheet_id as string | null,
          feedback_synced_at: s.feedback_synced_at as string | null,
          attendees:          (attendees ?? []) as Attendee[],
          feedback:           (feedback ?? []) as FeedbackRow[],
          attendee_count:     (attendees ?? []).length,
          attended_count:     (attendees ?? []).filter((a: unknown) => (a as Attendee).attended).length,
          feedback_count:     (feedback ?? []).length,
          avg_rating:         feedback && feedback.length > 0
            ? parseFloat((feedback.reduce((s: number, f: unknown) => s + ((f as FeedbackRow).overall_rating ?? 0), 0) / feedback.length).toFixed(1))
            : null,
        });
      }
      setLoadingDetail(false);
    })();
  }, [selectedSessionId, refreshKey]);

  const pillStyle = (key: TdInnerTab): React.CSSProperties => ({
    padding: "5px 14px", fontSize: "12px", fontWeight: 600, borderRadius: RADII.PILL,
    border: `1px solid ${activeTab === key ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: activeTab === key ? COLOURS.NAVY : "white",
    color: activeTab === key ? "white" : COLOURS.SLATE, cursor: "pointer",
  });

  const handleSessionSelected = (id: string) => {
    setSelectedSessionId(id);
  };

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* KPI cards */}
      {summaryLoading ? <SkeletonRows count={1} /> : summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "10px" }}>
          <CountCard label="Upcoming"          value={summary.upcoming_count}         color={COLOURS.BLUE}  />
          <CountCard label="Planned (month)"   value={summary.planned_this_month}     color={COLOURS.AMBER} />
          <CountCard label="Completed (month)" value={summary.completed_this_month}   color={COLOURS.GREEN} />
          <CountCard label="Trained YTD"       value={summary.total_attendees_ytd}    color={COLOURS.NAVY}  />
          <CountCard label="Cost YTD"          value={fmtPKR(summary.total_cost_ytd)} color={COLOURS.SLATE} />
          <CountCard label="Avg Feedback"      value={summary.avg_feedback_score ? `${summary.avg_feedback_score}/5` : "—"} color={COLOURS.AMBER} />
        </div>
      )}

      {/* Tab strip */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {INNER_TABS.filter(t => t.key !== "add" || canWrite(member?.role)).map(t => (
          <button key={t.key} style={pillStyle(t.key)} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "calendar" && (
        <CalendarTab userRole={member?.role} onSelectSession={handleSessionSelected} />
      )}
      {activeTab === "sessions" && (
        <SessionsTab userRole={member?.role} onSelectSession={handleSessionSelected} />
      )}
      {activeTab === "add" && canWrite(member?.role) && (
        <AddSessionForm
          onSuccess={() => { setActiveTab("sessions"); handleRefresh(); }}
          onCancel={() => setActiveTab("sessions")}
        />
      )}

      {/* Session detail panel */}
      {selectedSessionId && (
        loadingDetail ? null : selectedSession && (
          <SessionDetail
            session={selectedSession}
            userRole={member?.role}
            onClose={() => setSelectedSessionId(null)}
            onRefresh={handleRefresh}
          />
        )
      )}
    </div>
  );
}
