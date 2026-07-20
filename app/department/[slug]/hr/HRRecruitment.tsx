"use client";

import { useEffect, useState } from "react";
import { authFetch, supabase } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";

import { useMobile } from "../../../lib/useMobile";
import {
  COLOURS, RADII, cardStyle, SectionTitle, CountCard, SkeletonRows,
} from "../../../lib/SharedUI";

// ── Types ───────────────────────────────────────────────────────────────────────
type Summary = {
  total: number;
  open: number;
  filled: number;
  on_hold: number;
  long_open: number;
  avg_days_to_hire: number | null;
  filled_this_month: number;
};

type Position = {
  id: string;
  position_title: string;
  flw_company: string;
  salary_range: string | null;
  assigned_to: string | null;
  date_opened: string | null;
  date_closed: string | null;
  days_open: number | null;
  required_count: number;
  status: string;
  selected_candidate: string | null;
  offered_salary: string | null;
  flw_remarks: string | null;
  candidate_count: number;
};

type Candidate = {
  id: string;
  name: string;
  contact: string | null;
  email: string | null;
  personality_test: string | null;
  overview: string | null;
  cv_link: string | null;
  feedback: Record<string, string>;
  stage: string;
  offer_amount: string | null;
  date_of_joining: string | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────────
const STATUS_COLOURS: Record<string, string> = {
  Open:         COLOURS.AMBER,
  Interviewing: "#2563EB",
  Offered:      "#7C3AED",
  "On Hold":    COLOURS.SLATE,
  Filled:       COLOURS.GREEN,
  Cancelled:    COLOURS.RED,
};

const STAGE_COLOURS: Record<string, string> = {
  Applied:    COLOURS.SLATE,
  Screening:  COLOURS.AMBER,
  Interview:  "#2563EB",
  Offer:      "#7C3AED",
  Hired:      COLOURS.GREEN,
  Rejected:   COLOURS.RED,
};

function StatusPill({ status }: { status: string }) {
  const colour = STATUS_COLOURS[status] ?? COLOURS.SLATE;
  return (
    <span style={{
      display: "inline-block", fontSize: "11px", fontWeight: 600,
      padding: "3px 10px", borderRadius: RADII.PILL,
      color: colour, backgroundColor: colour + "1A", whiteSpace: "nowrap",
    }}>
      {status}
    </span>
  );
}

function StagePill({ stage }: { stage: string }) {
  const colour = STAGE_COLOURS[stage] ?? COLOURS.SLATE;
  return (
    <span style={{
      display: "inline-block", fontSize: "11px", fontWeight: 600,
      padding: "2px 8px", borderRadius: RADII.PILL,
      color: colour, backgroundColor: colour + "18",
    }}>
      {stage}
    </span>
  );
}

// ── Filter pill row ──────────────────────────────────────────────────────────────
const FILTER_STATUSES = ["All", "Open", "On Hold", "Filled"];

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px", fontSize: "13px", fontWeight: 500,
        borderRadius: RADII.PILL, cursor: "pointer", border: "none",
        backgroundColor: active ? COLOURS.NAVY : COLOURS.HAIRLINE,
        color: active ? "#FFF" : COLOURS.SLATE,
        transition: "background 0.15s",
      }}
    >
      {label}
    </button>
  );
}

// ── FlowHCM sync button ──────────────────────────────────────────────────────────
type SyncLog = { synced_at: string; status: string; records_synced: number } | null;

