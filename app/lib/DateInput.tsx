"use client";

import { useState, useEffect, useRef } from "react";
import { COLOURS } from "./SharedUI";

/**
 * DateInput — cross-browser DD/MM/YYYY date picker.
 *
 * Why: Safari ignores lang="en-GB" and always shows MM/DD/YYYY for
 * <input type="date">. This component shows a plain text input in
 * DD/MM/YYYY, validates as the user types, and calls onChange with
 * a YYYY-MM-DD string (the same format as a native date input) so
 * all existing state/DB code works without changes.
 *
 * Props mirror a native <input type="date">:
 *   value    — YYYY-MM-DD string (or "")
 *   onChange — receives a synthetic event with value as YYYY-MM-DD
 *   min/max  — YYYY-MM-DD strings for optional range clamping
 *   required, style, placeholder — passed through
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
  const [invalid, setInvalid] = useState(false);
  const prevIso = useRef(value);

  // Sync display if parent changes the ISO value externally
  useEffect(() => {
    if (value !== prevIso.current) {
      prevIso.current = value;
      setDisplay(isoToDisplay(value));
      setInvalid(false);
    }
  }, [value]);

  function handleChange(raw: string) {
    // Auto-insert slashes as the user types digits
    let v = raw.replace(/[^\d/]/g, "");

    // Auto-add slashes after day and month
    if (raw.length > display.length) {
      // Only auto-slash on forward typing
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
      // Range check
      if (min && iso < min) { setInvalid(true); return; }
      if (max && iso > max) { setInvalid(true); return; }
      setInvalid(false);
      prevIso.current = iso;
      onChange({ target: { value: iso } });
    } else {
      // Partial entry — don't fire onChange yet
      setInvalid(v.length >= 10);
    }
  }

  function handleBlur() {
    // On blur, either show the valid formatted date or clear invalid state
    const iso = displayToIso(display);
    if (display === "") {
      setInvalid(false);
      return;
    }
    if (iso && isValidDisplay(display)) {
      setDisplay(isoToDisplay(iso)); // normalise e.g. 1/1/2026 → 01/01/2026
      setInvalid(false);
    } else {
      setInvalid(true);
    }
  }

  const borderColor = invalid ? COLOURS.RED : `var(--border-color, ${COLOURS.HAIRLINE})`;

  return (
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
      style={{
        ...style,
        borderColor,
        outline: invalid ? "none" : undefined,
        boxShadow: invalid ? "0 0 0 2px #fca5a5" : undefined,
      }}
    />
  );
}
