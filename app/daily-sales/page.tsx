"use client";

/**
 * /daily-sales — Mobile-first daily sales entry form for store users.
 *
 * Three screens:
 *   "loading"  — auth check + store lookup
 *   "form"     — date picker + entry form with live calculated totals
 *                (if the chosen date already has an entry, fields pre-fill
 *                 for editing and an "Editing" banner is shown)
 *   "confirm"  — bottom-sheet review before final submit
 *   "success"  — post-submit confirmation (with "Submit Another Day" button)
 *
 * Date defaults to today in Asia/Karachi (PKT, UTC+5).
 * 7-day backdating is allowed; future dates are blocked.
 * Months locked after 23:59 PKT on day 10 of the following month show a
 * locked-month message and a disabled form.
 *
 * Calculated totals come from Postgres via daily_entry_preview RPC —
 * never computed in JS.
 *
 * All amounts displayed as "PKR 1,234,567.50" via formatPKR().
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { STORE_USER_RE } from "../lib/useRouteGuard";
import { formatDateUK } from "../lib/dateUtils";
import { formatPKR } from "../lib/pkrFormatter";
import DateInput from "../lib/DateInput";

// ── Types ─────────────────────────────────────────────────────────────────────

type Screen = "loading" | "form" | "confirm" | "success";

interface FormFields {
  cash_sale: string;
  campaign_float_cash: string;
  expenses: string;
  other_income: string;
  deposit: string;
  allied_bank_cc_sale: string;
  hbl_cc_sale: string;
  gift_karte: string;
  gift_vouchers: string;
  credit_notes_issue: string;
  remarks: string;
}

interface Totals {
  total_credit_card_sale: number;
  total_sale: number;
  net_cash_movement: number;
  opening_balance: number | null;
  closing_balance: number | null;
}

interface DailySalesRow {
  id: string;
  store_id: string;
  sales_date: string;
  cash_sale: number;
  campaign_float_cash: number;
  expenses: number;
  other_income: number;
  deposit: number;
  allied_bank_cc_sale: number;
  hbl_cc_sale: number;
  gift_karte: number;
  gift_vouchers: number;
  credit_notes_issue: number;
  remarks: string | null;
  total_credit_card_sale: number;
  total_sale: number;
  net_cash_movement: number;
  opening_balance: number | null;
  closing_balance: number | null;
}

interface StoreInfo {
  id: string | null;
  name: string | null;
  fm_code: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_FIELDS: FormFields = {
  cash_sale: "", campaign_float_cash: "", expenses: "", other_income: "",
  deposit: "", allied_bank_cc_sale: "", hbl_cc_sale: "",
  gift_karte: "", gift_vouchers: "", credit_notes_issue: "", remarks: "",
};

const ZERO_TOTALS: Totals = {
  total_credit_card_sale: 0, total_sale: 0, net_cash_movement: 0,
  opening_balance: null, closing_balance: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Today's date as YYYY-MM-DD in Asia/Karachi (PKT, UTC+5). */
function todayPkt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}

/**
 * Subtract n calendar days from a YYYY-MM-DD string.
 * Uses Date arithmetic to handle month/year boundaries correctly.
 */
function subDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - n);
  return (
    `${dt.getFullYear()}-` +
    `${String(dt.getMonth() + 1).padStart(2, "0")}-` +
    `${String(dt.getDate()).padStart(2, "0")}`
  );
}

/**
 * Format YYYY-MM-DD as "Wednesday, 07 October 2026".
 * Parsed as a local date (not UTC) to avoid off-by-one.
 */
function longDateForIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}

/**
 * Returns true if the MONTH containing isoDate is locked.
 * Rule: month M/Y locks after day 10 of month M+1
 * (i.e. today strictly AFTER the 10th of the next month).
 */
function isMonthLocked(isoDate: string, today: string): boolean {
  const year  = parseInt(isoDate.slice(0, 4), 10);
  const month = parseInt(isoDate.slice(5, 7), 10); // 1-based
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const lockDay   = `${nextYear}-${String(nextMonth).padStart(2, "0")}-10`;
  return today > lockDay;
}

