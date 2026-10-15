"use client";

/**
 * /visitor-entry — Mobile-first visitor check-in form.
 *
 * Screens:
 *   "loading"  — auth check + departments/hosts fetch
 *   "form"     — entry form (autofill by CNIC or mobile for returning visitors)
 *   "confirm"  — bottom-sheet review before submit
 *   "success"  — confirmation with "Log Another" button
 *
 * Hidden from nav (no permKey in PAGE_REGISTRY sidebar link).
 * Accessible via bookmarked link for reception/security staff.
 * Date defaults to today PKT; Time In defaults to now PKT.
 * Returns visitor autofill + flag warning on CNIC/mobile lookup.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import DateInput from "../lib/DateInput";

// ── Colours (match design system) ────────────────────────────────────────────
const C = {
  NAVY:    "#0F1720",
  SLATE:   "#64748B",
  BORDER:  "#EEF0F3",
  GREEN:   "#0F7B5F",
  AMBER:   "#B4791F",
  RED:     "#B3261E",
  CARD:    "#FFFFFF",
  BG:      "#F8F9FA",
  SUCCESS_SOFT: "#D1FAE5",
  WARNING_SOFT: "#FEF3C7",
  DANGER_SOFT:  "#FEE2E2",
};

const PILL = "999px";

// ── Types ─────────────────────────────────────────────────────────────────────
type Screen = "loading" | "form" | "confirm" | "success";

interface Host {
  id: string;
  full_name: string;
  department: string | null;
}

interface FormState {
  visit_date:    string;
  visitor_name:  string;
  mobile:        string;   // user types without +92 or with it
  cnic:          string;   // user types as 12345-1234567-1 or raw digits
  department:    string;
  host_id:       string;
  host_name:     string;
  purpose:       string;
  purpose_other: string;
  comments:      string;
  time_in:       string;   // HH:MM
}

const PURPOSES = [
  "Vendor/Payment",
  "Interview",
  "Meeting",
  "Delivery",
  "Government/Official",
  "Personal",
  "Other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function nowPkt(): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** Normalise mobile to +923XXXXXXXXX */
function normaliseMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("923") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("03") && digits.length === 11)  return `+92${digits.slice(1)}`;
  if (digits.startsWith("3") && digits.length === 10)   return `+92${digits}`;
  return raw.trim();  // pass through for validation error
}

