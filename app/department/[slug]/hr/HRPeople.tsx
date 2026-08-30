"use client";

/**
 * HRPeople.tsx — People tab
 * Employee directory + headcount overview. All aggregation via
 * get_hr_people_overview() RPC; directory via people_list section.
 */

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import { COLOURS, RADII, SkeletonRows } from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";

type Overview = {
  total_active: number; total_leavers: number;
  joined_30d: number; left_30d: number;
  by_company: { name: string; code: string; active: number }[];
  by_department: { name: string; active: number }[];
};

type Person = {
  employee_code: string; full_name: string | null; designation: string | null;
  department: string | null; station: string | null; grade: string | null;
  status: string | null; email: string | null; mobile: string | null;
  joining_date: string | null; is_active: boolean;
};

const card: React.CSSProperties = {
  backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.CARD, padding: "16px",
};

function Metric({ label, value, colour }: { label: string; value: string | number; colour?: string }) {
  return (
    <div style={{ ...card, padding: "14px 16px" }}>
      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "22px", fontWeight: 600, color: colour ?? COLOURS.NAVY }}>{value}</div>
    </div>
  );
}

export default function HRPeople() {
  const isMobile = useMobile();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [people, setPeople]     = useState<Person[]>([]);
  const [total, setTotal]       = useState(0);
  const [search, setSearch]     = useState("");
  const [showLeavers, setShowLeavers] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [listLoading, setListLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/hr/overview?section=people");
        if (res.ok) setOverview(await res.json());
      } finally { setLoading(false); }
    })();
  }, []);

  const loadList = useCallback(async (q: string, leavers: boolean) => {
    setListLoading(true);
    try {
      const params = new URLSearchParams({ section: "people_list", limit: "100" });
      if (q) params.set("search", q);
      if (leavers) params.set("active", "0");
      const res = await authFetch(`/api/hr/overview?${params.toString()}`);
      if (res.ok) {
        const j = await res.json();
        setPeople(j.rows ?? []);
        setTotal(j.total ?? 0);
      }
    } finally { setListLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadList(search, showLeavers), 350);
    return () => clearTimeout(t);
  }, [search, showLeavers, loadList]);

  const th: React.CSSProperties = {
    textAlign: "left", padding: "8px 12px", fontSize: "11px", fontWeight: 600,
    color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap",
    position: "sticky", top: 0, backgroundColor: COLOURS.CARD_ALT,
  };
  const td: React.CSSProperties = {
    padding: "8px 12px", fontSize: "13px", color: COLOURS.NAVY,
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap",
  };

  return (
    <div>
      {/* Headcount cards */}
      <div style={{
        display: "grid", gap: "10px", marginBottom: "16px",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
      }}>
        <Metric label="Active employees" value={loading ? "…" : overview?.total_active ?? 0} />
        <Metric label="Joined (30 days)"  value={loading ? "…" : overview?.joined_30d ?? 0} colour={COLOURS.GREEN} />
        <Metric label="Left (30 days)"    value={loading ? "…" : overview?.left_30d ?? 0}   colour={COLOURS.RED} />
        <Metric label="Historic leavers"  value={loading ? "…" : (overview?.total_leavers ?? 0).toLocaleString("en-GB")} colour={COLOURS.SLATE} />
      </div>

      {/* Company chips */}
      {overview && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
          {overview.by_company.map(c => (
            <span key={c.code} style={{
              fontSize: "12px", padding: "4px 10px", borderRadius: RADII.PILL,
              backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, color: COLOURS.INK_700,
            }}>
              <strong style={{ color: COLOURS.NAVY }}>{c.code}</strong> {c.active}
            </span>
          ))}
        </div>
      )}

      {/* Directory controls */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, code or designation…"
          style={{
            flex: isMobile ? "1 1 100%" : "0 1 320px", padding: "9px 12px", fontSize: "13px",
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
            outline: "none", color: COLOURS.NAVY, backgroundColor: COLOURS.CARD,
          }}
        />
        <label style={{ fontSize: "13px", color: COLOURS.SLATE, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
          <input type="checkbox" checked={showLeavers} onChange={e => setShowLeavers(e.target.checked)} />
          Include leavers
        </label>
        <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
          {listLoading ? "Loading…" : `${total.toLocaleString("en-GB")} ${showLeavers ? "records" : "active"}`}
        </span>
      </div>

      {/* Directory table */}
      <div style={{ ...card, padding: 0, overflow: "auto", maxHeight: "560px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Code</th><th style={th}>Name</th><th style={th}>Designation</th>
              <th style={th}>Department</th><th style={th}>Station</th><th style={th}>Grade</th>
              <th style={th}>Email</th><th style={th}>Mobile</th><th style={th}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {listLoading ? (
              <SkeletonRows count={8} />
            ) : people.length === 0 ? (
              <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: COLOURS.SLATE, padding: "24px" }}>No employees found.</td></tr>
            ) : people.map(p => (
              <tr key={p.employee_code}>
                <td style={td}>{p.employee_code}</td>
                <td style={{ ...td, fontWeight: 500 }}>{p.full_name ?? "—"}</td>
                <td style={td}>{p.designation ?? "—"}</td>
                <td style={td}>{p.department ?? "—"}</td>
                <td style={td}>{p.station ?? "—"}</td>
                <td style={td}>{p.grade ?? "—"}</td>
                <td style={{ ...td, color: COLOURS.SLATE }}>{p.email ?? "—"}</td>
                <td style={td}>{p.mobile ?? "—"}</td>
                <td style={td}>{p.joining_date ? formatDateUK(p.joining_date) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Department breakdown */}
      {overview && overview.by_department.length > 0 && (
        <div style={{ ...card, marginTop: "16px" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "10px" }}>Active headcount by department</div>
          <div style={{ display: "grid", gap: "6px", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)" }}>
            {overview.by_department.map(d => {
              const max = overview.by_department[0]?.active ?? 1;
              return (
                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", color: COLOURS.INK_700, width: "180px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                  <div style={{ flex: 1, height: "8px", backgroundColor: COLOURS.TRACK, borderRadius: 4 }}>
                    <div style={{ width: `${Math.max(2, (d.active / max) * 100)}%`, height: "100%", backgroundColor: COLOURS.BLUE, borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: "12px", color: COLOURS.NAVY, fontWeight: 600, width: "40px", textAlign: "right" }}>{d.active}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
