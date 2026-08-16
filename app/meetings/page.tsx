"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { useRequireCapability } from "../lib/useRouteGuard";
import {
  COLOURS,
  RADII,
  cardStyle,
  SectionTitle,
  PageHeader,
  PriorityBadge,
  StatusBadge,
  CountCard,
  primaryButtonStyle,
  labelStyle,
  inputStyle,
  useConfirm,
  TASK_DESCRIPTION_LIMIT,
  TASK_COMPANY_CODES,
  fixedCols,
  cardGrid,
} from "../lib/SharedUI";

type ExtractedMinutes = {
  meeting_title: string;
  meeting_date: string;
  company: string;
  department: string;
  attendees: string[];
  executive_summary: string;
  decisions: string[];
  risks: string[];
  opportunities: string[];
  action_items: {
    title: string;       // short task title, ≤80 chars
    notes?: string;      // full detail / context
    owner_name: string;
    due_date?: string;
    priority: string;
    department?: string;
    company_id?: string;
  }[];
};

type Meeting = {
  id: string;
  meeting_date: string;
  title: string;
  executive_summary: string | null;
  decisions: string[] | null;
  risks: string[] | null;
  opportunities: string[] | null;
  attendees: string[] | null;
  department: string | null;
  company: string | null;
  created_at: string;
  mind_map_url: string | null;
};

type PendingMinute = {
  id: string;
  gmail_message_id: string;
  subject: string | null;
  from_address: string | null;
  email_date: string | null;
  raw_text: string;
  status: string;
  created_at: string;
  source_type: string | null;
  extracted_data: ExtractedMinutes | null;
  pa_approved_by: string | null;
  pa_approved_at: string | null;
};

type MeetingTask = {
  id: string;
  description: string;
  assigned_to: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  meeting_id: string | null;
};

const DEPT_ACCENT: Record<string, string> = {
  "Finance": COLOURS.GREEN,
  "HR": COLOURS.AMBER,
  "Admin": COLOURS.SLATE,
  "Audit": COLOURS.RED,
  "Taxation": COLOURS.RED,
  "IT": COLOURS.BLUE,
  "Unze Trading Ops": COLOURS.BLUE,
  "Unze Group": COLOURS.NAVY,
};
function deptAccent(dept: string) { return DEPT_ACCENT[dept] || COLOURS.SLATE; }

