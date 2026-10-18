"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import DateInput from "../lib/DateInput";
import { useRequireCapability } from "../lib/useRouteGuard";
import { formatDateUK } from "../lib/dateUtils";

// ── Colours ──────────────────────────────────────────────────────────────────
const C = {
  NAVY:   "#0F1720",
  SLATE:  "#64748B",
  BORDER: "#EEF0F3",
  GREEN:  "#0F7B5F",
  AMBER:  "#B4791F",
  RED:    "#B3261E",
  BG:     "#F8F9FA",
  WHITE:  "#FFFFFF",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function normaliseMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("923") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("03")  && digits.length === 11) return `+92${digits.slice(1)}`;
  if (digits.startsWith("3")   && digits.length === 10) return `+92${digits}`;
  return raw.trim();
}

function normaliseCnic(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 13);
}

function displayCnic(digits: string): string {
  if (!digits) return "";
  if (digits.length <= 5)  return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function nowPkt(): { date: string; time: string } {
  const pkt = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const y = pkt.getUTCFullYear();
  const mo = String(pkt.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(pkt.getUTCDate()).padStart(2, "0");
  const h  = String(pkt.getUTCHours()).padStart(2, "0");
  const mi = String(pkt.getUTCMinutes()).padStart(2, "0");
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

/** Convert PKT date+time → UTC ISO string (PKT = UTC+5) */
function pktToUtcIso(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi]    = time.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi)).toISOString();
}

/** Format a UTC ISO timestamp as PKT HH:MM */
function formatTimePkt(utcIso: string): string {
  try {
    const pkt = new Date(new Date(utcIso).getTime() + 5 * 60 * 60 * 1000);
    return `${String(pkt.getUTCHours()).padStart(2, "0")}:${String(pkt.getUTCMinutes()).padStart(2, "0")}`;
  } catch { return "—"; }
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Host = { id: string; name: string; department: string | null };

type CurrentVisitor = {
  id: string;
  visitor_name: string;
  host_name: string;
  time_in: string;       // UTC ISO string
  department_name: string;
  purpose: string;
};

type Form = {
  date: string;
  time_in: string;
  visitor_name: string;
  cnic: string;
  mobile: string;
  department: string;
  host_id: string;
  host_name: string;
  purpose: string;
  purpose_other: string;
  comments: string;
};

const PURPOSES = [
  "Vendor/Payment",
  "Interview",
  "Meeting",
  "Delivery",
  "Government/Official",
  "Personal",
  "Other",
];

const BLANK = (): Form => {
  const { date, time: time_in } = nowPkt();
  return {
    date, time_in,
    visitor_name: "", cnic: "", mobile: "",
    department: "", host_id: "", host_name: "",
    purpose: "", purpose_other: "", comments: "",
  };
};

// ── Styles ────────────────────────────────────────────────────────────────────
const inputStyle = (isDesktop: boolean): React.CSSProperties => ({
  width: "100%",
  boxSizing: "border-box",
  padding: isDesktop ? "9px 12px" : "11px 14px",
  border: `1.5px solid ${C.BORDER}`,
  borderRadius: 8,
  fontSize: 15,
  color: C.NAVY,
  background: C.WHITE,
  outline: "none",
});

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: C.SLATE,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 5,
};

const cardStyle: React.CSSProperties = {
  background: C.WHITE,
  border: `1px solid ${C.BORDER}`,
  borderRadius: 12,
  padding: "18px 16px",
  marginBottom: 12,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: C.SLATE,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 14,
};

