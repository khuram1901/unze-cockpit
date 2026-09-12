"use client";

import { useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { COLOURS, RADII, SectionTitle, SkeletonRows } from "../../../lib/SharedUI";

// ── Types ─────────────────────────────────────────────────────────────────────

type Summary = {
  total_positions:   number;
  open_positions:    number;
  on_hold_positions: number;
  filled_positions:  number;
  total_candidates:  number;
};

type PipelineRow = {
  stage:           string;
  candidate_count: number;
};

type PositionRow = {
  id:              string;
  position_title:  string;
  flw_company:     string | null;
  department:      string | null;
  status:          string | null;
  date_opened:     string | null;
  salary_range:    string | null;
  required_count:  number | null;
  flw_remarks:     string | null;
  candidate_count: number;
  offer_count:     number;
};

type CompanyRow = {
  company:         string;
  open_positions:  number;
  total_candidates:number;
};

type RecruitmentData = {
  summary:           Summary;
  pipeline_breakdown:PipelineRow[];
  positions:         PositionRow[];
  by_company:        CompanyRow[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const STAGE_COLOUR: Record<string, string> = {
  "Offer Accepted": "#10B981",
  "Offer":          "#3B82F6",
  "Interviewed":    "#8B5CF6",
  "Shortlisted":    "#F59E0B",
  "Applied":        "#6B7280",
};

const STATUS_PILL: Record<string, { bg: string; color: string }> = {
  "Open":    { bg: "#D1FAE5", color: "#065F46" },
  "On Hold": { bg: "#FEF3C7", color: "#92400E" },
  "Filled":  { bg: "#DBEAFE", color: "#1E40AF" },
};

function KpiCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div style={{
      background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: RADII.CARD, padding: "16px 18px", flex: "1 1 140px", minWidth: "120px",
    }}>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "26px", fontWeight: 700, color: COLOURS.NAVY }}>{value}</div>
      {sub && <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const s = status ?? "Unknown";
  const pill = STATUS_PILL[s] ?? { bg: "#F3F4F6", color: "#374151" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: "12px",
      fontSize: "11px", fontWeight: 600, background: pill.bg, color: pill.color,
    }}>{s}</span>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HRRecruitment() {
  const [data, setData]       = useState<RecruitmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<"All" | "Open" | "On Hold" | "Filled">("All");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch("/api/hr/recruitment/overview");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (e: any) {
        setError(e.message ?? "Failed to load recruitment data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <SkeletonRows count={8} />;
  if (error) return (
    <div style={{ padding: "20px", color: "#DC2626", fontSize: "13px" }}>
      Failed to load recruitment data: {error}
    </div>
  );
  if (!data) return null;

  const { summary, pipeline_breakdown, positions, by_company } = data;
  const filteredPositions = filter === "All" ? positions : positions.filter(p => p.status === filter);
  const totalCandidates   = summary.total_candidates;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* KPI strip */}
      <div>
        <SectionTitle title="Recruitment Overview" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "12px" }}>
          <KpiCard label="Total Positions"   value={summary.total_positions} />
          <KpiCard label="Open"              value={summary.open_positions}   sub="actively hiring" />
          <KpiCard label="On Hold"           value={summary.on_hold_positions} />
          <KpiCard label="Filled"            value={summary.filled_positions} />
          <KpiCard label="Total Candidates"  value={totalCandidates} />
        </div>
      </div>

      {/* Two-column: pipeline + by company */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>

        {/* Pipeline stages */}
        <div style={{
          background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.CARD, padding: "16px 18px", flex: "1 1 260px",
        }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Candidate Pipeline
          </div>
          {pipeline_breakdown.length === 0 ? (
            <div style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No candidates yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {pipeline_breakdown.map(row => {
                const pct = totalCandidates > 0 ? Math.round((row.candidate_count / totalCandidates) * 100) : 0;
                const colour = STAGE_COLOUR[row.stage] ?? "#6B7280";
                return (
                  <div key={row.stage}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "3px" }}>
                      <span style={{ color: COLOURS.NAVY, fontWeight: 500 }}>{row.stage}</span>
                      <span style={{ color: COLOURS.SLATE }}>{row.candidate_count} ({pct}%)</span>
                    </div>
                    <div style={{ background: COLOURS.HAIRLINE, borderRadius: "4px", height: "6px" }}>
                      <div style={{ background: colour, borderRadius: "4px", height: "6px", width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By company */}
        {by_company.length > 0 && (
          <div style={{
            background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.CARD, padding: "16px 18px", flex: "1 1 260px",
          }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Open Positions by Company
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {by_company.map(row => (
                <div key={row.company} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", color: COLOURS.NAVY }}>{row.company}</span>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{row.open_positions} pos</span>
                    <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{row.total_candidates} cand.</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Positions table */}
      <div style={{
        background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
        borderRadius: RADII.CARD, overflow: "hidden",
      }}>
        {/* Filter tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "0 16px" }}>
          {(["All", "Open", "On Hold", "Filled"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              style={{
                padding: "10px 14px", fontSize: "12px", fontWeight: 500, border: "none",
                borderBottom: filter === tab ? `2px solid ${COLOURS.NAVY}` : "2px solid transparent",
                color: filter === tab ? COLOURS.NAVY : COLOURS.SLATE,
                background: "none", cursor: "pointer", marginBottom: "-1px", whiteSpace: "nowrap",
              }}
            >
              {tab}
              {tab === "All" && ` (${positions.length})`}
              {tab !== "All" && ` (${positions.filter(p => p.status === tab).length})`}
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          {filteredPositions.length === 0 ? (
            <div style={{ padding: "24px", color: COLOURS.SLATE, fontSize: "13px", textAlign: "center" }}>
              No positions found. The next FlowHCM sync will populate this table.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr>
                  {["Position", "Company", "Status", "Date Opened", "Salary Range", "Candidates", "Offers"].map(h => (
                    <th key={h} style={{
                      padding: "10px 12px", textAlign: "left", color: COLOURS.SLATE,
                      fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                      letterSpacing: "0.05em", background: COLOURS.CARD_ALT ?? "#F9FAFB",
                      borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPositions.map(pos => (
                  <tr key={pos.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <td style={{ padding: "10px 12px", color: COLOURS.NAVY, fontWeight: 500 }}>
                      {pos.position_title}
                      {pos.department && (
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>{pos.department}</div>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", color: COLOURS.SLATE }}>{pos.flw_company ?? "—"}</td>
                    <td style={{ padding: "10px 12px" }}><StatusPill status={pos.status} /></td>
                    <td style={{ padding: "10px 12px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>{fmtDate(pos.date_opened)}</td>
                    <td style={{ padding: "10px 12px", color: COLOURS.SLATE }}>{pos.salary_range ?? "—"}</td>
                    <td style={{ padding: "10px 12px", color: COLOURS.NAVY, fontWeight: 600, textAlign: "center" }}>{pos.candidate_count}</td>
                    <td style={{ padding: "10px 12px", color: pos.offer_count > 0 ? "#10B981" : COLOURS.SLATE, fontWeight: pos.offer_count > 0 ? 600 : 400, textAlign: "center" }}>
                      {pos.offer_count > 0 ? pos.offer_count : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Sync note */}
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, textAlign: "right" }}>
        Data sourced from FlowHCM via scheduled sync (every 2 hours)
      </div>

    </div>
  );
}
