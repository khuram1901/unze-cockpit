"use client";

/**
 * HRFilterBar.tsx — shared filter dropdowns for the HR tabs.
 * Options come from /api/hr/overview?section=filters (one RPC round-trip),
 * cached module-wide so switching tabs doesn't refetch.
 */

import { useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { COLOURS, RADII } from "../../../lib/SharedUI";

export type HRFilterOptions = {
  companies: { id: string; name: string; code: string | null; department_ids: string[]; location_ids: string[]; stations: string[] }[];
  departments: { id: string; name: string }[];
  stations: string[];
  locations: { id: string; name: string }[];
  payroll_months: { year: number; month: number }[];
};

let cached: HRFilterOptions | null = null;

export function useHRFilterOptions(): HRFilterOptions | null {
  const [opts, setOpts] = useState<HRFilterOptions | null>(cached);
  useEffect(() => {
    if (cached) return;
    (async () => {
      const res = await authFetch("/api/hr/overview?section=filters");
      if (res.ok) { cached = await res.json(); setOpts(cached); }
    })();
  }, []);
  return opts;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function FilterSelect({ label, value, onChange, options, minWidth = 150 }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  minWidth?: number;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={label}
      style={{
        minWidth, padding: "8px 10px", fontSize: "13px",
        border: `1px solid ${value ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
        borderRadius: RADII.SM, outline: "none", cursor: "pointer",
        color: value ? COLOURS.NAVY : COLOURS.SLATE,
        backgroundColor: COLOURS.CARD, fontWeight: value ? 600 : 400,
      }}
    >
      <option value="">{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