// ── Loading / checking screens ────────────────────────────────────────────────
function CentredMsg({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: C.BG }}>
      <span style={{ color: C.SLATE, fontSize: 15 }}>{children}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VisitorEntryPage() {
  // Auth guard — redirects to /login if not authenticated, /welcome if no admin_ops access
  const { checking } = useRequireCapability("visitor_entry");

  const [screen, setScreen] = useState<"form" | "confirm" | "success">("form");
  const [form, setForm] = useState<Form>(BLANK());
  const [departments, setDepartments] = useState<string[]>([]);
  const [allHosts, setAllHosts] = useState<Host[]>([]);
  const [filteredHosts, setFilteredHosts] = useState<Host[]>([]);
  const [hostSearch, setHostSearch] = useState("");
  const [deptSearch, setDeptSearch] = useState("");
  const [deptOpen, setDeptOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [flagInfo, setFlagInfo] = useState<{ type: string; reason: string | null } | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [currentVisitors, setCurrentVisitors] = useState<CurrentVisitor[]>([]);
  const [checkingOut, setCheckingOut] = useState<Set<string>>(new Set());
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [returningVisitor, setReturningVisitor] = useState<{
    name: string;
    host_name: string;
    visit_date: string | null;
    purpose: string | null;
  } | null>(null);

  const deptRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // Responsive detection
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setHostSearch("");
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Load departments and hosts once auth is confirmed
  useEffect(() => {
    if (checking) return;
    loadData();
  }, [checking]);

  async function loadData() {
    try {
      const res = await apiFetch("/api/visitors/departments");
      if (res.ok) {
        const d = await res.json();
        setDepartments(d.departments ?? []);
        // RPC returns full_name; normalise to name for the Host type
        const hosts = (d.hosts ?? []).map((h: { id: string; full_name?: string; name?: string; department: string | null }) => ({
          id: h.id,
          name: h.full_name ?? h.name ?? "",
          department: h.department,
        }));
        setAllHosts(hosts);
      }
    } catch {
      // non-blocking — the form still works without dept/host lists
    }
    loadCurrentVisitors();
  }

  async function loadCurrentVisitors() {
    setLoadingCurrent(true);
    try {
      const res = await apiFetch("/api/visitors/current");
      if (res.ok) {
        const d = await res.json();
        setCurrentVisitors(d.visitors ?? []);
      }
    } catch { /* non-blocking */ }
    finally { setLoadingCurrent(false); }
  }

  async function handleCheckOut(visitorId: string) {
    setCheckingOut((s) => new Set(s).add(visitorId));
    try {
      const res = await apiFetch("/api/visitors/check-out", {
        method: "POST",
        body: JSON.stringify({ visitor_id: visitorId }),
      });
      if (res.ok) {
        setCurrentVisitors((vs) => vs.filter((v) => v.id !== visitorId));
      }
    } catch { /* non-blocking */ }
    finally {
      setCheckingOut((s) => { const n = new Set(s); n.delete(visitorId); return n; });
    }
  }

  // ── Returning visitor autofill ────────────────────────────────────────────
  async function lookupVisitor(params: { cnic?: string; mobile?: string }) {
    try {
      const qs = params.cnic ? `cnic=${params.cnic}` : `mobile=${params.mobile}`;
      const res = await apiFetch(`/api/visitors/lookup?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      // Show flag banner regardless of whether we found a past visit
      if (data.flag) setFlagInfo({ type: data.flag, reason: data.flag_reason ?? null });
      else setFlagInfo(null);
      // Autofill fields from most recent visit (don't overwrite what the user already typed)
      if (data.found) {
        setReturningVisitor({
          name:       data.visitor_name || "",
          host_name:  data.host_name    || "",
          visit_date: data.visit_date   || null,
          purpose:    data.purpose      || null,
        });
        setForm((f) => ({
          ...f,
          visitor_name: f.visitor_name || data.visitor_name || "",
          mobile:       f.mobile       || data.mobile       || "",
          department:   f.department   || data.department_name || "",
          host_id:      f.host_id      || data.host_member_id  || "",
          host_name:    f.host_name    || data.host_name       || "",
          purpose:      f.purpose      || data.purpose         || "",
        }));
      } else {
        setReturningVisitor(null);
      }
    } catch { /* non-blocking */ }
  }

  // Trigger autofill when CNIC is complete (13 digits), 800ms debounce
  useEffect(() => {
    const cnic = normaliseCnic(form.cnic);
    if (cnic.length !== 13) { setFlagInfo(null); setReturningVisitor(null); return; }
    const t = setTimeout(() => lookupVisitor({ cnic }), 800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cnic]);

  // Trigger autofill when mobile is valid, 800ms debounce
  useEffect(() => {
    const mobile = normaliseMobile(form.mobile);
    if (!/^\+923\d{9}$/.test(mobile)) return;
    const t = setTimeout(() => lookupVisitor({ mobile }), 800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.mobile]);

  // Host filtering — show dept members on dept select, search-filtered otherwise
  useEffect(() => {
    if (!hostSearch.trim()) {
      // No search text: if a dept is selected show all its members
      if (form.department) {
        setFilteredHosts(allHosts.filter((h) => h.department === form.department));
      } else {
        setFilteredHosts([]);
      }
      return;
    }
    const q = hostSearch.toLowerCase();
    const results = allHosts.filter(
      (h) => h.name.toLowerCase().includes(q) ||
             (h.department ?? "").toLowerCase().includes(q)
    );
    // If a department is selected, show that department's matches first
    if (form.department) {
      results.sort((a, b) => {
        const aInDept = a.department === form.department ? -1 : 0;
        const bInDept = b.department === form.department ? -1 : 0;
        return aInDept - bInDept;
      });
    }
    setFilteredHosts(results.slice(0, 8));
  }, [hostSearch, allHosts, form.department]);

  // Filtered departments for combobox
  const filteredDepts = departments.filter((d) =>
    !deptSearch.trim() || d.toLowerCase().includes(deptSearch.toLowerCase())
  );

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Live mobile normalisation — converts when digit count is exactly right
  function handleMobileChange(raw: string) {
    const digits = raw.replace(/\D/g, "");
    let value = raw;
    if (
      (digits.startsWith("03")  && digits.length === 11) ||
      (digits.startsWith("3")   && digits.length === 10) ||
      (digits.startsWith("923") && digits.length === 12)
    ) {
      value = normaliseMobile(raw);
    }
    set("mobile", value);
  }

  function validate(): string | null {
    if (!form.visitor_name.trim()) return "Visitor name is required.";
    const m = normaliseMobile(form.mobile);
    if (!/^\+923\d{9}$/.test(m)) return "Enter a valid Pakistani mobile number (03XXXXXXXXX or +923XXXXXXXXX).";
    const c = normaliseCnic(form.cnic);
    if (c.length !== 13) return "CNIC must be 13 digits.";
    if (!form.host_id)   return "Please select a person to meet.";
    if (!form.purpose)   return "Please select a purpose.";
    if (form.purpose === "Other" && !form.purpose_other.trim()) return "Please describe the purpose.";
    return null;
  }

  function handleSubmit() {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    setScreen("confirm");
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        visit_date:      form.date,
        time_in:         pktToUtcIso(form.date, form.time_in),
        visitor_name:    form.visitor_name.trim(),
        cnic:            normaliseCnic(form.cnic),
        mobile:          normaliseMobile(form.mobile),
        department_name: form.department || "",
        host_member_id:  form.host_id   || null,
        host_name:       form.host_name,
        purpose:         form.purpose,
        purpose_other:   form.purpose === "Other" ? (form.purpose_other.trim() || null) : null,
        comments:        form.comments.trim() || null,
      };
      const res = await apiFetch("/api/visitors/check-in", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to save visitor log.");
      }
      setScreen("success");
      loadCurrentVisitors(); // refresh the panel so the new arrival appears
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred. Please try again.");
      setScreen("form");
    } finally {
      setSubmitting(false);
    }
  }

  const iStyle = inputStyle(isDesktop);

  // ── Layout helpers ────────────────────────────────────────────────────────
  const container: React.CSSProperties = {
    minHeight: "100dvh",
    backgroundColor: C.BG,
    paddingBottom: 100,
  };

  const inner: React.CSSProperties = {
    maxWidth: isDesktop ? 860 : 480,
    margin: "0 auto",
    padding: isDesktop ? "24px 24px 0" : "0 16px 0",
  };

  // 2-col grid on desktop, 1-col on mobile
  const grid2: React.CSSProperties = isDesktop
    ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }
    : {};

  const fieldBox: React.CSSProperties = { marginBottom: isDesktop ? 0 : 14 };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (checking) return <CentredMsg>Checking access…</CentredMsg>;

  // ── Success screen ────────────────────────────────────────────────────────
  if (screen === "success") {
    return (
      <div style={{ minHeight: "100dvh", backgroundColor: C.BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: C.WHITE, border: `1px solid ${C.BORDER}`, borderRadius: 16, padding: "36px 28px", textAlign: "center", maxWidth: 380, width: "100%" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#E6F4F0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <span style={{ fontSize: 26 }}>✓</span>
          </div>
          <p style={{ fontSize: 20, fontWeight: 700, color: C.NAVY, margin: "0 0 6px" }}>Visitor Logged</p>
          <p style={{ fontSize: 14, color: C.SLATE, margin: "0 0 24px" }}>
            {form.visitor_name} has been logged in to see {form.host_name}.
          </p>
          <button
            onClick={() => { setForm(BLANK()); setScreen("form"); setError(""); loadCurrentVisitors(); }}
            style={{ background: C.NAVY, color: C.WHITE, border: "none", borderRadius: 10, padding: "13px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer", width: "100%" }}
          >
            Log Another Visitor
          </button>
        </div>
      </div>
    );
  }

  // ── Confirm screen ────────────────────────────────────────────────────────
  if (screen === "confirm") {
    const rows: [string, string][] = [
      ["Date",          formatDateUK(form.date)],
      ["Time In",       form.time_in],
      ["Visitor Name",  form.visitor_name],
      ["CNIC",          displayCnic(normaliseCnic(form.cnic))],
      ["Mobile",        normaliseMobile(form.mobile)],
      ["Department",    form.department || "—"],
      ["Host",          form.host_name],
      ["Purpose",       form.purpose === "Other" ? `Other: ${form.purpose_other}` : form.purpose],
      ["Comments",      form.comments || "—"],
    ];
    return (
      <div style={container}>
        <div style={{ ...inner, paddingTop: isDesktop ? 24 : 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Confirm Entry</p>
          <p style={{ fontSize: 22, fontWeight: 700, color: C.NAVY, margin: "0 0 18px" }}>Review Details</p>
          <div style={cardStyle}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.BORDER}` }}>
                <span style={{ fontSize: 13, color: C.SLATE, fontWeight: 500 }}>{k}</span>
                <span style={{ fontSize: 13, color: C.NAVY, fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{v}</span>
              </div>
            ))}
          </div>
          {error && <p style={{ color: C.RED, fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              onClick={() => setScreen("form")}
              disabled={submitting}
              style={{ flex: 1, background: C.WHITE, border: `1.5px solid ${C.BORDER}`, color: C.NAVY, borderRadius: 10, padding: "13px 0", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              style={{ flex: 2, background: C.NAVY, color: C.WHITE, border: "none", borderRadius: 10, padding: "13px 0", fontSize: 15, fontWeight: 600, cursor: submitting ? "wait" : "pointer" }}
            >
              {submitting ? "Saving…" : "Confirm & Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form screen ───────────────────────────────────────────────────────────
  return (
    <div style={container}>
      <div style={{ ...inner, paddingTop: isDesktop ? 24 : 20 }}>
        {/* Header */}
        <p style={{ fontSize: 11, fontWeight: 700, color: C.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Visitors Log</p>
        <p style={{ fontSize: isDesktop ? 26 : 22, fontWeight: 700, color: C.NAVY, margin: "0 0 20px" }}>New Visitor Entry</p>

        {/* Currently in Office panel */}
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: currentVisitors.length > 0 ? 12 : 0 }}>
            <p style={{ ...sectionTitle, marginBottom: 0 }}>Currently in Office</p>
            <span style={{
              background: currentVisitors.length > 0 ? "#E6F4F0" : C.BORDER,
              color: currentVisitors.length > 0 ? C.GREEN : C.SLATE,
              fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            }}>
              {loadingCurrent ? "…" : `${currentVisitors.length} ${currentVisitors.length === 1 ? "person" : "people"}`}
            </span>
          </div>
          {!loadingCurrent && currentVisitors.length === 0 && (
            <p style={{ fontSize: 13, color: C.SLATE, margin: 0, paddingTop: 6 }}>No visitors currently in the office.</p>
          )}
          {currentVisitors.map((v, idx) => (
            <div
              key={v.id}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10,
                paddingTop: 10, paddingBottom: 10,
                borderTop: idx === 0 ? `1px solid ${C.BORDER}` : "none",
                borderBottom: `1px solid ${C.BORDER}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.NAVY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {v.visitor_name}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: C.SLATE }}>
                  {[v.host_name, v.department_name].filter(Boolean).join(" · ")}
                  {v.time_in ? ` · Arrived ${formatTimePkt(v.time_in)}` : ""}
                </p>
              </div>
              <button
                onClick={() => handleCheckOut(v.id)}
                disabled={checkingOut.has(v.id)}
                style={{
                  flexShrink: 0,
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: `1.5px solid ${C.BORDER}`,
                  background: checkingOut.has(v.id) ? C.BORDER : C.WHITE,
                  color: checkingOut.has(v.id) ? C.SLATE : C.NAVY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: checkingOut.has(v.id) ? "wait" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {checkingOut.has(v.id) ? "Saving…" : "Check Out"}
              </button>
            </div>
          ))}
        </div>

        {/* Returning visitor banner */}
        {returningVisitor && (
          <div style={{
            padding: "10px 14px", borderRadius: 8, marginBottom: 12,
            background: "#EFF6FF",
            border: `1px solid #BFDBFE`,
            color: "#1D4ED8",
            fontSize: 13,
          }}>
            <span style={{ fontWeight: 700 }}>↩ Returning visitor</span>
            {returningVisitor.host_name && (
              <span style={{ fontWeight: 400 }}>
                {" — last visited"}
                {returningVisitor.visit_date
                  ? ` on ${formatDateUK(returningVisitor.visit_date)}`
                  : ""}
                {` to see ${returningVisitor.host_name}`}
                {returningVisitor.purpose ? ` (${returningVisitor.purpose})` : ""}
              </span>
            )}
            <span style={{ fontWeight: 400, display: "block", fontSize: 12, marginTop: 2, color: "#3B82F6" }}>
              Details filled in automatically — please verify before saving.
            </span>
          </div>
        )}

        {/* Flag banner */}
        {flagInfo && (
          <div style={{
            padding: "10px 14px", borderRadius: 8, marginBottom: 14,
            background: flagInfo.type === "blacklist" ? "#FEF2F2" : "#FFFBEB",
            border: `1px solid ${flagInfo.type === "blacklist" ? "#FECACA" : "#FDE68A"}`,
            color: flagInfo.type === "blacklist" ? C.RED : C.AMBER,
            fontSize: 13, fontWeight: 600,
          }}>
            {flagInfo.type === "blacklist" ? "⛔ BLACKLISTED VISITOR" : "⭐ VIP VISITOR"}
            {flagInfo.reason && <span style={{ fontWeight: 400 }}> — {flagInfo.reason}</span>}
          </div>
        )}

        {/* Card 1 — Date & Time */}
        <div style={cardStyle}>
          <p style={sectionTitle}>Date &amp; Time</p>
          <div style={{ ...grid2, gap: isDesktop ? 14 : 0 }}>
            <div style={fieldBox}>
              <label style={labelStyle}>Date</label>
              <DateInput
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                style={iStyle}
              />
            </div>
            <div style={{ ...fieldBox, marginTop: isDesktop ? 0 : 14 }}>
              <label style={labelStyle}>Time In</label>
              <input
                type="time"
                value={form.time_in}
                onChange={(e) => set("time_in", e.target.value)}
                style={iStyle}
              />
            </div>
          </div>
        </div>

        {/* Card 2 — Visitor Details (Name FIRST) */}
        <div style={cardStyle}>
          <p style={sectionTitle}>Visitor Details</p>

          {/* Row 1: Name + CNIC */}
          <div style={{ ...grid2, marginBottom: isDesktop ? 14 : 0 }}>
            <div style={fieldBox}>
              <label style={labelStyle}>Full Name <span style={{ color: C.RED }}>*</span></label>
              <input
                type="text"
                placeholder="Visitor's full name"
                value={form.visitor_name}
                onChange={(e) => set("visitor_name", e.target.value)}
                style={iStyle}
                autoCapitalize="words"
              />
            </div>
            <div style={{ ...fieldBox, marginTop: isDesktop ? 0 : 14 }}>
              <label style={labelStyle}>CNIC <span style={{ color: C.RED }}>*</span></label>
              <input
                type="text"
                placeholder="12345-1234567-1"
                value={displayCnic(form.cnic)}
                onChange={(e) => set("cnic", normaliseCnic(e.target.value))}
                style={iStyle}
                inputMode="numeric"
                maxLength={15}
              />
            </div>
          </div>

          {/* Row 2: Mobile (full width on both) */}
          <div style={{ marginTop: isDesktop ? 0 : 14 }}>
            <label style={labelStyle}>Mobile Number <span style={{ color: C.RED }}>*</span></label>
            <input
              type="tel"
              placeholder="03001234567 or +923001234567"
              value={form.mobile}
              onChange={(e) => handleMobileChange(e.target.value)}
              onBlur={(e) => set("mobile", normaliseMobile(e.target.value))}
              style={{ ...iStyle, maxWidth: isDesktop ? "calc(50% - 7px)" : "100%" }}
              inputMode="numeric"
            />
            {form.mobile && /^\+923\d{9}$/.test(normaliseMobile(form.mobile)) && (
              <p style={{ fontSize: 12, color: C.GREEN, marginTop: 4 }}>✓ {normaliseMobile(form.mobile)}</p>
            )}
          </div>
        </div>

        {/* Card 3 — Person to Meet */}
        <div style={cardStyle}>
          <p style={sectionTitle}>Person to Meet</p>
          <div style={{ ...grid2, marginBottom: isDesktop ? 14 : 0 }}>
            {/* Department — searchable combobox */}
            <div ref={deptRef} style={{ ...fieldBox, position: "relative" }}>
              <label style={labelStyle}>Department</label>
              <input
                type="text"
                placeholder="Search department…"
                value={deptSearch !== "" ? deptSearch : form.department}
                onFocus={() => { setDeptSearch(""); setDeptOpen(true); }}
                onChange={(e) => { setDeptSearch(e.target.value); setDeptOpen(true); }}
                onBlur={() => { setTimeout(() => setDeptOpen(false), 150); }}
                style={iStyle}
              />
              {deptOpen && filteredDepts.length > 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                  background: C.WHITE, border: `1.5px solid ${C.BORDER}`, borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: 200, overflowY: "auto", marginTop: 2,
                }}>
                  <button
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", fontSize: 14, color: C.SLATE, cursor: "pointer" }}
                    onMouseDown={() => { set("department", ""); setDeptSearch(""); setDeptOpen(false); }}
                  >
                    All departments
                  </button>
                  {filteredDepts.map((d) => (
                    <button
                      key={d}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                        background: form.department === d ? "#F0F7FF" : "none",
                        border: "none", fontSize: 14, color: C.NAVY, fontWeight: form.department === d ? 600 : 400, cursor: "pointer",
                      }}
                      onMouseDown={() => {
                        set("department", d);
                        setDeptSearch("");
                        setDeptOpen(false);
                        // Clear host if it's from a different dept
                        if (form.host_id) {
                          const host = allHosts.find((h) => h.id === form.host_id);
                          if (host && host.department !== d) {
                            set("host_id", "");
                            set("host_name", "");
                          }
                        }
                      }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Host search */}
            <div ref={hostRef} style={{ ...fieldBox, position: "relative", marginTop: isDesktop ? 0 : 14 }}>
              <label style={labelStyle}>Person <span style={{ color: C.RED }}>*</span></label>
              <input
                type="text"
                placeholder="Search by name…"
                value={hostSearch || form.host_name}
                onChange={(e) => {
                  setHostSearch(e.target.value);
                  if (!e.target.value) { set("host_id", ""); set("host_name", ""); }
                }}
                style={iStyle}
              />
              {filteredHosts.length > 0 && !form.host_id && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                  background: C.WHITE, border: `1.5px solid ${C.BORDER}`, borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: 200, overflowY: "auto", marginTop: 2,
                }}>
                  {filteredHosts.map((h) => (
                    <button
                      key={h.id}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", cursor: "pointer" }}
                      onClick={() => {
                        setForm((f) => ({ ...f, host_id: h.id, host_name: h.name, department: f.department || h.department || "" }));
                        setHostSearch("");
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, color: C.NAVY }}>{h.name}</span>
                      {h.department && <span style={{ fontSize: 13, color: C.SLATE }}> · {h.department}</span>}
                    </button>
                  ))}
                </div>
              )}
              {form.host_name && !hostSearch && (
                <p style={{ fontSize: 12, color: C.GREEN, marginTop: 4 }}>✓ {form.host_name}</p>
              )}
            </div>
          </div>
        </div>

        {/* Card 4 — Purpose */}
        <div style={cardStyle}>
          <p style={sectionTitle}>Purpose <span style={{ color: C.RED }}>*</span></p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PURPOSES.map((p) => (
              <button
                key={p}
                onClick={() => { set("purpose", p); if (p !== "Other") set("purpose_other", ""); }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 20,
                  border: `1.5px solid ${form.purpose === p ? C.NAVY : C.BORDER}`,
                  background: form.purpose === p ? C.NAVY : C.WHITE,
                  color: form.purpose === p ? C.WHITE : C.NAVY,
                  fontSize: 13,
                  fontWeight: form.purpose === p ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {p}
              </button>
            ))}
          </div>
          {form.purpose === "Other" && (
            <input
              type="text"
              placeholder="Brief description…"
              value={form.purpose_other}
              onChange={(e) => set("purpose_other", e.target.value)}
              style={{ ...iStyle, marginTop: 12 }}
              maxLength={120}
            />
          )}
        </div>

        {/* Card 5 — Comments */}
        <div style={cardStyle}>
          <p style={sectionTitle}>Comments / Notes</p>
          <textarea
            placeholder="Optional notes about this visit…"
            value={form.comments}
            onChange={(e) => set("comments", e.target.value)}
            rows={isDesktop ? 3 : 4}
            style={{ ...iStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            maxLength={500}
          />
        </div>

        {/* Error */}
        {error && (
          <p style={{ color: C.RED, fontSize: 14, margin: "0 0 14px", padding: "10px 14px", background: "#FEF2F2", border: `1px solid #FECACA`, borderRadius: 8 }}>
            {error}
          </p>
        )}

        {/* Submit CTA */}
        <div style={{ position: "sticky", bottom: 0, background: `linear-gradient(to top, ${C.BG} 85%, transparent)`, padding: "16px 0 24px" }}>
          <button
            onClick={handleSubmit}
            style={{
              width: isDesktop ? "auto" : "100%",
              minWidth: isDesktop ? 220 : undefined,
              display: isDesktop ? "block" : "block",
              background: C.NAVY,
              color: C.WHITE,
              border: "none",
              borderRadius: 12,
              padding: "14px 32px",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.01em",
            }}
          >
            Review &amp; Confirm →
          </button>
        </div>
      </div>
    </div>
  );
}
