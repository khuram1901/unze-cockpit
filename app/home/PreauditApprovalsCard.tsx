"use client";

// Executive Dashboard widget: today's unapproved-documents position from the
// pre-audit team's daily check (Shahid's recommendation, 18/07/2026).
// Target is zero pending at close of business. Renders nothing for users the
// database doesn't authorise (RPC returns an error object for them).

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII, SectionTitle } from "../lib/SharedUI";
import { COMPANIES } from "../lib/constants";

type DailyItem = { company_id: string; doc_type: string; pending: number | null; reason: string | null; entered: boolean };
type Summary = {
  items: DailyItem[]; today_total: number; entered_count: number; expected_count: number;
  yesterday_total: number | null;
};

const DOC_SHORT: Record<string, string> = { PO: "PO", AP: "AP", OUT: "Outgoing", BANK: "Bank portal", JE: "JE" };

export default function PreauditApprovalsCard() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("audit_daily_log_summary");
      if (!error && data && !data.error) setSummary(data as Summary);
    })();
  }, []);

  if (!summary || summary.expected_count === 0) return null;

  const byCompany = COMPANIES.filter((c) => summary.items.some((i) => i.company_id === c.id)).map((c) => {
    const items = summary.items.filter((i) => i.company_id === c.id);
    const pending = items.reduce((s, i) => s + (i.pending || 0), 0);
    const entered = items.filter((i) => i.entered).length;
    const pendingTypes = items.filter((i) => (i.pending || 0) > 0).map((i) => `${DOC_SHORT[i.doc_type] || i.doc_type} ${i.pending}`);
    return { code: c.shortCode, pending, entered, total: items.length, pendingTypes };
  });
  const allEntered = summary.entered_count >= summary.expected_count;
  const totalColor = summary.today_total > 0 ? COLOURS.RED : allEntered ? COLOURS.GREEN : COLOURS.AMBER;

  return (
    <div style={{ marginBottom: "24px" }}>
      <SectionTitle title="Pre-Audit Approvals — Today" />
      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, padding: "16px 18px", marginTop: "8px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
          <span style={{ fontSize: "28px", fontWeight: 700, color: totalColor }}>{summary.today_total}</span>
          <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>
            documents pending approval · {summary.entered_count}/{summary.expected_count} checks entered
            {summary.yesterday_total !== null && <> · yesterday {summary.yesterday_total}</>}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
          {byCompany.map((c) => (
            <div key={c.code} style={{ backgroundColor: COLOURS.CARD_ALT, borderRadius: RADII.SM, padding: "8px 10px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>{c.code}</div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: c.pending > 0 ? COLOURS.RED : c.entered === c.total ? COLOURS.GREEN : COLOURS.AMBER }}>
                {c.entered === 0 ? "—" : c.pending}
              </div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                {c.entered === 0 ? "not entered yet" : c.pending > 0 ? c.pendingTypes.join(" · ") : "all approved"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