/** Returns the next Mon–Fri after the given ISO date (or today if omitted). */
function nextWorkingDay(fromIso?: string): string {
  const d = fromIso ? new Date(fromIso + "T00:00:00") : new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Extract the HTML for the "Meeting Notes / Executive Summary" section from
 * mammoth's HTML output, stopping before the next major heading.
 * Browser-only (uses DOMParser).
 */
function extractHtmlSummarySection(html: string): string | null {
  if (typeof window === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const summaryHeading = Array.from(doc.querySelectorAll("h1,h2,h3,h4")).find((el) =>
    /meeting\s*notes?|executive\s*summary|summary|overview/i.test(el.textContent || "")
  );
  if (!summaryHeading) return null;
  const endKeywords = /next\s*arrangements?|action\s*items?|decisions?|risks?|opportunities?|agenda|attendees?/i;
  let content = "";
  let el = summaryHeading.nextElementSibling;
  while (el) {
    const tag = el.tagName.toLowerCase();
    if (["h1", "h2", "h3", "h4"].includes(tag) && endKeywords.test(el.textContent || "")) break;
    content += el.outerHTML;
    el = el.nextElementSibling;
  }
  return content.trim() || null;
}

/**
 * Add inline styles to mammoth HTML elements so the formatted summary
 * renders correctly inside the app's inline-styled environment.
 */
function addInlineStylesToHtml(html: string): string {
  return html
    .replace(/<p>/gi, '<p style="margin:4px 0;font-size:12px;color:#475569;line-height:1.6">')
    .replace(/<strong>/gi, '<strong style="font-weight:700;color:#0F1720">')
    .replace(/<b>/gi, '<b style="font-weight:700;color:#0F1720">')
    .replace(/<em>/gi, '<em style="font-style:italic">')
    .replace(/<i>/gi, '<i style="font-style:italic">')
    .replace(/<ul>/gi, '<ul style="padding-left:18px;margin:4px 0">')
    .replace(/<ol>/gi, '<ol style="padding-left:18px;margin:4px 0">')
    .replace(/<li>/gi, '<li style="font-size:12px;color:#475569;margin-bottom:3px">')
    .replace(/<h1>/gi, '<h1 style="font-size:11px;font-weight:700;color:#0F1720;text-transform:uppercase;letter-spacing:0.06em;margin:8px 0 4px">')
    .replace(/<h2>/gi, '<h2 style="font-size:11px;font-weight:700;color:#0F1720;text-transform:uppercase;letter-spacing:0.06em;margin:6px 0 4px">')
    .replace(/<h3>/gi, '<h3 style="font-size:11px;font-weight:700;color:#0F1720;margin:5px 0 3px">');
}

function taskDotColour(status: string) {
  if (status === "Completed") return COLOURS.GREEN;
  if (status === "In Progress") return COLOURS.RED;
  return COLOURS.AMBER;
}

type MeetingEditDraft = {
  title: string;
  meeting_date: string;
  company: string;
  department: string;
  attendees: string[];
  executive_summary: string;
  decisions: string[];
  risks: string[];
  opportunities: string[];
};

function MeetingCard({
  m, mTasks, completedTasks, openTaskCount, isOpen, setExpandedId, downloadMinutesPDF, isMobile,
  onEditSaved, onDelete,
}: {
  m: Meeting;
  mTasks: MeetingTask[];
  completedTasks: number;
  openTaskCount: number;
  isOpen: boolean;
  setExpandedId: (id: string | null) => void;
  downloadMinutesPDF: (m: Meeting, tasks: MeetingTask[]) => void;
  isMobile: boolean;
  showDept: boolean;
  onEditSaved: (updated: Meeting) => void;
  onDelete: (id: string) => void;
}) {
  const pct = mTasks.length ? Math.round((completedTasks / mTasks.length) * 100) : 0;
  const barColour = pct === 100 ? COLOURS.GREEN : pct > 0 ? COLOURS.AMBER : COLOURS.BORDER;
  const dlg = useConfirm();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<MeetingEditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editMsg, setEditMsg] = useState("");

  function startEdit() {
    setDraft({
      title: m.title,
      meeting_date: m.meeting_date,
      company: m.company || "Unze Group",
      department: m.department || "Unze Group",
      attendees: m.attendees || [],
      executive_summary: m.executive_summary || "",
      decisions: m.decisions || [],
      risks: m.risks || [],
      opportunities: m.opportunities || [],
    });
    setIsEditing(true);
    setEditMsg("");
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setEditMsg("");
    try {
      const res = await authFetch(`/api/meetings/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditMsg("Error: " + (data.error || "Save failed"));
      } else {
        onEditSaved({ ...m, ...draft });
        setIsEditing(false);
        setDraft(null);
      }
    } catch {
      setEditMsg("Error: Network error");
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!await dlg.confirm(`Delete "${m.title}"? This cannot be undone. Tasks linked to this meeting will remain but will no longer be associated with it.`)) return;
    try {
      const res = await authFetch(`/api/meetings/${m.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setEditMsg("Error: " + (data.error || "Delete failed"));
        return;
      }
      onDelete(m.id);
    } catch {
      setEditMsg("Error: Network error");
    }
  }

  const sf: React.CSSProperties = { ...inputStyle, fontSize: "12px", padding: "6px 8px" };

  return (
    <div id={`meeting-row-${m.id}`} style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD }}>
      {dlg.element}
      {/* Compact meeting row */}
      <div onClick={() => !isEditing && setExpandedId(isOpen ? null : m.id)} style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "8px 14px", cursor: isEditing ? "default" : "pointer",
        backgroundColor: isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
      }}>
        <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px" }}>{formatDateUK(m.meeting_date)}</span>
        <span style={{ flex: 1, fontSize: "12px", fontWeight: 500, color: COLOURS.NAVY, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</span>
        {m.company && (
          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>{m.company}</span>
        )}
        {mTasks.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <div style={{ width: "48px", height: "4px", backgroundColor: COLOURS.TRACK, borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, backgroundColor: barColour, borderRadius: "2px", transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: "11px", color: COLOURS.SLATE, minWidth: "28px", textAlign: "right" }}>{completedTasks}/{mTasks.length}</span>
          </div>
        ) : (
          <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>no tasks</span>
        )}
        <span style={{ fontSize: "10px", color: COLOURS.SLATE, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
      </div>

      {/* Expanded meeting panel */}
      {isOpen && (
        <div style={{ borderTop: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD_ALT }}>

          {/* ── Edit mode ── */}
          {isEditing && draft ? (
            <div style={{ padding: "14px 14px", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "12px" }}>Edit Meeting Record</div>

              {editMsg && (
                <div style={{ fontSize: "12px", color: COLOURS.RED, marginBottom: "8px" }}>{editMsg}</div>
              )}

              <div style={{ marginBottom: "10px" }}>
                <label style={labelStyle}>Title</label>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={sf} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: cardGrid(240), gap: "10px", marginBottom: "10px" }}>
                <div>
                  <label style={labelStyle}>Date</label>
                  <DateInputWithCalendar value={draft.meeting_date} onChange={(e) => setDraft({ ...draft, meeting_date: e.target.value })} style={sf} />
                </div>
                <div>
                  <label style={labelStyle}>Company</label>
                  <select value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} style={sf}>
                    {["Unze Group", "Unze Trading", "Imperial Footwear", "Baranh", "Haute Dolci", "K&K Jhang"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Department</label>
                  <select value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} style={sf}>
                    {["Unze Group", "Unze Trading Ops", "Finance", "HR", "Audit", "Taxation", "Admin"].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Attendees (comma-separated)</label>
                  <input value={draft.attendees.join(", ")} onChange={(e) => setDraft({ ...draft, attendees: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} style={sf} />
                </div>
              </div>

              <div style={{ marginBottom: "10px" }}>
                <label style={labelStyle}>Executive Summary</label>
                <textarea value={draft.executive_summary} onChange={(e) => setDraft({ ...draft, executive_summary: e.target.value })}
                  style={{ ...sf, height: "80px", resize: "vertical" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: cardGrid(240), gap: "10px", marginBottom: "12px" }}>
                {(["decisions", "risks", "opportunities"] as const).map((field) => {
                  const colours: Record<string, string> = { decisions: COLOURS.GREEN, risks: COLOURS.RED, opportunities: COLOURS.BLUE };
                  return (
                    <div key={field}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={labelStyle}>{field.charAt(0).toUpperCase() + field.slice(1)} ({draft[field].length})</label>
                        <button onClick={() => setDraft({ ...draft, [field]: [...draft[field], ""] })}
                          style={{ fontSize: "11px", color: colours[field], background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>+ Add</button>
                      </div>
                      {draft[field].map((v, i) => (
                        <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                          <input value={v} onChange={(e) => {
                            const arr = [...draft[field]]; arr[i] = e.target.value;
                            setDraft({ ...draft, [field]: arr });
                          }} style={{ ...sf, flex: 1 }} />
                          <button onClick={() => setDraft({ ...draft, [field]: draft[field].filter((_, j) => j !== i) })}
                            style={{ fontSize: "12px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer" }}>×</button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={handleSave} disabled={saving}
                  style={{ ...primaryButtonStyle, backgroundColor: COLOURS.GREEN, opacity: saving ? 0.5 : 1, padding: "6px 16px", fontSize: "12px" }}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                <button onClick={() => { setIsEditing(false); setDraft(null); setEditMsg(""); }}
                  style={{ ...primaryButtonStyle, backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`, padding: "6px 16px", fontSize: "12px" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Summary + meta strip */}
              <div style={{ padding: "12px 14px", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: m.executive_summary ? "8px" : "0" }}>
                  {m.attendees && m.attendees.length > 0 && (
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", flex: 1 }}>
                      {m.attendees.map((a, i) => (
                        <span key={i} style={{ fontSize: "11px", padding: "2px 8px", backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.PILL, color: COLOURS.SLATE }}>{a}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button onClick={() => downloadMinutesPDF(m, mTasks)} style={{ ...primaryButtonStyle, padding: "4px 10px", fontSize: "11px" }}>PDF</button>
                    <button onClick={(e) => { e.stopPropagation(); startEdit(); }} style={{ ...primaryButtonStyle, padding: "4px 10px", fontSize: "11px", backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}` }}>Edit</button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(); }} style={{ ...primaryButtonStyle, padding: "4px 10px", fontSize: "11px", backgroundColor: COLOURS.CARD, color: COLOURS.RED, border: `1px solid ${COLOURS.RED}` }}>Delete</button>
                  </div>
                </div>
                {editMsg && <div style={{ fontSize: "12px", color: COLOURS.RED, marginTop: "6px" }}>{editMsg}</div>}
                {m.executive_summary && (
                  m.executive_summary.trimStart().startsWith("<")
                    ? <div dangerouslySetInnerHTML={{ __html: m.executive_summary }} />
                    : <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.6 }}>{m.executive_summary}</div>
                )}
              </div>

              {/* Decisions / Risks / Opps — compact inline lists */}
              {((m.decisions?.length ?? 0) > 0 || (m.risks?.length ?? 0) > 0 || (m.opportunities?.length ?? 0) > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: cardGrid(240), gap: "0", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                  {m.decisions && m.decisions.length > 0 && (
                    <div style={{ borderRight: isMobile ? "none" : `1px solid ${COLOURS.BORDER}`, padding: "10px 14px" }}>
                      <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.GREEN, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "6px" }}>Decisions ({m.decisions.length})</div>
                      {m.decisions.map((d, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                          <span style={{ color: COLOURS.GREEN, flexShrink: 0 }}>•</span>{d}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.risks && m.risks.length > 0 && (
                    <div style={{ borderRight: isMobile ? "none" : `1px solid ${COLOURS.BORDER}`, padding: "10px 14px" }}>
                      <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.RED, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "6px" }}>Risks ({m.risks.length})</div>
                      {m.risks.map((r, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                          <span style={{ color: COLOURS.RED, flexShrink: 0 }}>•</span>{r}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.opportunities && m.opportunities.length > 0 && (
                    <div style={{ padding: "10px 14px" }}>
                      <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.BLUE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "6px" }}>Opportunities ({m.opportunities.length})</div>
                      {m.opportunities.map((o, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                          <span style={{ color: COLOURS.BLUE, flexShrink: 0 }}>•</span>{o}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action Items — compact task rows */}
              <div>
                <div style={{ padding: "8px 14px", fontSize: "10px", fontWeight: 600, color: COLOURS.AMBER, textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                  Action Items ({mTasks.length})
                </div>
                {mTasks.length > 0 ? mTasks.map((t) => (
                  <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "7px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                    textDecoration: "none", backgroundColor: COLOURS.CARD,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD_ALT; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD; }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: taskDotColour(t.status), flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: "12px", color: COLOURS.NAVY, minWidth: 0 }}>{t.description}</span>
                    <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>{t.assigned_to || "—"}</span>
                    <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px", textAlign: "right" }}>{t.due_date ? formatDateUK(t.due_date) : "—"}</span>
                    <StatusBadge status={t.status} />
                    <span style={{ fontSize: "11px", color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                  </a>
                )) : (
                  <div style={{ padding: "10px 14px", fontSize: "12px", color: COLOURS.SLATE }}>No action items recorded.</div>
                )}
              </div>

              {/* Mind map */}
              {m.mind_map_url && (
                <div style={{ borderTop: `1px solid ${COLOURS.BORDER}`, padding: "12px 14px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "8px" }}>Mind Map</div>
                  <a href={m.mind_map_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block" }}>
                    <img
                      src={m.mind_map_url}
                      alt="Meeting mind map"
                      style={{ maxWidth: "100%", maxHeight: "320px", objectFit: "contain", borderRadius: RADII.XS, border: `1px solid ${COLOURS.BORDER}`, cursor: "pointer" }}
                    />
                  </a>
                  <p style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "4px" }}>Click image to open full size</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function bestMatch(name: string, members: { name: string; email: string }[]): { name: string; email: string } | undefined {
  const lower = name.toLowerCase().trim();
  const exact = members.find((m) => m.name.toLowerCase() === lower);
  if (exact) return exact;
  const fullContains = members.find((m) => m.name.toLowerCase() === lower || lower === m.name.toLowerCase());
  if (fullContains) return fullContains;
  const parts = lower.split(/\s+/);
  const lastWord = parts[parts.length - 1];
  const firstWord = parts[0];
  const byLastName = members.filter((m) => {
    const mParts = m.name.toLowerCase().split(/\s+/);
    return mParts[mParts.length - 1] === lastWord;
  });
  if (byLastName.length === 1) return byLastName[0];
  const byFirstName = members.filter((m) => {
    const mParts = m.name.toLowerCase().split(/\s+/);
    return mParts[0] === firstWord || mParts[mParts.length - 1] === firstWord;
  });
  if (byFirstName.length === 1) return byFirstName[0];
  const partial = members.find((m) => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()));
  return partial;
}

export default function MeetingsPage() {
  const { checking } = useRequireCapability("meetings_admin");
  const isMobile = useMobile();
  const dlg = useConfirm();
  const [transcript, setTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedMinutes | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [memberEmails, setMemberEmails] = useState<{ name: string; email: string }[]>([]);
  const [memberDetails, setMemberDetails] = useState<{ name: string; role: string; department: string | null; company_id: string | null }[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; short_code: string | null }[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const [step, setStep] = useState<"input" | "review" | "approved">("input");
  const [showMinutesFlow, setShowMinutesFlow] = useState(false);

  const [inputMethod, setInputMethod] = useState<"paste" | "upload" | "email">("paste");
  const [uploading, setUploading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [emailResults, setEmailResults] = useState<{ id: string; subject: string; from: string; date: string; text: string }[]>([]);

  const [externalEmails, setExternalEmails] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());

  const [pendingMinutes, setPendingMinutes] = useState<PendingMinute[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState<MeetingTask[]>([]);
  const [activePendingId, setActivePendingId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<"claude" | "other_ai" | "raw">("raw");
  const [paApprovedMinutes, setPaApprovedMinutes] = useState<PendingMinute[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<string>("All");
  const [mindMapFile, setMindMapFile] = useState<File | null>(null);

  const [view, setView] = useState<"meetings" | "decisions">("meetings");
  const [decisionSearch, setDecisionSearch] = useState("");
  const [decisionDeptFilter, setDecisionDeptFilter] = useState("All");
  const [showOpenTasksPanel, setShowOpenTasksPanel] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserEmail(user?.email || null);

    const { data: members } = await supabase
      .from("members")
      .select("first_name, last_name, name, email, role, department, company_id");
    if (members) {
      // Derive current user's role from the members list — avoids a separate
      // RLS-restricted query and uses data we already have.
      const me = members.find((m) => m.email === user?.email);
      setCurrentUserRole(me?.role || null);

      setMemberNames(members.map((m) => {
        const full = `${m.first_name || ""} ${m.last_name || ""}`.trim();
        return full || m.name || "";
      }).filter(Boolean));
      setMemberEmails(members.map((m) => ({
        name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "",
        email: m.email || "",
      })).filter((m) => m.email));
      setMemberDetails(members.map((m) => ({
        name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "",
        role: m.role || "Member",
        department: m.department || null,
        company_id: m.company_id || null,
      })).filter((m) => m.name));
    }

    const { data: companiesData } = await supabase
      .from("companies")
      .select("id, name, short_code")
      .in("short_code", TASK_COMPANY_CODES)
      .order("name", { ascending: true });
    setCompanies(companiesData || []);

    const { data: meetingsData } = await supabase
      .from("meetings")
      .select("id, meeting_date, title, executive_summary, decisions, risks, opportunities, attendees, department, company, created_at, mind_map_url")
      .order("meeting_date", { ascending: false })
      .limit(50);
    setMeetings(meetingsData || []);

    const { data: pendingData } = await supabase
      .from("pending_minutes")
      .select("id, gmail_message_id, subject, from_address, email_date, raw_text, status, source_type, extracted_data, pa_approved_by, pa_approved_at, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setPendingMinutes(pendingData || []);

    // CEO approval queue — pa_approved items (visible to CEO/Admin only)
    const { data: paApprovedData } = await supabase
      .from("pending_minutes")
      .select("id, gmail_message_id, subject, from_address, email_date, raw_text, status, source_type, extracted_data, pa_approved_by, pa_approved_at, created_at")
      .eq("status", "pa_approved")
      .order("created_at", { ascending: false });
    setPaApprovedMinutes(paApprovedData || []);

    const { data: taskData } = await supabase
      .from("tasks")
      .select("id, description, assigned_to, due_date, priority, status, meeting_id")
      .not("meeting_id", "is", null);
    setAllTasks(taskData || []);
  }

  function getTasksForMeeting(meetingId: string): MeetingTask[] {
    return allTasks.filter((t) => t.meeting_id === meetingId);
  }

  async function handleExtract() {
    if (!transcript.trim()) return;
    setExtracting(true);
    setExtracted(null);
    setMessage("");

    try {
      const res = await authFetch("/api/meetings/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          memberNames,
          memberDetails,
          preFormatted: sourceType === "claude" || sourceType === "other_ai",
          meetingDateRef: new Date().toISOString().slice(0, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage("Error: " + (data.error || "Extraction failed"));
      } else {
        // Enrich action items: exact-match owner name + auto-fill company_id + due date fallback
        const enriched = { ...data.extracted };

        // Convert meeting_date DD/MM/YYYY → YYYY-MM-DD for date math
        const dateParts = (enriched.meeting_date || "").split("/");
        const meetingIso = dateParts.length === 3
          ? `${dateParts[2]}-${dateParts[1].padStart(2, "0")}-${dateParts[0].padStart(2, "0")}`
          : undefined;

        enriched.action_items = (enriched.action_items || []).map((item: ExtractedMinutes["action_items"][0]) => {
          const matched = memberDetails.find(
            (m) => m.name.toLowerCase().trim() === (item.owner_name || "").toLowerCase().trim()
          ) || memberDetails.find(
            (m) => m.name.toLowerCase().includes((item.owner_name || "").toLowerCase().trim())
              || (item.owner_name || "").toLowerCase().includes(m.name.toLowerCase().trim())
          );
          return {
            ...item,
            owner_name: matched ? matched.name : item.owner_name,
            company_id: item.company_id || matched?.company_id || "",
            // Golden rule: if no due date extracted, default to next working day after the meeting
            due_date: item.due_date || nextWorkingDay(meetingIso),
          };
        });

        // For pre-formatted docs (Plaud, ChatGPT, etc.) with HTML available,
        // replace the plain-text summary with the formatted HTML from the document
        if ((sourceType === "claude" || sourceType === "other_ai") && transcriptHtml) {
          const htmlSection = extractHtmlSummarySection(transcriptHtml);
          if (htmlSection) {
            enriched.executive_summary = addInlineStylesToHtml(htmlSection);
          }
        }

        setExtracted(enriched);
        setStep("review");
      }
    } catch {
      setMessage("Error: Network error during extraction");
    }
    setExtracting(false);
  }

  async function processFile(file: File) {
    setUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch("/api/meetings/parse-file", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setMessage("Error: " + (data.error || "File parsing failed"));
      } else {
        setTranscript(data.text);
        setTranscriptHtml(data.html || "");
        setInputMethod("paste");
        setMessage(`Extracted text from ${file.name} — review below and click Extract.`);
      }
    } catch {
      setMessage("Error: Network error uploading file");
    }
    setUploading(false);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = "";
  }

  const [dragging, setDragging] = useState(false);
  const [transcriptHtml, setTranscriptHtml] = useState("");

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  async function handleCheckEmail() {
    setCheckingEmail(true);
    setMessage("");
    setEmailResults([]);

    try {
      const res = await authFetch("/api/meetings/check-inbox", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage("Error: " + (data.error || "Inbox check failed"));
      } else if (data.emails && data.emails.length > 0) {
        setEmailResults(data.emails);
        setMessage(`Found ${data.emails.length} minutes email${data.emails.length !== 1 ? "s" : ""}.`);
      } else {
        setMessage(data.message || "No new minutes emails found.");
      }
    } catch {
      setMessage("Error: Network error checking inbox");
    }
    setCheckingEmail(false);
  }

  function selectEmailMinutes(text: string) {
    setTranscript(text);
    setInputMethod("paste");
    setEmailResults([]);
    setMessage("Email content loaded — review below and click Extract.");
  }

  async function handleReviewPending(pending: PendingMinute) {
    setTranscript(pending.raw_text);
    setInputMethod("paste");
    setShowMinutesFlow(true);
    setStep("input");
    setActivePendingId(pending.id);
    setMessage(`Loaded: "${pending.subject || "Untitled"}". Click Extract to process with AI.`);

    await supabase
      .from("pending_minutes")
      .update({ status: "processing", reviewed_by: currentUserEmail })
      .eq("id", pending.id);
  }

  async function handleDismissPending(pendingId: string) {
    if (!await dlg.confirm("Dismiss this minute? It won't appear in the pending list again.")) return;
    await supabase
      .from("pending_minutes")
      .update({ status: "dismissed", reviewed_by: currentUserEmail, reviewed_at: new Date().toISOString() })
      .eq("id", pendingId);
    setPendingMinutes((prev) => prev.filter((p) => p.id !== pendingId));
  }

  async function handlePASubmitForCEO() {
    if (!extracted) return;

    const missingDue = extracted.action_items.filter((a) => !a.due_date);
    const missingTitle = extracted.action_items.filter((a) => !a.title?.trim());
    const missingOwner = extracted.action_items.filter((a) => !a.owner_name);
    const missingCompany = extracted.action_items.filter((a) => !a.company_id);
    if (missingTitle.length > 0) { setMessage(`Error: ${missingTitle.length} action item(s) missing a title.`); return; }
    if (missingOwner.length > 0) { setMessage(`Error: ${missingOwner.length} action item(s) missing an owner.`); return; }
    if (missingDue.length > 0) { setMessage(`Error: ${missingDue.length} action item(s) missing a due date. Every task must have a deadline.`); return; }
    if (missingCompany.length > 0) { setMessage(`Error: ${missingCompany.length} action item(s) missing a company.`); return; }

    setSaving(true);

    // Save the extracted data so the CEO can review without re-running AI.
    const updates: Record<string, unknown> = {
      status: "pa_approved",
      pa_approved_by: currentUserEmail,
      pa_approved_at: new Date().toISOString(),
      extracted_data: extracted,
      source_type: sourceType,
    };

    if (activePendingId) {
      await supabase.from("pending_minutes").update(updates).eq("id", activePendingId);
    }

    logAction("Updated", "meetings", `Minutes submitted for CEO approval: ${extracted.meeting_title}`);
    setMessage("Submitted for CEO approval. The minutes will appear in the CEO's review queue.");
    setSaving(false);
    setShowMinutesFlow(false);
    setStep("input");
    setExtracted(null);
    setActivePendingId(null);
    setTranscript("");
    setPendingMinutes((prev) => prev.filter((p) => p.id !== activePendingId));
    loadData(); // refresh the pa_approved queue
  }

  async function handleCEOApprove() {
    if (!extracted) return;

    const missingDue = extracted.action_items.filter((a) => !a.due_date);
    const missingTitle = extracted.action_items.filter((a) => !a.title?.trim());
    const missingOwner = extracted.action_items.filter((a) => !a.owner_name);
    const missingCompany = extracted.action_items.filter((a) => !a.company_id);
    if (missingTitle.length > 0) { setMessage(`Error: ${missingTitle.length} action item(s) missing a title.`); return; }
    if (missingOwner.length > 0) { setMessage(`Error: ${missingOwner.length} action item(s) missing an owner.`); return; }
    if (missingDue.length > 0) { setMessage(`Error: ${missingDue.length} action item(s) missing a due date.`); return; }
    if (missingCompany.length > 0) { setMessage(`Error: ${missingCompany.length} action item(s) missing a company.`); return; }

    setSaving(true);

    const dateParts = extracted.meeting_date.split("/");
    const isoDate = dateParts.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : new Date().toISOString().slice(0, 10);

    // Upload mind map image (if provided)
    let mindMapUrl: string | null = null;
    if (mindMapFile) {
      const ext = mindMapFile.name.split(".").pop() || "jpg";
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("meeting-mind-maps")
        .upload(fileName, mindMapFile, { contentType: mindMapFile.type, upsert: false });
      if (uploadError) {
        setMessage("Warning: mind map upload failed — " + uploadError.message + ". Continuing without it.");
      } else if (uploadData) {
        const { data: urlData } = supabase.storage.from("meeting-mind-maps").getPublicUrl(uploadData.path);
        mindMapUrl = urlData?.publicUrl || null;
      }
    }

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .insert({
        meeting_date: isoDate,
        title: extracted.meeting_title,
        executive_summary: extracted.executive_summary,
        decisions: extracted.decisions,
        risks: extracted.risks,
        opportunities: extracted.opportunities,
        attendees: extracted.attendees,
        department: extracted.department || "Unze Group",
        company: extracted.company || "Unze Group",
        raw_transcript: transcript,
        created_by: currentUserEmail,
        mind_map_url: mindMapUrl,
      })
      .select("id")
      .single();

    if (meetingError) {
      setMessage("Error saving meeting: " + meetingError.message);
      setSaving(false);
      return;
    }

    let tasksCreated = 0;
    for (const item of extracted.action_items) {
      const memberMatch = bestMatch(item.owner_name, memberEmails);
      const res = await authFetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: (item.title || "").slice(0, TASK_DESCRIPTION_LIMIT),
          notes: item.notes || "",
          companyId: item.company_id,
          assignedTo: item.owner_name,
          assignedToEmail: memberMatch?.email || null,
          assignedToDepartment: item.department || null,
          dueDate: item.due_date || null,
          priority: item.priority,
          status: "Not Started",
          project: extracted.meeting_title,
          meetingId: meeting.id,
          taskType: "Task",
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && !result?.error && result?.taskId) {
        await supabase.from("meeting_tasks").insert({ meeting_id: meeting.id, task_id: result.taskId });
        tasksCreated++;
      }
    }

    for (const attendee of extracted.attendees) {
      const match = bestMatch(attendee, memberEmails);
      if (match?.email) {
        await supabase.from("meeting_attendees").upsert({
          meeting_id: meeting.id, member_email: match.email, member_name: match.name,
        }, { onConflict: "meeting_id,member_email" });
      }
    }

    if (activePendingId) {
      await supabase.from("pending_minutes")
        .update({ status: "approved", meeting_id: meeting.id, reviewed_by: currentUserEmail, reviewed_at: new Date().toISOString() })
        .eq("id", activePendingId);
      setActivePendingId(null);
    }

    logAction("Created", "meetings", `${extracted.meeting_title} - ${tasksCreated} tasks created`, meeting.id);
    setMessage(`Approved & distributed: meeting saved and ${tasksCreated} task${tasksCreated !== 1 ? "s" : ""} created. Attendees will see these minutes in the app.`);
    setSaving(false);

    const externalOnly = new Set<string>();
    if (externalEmails.trim()) {
      externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).forEach((e) => externalOnly.add(e));
    }
    setSelectedRecipients(externalOnly);
    setStep("approved");
    setPaApprovedMinutes((prev) => prev.filter((p) => p.id !== activePendingId));
    loadData();
  }

  async function handleApprove() {
    return handlePASubmitForCEO();
  }

  async function handleSendMinutes() {
    if (!extracted) return;
    setSending(true);

    const uniqueEmails = Array.from(selectedRecipients);

    if (uniqueEmails.length === 0) {
      setMessage("No recipients selected. Tick at least one person to send to.");
      setSending(false);
      return;
    }

    try {
      const res = await authFetch("/api/meetings/send-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingTitle: extracted.meeting_title,
          meetingDate: extracted.meeting_date,
          executiveSummary: extracted.executive_summary,
          decisions: extracted.decisions,
          actionItems: extracted.action_items,
          attendeeEmails: uniqueEmails,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Minutes sent to ${data.sent} attendee${data.sent !== 1 ? "s" : ""}.`);
      } else {
        setMessage("Error sending minutes: " + (data.error || "Failed"));
      }
    } catch {
      setMessage("Error: Network error sending minutes");
    }
    setSending(false);
  }

  function downloadMinutesPDF(m: Meeting, mTasks: MeetingTask[]) {
    const html = `
      <html><head><title>${m.title}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; max-width: 800px; margin: 0 auto; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .meta { font-size: 13px; color: #64748b; margin-bottom: 16px; }
        h2 { font-size: 15px; margin: 16px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
        .summary { font-size: 14px; line-height: 1.6; color: #475569; }
        .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 8px; background: #f1f5f9; margin-right: 4px; }
        ul { padding-left: 20px; margin: 4px 0; }
        li { font-size: 14px; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
        th { background: #f8fafc; font-weight: 700; }
        @media print { body { padding: 10px; } }
      </style></head><body>
      <h1>${m.title}</h1>
      <div class="meta">
        ${formatDateUK(m.meeting_date)}
        ${m.department ? ` · ${m.department}` : ""}
        ${m.company ? ` · ${m.company}` : ""}
      </div>
      ${m.attendees?.length ? `<h2>Attendees</h2><div>${m.attendees.map((a) => `<span class="badge">${a}</span>`).join(" ")}</div>` : ""}
      ${m.executive_summary ? `<h2>Executive Summary</h2><div class="summary">${m.executive_summary}</div>` : ""}
      ${m.decisions?.length ? `<h2>Decisions</h2><ul>${m.decisions.map((d) => `<li>${d}</li>`).join("")}</ul>` : ""}
      ${m.risks?.length ? `<h2>Risks</h2><ul>${m.risks.map((r) => `<li>${r}</li>`).join("")}</ul>` : ""}
      ${m.opportunities?.length ? `<h2>Opportunities</h2><ul>${m.opportunities.map((o) => `<li>${o}</li>`).join("")}</ul>` : ""}
      ${mTasks.length ? `<h2>Action Items (${mTasks.length})</h2>
        <table><tr><th>Task</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th></tr>
        ${mTasks.map((t) => `<tr><td>${t.description}</td><td>${t.assigned_to || "—"}</td><td>${t.due_date ? formatDateUK(t.due_date) : "—"}</td><td>${t.priority || "Normal"}</td><td>${t.status}</td></tr>`).join("")}
        </table>` : ""}
      <div style="margin-top:20px;font-size:11px;color:#94a3b8;text-align:center">Generated from Unze Group · ${new Date().toLocaleDateString("en-GB")}</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  function resetAll() {
    setExtracted(null);
    setTranscript("");
    setTranscriptHtml("");
    setStep("input");
    setExternalEmails("");
    setMessage("");
    setShowMinutesFlow(false);
    setActivePendingId(null);
    setMindMapFile(null);
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const thisMonthMeetings = meetings.filter((m) => m.meeting_date.slice(0, 7) === currentMonth);
  const openTasks = allTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");

  // Task aging by department — for the summary table
  const taskAgingByDept = (() => {
    const today = new Date();
    const map = new Map<string, { open: number; pending: number; oldestDays: number }>();
    for (const task of openTasks) {
      const meeting = meetings.find((m) => m.id === task.meeting_id);
      if (!meeting) continue;
      const dept = meeting.department || meeting.company || "Unze Group";
      const days = Math.floor((today.getTime() - new Date(meeting.meeting_date).getTime()) / 86400000);
      const entry = map.get(dept) || { open: 0, pending: 0, oldestDays: 0 };
      if (task.status === "In Progress") entry.open++;
      else entry.pending++;
      entry.oldestDays = Math.max(entry.oldestDays, days);
      map.set(dept, entry);
    }
    return Array.from(map.entries())
      .map(([dept, v]) => ({ dept, ...v }))
      .sort((a, b) => b.oldestDays - a.oldestDays);
  })();

  // Navigate from Decision Log to a specific meeting in the list
  function openMeeting(meetingId: string, dept: string, _meetingDate: string) {
    setView("meetings");
    setSelectedDept(dept);
    setExpandedId(meetingId);
    setTimeout(() => {
      document.getElementById(`meeting-row-${meetingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }

  // Dept list for tabs
  const deptList = Array.from(
    new Set(meetings.map((m) => m.department || m.company || "Unze Group"))
  ).sort();

  // Meetings to display in Past Meetings view — filtered by tab, newest first
  const displayedMeetings = (selectedDept === "All"
    ? meetings
    : meetings.filter((m) => (m.department || m.company || "Unze Group") === selectedDept)
  ).slice().sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));

  const allDecisions = meetings.flatMap((m) =>
    (m.decisions || []).map((text) => ({
      text,
      meetingTitle: m.title,
      meetingDate: m.meeting_date,
      department: m.department || m.company || "Unze Group",
      meetingId: m.id,
    }))
  );

  const decisionDepts = Array.from(new Set(allDecisions.map((d) => d.department))).sort();
  const lowerSearch = decisionSearch.toLowerCase();
  const filteredDecisions = allDecisions.filter((d) => {
    if (decisionDeptFilter !== "All" && d.department !== decisionDeptFilter) return false;
    if (lowerSearch && !d.text.toLowerCase().includes(lowerSearch) && !d.meetingTitle.toLowerCase().includes(lowerSearch)) return false;
    return true;
  });

  // CEO/Admin reviewing from the pa_approved queue, OR creating minutes
  // themselves directly — either way they should go straight to Approve &
  // Distribute without the Submit-for-CEO detour.
  const isAdminOrCEO = currentUserRole === "Admin" || currentUserRole === "CEO";
  const isCEOReviewMode = isAdminOrCEO || paApprovedMinutes.some((p) => p.id === activePendingId);

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: COLOURS.SLATE }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
      {dlg.element}
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader />
          <button onClick={() => setShowMinutesFlow(!showMinutesFlow)} style={{
            ...primaryButtonStyle,
            display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
          }} title="Add minutes">
            {showMinutesFlow ? "✕ Close" : "+ Add Minutes"}
          </button>
        </div>

        {message && (
          <div style={{
            border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.CARD, padding: "10px 14px", marginBottom: "14px",
            backgroundColor: message.startsWith("Error") ? COLOURS.DANGER_SOFT : COLOURS.SUCCESS_SOFT,
            fontSize: "13px", color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN,
          }}>
            {message}
          </div>
        )}

        {/* Summary strip */}
        {!showMinutesFlow && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: showOpenTasksPanel ? "0" : "14px" }}>
              <CountCard label="Pending Review" value={pendingMinutes.length} color={pendingMinutes.length > 0 ? COLOURS.AMBER : COLOURS.SLATE} />
              <CountCard label="This Month" value={thisMonthMeetings.length} color={COLOURS.NAVY} />
              {/* Clickable Open Tasks card */}
              <div onClick={() => setShowOpenTasksPanel((p) => !p)} style={{
                ...cardStyle as React.CSSProperties,
                padding: "16px 20px",
                borderTop: `3px solid ${openTasks.length > 0 ? COLOURS.RED : COLOURS.GREEN}`,
                cursor: "pointer",
                outline: showOpenTasksPanel ? `2px solid ${COLOURS.RED}` : "none",
                outlineOffset: "-1px",
                position: "relative",
              }}>
                <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: COLOURS.SLATE, marginBottom: "10px" }}>Open Tasks</div>
                <div style={{ fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em", color: openTasks.length > 0 ? COLOURS.RED : COLOURS.GREEN }}>{openTasks.length.toLocaleString()}</div>
                {showOpenTasksPanel && <div style={{ position: "absolute", bottom: "6px", right: "8px", fontSize: "10px", color: COLOURS.RED }}>▼ showing</div>}
              </div>
              <CountCard label="Total Meetings" value={meetings.length} color={COLOURS.BLUE} />
            </div>

            {/* Open Tasks panel */}
            {showOpenTasksPanel && (() => {
              const panelTasks = openTasks
                .map((t) => ({ ...t, meetingTitle: meetings.find((m) => m.id === t.meeting_id)?.title || "Unknown" }))
                .sort((a, b) => {
                  if (!a.due_date && !b.due_date) return 0;
                  if (!a.due_date) return 1;
                  if (!b.due_date) return -1;
                  return a.due_date.localeCompare(b.due_date);
                });
              return (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: "14px", marginTop: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD_ALT }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.RED }}>{panelTasks.length} Open Task{panelTasks.length !== 1 ? "s" : ""}</span>
                    <button onClick={() => setShowOpenTasksPanel(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: COLOURS.SLATE, padding: "0 4px", lineHeight: 1 }}>×</button>
                  </div>
                  {panelTasks.length === 0 ? (
                    <div style={{ padding: "16px 14px", fontSize: "12px", color: COLOURS.SLATE }}>No open tasks.</div>
                  ) : panelTasks.map((t) => (
                    <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                      textDecoration: "none", backgroundColor: COLOURS.CARD,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD_ALT; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD; }}>
                      <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: taskDotColour(t.status), flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: "12px", color: COLOURS.NAVY, minWidth: 0 }}>{t.description}</span>
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, maxWidth: "140px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.meetingTitle}</span>
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>{t.assigned_to || "—"}</span>
                      <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px", textAlign: "right" }}>{t.due_date ? formatDateUK(t.due_date) : "—"}</span>
                      <StatusBadge status={t.status} />
                      <span style={{ fontSize: "11px", color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                    </a>
                  ))}
                </div>
              );
            })()}

            {/* Task Aging by Department */}
            {taskAgingByDept.length > 0 && (
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: "14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: fixedCols("1fr 80px 80px 90px"), minWidth: 390, padding: "6px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD_ALT }}>
                  <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, color: COLOURS.SLATE, letterSpacing: "0.07em" }}>Dept · Open Tasks</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, color: COLOURS.RED, letterSpacing: "0.07em", textAlign: "center" }}>In Progress</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, color: COLOURS.AMBER, letterSpacing: "0.07em", textAlign: "center" }}>Pending</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, color: COLOURS.SLATE, letterSpacing: "0.07em", textAlign: "right" }}>Oldest Task</span>
                </div>
                {taskAgingByDept.map((row) => {
                  const ageColour = row.oldestDays > 30 ? COLOURS.RED : row.oldestDays > 14 ? COLOURS.AMBER : COLOURS.GREEN;
                  return (
                    <div key={row.dept} style={{ display: "grid", gridTemplateColumns: fixedCols("1fr 80px 80px 90px"), minWidth: 390, padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: deptAccent(row.dept), flexShrink: 0 }} />
                        <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{row.dept}</span>
                      </div>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: row.open > 0 ? COLOURS.RED : COLOURS.SLATE, textAlign: "center" }}>{row.open}</span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: row.pending > 0 ? COLOURS.AMBER : COLOURS.SLATE, textAlign: "center" }}>{row.pending}</span>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: ageColour, textAlign: "right" }}>{row.oldestDays} day{row.oldestDays !== 1 ? "s" : ""}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Pending Review */}
        {pendingMinutes.length > 0 && !showMinutesFlow && (
          <div style={{ marginBottom: "16px" }}>
            <SectionTitle title={`Pending Review (${pendingMinutes.length})`} />
            {pendingMinutes.map((p) => (
              <div key={p.id} style={{
                ...cardStyle,
                backgroundColor: COLOURS.WARNING_SOFT,
                padding: "12px 14px", marginBottom: "8px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: COLOURS.NAVY }}>
                      {p.subject || "Untitled Minutes"}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      From: {p.from_address || "Unknown"}{p.email_date ? ` · ${p.email_date}` : ""}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                      {p.raw_text.slice(0, 150)}{p.raw_text.length > 150 ? "..." : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button onClick={() => handleReviewPending(p)} style={{
                      ...primaryButtonStyle, padding: "6px 14px",
                    }}>Review</button>
                    <button onClick={() => handleDismissPending(p.id)} style={{
                      ...primaryButtonStyle, padding: "6px 14px",
                      backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, border: `1px solid ${COLOURS.BORDER}`,
                    }}>Dismiss</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CEO Approval Queue — visible to Admin/CEO only */}
        {paApprovedMinutes.length > 0 && !showMinutesFlow && (
          <div style={{ marginBottom: "16px" }}>
            <SectionTitle title={`Awaiting Your Approval (${paApprovedMinutes.length})`} />
            <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "8px" }}>
              The PA has reviewed these minutes. Review and approve to create tasks and notify the team.
            </div>
            {paApprovedMinutes.map((p) => (
              <div key={p.id} style={{
                ...cardStyle,
                backgroundColor: "#EEF4FF",
                border: `1px solid #C7D9FF`,
                padding: "12px 14px", marginBottom: "8px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: COLOURS.NAVY }}>
                      {p.extracted_data?.meeting_title || p.subject || "Untitled Minutes"}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      {p.pa_approved_by ? `Reviewed by PA · ` : ""}{p.pa_approved_at ? formatDateUK(p.pa_approved_at.slice(0, 10)) : ""}
                      {p.source_type && ` · Source: ${p.source_type === "claude" ? "Claude" : p.source_type === "other_ai" ? "ChatGPT/Other AI" : "Raw transcription"}`}
                    </div>
                    {p.extracted_data && (
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                        {p.extracted_data.action_items.length} task{p.extracted_data.action_items.length !== 1 ? "s" : ""} · {p.extracted_data.attendees.length} attendee{p.extracted_data.attendees.length !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button onClick={() => {
                      // Load the extracted data for CEO to review
                      if (p.extracted_data) {
                        setExtracted(p.extracted_data);
                        setTranscript(p.raw_text);
                        setActivePendingId(p.id);
                        setStep("review");
                        setShowMinutesFlow(true);
                        setMessage("");
                      }
                    }} style={{ ...primaryButtonStyle, padding: "6px 14px", backgroundColor: COLOURS.GREEN }}>
                      Review & Approve
                    </button>
                    <button onClick={() => handleDismissPending(p.id)} style={{
                      ...primaryButtonStyle, padding: "6px 14px",
                      backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, border: `1px solid ${COLOURS.BORDER}`,
                    }}>Dismiss</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 1: Input */}
        {showMinutesFlow && step === "input" && (
          <div style={{ ...cardStyle, padding: "16px", marginBottom: "16px" }}>
            <SectionTitle title="Step 1: Add Minutes" />

            {/* Source type selector */}
            <div style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>Minutes Source</label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
                {([
                  { key: "claude" as const, label: "Claude", desc: "Extract fields only, preserve summary verbatim" },
                  { key: "other_ai" as const, label: "Other AI (Plaud, ChatGPT, Letterly…)", desc: "Pre-formatted AI output, preserve as written" },
                  { key: "raw" as const, label: "Raw Transcription", desc: "Full AI rewrite and extraction" },
                ] as { key: "claude" | "other_ai" | "raw"; label: string; desc: string }[]).map((opt) => (
                  <button key={opt.key} onClick={() => setSourceType(opt.key)} style={{
                    padding: "8px 14px", fontSize: "12px", fontWeight: sourceType === opt.key ? 600 : 400,
                    color: sourceType === opt.key ? COLOURS.CARD : COLOURS.SLATE,
                    backgroundColor: sourceType === opt.key ? COLOURS.NAVY : COLOURS.CARD,
                    border: `1px solid ${sourceType === opt.key ? COLOURS.NAVY : COLOURS.BORDER}`,
                    borderRadius: RADII.CARD, cursor: "pointer", textAlign: "left" as const,
                  }}>
                    <div>{opt.label}</div>
                    <div style={{ fontSize: "10px", opacity: 0.75, marginTop: "2px" }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "inline-flex", backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "3px", gap: "2px", marginBottom: "16px" }}>
              {([
                { key: "paste" as const, label: "Paste Text" },
                { key: "upload" as const, label: "Upload File" },
                { key: "email" as const, label: "From Email" },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setInputMethod(tab.key)}
                  style={{
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: inputMethod === tab.key ? 600 : 400,
                    color: inputMethod === tab.key ? COLOURS.CARD : COLOURS.SLATE,
                    backgroundColor: inputMethod === tab.key ? COLOURS.NAVY : "transparent",
                    border: "none",
                    borderRadius: RADII.PILL,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {inputMethod === "paste" && (
              <>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Paste the meeting transcript, raw notes, or pre-written minutes here..."
                  style={{ ...inputStyle, height: "200px", resize: "vertical", fontFamily: "inherit" }}
                />
                <button onClick={handleExtract} disabled={extracting || !transcript.trim()}
                  style={{ ...primaryButtonStyle, width: "100%", marginTop: "8px", opacity: extracting || !transcript.trim() ? 0.5 : 1 }}>
                  {extracting ? "Extracting with AI..." : "Extract Meeting Minutes"}
                </button>
              </>
            )}

            {inputMethod === "upload" && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  border: `2px dashed ${dragging ? COLOURS.NAVY : COLOURS.BORDER}`,
                  borderRadius: RADII.CARD,
                  backgroundColor: dragging ? COLOURS.TRACK : COLOURS.CARD_ALT,
                  transition: "all 0.2s ease",
                  cursor: uploading ? "wait" : "pointer",
                }}
              >
                <div style={{ fontSize: "36px", marginBottom: "10px", opacity: 0.5 }}>
                  {uploading ? "..." : ""}
                </div>
                <p style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "6px" }}>
                  {uploading ? "Reading file..." : dragging ? "Drop your file here" : "Drag & drop your file here"}
                </p>
                <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "16px" }}>
                  or
                </p>
                <label style={{
                  display: "inline-block",
                  ...primaryButtonStyle,
                  padding: "10px 24px",
                  cursor: uploading ? "wait" : "pointer",
                  opacity: uploading ? 0.5 : 1,
                }}>
                  Browse Files
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    style={{ display: "none" }}
                  />
                </label>
                <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "14px" }}>
                  Supported: PDF, Word (.docx), Plain text (.txt)
                </p>
              </div>
            )}

            {inputMethod === "email" && (
              <div style={{ padding: "8px 0" }}>
                <div style={{ backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, padding: "14px", marginBottom: "16px" }}>
                  <p style={{ fontSize: "13px", color: COLOURS.NAVY, fontWeight: 600, marginBottom: "6px" }}>
                    How it works
                  </p>
                  <ol style={{ fontSize: "13px", color: COLOURS.SLATE, margin: 0, paddingLeft: "20px", lineHeight: 1.8 }}>
                    <li>Forward your minutes email to <strong>k.saleem@unzegroup.com</strong></li>
                    <li>In Gmail, create a label called <strong>minutes-of-meeting</strong> and set up a filter to auto-label these emails</li>
                    <li>Click the button below to check for new minutes</li>
                  </ol>
                </div>

                <button onClick={handleCheckEmail} disabled={checkingEmail}
                  style={{ ...primaryButtonStyle, width: "100%", opacity: checkingEmail ? 0.5 : 1 }}>
                  {checkingEmail ? "Checking inbox..." : "Check for Minutes Emails"}
                </button>

                {emailResults.length > 0 && (
                  <div style={{ marginTop: "14px" }}>
                    <p style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "8px" }}>
                      Select an email to extract:
                    </p>
                    {emailResults.map((email) => (
                      <div key={email.id} style={{
                        border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, padding: "10px 12px",
                        marginBottom: "6px", backgroundColor: COLOURS.CARD, cursor: "pointer",
                      }}
                        onClick={() => selectEmailMinutes(email.text)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = COLOURS.NAVY; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = COLOURS.BORDER; }}
                      >
                        <div style={{ fontWeight: 600, fontSize: "13px", color: COLOURS.NAVY }}>{email.subject}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                          From: {email.from} · {email.date}
                        </div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                          {email.text.slice(0, 150)}{email.text.length > 150 ? "..." : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Review & Edit */}
        {showMinutesFlow && step === "review" && extracted && (() => {
          const updateActionItem = (index: number, updates: Partial<ExtractedMinutes["action_items"][0]>) => {
            const items = [...extracted.action_items];
            items[index] = { ...items[index], ...updates };
            setExtracted({ ...extracted, action_items: items });
          };
          const removeActionItem = (index: number) => {
            setExtracted({ ...extracted, action_items: extracted.action_items.filter((_, i) => i !== index) });
          };
          const addActionItem = () => {
            setExtracted({ ...extracted, action_items: [...extracted.action_items, { title: "", notes: "", owner_name: "", priority: "Medium", due_date: "", department: "", company_id: "" }] });
          };
          const smallField: React.CSSProperties = { ...inputStyle, fontSize: "12px", padding: "6px 8px" };

          return (
          <div style={{ ...cardStyle, padding: "16px", marginBottom: "16px" }}>
            <SectionTitle title={isCEOReviewMode ? "Step 2: Review & Approve" : "Step 2: Review & Submit"} />
            <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "12px" }}>
              {isCEOReviewMode
                ? "The PA has reviewed these minutes. You can still edit anything. When ready, approve to create tasks and notify the team."
                : "Review and edit everything below. When satisfied, submit for CEO approval — no tasks will be created until the CEO approves."}
            </p>

            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Title</label>
              <input value={extracted.meeting_title} onChange={(e) => setExtracted({ ...extracted, meeting_title: e.target.value })} style={inputStyle} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: cardGrid(240), gap: "10px", marginBottom: "12px" }}>
              <div>
                <label style={labelStyle}>Date</label>
                <input value={extracted.meeting_date} onChange={(e) => setExtracted({ ...extracted, meeting_date: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Company</label>
                <select value={extracted.company} onChange={(e) => setExtracted({ ...extracted, company: e.target.value })} style={inputStyle}>
                  {["Unze Group", "Unze Trading", "Imperial Footwear", "Baranh", "Haute Dolci", "K&K Jhang"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Department</label>
                <select value={extracted.department} onChange={(e) => setExtracted({ ...extracted, department: e.target.value })} style={inputStyle}>
                  {["Unze Group", "Unze Trading Ops", "Finance", "HR", "Audit", "Taxation", "Admin"].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Attendees (comma-separated)</label>
                <input value={extracted.attendees.join(", ")} onChange={(e) => setExtracted({ ...extracted, attendees: e.target.value.split(",").map((s) => s.trim()) })} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>
                Executive Summary
                {extracted.executive_summary.trimStart().startsWith("<") && (
                  <span style={{ fontWeight: 400, fontSize: "11px", color: COLOURS.GREEN, marginLeft: "6px" }}>· formatted from document</span>
                )}
              </label>
              <textarea value={extracted.executive_summary} onChange={(e) => setExtracted({ ...extracted, executive_summary: e.target.value })}
                style={{ ...inputStyle, height: "80px", resize: "vertical" }} />
              {extracted.executive_summary.trimStart().startsWith("<") && (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.XS, padding: "10px 12px", marginTop: "6px", backgroundColor: COLOURS.CARD }}
                  dangerouslySetInnerHTML={{ __html: extracted.executive_summary }} />
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: cardGrid(240), gap: "10px", marginBottom: "12px" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={labelStyle}>Decisions ({extracted.decisions.length})</label>
                  <button onClick={() => setExtracted({ ...extracted, decisions: [...extracted.decisions, ""] })}
                    style={{ fontSize: "12px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>+ Add</button>
                </div>
                {extracted.decisions.map((d, i) => (
                  <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                    <input value={d} onChange={(e) => { const arr = [...extracted.decisions]; arr[i] = e.target.value; setExtracted({ ...extracted, decisions: arr }); }}
                      style={{ ...smallField, flex: 1 }} />
                    <button onClick={() => setExtracted({ ...extracted, decisions: extracted.decisions.filter((_, j) => j !== i) })}
                      style={{ fontSize: "12px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer" }}>×</button>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={labelStyle}>Risks ({extracted.risks.length})</label>
                  <button onClick={() => setExtracted({ ...extracted, risks: [...extracted.risks, ""] })}
                    style={{ fontSize: "12px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>+ Add</button>
                </div>
                {extracted.risks.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                    <input value={r} onChange={(e) => { const arr = [...extracted.risks]; arr[i] = e.target.value; setExtracted({ ...extracted, risks: arr }); }}
                      style={{ ...smallField, flex: 1 }} />
                    <button onClick={() => setExtracted({ ...extracted, risks: extracted.risks.filter((_, j) => j !== i) })}
                      style={{ fontSize: "12px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer" }}>×</button>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={labelStyle}>Opportunities ({extracted.opportunities.length})</label>
                  <button onClick={() => setExtracted({ ...extracted, opportunities: [...extracted.opportunities, ""] })}
                    style={{ fontSize: "12px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>+ Add</button>
                </div>
                {extracted.opportunities.map((o, i) => (
                  <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                    <input value={o} onChange={(e) => { const arr = [...extracted.opportunities]; arr[i] = e.target.value; setExtracted({ ...extracted, opportunities: arr }); }}
                      style={{ ...smallField, flex: 1 }} />
                    <button onClick={() => setExtracted({ ...extracted, opportunities: extracted.opportunities.filter((_, j) => j !== i) })}
                      style={{ fontSize: "12px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer" }}>×</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", padding: "8px 0", borderTop: `2px solid ${COLOURS.NAVY}`, marginTop: "12px" }}>
              <SectionTitle title={`Action Items (${extracted.action_items.length})`} />
              <button onClick={addActionItem} style={{ ...primaryButtonStyle, padding: "8px 16px" }}>
                + Add Task
              </button>
            </div>

            {extracted.action_items.map((item, i) => (
              <div key={i} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, padding: "12px", marginBottom: "8px", backgroundColor: COLOURS.CARD_ALT }}>
                <div style={{ marginBottom: "6px" }}>
                  <label style={{ ...labelStyle, fontSize: "12px", color: !item.title?.trim() ? COLOURS.RED : undefined }}>Task title * (short)</label>
                  <input value={item.title || ""} onChange={(e) => updateActionItem(i, { title: e.target.value.slice(0, TASK_DESCRIPTION_LIMIT) })}
                    maxLength={TASK_DESCRIPTION_LIMIT}
                    placeholder="One clear action, e.g. Inspect tile delivery *" required
                    style={{ ...inputStyle, fontWeight: 600, borderColor: !item.title?.trim() ? COLOURS.RED : undefined }} />
                  <span style={{ fontSize: "10.5px", color: (item.title || "").length > TASK_DESCRIPTION_LIMIT - 20 ? COLOURS.AMBER : COLOURS.SLATE }}>{(item.title || "").length}/{TASK_DESCRIPTION_LIMIT}</span>
                </div>
                <div style={{ marginBottom: "8px" }}>
                  <label style={{ ...labelStyle, fontSize: "12px" }}>Details / context (optional)</label>
                  <textarea value={item.notes || ""} onChange={(e) => updateActionItem(i, { notes: e.target.value })}
                    placeholder="Full detail, background, or context for this task…"
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical", fontSize: "12px", color: COLOURS.SLATE }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: fixedCols("1fr 1fr 1fr 1fr 1fr auto"), gap: "8px", alignItems: "end" }}>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px", color: !item.owner_name ? COLOURS.RED : undefined }}>Owner *</label>
                    <select value={item.owner_name} onChange={(e) => updateActionItem(i, { owner_name: e.target.value })}
                      style={{ ...smallField, borderColor: !item.owner_name ? COLOURS.RED : undefined }}>
                      <option value="">Select owner</option>
                      {memberDetails.filter((m) => m.role === "Manager" || m.role === "Executive" || m.role === "Admin" || m.role === "CEO").map((m) => (
                        <option key={m.name} value={m.name}>{m.name} ({m.role})</option>
                      ))}
                      {item.owner_name && !memberDetails.find((m) => m.name === item.owner_name) && (
                        <option value={item.owner_name}>{item.owner_name} (not matched)</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px", color: !item.company_id ? COLOURS.RED : undefined }}>Company *</label>
                    <select value={item.company_id || ""} onChange={(e) => updateActionItem(i, { company_id: e.target.value })}
                      style={{ ...smallField, borderColor: !item.company_id ? COLOURS.RED : undefined }}>
                      <option value="">Select company</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px" }}>Priority</label>
                    <select value={item.priority} onChange={(e) => updateActionItem(i, { priority: e.target.value })} style={smallField}>
                      {["Low", "Medium", "High", "Urgent"].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px", color: !item.due_date ? COLOURS.RED : undefined }}>Due Date *</label>
                    <DateInputWithCalendar value={item.due_date || ""} onChange={(e) => updateActionItem(i, { due_date: e.target.value })} required
                      style={{ ...smallField, borderColor: !item.due_date ? COLOURS.RED : undefined }} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "12px" }}>Department</label>
                    <select value={item.department || ""} onChange={(e) => updateActionItem(i, { department: e.target.value })} style={smallField}>
                      <option value="">None</option>
                      {["Unze Trading Ops", "Finance", "HR", "Audit", "Taxation", "Admin"].map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => removeActionItem(i)}
                    style={{ backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.RED}`, color: COLOURS.RED, borderRadius: RADII.XS, padding: "6px 10px", fontSize: "13px", cursor: "pointer", height: "fit-content" }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {/* Mind Map upload — shown only to CEO/Admin before approving */}
            {isCEOReviewMode && (
              <div style={{ marginTop: "12px" }}>
                <label style={labelStyle}>Mind Map (optional — JPEG/PNG)</label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                  <label style={{
                    display: "inline-flex", alignItems: "center", gap: "6px",
                    padding: "6px 12px", borderRadius: RADII.XS, cursor: "pointer",
                    border: `1px solid ${COLOURS.BORDER}`, fontSize: "12px", color: COLOURS.NAVY,
                    backgroundColor: COLOURS.CARD,
                  }}>
                    <span>📎</span>
                    <span>{mindMapFile ? "Change image" : "Attach image"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        if (f && f.size > 10 * 1024 * 1024) {
                          setMessage("Mind map image must be under 10 MB.");
                          return;
                        }
                        setMindMapFile(f);
                      }}
                    />
                  </label>
                  {mindMapFile && (
                    <>
                      <span style={{ fontSize: "12px", color: COLOURS.GREEN }}>✓ {mindMapFile.name}</span>
                      <button
                        onClick={() => setMindMapFile(null)}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: COLOURS.RED, padding: 0 }}
                      >Remove</button>
                    </>
                  )}
                </div>
                {mindMapFile && (
                  <img
                    src={URL.createObjectURL(mindMapFile)}
                    alt="Mind map preview"
                    style={{ marginTop: "8px", maxWidth: "100%", maxHeight: "220px", objectFit: "contain", borderRadius: RADII.XS, border: `1px solid ${COLOURS.BORDER}` }}
                  />
                )}
                <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                  Attach a mind map or visual summary (JPEG/PNG, max 10 MB). It will appear in the meeting card.
                </p>
              </div>
            )}

            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>External Attendee Emails (comma-separated, optional)</label>
              <input value={externalEmails} onChange={(e) => setExternalEmails(e.target.value)}
                placeholder="e.g. john@external.com, jane@supplier.com" style={inputStyle} />
              <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                These people will receive the minutes email but no tasks will be created for them.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button onClick={() => { setStep("input"); setMessage(""); }}
                style={{ ...primaryButtonStyle, backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`, flex: 1 }}>
                Back
              </button>
              {isCEOReviewMode ? (
                <button onClick={handleCEOApprove} disabled={saving}
                  style={{ ...primaryButtonStyle, flex: 2, backgroundColor: COLOURS.GREEN, opacity: saving ? 0.5 : 1 }}>
                  {saving ? "Approving..." : "Approve & Distribute"}
                </button>
              ) : (
                <button onClick={handlePASubmitForCEO} disabled={saving}
                  style={{ ...primaryButtonStyle, flex: 2, backgroundColor: COLOURS.AMBER, opacity: saving ? 0.5 : 1 }}>
                  {saving ? "Submitting..." : "Submit for CEO Approval →"}
                </button>
              )}
            </div>
          </div>
          );
        })()}

        {/* Step 3: Approved — send to attendees */}
        {showMinutesFlow && step === "approved" && extracted && (() => {
          const toggleRecipient = (email: string) => {
            setSelectedRecipients((prev) => {
              const next = new Set(prev);
              if (next.has(email)) next.delete(email);
              else next.add(email);
              return next;
            });
          };
          const selectAll = () => {
            const all = new Set<string>();
            extracted.attendees.forEach((a) => {
              const match = bestMatch(a, memberEmails);
              if (match?.email) all.add(match.email);
            });
            if (externalEmails.trim()) externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).forEach((e) => all.add(e));
            setSelectedRecipients(all);
          };
          const deselectAll = () => setSelectedRecipients(new Set());

          return (
          <div style={{ ...cardStyle, padding: "16px", marginBottom: "16px" }}>
            <SectionTitle title="Step 3: Notify Attendees" />

            <div style={{
              border: `1px solid ${COLOURS.HAIRLINE}`,
              borderRadius: RADII.CARD, padding: "10px 14px", marginBottom: "14px",
              backgroundColor: COLOURS.SUCCESS_SOFT, fontSize: "13px", color: COLOURS.GREEN,
            }}>
              Company attendees will see these minutes in <strong>My Minutes</strong> within the app. Only check people below if you also want to send an email copy (typically for external attendees who don't have app access).
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={labelStyle}>Email Recipients ({selectedRecipients.size} selected)</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={selectAll} style={{ fontSize: "12px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Select All</button>
                  <button onClick={deselectAll} style={{ fontSize: "12px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Deselect All</button>
                </div>
              </div>

              <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px", marginTop: "6px" }}>Company Attendees (view in app — tick to also email)</div>
              {extracted.attendees.map((a) => {
                const match = bestMatch(a, memberEmails);
                if (!match?.email) return (
                  <div key={a} style={{ padding: "4px 0", fontSize: "13px", color: COLOURS.SLATE }}>
                    {a} <span style={{ fontSize: "12px", color: COLOURS.AMBER }}>(no email match)</span>
                  </div>
                );
                return (
                  <label key={a} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", fontSize: "13px", color: COLOURS.NAVY, cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedRecipients.has(match.email)}
                      onChange={() => toggleRecipient(match.email)} style={{ width: "16px", height: "16px" }} />
                    <span style={{ fontWeight: 600 }}>{a}</span>
                    <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{match.email}</span>
                  </label>
                );
              })}

              {externalEmails.trim() && (
                <>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px", marginTop: "10px" }}>External Attendees (email only)</div>
                  {externalEmails.split(",").map((e) => e.trim()).filter((e) => e.includes("@")).map((ext) => (
                    <label key={ext} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", fontSize: "13px", color: COLOURS.NAVY, cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedRecipients.has(ext)}
                        onChange={() => toggleRecipient(ext)} style={{ width: "16px", height: "16px" }} />
                      <span style={{ fontWeight: 600 }}>{ext}</span>
                      <span style={{ fontSize: "12px", color: COLOURS.BLUE }}>(external)</span>
                    </label>
                  ))}
                </>
              )}

              <div style={{ marginTop: "8px", display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="email" placeholder="Add external email..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val.includes("@")) {
                        setSelectedRecipients((prev) => new Set(prev).add(val));
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                  style={{ ...inputStyle, flex: "1 1 200px", maxWidth: "280px", fontSize: "14px", padding: "6px 8px" }}
                />
                <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Press Enter to add</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              {selectedRecipients.size > 0 ? (
                <button onClick={handleSendMinutes} disabled={sending}
                  style={{ ...primaryButtonStyle, flex: 2, opacity: sending ? 0.5 : 1 }}>
                  {sending ? "Sending..." : `Email to ${selectedRecipients.size} Recipient${selectedRecipients.size !== 1 ? "s" : ""}`}
                </button>
              ) : null}
              <button onClick={resetAll}
                style={{ ...primaryButtonStyle, backgroundColor: selectedRecipients.size === 0 ? COLOURS.GREEN : COLOURS.CARD, color: selectedRecipients.size === 0 ? "white" : COLOURS.NAVY, border: selectedRecipients.size === 0 ? "none" : `1px solid ${COLOURS.BORDER}`, flex: selectedRecipients.size === 0 ? 2 : 1 }}>
                {selectedRecipients.size === 0 ? "Done — Attendees Notified in App" : "Skip Email & Done"}
              </button>
            </div>
          </div>
          );
        })()}

        {/* Past meetings / Decision Log */}
        {!showMinutesFlow && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "inline-flex", backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "3px", gap: "2px" }}>
                {(["meetings", "decisions"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} style={{
                    padding: "6px 14px", fontSize: "12px", fontWeight: view === v ? 600 : 400,
                    color: view === v ? COLOURS.CARD : COLOURS.SLATE,
                    backgroundColor: view === v ? COLOURS.NAVY : "transparent",
                    border: "none", borderRadius: RADII.PILL, cursor: "pointer",
                  }}>
                    {v === "meetings" ? "Past Meetings" : `Decision Log (${allDecisions.length})`}
                  </button>
                ))}
              </div>
            </div>

            {view === "decisions" && (
              <div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                  <input
                    value={decisionSearch}
                    onChange={(e) => setDecisionSearch(e.target.value)}
                    placeholder="Search decisions..."
                    style={{ ...inputStyle, flex: "1 1 200px", maxWidth: "320px", padding: "7px 10px" }}
                  />
                  <select
                    value={decisionDeptFilter}
                    onChange={(e) => setDecisionDeptFilter(e.target.value)}
                    style={{ ...inputStyle, width: "auto", flex: "0 0 auto", padding: "7px 10px" }}
                  >
                    <option value="All">All Departments</option>
                    {decisionDepts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                {filteredDecisions.length === 0 ? (
                  <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>
                    {allDecisions.length === 0 ? "No decisions recorded yet." : "No decisions match your filters."}
                  </p>
                ) : (
                  <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
                    {filteredDecisions.map((d, i) => (
                      <div key={`${d.meetingId}-${i}`}
                        onClick={() => openMeeting(d.meetingId, d.department, d.meetingDate)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = COLOURS.CARD_ALT; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = COLOURS.CARD; }}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "8px 14px",
                          borderBottom: i < filteredDecisions.length - 1 ? `1px solid ${COLOURS.BORDER}` : "none",
                          backgroundColor: COLOURS.CARD, cursor: "pointer",
                        }}>
                        <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: COLOURS.GREEN, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12px", color: COLOURS.NAVY, marginBottom: "2px" }}>{d.text}</div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "11px", color: COLOURS.SLATE, alignItems: "center" }}>
                            <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{formatDateUK(d.meetingDate)}</span>
                            <span>{d.meetingTitle}</span>
                            <span style={{ padding: "1px 6px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: deptAccent(d.department), fontWeight: 600 }}>{d.department}</span>
                          </div>
                        </div>
                        <span style={{ fontSize: "11px", color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>View →</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: "8px", fontSize: "13px", color: COLOURS.SLATE }}>
                  {filteredDecisions.length} decision{filteredDecisions.length !== 1 ? "s" : ""}
                  {decisionSearch || decisionDeptFilter !== "All" ? ` (filtered from ${allDecisions.length} total)` : ""}
                </div>
              </div>
            )}

            {view === "meetings" && (
              <div>
                {/* Dept filter tabs */}
                <div style={{ display: "flex", overflowX: "auto", marginBottom: "10px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", backgroundColor: COLOURS.CARD_ALT }}>
                  {["All", ...deptList].map((dept, i) => {
                    const deptMeetings = dept === "All" ? meetings : meetings.filter((m) => (m.department || m.company || "Unze Group") === dept);
                    const openCount = deptMeetings.reduce((s, m) => {
                      const mt = getTasksForMeeting(m.id).filter((t) => t.status === "In Progress");
                      return s + mt.length;
                    }, 0);
                    const pendingCount = deptMeetings.reduce((s, m) => {
                      const mt = getTasksForMeeting(m.id).filter((t) => t.status === "Not Started" || t.status === "Waiting Reply");
                      return s + mt.length;
                    }, 0);
                    const active = selectedDept === dept;
                    const pillColour = openCount > 0 ? COLOURS.RED : pendingCount > 0 ? COLOURS.AMBER : null;
                    const isLast = i === deptList.length;
                    return (
                      <button key={dept} onClick={() => setSelectedDept(dept)} style={{
                        padding: "8px 14px", fontSize: "12px", fontWeight: active ? 600 : 400,
                        color: active ? COLOURS.NAVY : COLOURS.SLATE,
                        backgroundColor: active ? COLOURS.CARD : "transparent",
                        border: "none", borderRight: isLast ? "none" : `1px solid ${COLOURS.BORDER}`,
                        cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                        {dept}
                        {pillColour && (
                          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: RADII.PILL, backgroundColor: pillColour + "22", color: pillColour, fontWeight: 600 }}>
                            {openCount > 0 ? openCount : pendingCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Flat meeting list */}
                {meetings.length === 0 ? (
                  <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No meetings recorded yet.</p>
                ) : displayedMeetings.length === 0 ? (
                  <div style={{ ...cardStyle, padding: "24px", textAlign: "center" as const, color: COLOURS.SLATE, fontSize: "13px" }}>
                    {selectedDept !== "All" ? `No meetings for ${selectedDept}.` : "No past meetings found."}
                  </div>
                ) : (
                  <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
                    {displayedMeetings.map((m) => {
                      const isOpen = expandedId === m.id;
                      const mTasks = getTasksForMeeting(m.id);
                      const completedTasks = mTasks.filter((t) => t.status === "Completed").length;
                      const openTaskCount = mTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;
                      return <MeetingCard key={m.id} m={m} mTasks={mTasks} completedTasks={completedTasks} openTaskCount={openTaskCount} isOpen={isOpen} setExpandedId={setExpandedId} downloadMinutesPDF={downloadMinutesPDF} isMobile={isMobile} showDept={selectedDept === "All"} onEditSaved={(updated) => setMeetings((prev) => prev.map((x) => x.id === updated.id ? updated : x))} onDelete={(id) => { setMeetings((prev) => prev.filter((x) => x.id !== id)); setExpandedId(null); }} />;
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