/** Strip CNIC to 13 digits */
function normaliseCnic(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Display CNIC as 12345-1234567-1 */
function displayCnic(digits: string): string {
  if (digits.length !== 13) return digits;
  return `${digits.slice(0,5)}-${digits.slice(5,12)}-${digits.slice(12)}`;
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

const EMPTY_FORM = (): FormState => {
  const { date, time } = nowPkt();
  return {
    visit_date: date, visitor_name: "", mobile: "", cnic: "",
    department: "", host_id: "", host_name: "", purpose: "",
    purpose_other: "", comments: "", time_in: time,
  };
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function VisitorEntryPage() {
  const [screen, setScreen]       = useState<Screen>("loading");
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [departments, setDepts]   = useState<string[]>([]);
  const [allHosts, setAllHosts]   = useState<Host[]>([]);
  const [hosts, setHosts]         = useState<Host[]>([]);   // filtered by dept
  const [hostSearch, setHostSearch] = useState("");
  const [flag, setFlag]           = useState<"vip" | "blacklist" | null>(null);
  const [flagReason, setFlagReason] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const mobileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cnicTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth guard: any logged-in user can access this form
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = "/login?next=/visitor-entry"; return; }
      loadDepts();
    });
  }, []);

  async function loadDepts() {
    try {
      const res = await apiFetch("/api/visitors/departments");
      const data = await res.json();
      setDepts(data.departments ?? []);
      setAllHosts(data.hosts ?? []);
      setScreen("form");
    } catch {
      setError("Failed to load form data. Please refresh.");
      setScreen("form");
    }
  }

  // Filter hosts when dept changes
  useEffect(() => {
    const dept = form.department.toLowerCase();
    if (!dept) {
      setHosts(allHosts);
    } else {
      setHosts(allHosts.filter((h) =>
        h.department?.toLowerCase() === dept
      ));
    }
    // Clear host selection when dept changes
    setForm((f) => ({ ...f, host_id: "", host_name: "" }));
    setHostSearch("");
  }, [form.department, allHosts]);

  // Autofill lookup on mobile change (debounced 800ms)
  const triggerLookup = useCallback(async (mobile: string, cnic: string) => {
    const normMobile = normaliseMobile(mobile);
    const normCnic   = normaliseCnic(cnic);
    if (normMobile.length < 13 && normCnic.length < 13) return;

    setLookingUp(true);
    try {
      const params = new URLSearchParams();
      if (normCnic.length === 13) params.set("cnic", normCnic);
      else if (/^\+923\d{9}$/.test(normMobile)) params.set("mobile", normMobile);
      else return;

      const res = await apiFetch(`/api/visitors/lookup?${params}`);
      const data = await res.json();
      if (data.found) {
        setForm((f) => ({
          ...f,
          visitor_name:  data.visitor_name  || f.visitor_name,
          mobile:        data.mobile        || f.mobile,
          cnic:          displayCnic(data.cnic || "") || f.cnic,
          department:    data.department_name || f.department,
          host_id:       data.host_member_id  || f.host_id,
          host_name:     data.host_name       || f.host_name,
          purpose:       data.purpose         || f.purpose,
        }));
      }
      setFlag(data.flag || null);
      setFlagReason(data.flag_reason || null);
    } finally {
      setLookingUp(false);
    }
  }, []);

  function set(key: keyof FormState, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
    // Trigger lookup on mobile/cnic change
    if (key === "mobile") {
      if (mobileTimer.current) clearTimeout(mobileTimer.current);
      mobileTimer.current = setTimeout(() => triggerLookup(val, form.cnic), 800);
    }
    if (key === "cnic") {
      if (cnicTimer.current) clearTimeout(cnicTimer.current);
      cnicTimer.current = setTimeout(() => triggerLookup(form.mobile, val), 800);
    }
  }

  // Validation
  function validate(): string | null {
    if (!form.visit_date)    return "Date is required";
    if (!form.visitor_name.trim()) return "Visitor name is required";
    const nm = normaliseMobile(form.mobile);
    if (!/^\+923\d{9}$/.test(nm)) return "Mobile must be +923XXXXXXXXX (11 digits after 0)";
    const cnic = normaliseCnic(form.cnic);
    if (form.cnic && cnic.length !== 13) return "CNIC must be 13 digits";
    if (!form.department)   return "Department is required";
    if (!form.host_name)    return "Person to Meet is required";
    if (!form.purpose)      return "Purpose is required";
    if (form.purpose === "Other" && !form.purpose_other.trim()) return "Please describe the purpose";
    if (!form.time_in)      return "Time In is required";
    return null;
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const nm = normaliseMobile(form.mobile);
      const nc = normaliseCnic(form.cnic);
      const { date } = nowPkt();
      // Compose time_in as full ISO timestamp in PKT
      const [hh, mm] = form.time_in.split(":");
      const timeIn = new Date();
      const pktOffset = 5 * 60; // PKT = UTC+5
      const utcMs = Date.UTC(
        parseInt(form.visit_date.slice(0,4)),
        parseInt(form.visit_date.slice(5,7)) - 1,
        parseInt(form.visit_date.slice(8,10)),
        parseInt(hh) - 5, parseInt(mm), 0
      );
      const timeInIso = new Date(utcMs).toISOString();
      void timeIn; void pktOffset; void date;

      const res = await apiFetch("/api/visitors/check-in", {
        method: "POST",
        body: JSON.stringify({
          visit_date:    form.visit_date,
          visitor_name:  form.visitor_name.trim(),
          mobile:        nm,
          cnic:          nc.length === 13 ? nc : null,
          department_name: form.department,
          host_member_id:  form.host_id || null,
          host_name:       form.host_name,
          purpose:         form.purpose,
          purpose_other:   form.purpose === "Other" ? form.purpose_other.trim() : null,
          comments:        form.comments.trim() || null,
          time_in:         timeInIso,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Save failed"); return; }
      setSubmittedId(data.id);
      setScreen("success");
    } finally {
      setSaving(false);
    }
  }

  // ── Filtered host list for search ──
  const filteredHosts = hosts.filter((h) =>
    h.full_name.toLowerCase().includes(hostSearch.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const containerStyle: React.CSSProperties = {
    minHeight: "100dvh",
    backgroundColor: C.BG,
    fontFamily: "'Inter', sans-serif",
    color: C.NAVY,
  };
  const cardStyle: React.CSSProperties = {
    background: C.CARD,
    borderRadius: "16px",
    padding: "20px 16px",
    marginBottom: "12px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "12px", fontWeight: 600,
    color: C.SLATE, marginBottom: "6px", letterSpacing: "0.02em",
  };
  const inputStyleLocal: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    padding: "12px 14px", borderRadius: "10px",
    border: `1.5px solid ${C.BORDER}`, fontSize: "16px",
    color: C.NAVY, background: C.CARD, outline: "none",
    WebkitAppearance: "none",
  };
  const btnPrimary: React.CSSProperties = {
    width: "100%", padding: "16px", borderRadius: PILL,
    backgroundColor: C.NAVY, color: "white",
    fontSize: "16px", fontWeight: 700, border: "none",
    cursor: saving ? "not-allowed" : "pointer",
    opacity: saving ? 0.7 : 1,
  };

  // ── Loading screen ────────────────────────────────────────────────────────
  if (screen === "loading") {
    return (
      <div style={{ ...containerStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: C.SLATE }}>Loading…</p>
      </div>
    );
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (screen === "success") {
    return (
      <div style={{ ...containerStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", textAlign: "center" }}>
        <div style={{ fontSize: "56px", marginBottom: "16px" }}>✅</div>
        <h2 style={{ fontSize: "22px", fontWeight: 800, margin: "0 0 8px" }}>Visitor Logged</h2>
        <p style={{ color: C.SLATE, margin: "0 0 32px" }}>
          {form.visitor_name} has been checked in to see {form.host_name}.<br />
          Entry ID: <code style={{ fontSize: "12px" }}>{submittedId?.slice(0,8)}</code>
        </p>
        <button
          onClick={() => { setForm(EMPTY_FORM()); setFlag(null); setFlagReason(null); setError(null); setScreen("form"); }}
          style={btnPrimary}
        >Log Another Visitor</button>
      </div>
    );
  }

  // ── Confirm bottom-sheet ──────────────────────────────────────────────────
  if (screen === "confirm") {
    const nm = normaliseMobile(form.mobile);
    const nc = normaliseCnic(form.cnic);
    const rows: [string, string][] = [
      ["Date",        form.visit_date],
      ["Time In",     form.time_in],
      ["Visitor",     form.visitor_name],
      ["Mobile",      nm.slice(0,7) + "****"],
      ...(nc.length === 13 ? [["CNIC", displayCnic(nc)] as [string,string]] : []),
      ["Department",  form.department],
      ["Meeting",     form.host_name],
      ["Purpose",     form.purpose === "Other" ? `Other — ${form.purpose_other}` : form.purpose],
      ...(form.comments ? [["Comments", form.comments] as [string,string]] : []),
    ];
    return (
      <div style={{ ...containerStyle, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "24px 16px 0", flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 800 }}>Confirm Check-In</h2>
          <p style={{ color: C.SLATE, margin: "4px 0 16px", fontSize: "14px" }}>Review details before logging</p>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
          <div style={cardStyle}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.BORDER}` }}>
                <span style={{ color: C.SLATE, fontSize: "14px" }}>{k}</span>
                <span style={{ fontWeight: 600, fontSize: "14px", textAlign: "right", maxWidth: "60%" }}>{v}</span>
              </div>
            ))}
          </div>
          {error && (
            <div style={{ background: C.DANGER_SOFT, border: `1px solid ${C.RED}`, borderRadius: "10px", padding: "12px 14px", marginBottom: "12px", color: C.RED, fontSize: "14px" }}>
              {error}
            </div>
          )}
        </div>
        <div style={{ padding: "12px 16px 24px", display: "flex", gap: "12px", borderTop: `1px solid ${C.BORDER}` }}>
          <button
            onClick={() => { setError(null); setScreen("form"); }}
            style={{ flex: 1, padding: "16px", borderRadius: PILL, border: `1.5px solid ${C.BORDER}`, background: "white", fontSize: "16px", fontWeight: 600, cursor: "pointer", color: C.NAVY }}
          >Edit</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{ flex: 2, ...btnPrimary }}
          >{saving ? "Saving…" : "Confirm Check-In"}</button>
        </div>
      </div>
    );
  }

  // ── Form screen ───────────────────────────────────────────────────────────
  const validErr = validate();
  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ padding: "20px 16px 0", position: "sticky", top: 0, zIndex: 10, background: C.BG }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <span style={{ fontSize: "24px" }}>🏢</span>
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 800 }}>Visitor Check-In</h1>
        </div>
        <p style={{ color: C.SLATE, margin: "0 0 16px", fontSize: "13px" }}>Unze Group — Head Office</p>
      </div>

      <div style={{ padding: "0 16px 120px" }}>

        {/* Flag warning */}
        {flag === "blacklist" && (
          <div style={{ background: C.DANGER_SOFT, border: `1.5px solid ${C.RED}`, borderRadius: "12px", padding: "14px 16px", marginBottom: "12px" }}>
            <p style={{ margin: 0, fontWeight: 700, color: C.RED, fontSize: "14px" }}>⚠️ Blacklisted Visitor</p>
            {flagReason && <p style={{ margin: "4px 0 0", color: C.RED, fontSize: "13px" }}>{flagReason}</p>}
          </div>
        )}
        {flag === "vip" && (
          <div style={{ background: C.WARNING_SOFT, border: `1.5px solid ${C.AMBER}`, borderRadius: "12px", padding: "14px 16px", marginBottom: "12px" }}>
            <p style={{ margin: 0, fontWeight: 700, color: C.AMBER, fontSize: "14px" }}>⭐ VIP Visitor</p>
            {flagReason && <p style={{ margin: "4px 0 0", color: C.AMBER, fontSize: "13px" }}>{flagReason}</p>}
          </div>
        )}

        {/* Date + Time In */}
        <div style={cardStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={labelStyle}>DATE</label>
              <DateInput
                value={form.visit_date}
                onChange={(e) => set("visit_date", e.target.value)}
                max={nowPkt().date}
              />
            </div>
            <div>
              <label style={labelStyle}>TIME IN</label>
              <input
                type="time"
                value={form.time_in}
                onChange={(e) => set("time_in", e.target.value)}
                style={inputStyleLocal}
              />
            </div>
          </div>
        </div>

        {/* Visitor Details */}
        <div style={cardStyle}>
          <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: "14px", color: C.NAVY }}>Visitor Details</p>

          {lookingUp && (
            <p style={{ fontSize: "12px", color: C.SLATE, margin: "0 0 8px" }}>🔍 Looking up visitor…</p>
          )}

          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>MOBILE NUMBER *</label>
            <input
              type="tel"
              placeholder="+923001234567 or 03001234567"
              value={form.mobile}
              onChange={(e) => set("mobile", e.target.value)}
              style={inputStyleLocal}
              inputMode="tel"
            />
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>CNIC (optional)</label>
            <input
              type="text"
              placeholder="12345-1234567-1"
              value={form.cnic}
              onChange={(e) => set("cnic", e.target.value)}
              style={inputStyleLocal}
              inputMode="numeric"
              maxLength={15}
            />
          </div>

          <div>
            <label style={labelStyle}>VISITOR NAME *</label>
            <input
              type="text"
              placeholder="Full name"
              value={form.visitor_name}
              onChange={(e) => set("visitor_name", e.target.value)}
              style={inputStyleLocal}
              autoCapitalize="words"
            />
          </div>
        </div>

        {/* Department + Person to Meet */}
        <div style={cardStyle}>
          <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: "14px", color: C.NAVY }}>Person to Meet</p>

          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>DEPARTMENT *</label>
            <select
              value={form.department}
              onChange={(e) => set("department", e.target.value)}
              style={{ ...inputStyleLocal, color: form.department ? C.NAVY : C.SLATE }}
            >
              <option value="">Select department…</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>PERSON TO MEET * {form.department && `(${hosts.length} in dept)`}</label>
            <input
              type="text"
              placeholder="Search by name…"
              value={hostSearch || form.host_name}
              onChange={(e) => {
                setHostSearch(e.target.value);
                // If user clears, clear host selection
                if (!e.target.value) {
                  set("host_name", "");
                  setForm((f) => ({ ...f, host_id: "", host_name: "" }));
                }
              }}
              style={inputStyleLocal}
            />
            {hostSearch && filteredHosts.length > 0 && (
              <div style={{ border: `1.5px solid ${C.BORDER}`, borderRadius: "10px", marginTop: "4px", maxHeight: "200px", overflowY: "auto", background: C.CARD }}>
                {filteredHosts.slice(0, 8).map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setForm((f) => ({ ...f, host_id: h.id, host_name: h.full_name }));
                      setHostSearch("");
                    }}
                    style={{ width: "100%", textAlign: "left", padding: "12px 14px", border: "none", background: "transparent", cursor: "pointer", borderBottom: `1px solid ${C.BORDER}`, fontSize: "14px" }}
                  >
                    <span style={{ fontWeight: 600 }}>{h.full_name}</span>
                    {h.department && <span style={{ color: C.SLATE, fontSize: "12px" }}> · {h.department}</span>}
                  </button>
                ))}
                {filteredHosts.length === 0 && (
                  <p style={{ padding: "12px 14px", margin: 0, color: C.SLATE, fontSize: "14px" }}>
                    No match — type full name to log as-is
                  </p>
                )}
              </div>
            )}
            {/* Allow free-text if not found in list */}
            {!form.host_id && !hostSearch && !form.host_name && (
              <input
                type="text"
                placeholder="Or type name if not in list"
                value={form.host_name}
                onChange={(e) => setForm((f) => ({ ...f, host_name: e.target.value }))}
                style={{ ...inputStyleLocal, marginTop: "8px" }}
              />
            )}
            {form.host_name && !hostSearch && (
              <p style={{ margin: "6px 0 0", fontSize: "13px", color: C.GREEN }}>✓ {form.host_name}</p>
            )}
          </div>
        </div>

        {/* Purpose */}
        <div style={cardStyle}>
          <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: "14px", color: C.NAVY }}>Purpose of Visit *</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
            {PURPOSES.map((p) => (
              <button
                key={p}
                onClick={() => set("purpose", p)}
                style={{
                  padding: "8px 14px", borderRadius: PILL, border: `1.5px solid ${form.purpose === p ? C.NAVY : C.BORDER}`,
                  background: form.purpose === p ? C.NAVY : "white",
                  color: form.purpose === p ? "white" : C.NAVY,
                  fontSize: "13px", fontWeight: 600, cursor: "pointer",
                }}
              >{p}</button>
            ))}
          </div>
          {form.purpose === "Other" && (
            <div>
              <label style={labelStyle}>DESCRIBE PURPOSE *</label>
              <input
                type="text"
                placeholder="Brief description…"
                value={form.purpose_other}
                onChange={(e) => set("purpose_other", e.target.value)}
                style={inputStyleLocal}
              />
            </div>
          )}
        </div>

        {/* Comments */}
        <div style={cardStyle}>
          <label style={labelStyle}>COMMENTS (optional)</label>
          <textarea
            rows={3}
            placeholder="Any additional notes…"
            value={form.comments}
            onChange={(e) => set("comments", e.target.value)}
            style={{ ...inputStyleLocal, resize: "vertical", fontFamily: "inherit", lineHeight: "1.5" }}
          />
        </div>

        {error && (
          <div style={{ background: C.DANGER_SOFT, border: `1px solid ${C.RED}`, borderRadius: "10px", padding: "12px 14px", marginBottom: "12px", color: C.RED, fontSize: "14px" }}>
            {error}
          </div>
        )}

      </div>

      {/* Sticky CTA */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        padding: "12px 16px 24px", background: C.CARD,
        borderTop: `1px solid ${C.BORDER}`, zIndex: 20,
      }}>
        <button
          onClick={() => {
            const err = validate();
            if (err) { setError(err); return; }
            setError(null);
            setScreen("confirm");
          }}
          style={btnPrimary}
        >Review &amp; Check In →</button>
      </div>
    </div>
  );
}