/** Parse a numeric input string; returns 0 for blank / NaN. */
function num(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * Convert a stored number to a form field string.
 * Zero shows as "" (displays the "0" placeholder) to avoid cluttering
 * the form with zeros for fields the user left empty.
 */
function numToField(n: number): string {
  return n === 0 ? "" : String(n);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DailySalesPage() {
  const router = useRouter();

  const today = todayPkt();

  const [screen, setScreen]               = useState<Screen>("loading");
  const [store, setStore]                 = useState<StoreInfo>({ id: null, name: null, fm_code: null });
  const [selectedDate, setSelectedDate]   = useState<string>(today);
  const [isEditMode, setIsEditMode]       = useState(false);
  const [monthLocked, setMonthLocked]     = useState(false);
  const [dateChecking, setDateChecking]   = useState(false);
  const [fields, setFields]               = useState<FormFields>(EMPTY_FIELDS);
  const [totals, setTotals]               = useState<Totals>(ZERO_TOTALS);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [fieldErrors, setFieldErrors]     = useState<Partial<Record<keyof FormFields, string>>>({});
  const [submitError, setSubmitError]     = useState<string | null>(null);
  const [submitting, setSubmitting]       = useState(false);
  const [submitted, setSubmitted]         = useState<DailySalesRow | null>(null);

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auth + boot ─────────────────────────────────────────────────────────────
  useEffect(() => {
    void boot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function boot() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.email) { router.replace("/login"); return; }

    if (session.user.app_metadata?.must_change_password === true) {
      router.replace("/change-password");
      return;
    }

    const email = session.user.email;
    const isStoreUser = STORE_USER_RE.test(email) || session.user.app_metadata?.store_user === true;
    const isAdmin = /k\.saleem@unzegroup\.com|kamran@unze\.co\.uk/i.test(email);
    if (!isStoreUser && !isAdmin) { router.replace("/welcome"); return; }

    const storeRes = await apiFetch("/api/daily-sales/my-store");
    let storeInfo: StoreInfo = { id: null, name: null, fm_code: null };
    if (storeRes.ok) {
      storeInfo = await storeRes.json() as StoreInfo;
      setStore(storeInfo);
    }

    const t = todayPkt();
    setSelectedDate(t);

    if (storeInfo.id) {
      // Check today for an existing entry; sets edit mode and fields if found
      await checkDate(t, storeInfo.id);
    }

    setScreen("form");
  }

  // ── Check selected date ──────────────────────────────────────────────────────
  /**
   * Called whenever the selected date changes (including on boot).
   * 1. Checks if the month is locked → shows locked message.
   * 2. Fetches the month's rows to see if the date already has an entry.
   * 3. If it does: pre-fills fields for editing.
   * 4. If it doesn't: clears the form.
   */
  async function checkDate(iso: string, storeId: string) {
    const t = todayPkt();

    // Month lock check (frontend estimate — server enforces authoritatively)
    if (isMonthLocked(iso, t)) {
      setMonthLocked(true);
      setIsEditMode(false);
      setFields(EMPTY_FIELDS);
      setTotals(ZERO_TOTALS);
      return;
    }
    setMonthLocked(false);

    const year  = iso.slice(0, 4);
    const month = iso.slice(5, 7);
    const rowsRes = await apiFetch(
      `/api/daily-sales/rows?store_id=${storeId}&year=${year}&month=${month}`
    );
    if (!rowsRes.ok) return;

    const jr = await rowsRes.json() as { rows: DailySalesRow[] };
    const existing = jr.rows?.find((r) => r.sales_date === iso);

    if (existing) {
      // Pre-fill form for editing
      setIsEditMode(true);
      const filled: FormFields = {
        cash_sale:            numToField(existing.cash_sale),
        campaign_float_cash:  numToField(existing.campaign_float_cash),
        expenses:             numToField(existing.expenses),
        other_income:         numToField(existing.other_income),
        deposit:              numToField(existing.deposit),
        allied_bank_cc_sale:  numToField(existing.allied_bank_cc_sale),
        hbl_cc_sale:          numToField(existing.hbl_cc_sale),
        gift_karte:           numToField(existing.gift_karte),
        gift_vouchers:        numToField(existing.gift_vouchers),
        credit_notes_issue:   numToField(existing.credit_notes_issue),
        remarks:              existing.remarks ?? "",
      };
      setFields(filled);
      // Totals come directly from the saved row (no need for preview call)
      setTotals({
        total_credit_card_sale: existing.total_credit_card_sale,
        total_sale:             existing.total_sale,
        net_cash_movement:      existing.net_cash_movement,
        opening_balance:        existing.opening_balance,
        closing_balance:        existing.closing_balance,
      });
    } else {
      setIsEditMode(false);
      setFields(EMPTY_FIELDS);
      setTotals(ZERO_TOTALS);
    }
  }

  // ── Date change ─────────────────────────────────────────────────────────────
  async function handleDateChange(e: { target: { value: string } }) {
    const iso = e.target.value;
    if (!iso) return;
    setSelectedDate(iso);
    setFieldErrors({});
    setSubmitError(null);

    if (store.id) {
      setDateChecking(true);
      try {
        await checkDate(iso, store.id);
      } finally {
        setDateChecking(false);
      }
    }
  }

  // ── Live totals via preview ─────────────────────────────────────────────────
  const refreshTotals = useCallback(async (f: FormFields, storeId: string | null, date: string) => {
    setTotalsLoading(true);
    try {
      const fields = {
        cash_sale:            num(f.cash_sale),
        campaign_float_cash:  num(f.campaign_float_cash),
        expenses:             num(f.expenses),
        other_income:         num(f.other_income),
        deposit:              num(f.deposit),
        allied_bank_cc_sale:  num(f.allied_bank_cc_sale),
        hbl_cc_sale:          num(f.hbl_cc_sale),
        gift_karte:           num(f.gift_karte),
        gift_vouchers:        num(f.gift_vouchers),
        credit_notes_issue:   num(f.credit_notes_issue),
      };
      const res = await apiFetch("/api/daily-sales/entry-preview", {
        method: "POST",
        body: JSON.stringify({ store_id: storeId, sales_date: date, fields }),
      });
      if (res.ok) {
        const j = await res.json() as { totals?: Totals };
        if (j.totals) {
          setTotals({
            total_credit_card_sale: j.totals.total_credit_card_sale ?? 0,
            total_sale:             j.totals.total_sale             ?? 0,
            net_cash_movement:      j.totals.net_cash_movement      ?? 0,
            opening_balance:        j.totals.opening_balance        ?? null,
            closing_balance:        j.totals.closing_balance        ?? null,
          });
        }
      }
    } finally {
      setTotalsLoading(false);
    }
  }, []);

  function handleFieldChange(key: keyof FormFields, value: string) {
    const next = { ...fields, [key]: value };
    setFields(next);
    setFieldErrors((e) => ({ ...e, [key]: undefined }));

    if (!monthLocked) {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(
        () => void refreshTotals(next, store.id ?? null, selectedDate),
        300
      );
    }
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Partial<Record<keyof FormFields, string>> = {};
    if (!fields.cash_sale.trim()) errs.cash_sale = "Cash Sale is required";
    else if (num(fields.cash_sale) < 0) errs.cash_sale = "Must be 0 or more";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function submit() {
    if (!store.id) { setSubmitError("No store assigned to your account."); return; }
    setSubmitting(true);
    setSubmitError(null);

    try {
      const body = {
        store_id:             store.id,
        sales_date:           selectedDate,
        cash_sale:            num(fields.cash_sale),
        campaign_float_cash:  num(fields.campaign_float_cash),
        expenses:             num(fields.expenses),
        other_income:         num(fields.other_income),
        deposit:              num(fields.deposit),
        allied_bank_cc_sale:  num(fields.allied_bank_cc_sale),
        hbl_cc_sale:          num(fields.hbl_cc_sale),
        gift_karte:           num(fields.gift_karte),
        gift_vouchers:        num(fields.gift_vouchers),
        credit_notes_issue:   num(fields.credit_notes_issue),
        remarks:              fields.remarks || null,
      };

      const res = await apiFetch("/api/daily-sales/submit", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const j = await res.json() as { ok?: boolean; error?: string };

      if (!res.ok) {
        setSubmitError(j.error ?? "Submission failed — please try again.");
        return;
      }

      // Fetch the saved row to show exact server-computed figures on success screen
      const year  = selectedDate.slice(0, 4);
      const month = selectedDate.slice(5, 7);
      const rowsRes = await apiFetch(
        `/api/daily-sales/rows?store_id=${store.id}&year=${year}&month=${month}`
      );
      if (rowsRes.ok) {
        const jr = await rowsRes.json() as { rows: DailySalesRow[] };
        const saved = jr.rows?.find((r) => r.sales_date === selectedDate);
        if (saved) setSubmitted(saved);
      }

      setScreen("success");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Reset (submit another day) ──────────────────────────────────────────────
  function resetForm() {
    const t = todayPkt();
    setSelectedDate(t);
    setFields(EMPTY_FIELDS);
    setTotals(ZERO_TOTALS);
    setSubmitError(null);
    setSubmitted(null);
    setIsEditMode(false);
    setMonthLocked(false);
    setScreen("form");
    if (store.id) {
      void checkDate(t, store.id);
    }
  }

  // ── Sign out ────────────────────────────────────────────────────────────────
  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // ── Style helpers ─────────────────────────────────────────────────────────
  const inputStyle = (err?: string, readOnly?: boolean): React.CSSProperties => ({
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: `1.5px solid ${err ? "#B3261E" : "#EEF0F3"}`,
    fontSize: 15, fontFamily: "inherit", outline: "none",
    background: err ? "#FFF5F5" : readOnly ? "#F4F7FF" : "#fff",
    color: readOnly ? "#3B5EA6" : "#0F1720",
    fontWeight: readOnly ? 700 : 400,
    fontVariantNumeric: "tabular-nums",
    cursor: readOnly ? "not-allowed" : "auto",
    boxSizing: "border-box" as const,
  });

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: "#64748B",
    display: "block", marginBottom: 4, letterSpacing: ".03em",
  };

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "#94A3B8",
    letterSpacing: ".09em", textTransform: "uppercase",
    padding: "12px 0 8px", borderBottom: "1px solid #EEF0F3",
    marginBottom: 14, marginTop: 6,
  };

  const fieldWrap: React.CSSProperties = { marginBottom: 14 };
  const twoCol: React.CSSProperties = {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
  };
  const autoBadge: React.CSSProperties = {
    display: "inline-block", fontSize: 9, fontWeight: 800, color: "#3B5EA6",
    background: "#EDF2FF", padding: "2px 5px", borderRadius: 3, marginBottom: 4,
    letterSpacing: ".05em",
  };

  // ── Shared header ──────────────────────────────────────────────────────────
  function Header() {
    const storeLine = [
      store.name ? store.name.toUpperCase() : null,
      store.fm_code ? store.fm_code : null,
    ].filter(Boolean).join(" · ") || "UNZE";

    return (
      <div style={{
        background: "#0F1720", padding: "14px 18px 16px",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.5)", letterSpacing: ".05em" }}>
            {storeLine}
          </span>
          <button
            onClick={() => void signOut()}
            style={{
              fontSize: 11, color: "rgba(255,255,255,.35)", background: "none",
              border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0,
            }}
          >
            Sign out
          </button>
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-.4px" }}>
          Daily Sales Entry
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,.45)", marginTop: 2 }}>
          {longDateForIso(selectedDate)}
        </div>
      </div>
    );
  }

  // ── Summary card (success screen) ──────────────────────────────────────────
  function SummaryCard({ data }: { data: DailySalesRow }) {
    return (
      <div style={{
        background: "#fff", borderRadius: 12, padding: "14px 20px",
        width: "100%", maxWidth: 380, border: "1px solid #EEF0F3",
      }}>
        {([
          ["Total Sale",        formatPKR(data.total_sale),        "#0F1720"],
          ["Net Cash Movement", formatPKR(data.net_cash_movement), "#0F7B5F"],
          ["Closing Balance",   formatPKR(data.closing_balance),   "#0F1720"],
        ] as [string, string, string][]).map(([lbl, val, color], i, arr) => (
          <div key={lbl} style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            padding: "8px 0",
            borderBottom: i < arr.length - 1 ? "1px solid #EEF0F3" : "none",
          }}>
            <span style={{ fontSize: 12, color: "#64748B" }}>{lbl}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{val}</span>
          </div>
        ))}
      </div>
    );
  }

  // ── SCREEN: Loading ────────────────────────────────────────────────────────
  if (screen === "loading") {
    return (
      <main style={{
        minHeight: "100dvh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#F4F6F9", fontFamily: "system-ui, sans-serif",
      }}>
        <span style={{ fontSize: 14, color: "#64748B" }}>Loading…</span>
      </main>
    );
  }

  // ── SCREEN: Success ────────────────────────────────────────────────────────
  if (screen === "success") {
    return (
      <main style={{ minHeight: "100dvh", background: "#F4F6F9", fontFamily: "system-ui, sans-serif" }}>
        <Header />
        <div style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{
            width: 60, height: 60, borderRadius: "50%", background: "#E8F5F1",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, color: "#0F7B5F", marginBottom: 16,
          }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0F1720", marginBottom: 6 }}>
            {isEditMode ? "Updated" : "Submitted"}
          </div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>
            {formatDateUK(selectedDate)} · saved successfully
          </div>
          {submitted && <SummaryCard data={submitted} />}
          <button
            onClick={resetForm}
            style={{
              width: "100%", maxWidth: 380, padding: 14, borderRadius: 10,
              background: "#0F1720", color: "#fff", fontSize: 14, fontWeight: 700,
              border: "none", cursor: "pointer", fontFamily: "inherit", marginTop: 16,
            }}
          >
            Submit Another Day
          </button>
        </div>
      </main>
    );
  }

  // ── Date bounds for DateInput ──────────────────────────────────────────────
  const minDate = subDays(today, 7);
  const maxDate = today;

  // ── SCREEN: Form + Confirm sheet ──────────────────────────────────────────
  return (
    <main style={{ minHeight: "100dvh", background: "#F4F6F9", fontFamily: "system-ui, sans-serif" }}>
      <Header />

      {/* Admin no-store banner */}
      {!store.id && (
        <div style={{
          margin: "12px 16px 0", padding: "12px 14px",
          background: "#FFF9E6", border: "1px solid #F3D97E",
          borderRadius: 10, fontSize: 12, color: "#B4791F",
        }}>
          You are signed in as an admin. No store is assigned to this account.
        </div>
      )}

      {/* Edit-mode banner */}
      {isEditMode && !monthLocked && (
        <div style={{
          margin: "12px 16px 0", padding: "11px 14px",
          background: "#EDF2FF", border: "1px solid #BFCFFF",
          borderRadius: 10, fontSize: 12, color: "#3B5EA6", fontWeight: 600,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>✎</span>
          <span>Editing existing entry for {formatDateUK(selectedDate)}</span>
        </div>
      )}

      {/* Error banner */}
      {submitError && (
        <div style={{
          margin: "12px 16px 0", padding: "12px 14px",
          background: "#FFF5F5", border: "1px solid #FDECEA",
          borderRadius: 10, display: "flex", gap: 10, alignItems: "flex-start",
        }}>
          <span style={{ fontSize: 15, lineHeight: 1.2, flexShrink: 0 }}>⚠</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#B3261E", marginBottom: 2 }}>Submission Error</div>
            <div style={{ fontSize: 12, color: "#0F1720" }}>{submitError}</div>
          </div>
        </div>
      )}

      {/* Form body */}
      <div style={{ padding: "0 16px 40px" }}>

        {/* Date picker */}
        <div style={sectionHeaderStyle}>Date</div>
        <div style={fieldWrap}>
          <label style={labelStyle} htmlFor="sales-date">Sales Date</label>
          {dateChecking ? (
            <div style={{
              ...inputStyle(),
              color: "#94A3B8", fontSize: 13,
            }}>
              Checking…
            </div>
          ) : (
            <DateInput
              id="sales-date"
              value={selectedDate}
              onChange={handleDateChange}
              min={minDate}
              max={maxDate}
              required
              style={inputStyle()}
            />
          )}
        </div>

        {/* Locked month message */}
        {monthLocked ? (
          <div style={{
            padding: "24px 16px", textAlign: "center",
            background: "#FFF9E6", border: "1px solid #F3D97E",
            borderRadius: 12, marginTop: 4,
          }}>
            <div style={{ fontSize: 22, marginBottom: 10 }}>🔒</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#B4791F", marginBottom: 6 }}>
              This month is locked
            </div>
            <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>
              The month for {formatDateUK(selectedDate)} has been locked for reporting.
              <br />Contact your area manager to reopen it.
            </div>
          </div>
        ) : (
          <>
            {/* Cash Movement */}
            <div style={sectionHeaderStyle}>Cash Movement</div>

            <div style={fieldWrap}>
              <label style={labelStyle} htmlFor="cash_sale">
                Cash Sale <span style={{ color: "#B3261E" }}>*</span>
              </label>
              <input
                id="cash_sale"
                style={inputStyle(fieldErrors.cash_sale)}
                type="text" inputMode="decimal"
                value={fields.cash_sale} placeholder="0"
                onChange={(e) => handleFieldChange("cash_sale", e.target.value)}
              />
              {fieldErrors.cash_sale && (
                <div style={{ fontSize: 11, color: "#B3261E", marginTop: 3 }}>{fieldErrors.cash_sale}</div>
              )}
            </div>

            <div style={twoCol}>
              {([ ["campaign_float_cash", "Campaign Float"], ["expenses", "Expenses"] ] as const).map(([k, lbl]) => (
                <div key={k} style={fieldWrap}>
                  <label style={labelStyle}>{lbl}</label>
                  <input style={inputStyle()} type="text" inputMode="decimal"
                    value={fields[k]} placeholder="0"
                    onChange={(e) => handleFieldChange(k, e.target.value)} />
                </div>
              ))}
            </div>

            <div style={twoCol}>
              {([ ["other_income", "Other Income"], ["deposit", "Deposit"] ] as const).map(([k, lbl]) => (
                <div key={k} style={fieldWrap}>
                  <label style={labelStyle}>{lbl}</label>
                  <input style={inputStyle()} type="text" inputMode="decimal"
                    value={fields[k]} placeholder="0"
                    onChange={(e) => handleFieldChange(k, e.target.value)} />
                </div>
              ))}
            </div>

            {/* Card Sales */}
            <div style={sectionHeaderStyle}>Card Sales</div>
            <div style={twoCol}>
              {([ ["allied_bank_cc_sale", "Allied Bank CC"], ["hbl_cc_sale", "HBL CC"] ] as const).map(([k, lbl]) => (
                <div key={k} style={fieldWrap}>
                  <label style={labelStyle}>{lbl}</label>
                  <input style={inputStyle()} type="text" inputMode="decimal"
                    value={fields[k]} placeholder="0"
                    onChange={(e) => handleFieldChange(k, e.target.value)} />
                </div>
              ))}
            </div>

            {/* Other Sales */}
            <div style={sectionHeaderStyle}>Other Sales</div>
            <div style={twoCol}>
              {([ ["gift_karte", "Gift Karte"], ["gift_vouchers", "Gift Vouchers"] ] as const).map(([k, lbl]) => (
                <div key={k} style={fieldWrap}>
                  <label style={labelStyle}>{lbl}</label>
                  <input style={inputStyle()} type="text" inputMode="decimal"
                    value={fields[k]} placeholder="0"
                    onChange={(e) => handleFieldChange(k, e.target.value)} />
                </div>
              ))}
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Credit Notes Issued</label>
              <input style={inputStyle()} type="text" inputMode="decimal"
                value={fields.credit_notes_issue} placeholder="0"
                onChange={(e) => handleFieldChange("credit_notes_issue", e.target.value)} />
            </div>

            {/* Calculated Totals */}
            <div style={sectionHeaderStyle}>Calculated Totals</div>
            <div style={twoCol}>
              <div style={fieldWrap}>
                <span style={autoBadge}>AUTO</span>
                <label style={labelStyle}>Total Card Sale</label>
                <input style={inputStyle(undefined, true)} readOnly type="text"
                  value={totalsLoading ? "…" : formatPKR(totals.total_credit_card_sale)} />
              </div>
              <div style={fieldWrap}>
                <span style={autoBadge}>AUTO</span>
                <label style={labelStyle}>Total Sale</label>
                <input style={inputStyle(undefined, true)} readOnly type="text"
                  value={totalsLoading ? "…" : formatPKR(totals.total_sale)} />
              </div>
            </div>
            <div style={fieldWrap}>
              <span style={autoBadge}>AUTO</span>
              <label style={labelStyle}>Net Cash Movement</label>
              <input style={inputStyle(undefined, true)} readOnly type="text"
                value={totalsLoading ? "…" : formatPKR(totals.net_cash_movement)} />
              {totals.opening_balance != null && (
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.5 }}>
                  Opening {formatPKR(totals.opening_balance)} + Net {formatPKR(totals.net_cash_movement)} = Closing {formatPKR(totals.closing_balance)}
                </div>
              )}
            </div>

            {/* Remarks */}
            <div style={sectionHeaderStyle}>Remarks</div>
            <div style={fieldWrap}>
              <textarea
                style={{ ...inputStyle(), height: 76, resize: "none", fontSize: 14, lineHeight: "1.45" }}
                value={fields.remarks}
                placeholder="Optional notes for today's trading…"
                onChange={(e) => handleFieldChange("remarks", e.target.value)}
              />
            </div>

            <button
              onClick={() => { if (validate()) setScreen("confirm"); }}
              disabled={!store.id}
              style={{
                width: "100%", padding: 15, borderRadius: 12, background: "#0F1720",
                color: "#fff", fontSize: 15, fontWeight: 800, border: "none",
                cursor: store.id ? "pointer" : "not-allowed",
                fontFamily: "inherit", marginTop: 4,
                opacity: store.id ? 1 : 0.5,
              }}
            >
              {isEditMode ? "Review & Update →" : "Review & Submit →"}
            </button>
          </>
        )}
      </div>

      {/* Confirmation bottom sheet */}
      {screen === "confirm" && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15,23,32,.65)", zIndex: 50,
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
        }}>
          <div style={{
            background: "#fff", borderRadius: "20px 20px 0 0",
            padding: "0 20px 36px", maxHeight: "88dvh", overflowY: "auto",
          }}>
            {/* Handle bar */}
            <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 10px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#EEF0F3" }} />
            </div>

            <div style={{ fontSize: 16, fontWeight: 800, color: "#0F1720" }}>
              {isEditMode ? "Confirm Update" : "Confirm Submission"}
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 18, marginTop: 2 }}>
              {formatDateUK(selectedDate)} · {store.name ?? "Store"}
            </div>

            {/* Line-item summary */}
            {([
              ["Cash Sale",              formatPKR(num(fields.cash_sale)),                                       null],
              ["Allied CC + HBL CC",     formatPKR(num(fields.allied_bank_cc_sale) + num(fields.hbl_cc_sale)),  null],
              ["Gift Karte + Vouchers",  formatPKR(num(fields.gift_karte) + num(fields.gift_vouchers)),         null],
              ["Campaign Float",         formatPKR(num(fields.campaign_float_cash)),                            null],
              ["Expenses",               formatPKR(num(fields.expenses)),                                       "#B4791F"],
              ["Deposit",                formatPKR(num(fields.deposit)),                                        null],
            ] as [string, string, string | null][]).map(([lbl, val, color]) => (
              <div key={lbl} style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                padding: "9px 0", borderBottom: "1px solid #EEF0F3",
              }}>
                <span style={{ fontSize: 12, color: "#64748B" }}>{lbl}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: color ?? "#0F1720", fontVariantNumeric: "tabular-nums" }}>{val}</span>
              </div>
            ))}

            {/* Separator */}
            <div style={{ height: 1, background: "#0F1720", opacity: .08, margin: "14px 0" }} />

            {/* Calculated totals */}
            {([
              ["Total Sale",        formatPKR(totals.total_sale),        "#0F1720", 16],
              ["Net Cash Movement", formatPKR(totals.net_cash_movement), "#0F7B5F", 16],
              ["Closing Balance",   formatPKR(totals.closing_balance),   "#0F1720", 16],
            ] as [string, string, string, number][]).map(([lbl, val, color, sz]) => (
              <div key={lbl} style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                padding: "7px 0", borderBottom: "1px solid #EEF0F3",
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0F1720" }}>{lbl}</span>
                <span style={{ fontSize: sz, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{val}</span>
              </div>
            ))}

            {submitError && (
              <div style={{
                marginTop: 14, padding: "10px 14px",
                background: "#FFF5F5", border: "1px solid #FDECEA",
                borderRadius: 8, color: "#B3261E", fontSize: 12,
              }}>
                {submitError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => { setScreen("form"); setSubmitError(null); }}
                disabled={submitting}
                style={{
                  flex: 1, padding: 13, borderRadius: 10, fontSize: 13, fontWeight: 700,
                  border: "none", cursor: "pointer", background: "#F4F6F9",
                  color: "#0F1720", fontFamily: "inherit",
                }}
              >
                ← Edit
              </button>
              <button
                onClick={() => void submit()}
                disabled={submitting}
                style={{
                  flex: 2, padding: 13, borderRadius: 10, fontSize: 14, fontWeight: 800,
                  border: "none", cursor: submitting ? "default" : "pointer",
                  background: "#0F7B5F", color: "#fff", fontFamily: "inherit",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? "Saving…" : isEditMode ? "Update ✓" : "Submit ✓"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
