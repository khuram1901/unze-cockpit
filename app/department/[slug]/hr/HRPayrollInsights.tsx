"use client";

/**
 * HRPayrollInsights.tsx — Payroll tab
 * CEO-level payroll cost view: totals + slice by company / department /
 * location. Data from get_hr_payroll_insights() RPC.
 */

import { useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { COLOURS, RADII } from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";

type Slice = { name: string; heads: number; gross: number; type?: string };
type Insights = {
  total_gross: number; heads_on_payroll: number; avg_cost: number;
  month_allowances: number; month_deductions: number; open_advances: number;
  by_company: Slice[]; by_department: Slice[]; by_location: Slice[];
};

const PKR = (v: number | null | undefined) =>
  v != null ? `PKR ${Number(v).toLocaleString("en-PK")}` : "—";

const card: React.CSSProperties = {
  backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.CARD, padding: "16px",
};

type Dim = "by_company" | "by_department" | "by_location";

export default function HRPayrollInsights() {
  const isMobile = useMobile();
  const [data, setData]       = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim]         = useState<Dim>("by_company");

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/hr/overview?section=payroll");
        if (res.ok) setData(await res.json());
      } finally { setLoading(false); }
    })();
  }, []);

  const slices: Slice[] = data ? (data[dim] ?? []) : [];
  const maxGross = slices[0]?.gross ?? 1;

  const pill = (key: Dim, label: string): React.CSSProperties => ({
    padding: "6px 14px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
    borderRadius: RADII.PILL, border: `1px solid ${dim === key ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: dim === key ? COLOURS.NAVY : COLOURS.CARD,
    color: dim === key ? "#FFFFFF" : COLOURS.SLATE,
  });

  return (
    <div>
      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "14px" }}>
        Monthly cost of the active workforce (gross salaries from FlowHCM salary setup), with this month's allowances and deductions.
      </div>

      {/* Summary cards */}
      <div style={{
        display: "grid", gap: "10px", marginBottom: "16px",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)",
      }}>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Monthly payroll (gross)</div>
          <div style={{ fontSize: "20px", fontWeight: 600, color: COLOURS.NAVY }}>{loading ? "…" : PKR(data?.total_gross)}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Heads on payroll</div>
          <div style={{ fontSize: "20px", fontWeight: 600, color: COLOURS.NAVY }}>{loading ? "…" : data?.heads_on_payroll ?? 0}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Average cost / head</div>
          <div style={{ fontSize: "20px", fontWeight: 600, color: COLOURS.NAVY }}>{loading ? "…" : PKR(data?.avg_cost)}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Allowances (this month)</div>
          <div style={{ fontSize: "20px", fontWeight: 600, color: COLOURS.GREEN }}>{loading ? "…" : PKR(data?.month_allowances)}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Deductions (this month)</div>
          <div style={{ fontSize: "20px", fontWeight: 600, color: COLOURS.RED }}>{loading ? "…" : PKR(data?.month_deductions)}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Approved salary advances</div>
          <div style={{ fontSize: "20px", fontWeight: 600, color: COLOURS.AMBER }}>{loading ? "…" : PKR(data?.open_advances)}</div>
        </div>
      </div>

      {/* Dimension picker */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <button style={pill("by_company", "Company")}    onClick={() => setDim("by_company")}>By company</button>
        <button style={pill("by_department", "Dept")}    onClick={() => setDim("by_department")}>By department</button>
        <button style={pill("by_location", "Location")}  onClick={() => setDim("by_location")}>By location</button>
      </div>

      {/* Cost breakdown */}
      <div style={{ ...card }}>
        {loading ? (
          <div style={{ fontSize: "13px", color: COLOURS.SLATE, textAlign: "center", padding: "24px" }}>Loading…</div>
        ) : slices.length === 0 ? (
          <div style={{ fontSize: "13px", color: COLOURS.SLATE, textAlign: "center", padding: "24px" }}>No payroll data yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {slices.map(s => (
              <div key={s.name} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{
                  fontSize: "12px", color: COLOURS.INK_700, width: isMobile ? "120px" : "220px",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{s.name}</span>
                <div style={{ flex: 1, height: "10px", backgroundColor: COLOURS.TRACK, borderRadius: 5 }}>
                  <div style={{ width: `${Math.max(2, (s.gross / maxGross) * 100)}%`, height: "100%", backgroundColor: COLOURS.BLUE, borderRadius: 5 }} />
                </div>
                <span style={{ fontSize: "12px", color: COLOURS.NAVY, fontWeight: 600, width: isMobile ? "90px" : "130px", textAlign: "right" }}>{PKR(s.gross)}</span>
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, width: "56px", textAlign: "right" }}>{s.heads} staff</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
