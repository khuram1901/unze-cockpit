"use client";

import { useState, useRef, useEffect } from "react";
import DateInput from "./DateInput";
import { COLOURS, RADII } from "./SharedUI";

// Adds the "Pick" button + popover calendar from the finalised Tasks
// mockup, sitting alongside the existing DateInput text field rather than
// replacing it — typing DD/MM/YYYY still works exactly as before. This is
// a custom calendar, not <input type="date">, per the house rule that
// Safari ignores the DD/MM/YYYY locale setting on native date pickers.
// Output is the same YYYY-MM-DD string DateInput already produces.

type Props = {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  required?: boolean;
  style?: React.CSSProperties;
  placeholder?: string;
  id?: string;
};

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export default function DateInputWithCalendar(props: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const base = props.value ? new Date(props.value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(base.getFullYear());
  const [viewMonth, setViewMonth] = useState(base.getMonth());

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function shift(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m);
    setViewYear(y);
  }

  function pick(day: number) {
    const mm = String(viewMonth + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    props.onChange({ target: { value: `${viewYear}-${mm}-${dd}` } });
    setOpen(false);
  }

  const first = new Date(viewYear, viewMonth, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const selectedIso = props.value;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: "5px" }}>
      <DateInput {...props} />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Pick a date"
        style={{
          backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
          padding: "7px 12px", height: "32px", cursor: "pointer", fontSize: "12px", fontWeight: 600,
          flexShrink: 0, color: COLOURS.SLATE,
        }}
      >
        Pick
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, background: COLOURS.CARD,
          border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
          boxShadow: "0 8px 24px rgba(15,23,32,0.14)", padding: "10px", zIndex: 30, width: "220px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12.5px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>
            <span onClick={() => shift(-1)} style={{ cursor: "pointer", padding: "2px 8px", borderRadius: "6px" }}>‹</span>
            <span>{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <span onClick={() => shift(1)} style={{ cursor: "pointer", padding: "2px 8px", borderRadius: "6px" }}>›</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px", textAlign: "center" }}>
            {DOW.map((d, i) => <div key={i} style={{ fontSize: "10px", color: COLOURS.INK_400, fontWeight: 700, padding: "2px 0" }}>{d}</div>)}
            {Array.from({ length: startDay }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSelected = iso === selectedIso;
              return (
                <div
                  key={day}
                  onClick={() => pick(day)}
                  style={{
                    fontSize: "12px", padding: "5px 0", borderRadius: "6px", cursor: "pointer",
                    color: isSelected ? "white" : COLOURS.NAVY,
                    backgroundColor: isSelected ? COLOURS.BLUE : "transparent",
                    fontWeight: isSelected ? 700 : 400,
                  }}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