function SyncButton({ onSynced, syncLog }: { onSynced: (msg: string) => void; syncLog: SyncLog }) {
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await authFetch("/api/flowhcm/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: ["recruitment"] }),
      });
      const json = await res.json();
      if (json.status === "not_configured") {
        onSynced("FlowHCM not connected yet — add FLOWHCM_TOKEN to Vercel env vars.");
      } else if (json.errors?.length) {
        onSynced("Sync error: " + json.errors.join("; "));
      } else {
        const r = json.results?.recruitment ?? 0;
        onSynced(`Sync complete — ${r} records refreshed from FlowHCM.`);
      }
    } catch {
      onSynced("Error: Network failure during sync.");
    } finally {
      setSyncing(false);
    }
  }

  const lastSynced = syncLog?.synced_at
    ? formatDateUK(syncLog.synced_at.slice(0, 10)) + " · " + syncLog.records_synced + " records"
    : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      {lastSynced && (
        <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>
          Last sync: {lastSynced}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={syncing}
        style={{
          padding: "7px 16px", fontSize: "13px", fontWeight: 600,
          borderRadius: RADII.PILL, cursor: syncing ? "wait" : "pointer",
          border: `1px solid ${COLOURS.HAIRLINE}`,
          backgroundColor: COLOURS.CARD, color: COLOURS.NAVY,
          opacity: syncing ? 0.7 : 1,
        }}
      >
        {syncing ? "Syncing…" : "↻ Sync from FlowHCM"}
      </button>
    </div>
  );
}

