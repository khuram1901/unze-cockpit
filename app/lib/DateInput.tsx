"use client";

import { useState, useEffect, useRef } from "react";
import { COLOURS } from "./SharedUI";

/**
 * DateInput — cross-browser DD/MM/YYYY date picker.
 *
 * Why: Safari ignores lang="en-GB" and always shows MM/DD/YYYY for
 * <input type="date">. This component shows a plain text input in
 * DD/MM/YYYY, validates as the user types, and calls onChange with
 * a YYYY-MM-DD string so all existing state/DB code works without changes.
 *
 * The calendar icon opens the browser's native date picker.
 * showPicker() is used for Chrome/Firefox; click() falls back for Safari.
 */

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

function isoToDisplay(iso: string): string {
  if (!iso || iso.length < 10) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

function displayToIso(display: string): string {
  const parts = display.replace(/\s/g, "").split("/");
  if (parts.length !== 3) return "";
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length !== 4) return "";
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  if (Number(mm) < 1 || Number(mm) > 12) return "";
  if (Number(dd) < 1 || Number(dd) > 31) return "";
  return `${y}-${mm}-${dd}`;
}

function isValidDisplay(display: string): boolean {
  const iso = displayToIso(display);
  if (!iso) return false;
  const d = new Date(iso + "T00:00:00");
  return !isNaN(d.getTime());
}

export default function DateInput({ value, onChange, min, max, required, style, placeholder, id }: Props) {
  const [display, setDisplay] = useState(isoToDisplay(value));
  const [invalid, setInvalid]   = useState(false);
  const prevIso   = useRef(value);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Sync display if parent changes the ISO value externally
  useEffect(() => {
    if (value !== prevIso.current) {
      prevIso.current = value;
      setDisplay(isoToDisplay(value));
      setInvalid(false);
    }
  }, [value]);

  function handleChange(raw: string) {
    let v = raw.replace(/[^\d/]/g, "");

    // Auto-add slashes after day and month on forward typing
    if (raw.length > display.length) {
      const digits = v.replace(/\//g, "");
      if (digits.length === 2 && !v.includes("/")) v = v + "/";
      else if (digits.length === 4 && v.indexOf("/") === v.lastIndexOf("/")) v = v + "/";
    }

    setDisplay(v);

    if (v === "") {
      setInvalid(false);
      prevIso.current = "";
      onChange({ target: { value: "" } });
      return;
    }

    const iso = displayToIso(v);
    if (iso && isValidDisplay(v)) {
      if (min && iso < min) { setInvalid(true); return; }
      if (max && iso > max) { setInvalid(true); return; }
      setInvalid(false);
      prevIso.current = iso;
      onChange({ target: { value: iso } });
    } else {
      setInvalid(v.length >= 10);
    }
  }

  function handleBlur() {
    const iso = displayToIso(display);
    if (display === "") { setInvalid(false); return; }
    if (iso && isValidDisplay(display)) {
      setDisplay(isoToDisplay(iso));
      setInvalid(false);
    } else {
      setInvalid(true);
    }
  }

  // Called when the hidden native picker resolves a date
  function handleNativePick(iso: string) {
    if (!iso) return;
    setDisplay(isoToDisplay(iso));
    setInvalid(false);
    prevIso.current = iso;
    onChange({ target: { value: iso } });
  }

  // Open the native date picker via showPicker() (Chrome/Firefox/Safari 16+)
  // Fall back to .click() for older browsers
  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).showPicker();
    } catch {
      el.click();
    }
  }

  const borderColor = invalid ? COLOURS.RED : `var(--border-color, ${COLOURS.HAIRLINE})`;

  // Base input style merged with caller's style
  const inputStyle: React.CSSProperties = {
    ...style,
    borderColor,
    outline: invalid ? "none" : undefined,
    boxShadow: invalid ? "0 0 0 2px #fca5a5" : undefined,
    // Make room for calendar icon on the right
    paddingRight: "34px",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", width: "100%" }}>
      {/* Visible text input: DD/MM/YYYY */}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder || "DD/MM/YYYY"}
        maxLength={10}
        required={required}
        style={inputStyle}
      />

      {/* Calendar icon button */}
      <button
        type="button"
        onClick={openPicker}
        tabIndex={-1}
        aria-label="Open date picker"
        style={{
          position: "absolute", right: "9px",
          background: "none", border: "none", cursor: "pointer",
          padding: "2px", lineHeight: 1,
          color: COLOURS.SLATE, fontSize: "15px",
          display: "flex", alignItems: "center",
          opacity: 0.65,
        }}
      >
        📅
      </button>

      {/* Hidden native date input — opened programmatically */}
      <input
        ref={pickerRef}
        type="date"
        value={value || ""}
        min={min}
        max={max}
        onChange={(e) => handleNativePick(e.target.value)}
        tabIndex={-1}
        style={{
          position: "absolute", opacity: 0,
          pointerEvents: "none",
          width: "1px", height: "1px",
          right: 0, top: 0,
        }}
      />
    </div>
  );
}
