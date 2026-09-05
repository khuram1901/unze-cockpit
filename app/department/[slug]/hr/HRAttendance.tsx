"use client";

/**
 * HRAttendance.tsx — Attendance tab
 * Group-wide daily attendance: present / on leave / absent, plus the
 * stations with the highest absence. Data from get_hr_attendance_overview().
 */

import { useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import { COLOURS, RADII } from "../../../lib/SharedUI";
import DateInput from "../../../lib/DateInput";
import { useMobile } from "../../../lib/useMobile";
import { useHRFilterOptions, FilterSelect } from "./HRFilterBar";

type StationRow = { station: string; active: number; absent: number };
type Overview = {
  date: string; active: number; present: number; on_leave: number; absent: number;
  by_station_absence: StationRow[];
};

const card: React.CSSProperties = {
  backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.CARD, padding: "16px",
};

export default function HRAttendance() {
  const isMobile = useMobile();
  const [date, setDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [company, setCompany] = useState("");
  const [station, setStation] = useState("");
  const [data, setData]       = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const filterOpts = useHRFilterOptions();

  const handleCompanyChange = (v: string) => { setCompany(v); setStation(""); };
  const selectedCo = company ? (filterOpts?.companies ?? []).find(c => c.id === company) : null;
  const visibleStations = selectedCo
    ? (selectedCo.stations ?? [])
    : (filterOpts?.stations ?? []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ section: "attendance", date });
        if (company) params.set("company", company);
        if (station) params.set("station", station);
        const res = await authFetch(`/api/hr/overview?${params.toString()}`);
        if (res.ok) setData(await res.json());
      } finally { setLoading(false); }
    })();
  }, [date, company, station]);

  const presentPct = data && data.active > 0 ? Math.round((data.present / data.active) * 100) : 0;

  return (
    <div>
      {/* Date picker */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>Attendance for</span>
        <div style={{ width: "140px" }}>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {data && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>({formatDateUK(data.date)})</span>}
        <FilterSelect label="All companies" value={company} onChange={handleCompanyChange}
          options={(filterOpts?.companies ?? []).map(co => ({ value: co.id, label: co.name }))} />
        <FilterSelect label="All stations" value={station} onChange={setStation}
          options={visibleStations.map(s => ({ value: s, label: s }))} />
        {(company || station) && (
          <button onClick={() => { setCompany(""); setStation(""); }} style={{
            padding: "8px 12px", fontSize: "13px", cursor: "pointer", color: COLOURS.SLATE,
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD,
          }}>Clear</button>
        )}
      </div>

      {/* Summary cards */}
      <div style={{
        display: "grid", gap: "10px", marginBottom: "16px",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)",
      }}>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Active staff</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.NAVY }}>{loading ? "…" : (data?.active ?? 0).toLocaleString("en-GB")}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Present</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.GREEN }}>{loading ? "…" : data?.present ?? 0}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Present %</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: presentPct >= 85 ? COLOURS.GREEN : presentPct >= 70 ? COLOURS.AMBER : COLOURS.RED }}>
            {loading ? "…" : `${presentPct}%`}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>On leave</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.AMBER }}>{loading ? "…" : data?.on_leave ?? 0}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Absent / no record</div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.RED }}>{loading ? "…" : data?.absent ?? 0}</div>
        </div>
      </div>

      {/* Worst stations */}
      <div style={{ ...card }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" }}>Highest absence by station</div>
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px" }}>
          "Absent" means no FlowHCM sign-in and no approved leave. Weekend and off-day staff appear absent — read alongside the day of week.
        </div>
        {loading ? (
          <div style={{ fontSize: "13px", color: COLOURS.SLATE, textAlign: "center", padding: "16px" }}>Loading…</div>
        ) : (data?.by_station_absence ?? []).length === 0 ? (
          <div style={{ fontSize: "13px", color: COLOURS.SLATE, textAlign: "center", padding: "16px" }}>No absences recorded.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(data?.by_station_absence ?? []).map(s => {
              const pct = s.active > 0 ? Math.round((s.absent / s.active) * 100) : 0;
              return (
                <div key={s.station} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{
                    fontSize: "12px", color: COLOURS.INK_700, width: isMobile ? "130px" : "220px",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{s.station}</span>
                  <div style={{ flex: 1, height: "10px", backgroundColor: COLOURS.TRACK, borderRadius: 5 }}>
                    <div style={{
                      width: `${Math.max(2, pct)}%`, height: "100%", borderRadius: 5,
                      backgroundColor: pct >= 50 ? COLOURS.RED : pct >= 25 ? COLOURS.AMBER : COLOURS.GREEN,
                    }} />
                  </div>
                  <span style={{ fontSize: "12px", color: COLOURS.NAVY, fontWeight: 600, width: "80px", textAlign: "right" }}>
                    {s.absent} / {s.active}
                  </span>
                  <span style={{ fontSize: "11px", color: COLOURS.SLATE, width: "40px", textAlign: "right" }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