// ── Candidate slide-over ─────────────────────────────────────────────────────────
function CandidatePanel({
  position,
  onClose,
}: {
  position: Position;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    authFetch(`/api/hr/recruitment/candidates?position_id=${position.id}`)
      .then((r: Response) => r.json())
      .then((d: { candidates?: Candidate[] }) => { setCandidates(d.candidates ?? []); setLoading(false); });
  }, [position.id]);

  const overlayStyle: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 1000,
    backgroundColor: "rgba(15,23,32,0.45)",
  };

  const panelStyle: React.CSSProperties = {
    position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 1001,
    width: "min(600px, 100vw)",
    backgroundColor: "#FFF",
    boxShadow: "-4px 0 32px rgba(0,0,0,0.12)",
    display: "flex", flexDirection: "column",
    overflowY: "auto",
  };

  const stageCount = (stage: string) => candidates.filter((c) => c.stage === stage).length;

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <div style={panelStyle}>
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
          position: "sticky", top: 0, backgroundColor: "#FFF", zIndex: 2,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>
                {position.position_title}
              </div>
              <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "3px" }}>
                {position.flw_company}
                {position.salary_range && ` · ${position.salary_range}`}
                {position.date_opened && ` · Opened ${formatDateUK(position.date_opened)}`}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: "22px", color: COLOURS.SLATE, padding: "0 4px",
              }}
            >
              ×
            </button>
          </div>

          {/* Position status + selected candidate */}
          <div style={{ display: "flex", gap: "8px", marginTop: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <StatusPill status={position.status} />
            {position.selected_candidate && (
              <span style={{ fontSize: "12px", color: COLOURS.GREEN, fontWeight: 600 }}>
                ✓ {position.selected_candidate}
                {position.offered_salary && ` @ ${position.offered_salary}`}
              </span>
            )}
          </div>

          {/* Pipeline summary pills */}
          {!loading && candidates.length > 0 && (
            <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
              {["Applied","Screening","Interview","Offer","Hired","Rejected"].map((s) => {
                const n = stageCount(s);
                if (n === 0) return null;
                return <StagePill key={s} stage={`${s} (${n})`} />;
              })}
            </div>
          )}
        </div>

        {/* Candidate list */}
        <div style={{ padding: "16px 24px", flex: 1 }}>
          {loading ? (
            <SkeletonRows count={4} />
          ) : candidates.length === 0 ? (
            <div style={{ color: COLOURS.SLATE, fontSize: "14px", padding: "20px 0", textAlign: "center" }}>
              No candidates imported for this position.
              {position.flw_remarks && (
                <div style={{ marginTop: "12px", fontSize: "13px", fontStyle: "italic", lineHeight: 1.5 }}>
                  "{position.flw_remarks}"
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {candidates.map((c) => {
                const isOpen = expandedId === c.id;
                return (
                  <div
                    key={c.id}
                    style={{
                      border: `1px solid ${COLOURS.HAIRLINE}`,
                      borderLeft: `3px solid ${STAGE_COLOURS[c.stage] ?? COLOURS.SLATE}`,
                      borderRadius: RADII.CARD,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      onClick={() => setExpandedId(isOpen ? null : c.id)}
                      style={{
                        padding: "10px 14px", cursor: "pointer",
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        backgroundColor: isOpen ? COLOURS.CARD_ALT : "#FFF",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{c.name}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                          {c.contact && c.contact}
                          {c.contact && c.email && " · "}
                          {c.email && c.email}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <StagePill stage={c.stage} />
                        {c.offer_amount && (
                          <span style={{ fontSize: "12px", color: COLOURS.GREEN, fontWeight: 600 }}>
                            {c.offer_amount}
                          </span>
                        )}
                        <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{isOpen ? "▼" : "▶"}</span>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{
                        padding: "12px 14px", borderTop: `1px solid ${COLOURS.HAIRLINE}`,
                        backgroundColor: COLOURS.CARD_ALT, fontSize: "13px", color: COLOURS.NAVY,
                      }}>
                        {c.personality_test && (
                          <div style={{ marginBottom: "8px" }}>
                            <span style={{ color: COLOURS.SLATE, fontWeight: 500 }}>Personality Test: </span>
                            {c.personality_test}
                          </div>
                        )}
                        {c.date_of_joining && (
                          <div style={{ marginBottom: "8px" }}>
                            <span style={{ color: COLOURS.SLATE, fontWeight: 500 }}>Date of Joining: </span>
                            {formatDateUK(c.date_of_joining)}
                          </div>
                        )}
                        {c.cv_link && (
                          <div style={{ marginBottom: "8px" }}>
                            <a href={c.cv_link} target="_blank" rel="noopener noreferrer"
                              style={{ color: COLOURS.GREEN, textDecoration: "none", fontWeight: 500 }}>
                              View CV / Portfolio →
                            </a>
                          </div>
                        )}
                        {c.overview && (
                          <div style={{ marginBottom: "8px" }}>
                            <div style={{ color: COLOURS.SLATE, fontWeight: 500, marginBottom: "4px" }}>Overview:</div>
                            <div style={{ lineHeight: 1.55, whiteSpace: "pre-line", color: COLOURS.SLATE }}>
                              {c.overview.slice(0, 500)}{c.overview.length > 500 ? "…" : ""}
                            </div>
                          </div>
                        )}
                        {Object.keys(c.feedback).length > 0 && (
                          <div>
                            <div style={{ color: COLOURS.SLATE, fontWeight: 500, marginBottom: "6px" }}>Feedback:</div>
                            {Object.entries(c.feedback).map(([k, v]) => (
                              <div key={k} style={{ marginBottom: "8px" }}>
                                <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.07em", color: COLOURS.SLATE, fontWeight: 600 }}>
                                  {k}
                                </div>
                                <div style={{ lineHeight: 1.5, color: COLOURS.NAVY, marginTop: "2px" }}>
                                  {v.slice(0, 400)}{v.length > 400 ? "…" : ""}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main component ───────────────────────────────────────────────────────────────
export default function HRRecruitment() {
  const isMobile = useMobile();
  const [summary, setSummary]     = useState<Summary | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState("All");
  const [search, setSearch]       = useState("");
  const [message, setMessage]     = useState("");
  const [panelPos, setPanelPos]   = useState<Position | null>(null);
  const [syncLog, setSyncLog]     = useState<SyncLog>(null);

  function showMsg(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 6000);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [sumRes, posRes, statusRes] = await Promise.all([
        authFetch("/api/hr/recruitment/summary"),
        authFetch("/api/hr/recruitment/positions"),
        authFetch("/api/flowhcm/status"),
      ]);
      const sumData    = await sumRes.json();
      const posData    = await posRes.json();
      const statusData = await statusRes.json();
      setSummary(sumData.summary ?? null);
      setPositions(posData.positions ?? []);
      const log = (statusData.sync_log ?? []) as { module: string; synced_at: string; status: string; records_synced: number }[];
      setSyncLog(log.find(l => l.module === "recruitment") ?? null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  // Filtered + searched list
  const filtered = positions.filter((p) => {
    const statusMatch = filter === "All" || p.status === filter;
    if (!statusMatch) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.position_title.toLowerCase().includes(q) ||
      p.flw_company.toLowerCase().includes(q) ||
      (p.selected_candidate ?? "").toLowerCase().includes(q) ||
      (p.assigned_to ?? "").toLowerCase().includes(q)
    );
  });

  const longOpen = positions.filter(
    (p) => p.status === "Open" && (p.days_open ?? 0) > 60
  );

  return (
    <>
      {/* Message toast */}
      {message && (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
          borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px",
          backgroundColor: COLOURS.CARD, fontSize: "13px", color: COLOURS.NAVY,
        }}>
          {message}
        </div>
      )}

      {/* 60+ days alert banner */}
      {!loading && longOpen.length > 0 && (
        <div style={{
          backgroundColor: COLOURS.AMBER + "12",
          border: `1px solid ${COLOURS.AMBER}55`,
          borderLeft: `4px solid ${COLOURS.AMBER}`,
          borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px",
          fontSize: "13px",
        }}>
          <span style={{ fontWeight: 700, color: COLOURS.AMBER }}>⚠ {longOpen.length} position{longOpen.length > 1 ? "s" : ""} open 60+ days: </span>
          <span style={{ color: COLOURS.NAVY }}>
            {longOpen.map((p) => `${p.position_title} (${p.days_open}d)`).join(" · ")}
          </span>
        </div>
      )}

      {/* KPI cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)",
        gap: "10px", marginBottom: "16px",
      }}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ ...cardStyle, padding: "16px 20px", height: "80px" }} />
          ))
        ) : summary ? (
          <>
            <CountCard label="Open"           value={summary.open}               color={COLOURS.AMBER} />
            <CountCard label="On Hold"        value={summary.on_hold}            color={COLOURS.SLATE} />
            <CountCard label="Filled"         value={summary.filled}             color={COLOURS.GREEN} />
            <CountCard label="Total"          value={summary.total}              color={COLOURS.NAVY}  />
            <CountCard label="Avg Days Hire"  value={summary.avg_days_to_hire ?? "—"} color={COLOURS.AMBER} />
          </>
        ) : null}
      </div>

      {/* Toolbar: search + filter + import */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "8px",
        alignItems: "center", justifyContent: "space-between",
        marginBottom: "12px",
      }}>
        {/* Left: filter pills + search */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          {FILTER_STATUSES.map((s) => (
            <FilterPill key={s} label={s} active={filter === s} onClick={() => setFilter(s)} />
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search position, company…"
            style={{
              padding: "5px 10px", fontSize: "13px",
              border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL,
              color: COLOURS.NAVY, outline: "none", width: "180px",
            }}
          />
        </div>

        {/* Right: FlowHCM sync */}
        <SyncButton syncLog={syncLog} onSynced={(msg) => { showMsg(msg); loadData(); }} />
      </div>

      {/* Count label */}
      {!loading && (
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "8px" }}>
          Showing {filtered.length} of {positions.length} positions
        </div>
      )}

      {/* Positions table */}
      <div style={{
        border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
        backgroundColor: COLOURS.CARD, overflow: "hidden",
      }}>
        {/* Table header */}
        {!isMobile && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "3fr 1.5fr 1.2fr 1fr 1.2fr 1.5fr 1fr",
            padding: "8px 16px",
            backgroundColor: "#F8FAFC",
            borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
            fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.07em",
            textTransform: "uppercase", color: COLOURS.SLATE,
          }}>
            <div>Position</div>
            <div>Company</div>
            <div>Salary Range</div>
            <div>Recruiter</div>
            <div>Opened</div>
            <div>Filled By / Remarks</div>
            <div>Status</div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: "16px" }}>
            <SkeletonRows count={8} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: COLOURS.SLATE, fontSize: "14px" }}>
            {positions.length === 0
              ? 'No positions yet. Click "Sync from FlowHCM" to pull your recruitment data.'
              : "No positions match the current filters."}
          </div>
        ) : (
          filtered.map((pos, idx) => {
            const isLast   = idx === filtered.length - 1;
            const isLong   = pos.status === "Open" && (pos.days_open ?? 0) > 60;

            if (isMobile) {
              return (
                <div
                  key={pos.id}
                  onClick={() => setPanelPos(pos)}
                  style={{
                    padding: "12px 14px",
                    borderBottom: isLast ? "none" : `1px solid ${COLOURS.HAIRLINE}`,
                    cursor: "pointer",
                    backgroundColor: isLong ? COLOURS.AMBER + "0A" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>
                        {pos.position_title}
                      </div>
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                        {pos.flw_company}
                        {pos.salary_range && ` · ${pos.salary_range}`}
                      </div>
                      {pos.selected_candidate && (
                        <div style={{ fontSize: "12px", color: COLOURS.GREEN, marginTop: "2px" }}>
                          ✓ {pos.selected_candidate}
                        </div>
                      )}
                    </div>
                    <StatusPill status={pos.status} />
                  </div>
                </div>
              );
            }

            return (
              <div
                key={pos.id}
                onClick={() => setPanelPos(pos)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "3fr 1.5fr 1.2fr 1fr 1.2fr 1.5fr 1fr",
                  padding: "10px 16px",
                  borderBottom: isLast ? "none" : `1px solid ${COLOURS.HAIRLINE}`,
                  cursor: "pointer",
                  alignItems: "center",
                  backgroundColor: isLong ? COLOURS.AMBER + "0A" : "transparent",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isLong) (e.currentTarget as HTMLDivElement).style.backgroundColor = COLOURS.CARD_ALT;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = isLong ? COLOURS.AMBER + "0A" : "transparent";
                }}
              >
                {/* Position */}
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>
                    {pos.position_title}
                    {pos.required_count > 1 && (
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 400, marginLeft: "6px" }}>
                        ×{pos.required_count}
                      </span>
                    )}
                  </div>
                  {pos.candidate_count > 0 && (
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "1px" }}>
                      {pos.candidate_count} candidate{pos.candidate_count > 1 ? "s" : ""}
                    </div>
                  )}
                </div>

                {/* Company */}
                <div style={{ fontSize: "13px", color: COLOURS.NAVY }}>{pos.flw_company}</div>

                {/* Salary */}
                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{pos.salary_range ?? "—"}</div>

                {/* Recruiter */}
                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{pos.assigned_to ?? "—"}</div>

                {/* Date opened + days */}
                <div>
                  <div style={{ fontSize: "12px", color: COLOURS.NAVY }}>
                    {pos.date_opened ? formatDateUK(pos.date_opened) : "—"}
                  </div>
                  {pos.days_open != null && pos.status !== "Filled" && (
                    <div style={{
                      fontSize: "11px",
                      color: (pos.days_open > 60) ? COLOURS.RED : COLOURS.SLATE,
                      fontWeight: pos.days_open > 60 ? 600 : 400,
                    }}>
                      {pos.days_open}d open
                    </div>
                  )}
                  {pos.status === "Filled" && pos.date_closed && (
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                      Filled {formatDateUK(pos.date_closed)}
                    </div>
                  )}
                </div>

                {/* Selected candidate / remarks */}
                <div>
                  {pos.selected_candidate ? (
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.GREEN }}>
                        ✓ {pos.selected_candidate}
                      </div>
                      {pos.offered_salary && (
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                          @ {pos.offered_salary}
                        </div>
                      )}
                    </div>
                  ) : pos.flw_remarks ? (
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                      {pos.flw_remarks.slice(0, 60)}{pos.flw_remarks.length > 60 ? "…" : ""}
                    </div>
                  ) : (
                    <span style={{ color: COLOURS.SLATE, fontSize: "12px" }}>—</span>
                  )}
                </div>

                {/* Status */}
                <div><StatusPill status={pos.status} /></div>
              </div>
            );
          })
        )}
      </div>

      {/* Candidate slide-over panel */}
      {panelPos && (
        <CandidatePanel position={panelPos} onClose={() => setPanelPos(null)} />
      )}
    </>
  );
}
