"use client";

/**
 * EmployeePicker — reusable FlowHCM employee typeahead (30/08/2026).
 * ─────────────────────────────────────────────────────────────────
 * The single way to reference an employee in any form. Searches the
 * live FlowHCM roster (flw_employees via /api/hr/overview people_list)
 * and returns the selected employee to the parent. Guarantees new
 * records always link to the employee master instead of free text.
 *
 * 09/09/2026 (Salman's bug report): typed-but-unselected text no longer
 * vanishes on blur — it stays visible with an amber "select from the
 * list" hint until a real selection is made. Empty results and 403s now
 * show clear messages instead of a silent empty dropdown.
 *
 *   <EmployeePicker
 *     value={form.employee_name}
 *     onSelect={(emp) => setForm({ ...form, employee_name: emp.full_name, employee_code: emp.employee_code })}
 *     onClear={() => ...}                 // optional
 *     includeLeavers                       // optional — default active only
 *     placeholder="Search employee…"
 *   />
 */

import { useEffect, useState } from "react";
import { authFetch } from "./supabase";
import { COLOURS, RADII, SHADOWS } from "./SharedUI";

export type PickedEmployee = {
  employee_code: string;
  full_name: string | null;
  designation: string | null;
  department: string | null;
  station: string | null;
  email: string | null;
  mobile: string | null;
};

type Props = {
  value?: string;                       // currently-selected display name
  onSelect: (emp: PickedEmployee) => void;
  onClear?: () => void;
  includeLeavers?: boolean;
  placeholder?: string;
  inputStyle?: React.CSSProperties;
};

export default function EmployeePicker({ value, onSelect, onClear, includeLeavers, placeholder, inputStyle }: Props) {
  const [search, setSearch]   = useState("");
  const [results, setResults] = useState<PickedEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const [fetched, setFetched] = useState(false);   // a fetch has completed for the current search
  const [denied, setDenied]   = useState(false);   // API returned 403 — no permission

  // Fetch employees: immediately on open (initial list), or debounced when typing.
  useEffect(() => {
    if (!open) return;
    const delay = search.trim() ? 300 : 0;
    const t = setTimeout(async () => {
      setLoading(true);
      setFetched(false);
      try {
        const params = new URLSearchParams({ section: "people_list", limit: "8" });
        if (search.trim()) params.set("search", search.trim());
        if (includeLeavers) params.set("active", "0");
        const res = await authFetch(`/api/hr/overview?${params.toString()}`);
        if (res.ok) {
          const j = await res.json();
          setResults(j.rows ?? []);
          setDenied(false);
        } else if (res.status === 403) {
          setResults([]);
          setDenied(true);
        } else {
          setResults([]);
        }
        setFetched(true);
      } finally { setLoading(false); }
    }, delay);
    return () => clearTimeout(t);
  }, [search, open, includeLeavers]);

  const baseInput: React.CSSProperties = {
    width: "100%", padding: "8px 12px", fontSize: "13px",
    border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
    outline: "none", color: COLOURS.NAVY, backgroundColor: COLOURS.CARD,
    ...inputStyle,
  };

  // Typed text that never became a selection — keep it visible with a hint
  // instead of silently wiping it (Salman's bug, 09/09/2026).
  const pendingText = !open && !value && search.trim() !== "";

  return (
    <div style={{ position: "relative" }}>
      <input
        style={{
          ...baseInput,
          ...(pendingText ? { borderColor: COLOURS.AMBER } : {}),
        }}
        value={open ? search : (value || search)}
        placeholder={placeholder ?? "Search employee by name or code…"}
        onFocus={() => { setOpen(true); if (value) setSearch(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onChange={(e) => setSearch(e.target.value)}
      />
      {pendingText && (
        <div style={{ fontSize: "11px", color: COLOURS.AMBER, marginTop: "3px" }}>
          Not selected yet — click the field and choose the employee from the list.
        </div>
      )}
      {value && !open && onClear && (
        <button type="button" onClick={onClear} style={{
          position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
          background: "none", border: "none", color: COLOURS.SLATE, cursor: "pointer", fontSize: "14px",
        }} title="Clear">×</button>
      )}
      {open && (
        <div style={{
          position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%",
          backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.SM, boxShadow: SHADOWS.DROPDOWN, maxHeight: "240px", overflowY: "auto",
        }}>
          {loading ? (
            <div style={{ padding: "10px 12px", fontSize: "13px", color: COLOURS.SLATE }}>Searching…</div>
          ) : denied ? (
            <div style={{ padding: "10px 12px", fontSize: "13px", color: COLOURS.RED }}>
              You don't have permission to search employees — ask an administrator.
            </div>
          ) : results.length === 0 && fetched ? (
            <div style={{ padding: "10px 12px", fontSize: "13px", color: COLOURS.SLATE }}>
              No employees found{search.trim() ? ` for "${search.trim()}"` : ""}.
            </div>
          ) : results.map((emp) => (
            <button
              key={emp.employee_code}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onSelect(emp); setOpen(false); setSearch(""); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                fontSize: "13px", color: COLOURS.NAVY, background: "none", border: "none",
                borderBottom: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer",
              }}
            >
              <strong>{emp.full_name ?? "—"}</strong> · {emp.employee_code}
              <span style={{ color: COLOURS.SLATE }}> — {emp.designation ?? "—"} · {emp.station ?? emp.department ?? "—"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
