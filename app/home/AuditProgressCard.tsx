"use client";

// Executive Dashboard: Audit Portfolio Progress (CEO view).
// Shows per-team completion %, on-track vs overdue project counts,
// and an overall portfolio bar — so the CEO can see at a glance
// whether the audit programme is running on time.
// Replaces the pre-audit daily approvals card (moved to audit page for Shahid).

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII, SectionTitle } from "../lib/SharedUI";
import { formatDateUK } from "../lib/dateUtils";

type TeamStat = {
  id: string; name: string; code: string;
  total: number; done: number; running: number; planned: number;
  overdue: number; on_track: number; avg_pct: number;
  next_deadline: string | null;
};

type Overall = {
  total: number; done: number; running: number; planned: number;
  overdue: number; on_track: number; avg_pct: number;
};

type Summary = { overall: Overall; teams: TeamStat[] };

function MiniBar({ pct, overdue }: { pct: number; overdue: boolean }) {
  const fill = overdue ? COLOURS.RED : pct >= 80 ? COLOURS.GREEN : pct >= 40 ? COLOURS.AMBER : COLOURS.SLATE;
  return (
    <div style={{ height: "6px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${pct}%`, height: "100%", backgroundColor: fill, borderRadius: RADII.PILL, transition: "width 0.4s ease" }} />
    </div>
  );
}

function Pill({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 7px", borderRadius: RADII.PILL, backgroundColor: bg, color: text, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

export default function AuditProgressCard() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("audit_executive_summary");
      if (!error && data && !data.error) setSummary(data as Summary);
    })();
  }, []);

  if (!summary) return null;

  const { overall, teams } = summary;
  const donePct = overall.total > 0 ? Math.round((100 * overall.done) / overall.total) : 0;
  const anyOverdue = overall.overdue > 0;

  return (
    <div style={{ marginBottom: "24px" }}>
      <SectionTitle title="Internal Audit Portfolio" />

      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginTop: "8px" }}>

        {/* ── Overall header row ── */}
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "2px" }}>Overall completion</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
              <span style={{ fontSize: "30px", fontWeight: 700, color: anyOverdue ? COLOURS.RED : COLOURS.NAVY, lineHeight: 1 }}>{donePct}%</span>
              <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{overall.done} of {overall.total} projects done</span>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: "160px" }}>
            <MiniBar pct={donePct} overdue={false} />
            <div style={{ display: "flex", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
              {overall.done > 0 && <Pill label={`${overall.done} done`} bg={COLOURS.SUCCESS_SOFT} text={COLOURS.GREEN} />}
              {overall.on_track > 0 && <Pill label={`${overall.on_track} on track`} bg="#EEF1FC" text={COLOURS.BLUE} />}
              {overall.overdue > 0 && <Pill label={`${overall.overdue} overdue`} bg="#FEE2E2" text={COLOURS.RED} />}
              {overall.planned > 0 && <Pill label={`${overall.planned} planned`} bg={COLOURS.CARD_ALT} text={COLOURS.SLATE} />}
            </div>
          </div>

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "2px" }}>Avg progress</div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: overall.avg_pct >= 60 ? COLOURS.GREEN : COLOURS.AMBER }}>{overall.avg_pct}%</div>
          </div>
        </div>

        {/* ── Per-team rows ── */}
        {teams.map((t) => {
          const tDonePct = t.total > 0 ? Math.round((100 * t.done) / t.total) : 0;
          const isOverdue = t.overdue > 0;
          const health = isOverdue ? { color: COLOURS.RED, label: `${t.overdue} overdue` }
            : t.running > 0 ? { color: COLOURS.GREEN, label: "On track" }
            : { color: COLOURS.SLATE, label: "Planned" };

          return (
            <div key={t.id} style={{ padding: "13px 18px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>

              {/* Team name + health */}
              <div style={{ minWidth: "160px", flex: "0 0 auto" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{t.name}</div>
                <div style={{ fontSize: "11px", fontWeight: 600, color: health.color, marginTop: "2px" }}>{health.label}</div>
              </div>

              {/* Progress bar */}
              <div style={{ flex: 1, minWidth: "100px" }}>
                <MiniBar pct={tDonePct} overdue={isOverdue} />
              </div>

              {/* Stats */}
              <div style={{ display: "flex", gap: "14px", flexShrink: 0, alignItems: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: isOverdue ? COLOURS.RED : COLOURS.NAVY }}>{t.avg_pct}%</div>
                  <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>avg progress</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.GREEN }}>{t.done}</div>
                  <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>done</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.AMBER }}>{t.running}</div>
                  <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>running</div>
                </div>
                {t.next_deadline && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Next deadline</div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{formatDateUK(t.next_deadline)}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* ── Footer note ── */}
        <div style={{ padding: "8px 18px", backgroundColor: COLOURS.CARD_ALT }}>
          <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>FY 2025-26 · Pre-audit daily checks tracked separately on the Audit page</span>
        </div>
      </div>
    </div>
  );
}
