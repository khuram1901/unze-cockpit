"use client";

/**
 * HRMovement.tsx — Workforce movement tab
 * Joiners and leavers for a selected period, sliced by department and
 * company. Data from get_hr_movement() RPC.
 */

import { useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { COLOURS, RADII } from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";

type Row = { name: string; joined: number; left: number; active: number };
type Movement = { joined: number; left: number; active_now: number; by_department: Row[]; by_company: Row[] };

type Period = "month" | "quarter" | "year";

const card: React.CSSProperties = {
  backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.CARD, padding: "16px",
};

function rangeFor(p: Period): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const days = p === "month" ? 30 : p === "quarter" ? 91 : 365;
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  return { from, to };
}

export default function HRMovement() {
  const isMobile = useMobile();
  const [period, setPeriod]   = useState<Period>("month");
  const [data, setData]       = useState<Movement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { from, to } = rangeFor(period);
        const res = await authFetch(`/api/hr/overview?section=movement&from=${from}&to=${to}`);
        if (res.ok) setData(await res.json());
      } finally { setLoading(false); }
    })();
  }, [period]);

  const pill = (key: Period): React.CSSProperties => ({
    padding: "6px 14px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
    borderRadius: RADII.PILL, border: `1px solid ${period === key ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: period === key ? COLOURS.NAVY : COLOURS.CARD,
    color: period === key ? "#FFFFFF" : COLOURS.SLATE,
  });

  const th: React.CSSProperties = {
    textAlign: "left", padding: "8px 12px", fontSize: "11px", fontWeight: 600,
    color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  };
  const td: React.CSSProperties = {
    padding: "8px 12px", fontSize: "13px", color: COLOURS.NAVY,
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  };

  const net = data ? data.joined - data.left : 0;

  const MovementTable = ({ title, rows }: { title: string; rows: Row[] }) => (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, padding: "14px 16px 8px" }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>{title === "By company" ? "Company" : "Department"}</th>
            <th style={{ ...th, textAlign: "right", color: COLOURS.GREEN }}>Joined</th>
            <th style={{ ...th, textAlign: "right", color: COLOURS.RED }}>Left</th>
            <th style={{ ...th, textAlign: "right" }}>Net</th>
            <th style={{ ...th, textAlign: "right" }}>Active now</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: COLOURS.SLATE, padding: "20px" }}>No movement in this period.</td></tr>
          ) : rows.map(r => {
            const n = r.joined - r.left;
            return (
              <tr key={r.name}>
                <td style={{ ...td, fontWeight: 500 }}>{r.name}</td>
                <td style={{ ...td, textAlign: "right", color: r.joined > 0 ? COLOURS.GREEN : COLOURS.SLATE }}>{r.joined}</td>
                <td style={{ ...td, textAlign: "right", color: r.left > 0 ? COLOURS.RED : COLOURS.SLATE }}>{r.left}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600, color: n > 0 ? COLOURS.GREEN : n < 0 ? COLOURS.RED : COLOURS.SLATE }}>
                  {n > 0 ? `+${n}` : n}
                </td>
                <td style={{ ...td, textAlign: "right" }}>{r.active}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      {/* Period picker */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button style={pill("month")}   onClick={() => setPeriod("month")}>Last 30 days</button>
        <button style={pill("quarter")} onClick={() => setPeriod("quarter")}>Last quarter</button>
        <button style={pill("year")}    onClick={() => setPeriod("year")}>Last 12 months</button>
      </div>

      {/* Summary cards */}
      <div style={{
        display: "grid", gap: "10px", marginBottom: "16px",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
      }}>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Joined</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.GREEN }}>{loading ? "…" : data?.joined ?? 0}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Left</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.RED }}>{loading ? "…" : data?.left ?? 0}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Net change</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: net > 0 ? COLOURS.GREEN : net < 0 ? COLOURS.RED : COLOURS.NAVY }}>
            {loading ? "…" : net > 0 ? `+${net}` : net}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Active now</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.NAVY }}>{loading ? "…" : (data?.active_now ?? 0).toLocaleString("en-GB")}</div>
        </div>
      </div>

      {/* Tables */}
      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", alignItems: "start" }}>
        <MovementTable title="By company"    rows={data?.by_company ?? []} />
        <MovementTable title="By department" rows={data?.by_department ?? []} />
      </div>
    </div>
  );
}
