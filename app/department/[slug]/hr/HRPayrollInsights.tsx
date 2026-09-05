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
import { useHRFilterOptions, FilterSelect, MONTH_NAMES } from "./HRFilterBar";

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
  const [ym, setYm]           = useState("");   // "2026-8"; "" = current month
  const [company, setCompany]       = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation]     = useState("");
  const filterOpts = useHRFilterOptions();

  const handleCompanyChange = (v: string) => { setCompany(v); setDepartment(""); setLocation(""); };
  const selectedCo = company ? (filterOpts?.companies ?? []).find(c => c.id === company) : null;
  const visibleDepts = selectedCo
    ? (filterOpts?.departments ?? []).filter(d => (selectedCo.department_ids ?? []).includes(d.id))
    : (filterOpts?.departments ?? []);
  const visibleLocations = selectedCo
    ? (filterOpts?.locations ?? []).filter(l => (selectedCo.location_ids ?? []).includes(l.id))
    : (filterOpts?.locations ?? []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ section: "payroll" });
        if (ym) {
          const [y, m] = ym.split("-");
          params.set("year", y);
          params.set("month", m);
        }
        if (company) params.set("company", company);
        if (department) params.set("department", department);
        if (location) params.set("location", location);
        const res = await authFetch(`/api/hr/overview?${params.toString()}`);
        if (res.ok) setData(await res.json());
      } finally { setLoading(false); }
    })();
  }, [ym, company, department, location]);

  const monthLabel = (() => {
    if (ym) {
      const [y, m] = ym.split("-").map(Number);
      return `${MONTH_NAMES[m - 1]} ${y}`;
    }
    const now = new Date();
    return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  })();

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
        Gross salaries are the current FlowHCM salary setup (a live snapshot — FlowHCM keeps no salary history).
        Allowances, deductions and advances are for the selected month; months appear here as FlowHCM data arrives.
      </div>

      {/* Month + filters */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
        <FilterSelect label={`Month: ${monthLabel}`} value={ym} onChange={setYm} minWidth={170}
          options={(filterOpts?.payroll_months ?? []).map(pm => ({
            value: `${pm.year}-${pm.month}`, label: `${MONTH_NAMES[pm.month - 1]} ${pm.year}`,
          }))} />
        <FilterSelect label="All companies" value={company} onChange={handleCompanyChange}
          options={(filterOpts?.companies ?? []).map(co => ({ value: co.id, label: co.name }))} />
        <FilterSelect label="All departments" value={department} onChange={setDepartment}
          options={visibleDepts.map(d => ({ value: d.id, label: d.name }))} />
        <FilterSelect label="All locations" value={location} onChange={setLocation}
          options={visibleLocations.map(l => ({ value: l.id, label: l.name }))} />
        {(ym || company || department || location) && (
          <button onClick={() => { setYm(""); setCompany(""); setDepartment(""); setLocation(""); }} style={{
            padding: "8px 12px", fontSize: "13px", cursor: "pointer", color: COLOURS.SLATE,
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD,
          }}>Clear</button>
        )}
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
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>{`Allowances (${monthLabel})`}</div>
          <div style={{ fontSize: "20px", fontWeight: 600, color: COLOURS.GREEN }}>{loading ? "…" : PKR(data?.month_allowances)}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>{`Deductions (${monthLabel})`}</div>
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
