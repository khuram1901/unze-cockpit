"use client";

import { useEffect, useRef, useState } from "react";
import { authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInput from "../lib/DateInput";
import {
  COLOURS, RADII, SkeletonRows,
  useToast, primaryButtonStyle, inputStyle,
} from "../lib/SharedUI";

// ── Types ─────────────────────────────────────────────────────────────────────

type TxnSummary = { id: string; txn_type: "payment" | "receipt"; amount_pkr: number };

type CashSheetSummary = {
  id: string;
  company: string;
  sheet_date: string;
  source: string;
  pdf_storage_path: string | null;
  opening_balance_pkr: number | null;
  closing_balance_pkr: number | null;
  notes: string | null;
  uploaded_by: string;
  created_at: string;
  cash_sheet_transactions: TxnSummary[];
};

type Transaction = {
  id: string;
  txn_type: "payment" | "receipt";
  description: string;
  amount_pkr: number;
  bank_account: string | null;
  reference: string | null;
  category: string | null;
  sort_order: number;
};

type CashSheetDetail = Omit<CashSheetSummary, "cash_sheet_transactions"> & {
  receipts: Transaction[];
  payments: Transaction[];
  pdf_signed_url: string | null;
  receipts_pkr: number | null;
  payments_pkr: number | null;
};

type DraftTxn = {
  _key: string;
  txn_type: "payment" | "receipt";
  description: string;
  amount_pkr: string;
  bank_account: string;
  reference: string;
  category: string;
};

type Company = "IFPL" | "UTPL" | "BRNH" | "HD" | "KKJ";

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPANY_TABS: { id: Company; label: string }[] = [
  { id: "UTPL", label: "Unze Trading (UTPL)" },
  { id: "IFPL", label: "Imperial Footwear (IFPL)" },
  { id: "BRNH", label: "Baranh (BRNH)" },
  { id: "HD",   label: "Haute Dolci (HD)" },
  { id: "KKJ",  label: "K&K Jhang (KKJ)" },
];

const RECEIPT_CATEGORIES = [
  "Sales", "Receivable Collection", "Bank Transfer In",
  "Loan Received", "Other Receipt",
];

const PAYMENT_CATEGORIES = [
  "Supplier Payment", "Salary / Wages", "EOBI", "Social Security",
  "Utility Bill", "Rent", "Tax", "Bank Charges",
  "Bank Transfer Out", "Other Payment",
];

// ── Formatting helpers ────────────────────────────────────────────────────────

function pkr(amount: number | null | undefined): string {
  if (amount == null) return "—";
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded);
  const sign = rounded < 0 ? "-" : "";
  return sign + "PKR " + abs.toLocaleString("en-PK");
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[m - 1]} ${y}`;
}

function currentYM(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function prevYM(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function nextYM(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function dayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
}

function netColour(net: number): string {
  if (net > 0) return COLOURS.GREEN;
  if (net < 0) return COLOURS.RED;
  return COLOURS.SLATE;
}

function shortDate(dateStr: string): string {
  // "2026-07-07" → "7 Jul"
  return formatDateUK(dateStr).slice(0, 6).trim().replace(/^0/, "");
}

function uniqueKey(): string {
  return Math.random().toString(36).slice(2);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CashSheetTab() {
  const [company, setCompany] = useState<Company>("UTPL");
  const [selectedMonth, setSelectedMonth] = useState<string>(currentYM());

  // Sheet list
  const [sheets, setSheets] = useState<CashSheetSummary[]>([]);
  const [loading, setLoading] = useState(false);

  // Detail view
  const [detail, setDetail] = useState<CashSheetDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Add-transaction form inside detail
  const [addTxn, setAddTxn] = useState<DraftTxn | null>(null);
  const [savingTxn, setSavingTxn] = useState(false);

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    sheet_date: todayISO(), opening_balance_pkr: "", closing_balance_pkr: "", notes: "",
  });
  const [draftTxns, setDraftTxns] = useState<DraftTxn[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { show: showToast, element: toastElement } = useToast();

  // ── Data loading ────────────────────────────────────────────────────────────

  async function loadSheets() {
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/banking/cash-sheets?company=${company}&month=${selectedMonth}`
      );
      const json = await res.json();
      setSheets(json.data || []);
    } catch {
      showToast("Failed to load cash sheets — check your connection and refresh", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSheets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, selectedMonth]);

  async function loadDetail(id: string) {
    setLoadingDetail(true);
    try {
      const res = await authFetch(`/api/banking/cash-sheets/${id}`);
      const json = await res.json();
      setDetail(json.data || null);
    } catch {
      showToast("Failed to load sheet detail", "error");
    } finally {
      setLoadingDetail(false);
    }
  }

  // ── Upload submit ───────────────────────────────────────────────────────────

  async function submitUpload() {
    if (!uploadForm.sheet_date) {
      showToast("Please select a date", "error"); return;
    }
    setSaving(true);
    try {

    // 1. Upload PDF if selected — also parses it server-side to extract balances
    let pdf_storage_path: string | undefined;
    let parsedOpening: number | undefined;
    let parsedClosing: number | undefined;
    let parsedReceipts: number | undefined;
    let parsedPayments: number | undefined;
    if (uploadFile) {
      if (uploadFile.size > 20 * 1024 * 1024) {
        showToast("PDF must be under 20 MB", "error");
        return;
      }

      // 1a. Get a signed upload URL — the browser then uploads the PDF
      //     DIRECTLY to Supabase Storage, bypassing Vercel's ~4.5 MB request
      //     limit that rejected larger scanned sheets (413 errors).
      const urlRes = await authFetch("/api/banking/cash-sheets/pdf/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, date: uploadForm.sheet_date }),
      });
      const urlJson = await urlRes.json();
      if (!urlJson.ok) {
        showToast(urlJson.error || "Could not prepare PDF upload", "error");
        return;
      }

      // 1b. Direct upload to storage via plain fetch — avoids any dependency on
      //     NEXT_PUBLIC_SUPABASE_URL being correctly set in the browser bundle.
      //     The signedUrl returned by the server is the complete upload endpoint.
      const upRes = await fetch(urlJson.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf", "x-upsert": "true" },
        body: uploadFile,
      });
      if (!upRes.ok) {
        const upText = await upRes.text().catch(() => upRes.statusText);
        showToast(`PDF upload failed (${upRes.status}): ${upText.slice(0, 120)}`, "error");
        return;
      }
      pdf_storage_path = urlJson.path;

      // 1c. Parse server-side (downloads from storage — no size limit issues)
      const parseRes = await authFetch("/api/banking/cash-sheets/pdf/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: urlJson.path }),
      });
      const pdfJson = await parseRes.json();
      // Parsing is best-effort — a parse failure never blocks the save
      if (pdfJson.ok && pdfJson.parsed) {
        parsedOpening = pdfJson.parsed.opening ?? undefined;
        parsedClosing = pdfJson.parsed.closing ?? undefined;
        parsedReceipts = pdfJson.parsed.receipts ?? undefined;
        parsedPayments = pdfJson.parsed.payments ?? undefined;
      }
    }

    // 2. Build validated transactions
    const transactions = draftTxns
      .filter((t) => t.description.trim() && parseFloat(t.amount_pkr) > 0)
      .map((t, i) => ({
        txn_type: t.txn_type,
        description: t.description.trim(),
        amount_pkr: parseFloat(t.amount_pkr),
        bank_account: t.bank_account || undefined,
        reference: t.reference || undefined,
        category: t.category || undefined,
        sort_order: i,
      }));

    // Resolve balances: prefer manually-entered values, fall back to PDF parse
    const finalOpening = uploadForm.opening_balance_pkr
      ? parseFloat(uploadForm.opening_balance_pkr)
      : parsedOpening;
    const finalClosing = uploadForm.closing_balance_pkr
      ? parseFloat(uploadForm.closing_balance_pkr)
      : parsedClosing;

    // 3. Create sheet
    const res = await authFetch("/api/banking/cash-sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company,
        sheet_date: uploadForm.sheet_date,
        opening_balance_pkr: finalOpening,
        closing_balance_pkr: finalClosing,
        notes: uploadForm.notes || undefined,
        pdf_storage_path,
        transactions,
        // Pass parsed totals so daily_cash_position can be kept in sync
        total_receipts: parsedReceipts,
        total_payments: parsedPayments,
      }),
    });
    let json: { ok?: boolean; error?: string };
    try {
      json = await res.json();
    } catch {
      json = { ok: false, error: `Server error (${res.status}) — please try again` };
    }

    if (json.ok) {
      showToast("Cash sheet saved", "success");
      closeUpload();
      loadSheets();
    } else {
      showToast(json.error || `Failed to save (${res.status}) — please try again`, "error");
    }

    } catch (err) {
      // Network failure / server unreachable — without this the button was
      // stuck on "Saving…" forever with no feedback.
      showToast("Save failed: " + (err instanceof Error ? err.message : String(err)) + " — please try again", "error");
    } finally {
      setSaving(false);
    }
  }

  function closeUpload() {
    setShowUpload(false);
    setDragOver(false);
    setSaving(false);
    setUploadForm({ sheet_date: todayISO(), opening_balance_pkr: "", closing_balance_pkr: "", notes: "" });
    setDraftTxns([]);
    setUploadFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Draft transaction helpers ───────────────────────────────────────────────

  function addDraftRow(type: "payment" | "receipt") {
    setDraftTxns((prev) => [
      ...prev,
      { _key: uniqueKey(), txn_type: type, description: "", amount_pkr: "", bank_account: "", reference: "", category: "" },
    ]);
  }

  function updateDraftRow(key: string, field: keyof DraftTxn, value: string) {
    setDraftTxns((prev) =>
      prev.map((t) => (t._key === key ? { ...t, [field]: value } : t))
    );
  }

  function removeDraftRow(key: string) {
    setDraftTxns((prev) => prev.filter((t) => t._key !== key));
  }

  // ── Add transaction to existing sheet ──────────────────────────────────────

  function openAddTxn(type: "payment" | "receipt") {
    setAddTxn({ _key: uniqueKey(), txn_type: type, description: "", amount_pkr: "", bank_account: "", reference: "", category: "" });
  }

  async function saveAddTxn() {
    if (!detail || !addTxn) return;
    if (!addTxn.description.trim() || !addTxn.amount_pkr) {
      showToast("Description and amount are required", "error"); return;
    }
    setSavingTxn(true);
    try {
    const res = await authFetch("/api/banking/cash-sheets/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheet_id: detail.id,
        txn_type: addTxn.txn_type,
        description: addTxn.description.trim(),
        amount_pkr: parseFloat(addTxn.amount_pkr),
        bank_account: addTxn.bank_account || undefined,
        reference: addTxn.reference || undefined,
        category: addTxn.category || undefined,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      showToast("Transaction added", "success");
      setAddTxn(null);
      loadDetail(detail.id);
      loadSheets();
    } else {
      showToast(json.error || "Failed to add", "error");
    }
    } catch (err) {
      showToast("Failed to add: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setSavingTxn(false);
    }
  }

  async function deleteTxn(txnId: string) {
    if (!detail) return;
    if (!confirm("Remove this transaction?")) return;
    try {
      const res = await authFetch(`/api/banking/cash-sheets/transactions?id=${txnId}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        loadDetail(detail.id);
        loadSheets();
      } else {
        showToast(json.error || "Failed to delete", "error");
      }
    } catch (err) {
      showToast("Failed to delete: " + (err instanceof Error ? err.message : String(err)), "error");
    }
  }

  async function deleteSheet(id: string) {
    if (!confirm("Delete this entire cash sheet and all its transactions? This cannot be undone.")) return;
    try {
      const res = await authFetch(`/api/banking/cash-sheets/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        showToast("Cash sheet deleted", "success");
        setDetail(null);
        loadSheets();
      } else {
        showToast(json.error || "Failed to delete", "error");
      }
    } catch (err) {
      showToast("Failed to delete: " + (err instanceof Error ? err.message : String(err)), "error");
    }
  }

  // ── Sheet list helpers ──────────────────────────────────────────────────────

  function getSheetTotals(sheet: CashSheetSummary) {
    const txns = sheet.cash_sheet_transactions || [];
    const totalReceipts = txns.filter((t) => t.txn_type === "receipt").reduce((s, t) => s + Number(t.amount_pkr), 0);
    const totalPayments = txns.filter((t) => t.txn_type === "payment").reduce((s, t) => s + Number(t.amount_pkr), 0);
    const net = totalReceipts - totalPayments;
    return { totalReceipts, totalPayments, net, txnCount: txns.length };
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px", fontSize: "13px", fontWeight: active ? 700 : 500,
    color: active ? COLOURS.NAVY : COLOURS.SLATE,
    backgroundColor: "transparent", border: "none",
    borderBottom: active ? `2px solid ${COLOURS.NAVY}` : "2px solid transparent",
    marginBottom: "-2px", cursor: "pointer", whiteSpace: "nowrap" as const,
  });

  const navBtn: React.CSSProperties = {
    width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
    border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL,
    backgroundColor: "white", cursor: "pointer", fontSize: "14px", color: COLOURS.NAVY,
  };

  // ── Render: transaction row ─────────────────────────────────────────────────

  function renderTxnRow(t: Transaction, type: "payment" | "receipt") {
    return (
      <div key={t.id} style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        padding: "9px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "2px" }}>
            {t.description}
          </div>
          <div style={{ fontSize: "11px", color: COLOURS.SLATE, display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {t.category && <span>{t.category}</span>}
            {t.bank_account && <span>· {t.bank_account}</span>}
            {t.reference && <span>· Ref: {t.reference}</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "12px", flexShrink: 0 }}>
          <span style={{
            fontSize: "13px", fontWeight: 700,
            color: type === "receipt" ? COLOURS.GREEN : COLOURS.RED,
          }}>
            {pkr(t.amount_pkr)}
          </span>
          <button
            onClick={() => deleteTxn(t.id)}
            title="Remove transaction"
            style={{
              width: "22px", height: "22px", borderRadius: "50%",
              border: "none", backgroundColor: "#FEE2E2", color: COLOURS.RED,
              cursor: "pointer", fontSize: "12px", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}
          >×</button>
        </div>
      </div>
    );
  }

  // ── Render: draft transaction input row ─────────────────────────────────────

  function renderDraftRow(t: DraftTxn) {
    const categories = t.txn_type === "receipt" ? RECEIPT_CATEGORIES : PAYMENT_CATEGORIES;
    return (
      <div key={t._key} style={{
        padding: "10px 12px", borderRadius: "8px", marginBottom: "6px",
        backgroundColor: t.txn_type === "receipt" ? "#F0FDF4" : "#FFF7F0",
        border: `1px solid ${t.txn_type === "receipt" ? "#BBF7D0" : "#FED7AA"}`,
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "6px", marginBottom: "6px" }}>
          <input
            placeholder="Description *"
            value={t.description}
            onChange={(e) => updateDraftRow(t._key, "description", e.target.value)}
            style={{ ...inputStyle, fontSize: "12px" }}
          />
          <input
            type="number"
            placeholder="Amount *"
            value={t.amount_pkr}
            onChange={(e) => updateDraftRow(t._key, "amount_pkr", e.target.value)}
            style={{ ...inputStyle, fontSize: "12px" }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "6px", alignItems: "center" }}>
          <select
            value={t.category}
            onChange={(e) => updateDraftRow(t._key, "category", e.target.value)}
            style={{ ...inputStyle, fontSize: "11px" }}
          >
            <option value="">Category</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            placeholder="Bank account"
            value={t.bank_account}
            onChange={(e) => updateDraftRow(t._key, "bank_account", e.target.value)}
            style={{ ...inputStyle, fontSize: "11px" }}
          />
          <input
            placeholder="Reference"
            value={t.reference}
            onChange={(e) => updateDraftRow(t._key, "reference", e.target.value)}
            style={{ ...inputStyle, fontSize: "11px" }}
          />
          <button
            onClick={() => removeDraftRow(t._key)}
            style={{
              width: "24px", height: "24px", borderRadius: "50%", flexShrink: 0,
              border: "none", backgroundColor: "#FEE2E2", color: COLOURS.RED,
              cursor: "pointer", fontSize: "14px",
            }}
          >×</button>
        </div>
      </div>
    );
  }

  // ── Render: main ─────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Company sub-tabs + Month nav on same row */}
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        flexWrap: "wrap", gap: "8px", marginBottom: "20px",
        borderBottom: `2px solid ${COLOURS.HAIRLINE}`,
      }}>
        {/* Company tabs */}
        <div style={{ display: "flex", gap: "4px" }}>
          {COMPANY_TABS.map((ct) => (
            <button key={ct.id} onClick={() => setCompany(ct.id)} style={pillBtn(company === ct.id)}>
              {ct.label}
            </button>
          ))}
        </div>

        {/* Month navigator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "8px" }}>
          <button style={navBtn} onClick={() => setSelectedMonth(prevYM(selectedMonth))}>‹</button>
          <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, minWidth: "80px", textAlign: "center" }}>
            {monthLabel(selectedMonth)}
          </span>
          <button
            style={{ ...navBtn, opacity: selectedMonth >= currentYM() ? 0.3 : 1 }}
            onClick={() => selectedMonth < currentYM() && setSelectedMonth(nextYM(selectedMonth))}
            disabled={selectedMonth >= currentYM()}
          >›</button>
        </div>
      </div>

      {/* Upload button */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
        <button
          onClick={() => setShowUpload(true)}
          style={{ ...primaryButtonStyle, display: "flex", alignItems: "center", gap: "6px" }}
        >
          <span style={{ fontSize: "16px" }}>+</span> Upload Cash Sheet
        </button>
      </div>

      {/* Sheet list */}
      {loading ? (
        <SkeletonRows count={4} height="72px" />
      ) : sheets.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "48px 24px",
          border: `2px dashed ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
          color: COLOURS.SLATE,
        }}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>📄</div>
          <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px", color: COLOURS.NAVY }}>
            No cash sheets for {monthLabel(selectedMonth)}
          </div>
          <div style={{ fontSize: "12px" }}>Upload the first sheet or navigate to another month.</div>
        </div>
      ) : (
        <div>
          {sheets.map((sheet) => {
            const { totalReceipts, totalPayments, net, txnCount } = getSheetTotals(sheet);
            const hasBalances = sheet.opening_balance_pkr != null && sheet.closing_balance_pkr != null;
            const balanceNet = hasBalances
              ? (sheet.closing_balance_pkr! - sheet.opening_balance_pkr!)
              : null;
            return (
              <div
                key={sheet.id}
                onClick={() => loadDetail(sheet.id)}
                style={{
                  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px",
                  padding: "14px 16px", marginBottom: "8px", cursor: "pointer",
                  backgroundColor: "white", transition: "box-shadow 0.12s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 2px 12px rgba(15,23,42,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>
                      {dayOfWeek(sheet.sheet_date)} {shortDate(sheet.sheet_date)}
                    </div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px", display: "flex", gap: "12px" }}>
                      {txnCount > 0 ? (
                        <>
                          <span style={{ color: COLOURS.GREEN }}>
                            ↑ {(sheet.cash_sheet_transactions || []).filter((t) => t.txn_type === "receipt").length} receipts
                          </span>
                          <span style={{ color: COLOURS.RED }}>
                            ↓ {(sheet.cash_sheet_transactions || []).filter((t) => t.txn_type === "payment").length} payments
                          </span>
                        </>
                      ) : (
                        <span>No transactions recorded</span>
                      )}
                      {sheet.pdf_storage_path && <span>· 📄 PDF attached</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {hasBalances && (
                      <>
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                          Open {pkr(sheet.opening_balance_pkr)} → Close {pkr(sheet.closing_balance_pkr)}
                        </div>
                        {balanceNet !== null && (
                          <div style={{ fontSize: "12px", fontWeight: 700, color: netColour(balanceNet), marginTop: "2px" }}>
                            {balanceNet >= 0 ? "▲" : "▼"} {pkr(Math.abs(balanceNet))}
                          </div>
                        )}
                      </>
                    )}
                    {!hasBalances && txnCount > 0 && (
                      <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>
                        Net {net >= 0 ? "▲" : "▼"} {pkr(Math.abs(net))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detail modal ──────────────────────────────────────────────────────── */}
      {(detail !== null || loadingDetail) && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9998,
            backgroundColor: "rgba(15,23,42,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
          }}
          onClick={() => { setDetail(null); setAddTxn(null); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "white", borderRadius: RADII.CARD,
              maxWidth: "600px", width: "100%", maxHeight: "85vh",
              display: "flex", flexDirection: "column",
              boxShadow: "0 20px 60px rgba(15,23,42,0.2)",
            }}
          >
            {loadingDetail ? (
              <div style={{ padding: "32px" }}><SkeletonRows count={5} height="40px" /></div>
            ) : detail ? (
              <>
                {/* Modal header */}
                <div style={{
                  padding: "16px 20px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                  display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
                }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>
                      Cash Sheet — {detail.company} · {dayOfWeek(detail.sheet_date)} {formatDateUK(detail.sheet_date)}
                    </div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      Uploaded by {detail.uploaded_by.split("@")[0]} ·{" "}
                      {detail.source === "email" ? "via email" : "manual upload"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {detail.pdf_signed_url && (
                      <a
                        href={detail.pdf_signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: "12px", fontWeight: 600, padding: "5px 12px",
                          borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`,
                          color: COLOURS.NAVY, textDecoration: "none", backgroundColor: "#FAFBFD",
                        }}
                      >
                        📄 View PDF
                      </a>
                    )}
                    <button
                      onClick={() => deleteSheet(detail.id)}
                      style={{
                        fontSize: "11px", padding: "4px 10px", borderRadius: RADII.PILL,
                        border: `1px solid #FCA5A5`, backgroundColor: "#FEE2E2",
                        color: COLOURS.RED, cursor: "pointer",
                      }}
                    >Delete</button>
                    <button
                      onClick={() => { setDetail(null); setAddTxn(null); }}
                      style={{
                        width: "28px", height: "28px", borderRadius: "50%", border: "none",
                        backgroundColor: COLOURS.HAIRLINE, cursor: "pointer", fontSize: "16px",
                        display: "flex", alignItems: "center", justifyContent: "center", color: COLOURS.SLATE,
                      }}
                    >×</button>
                  </div>
                </div>

                {/* Scrollable body */}
                <div style={{ overflowY: "auto", padding: "16px 20px", flex: 1 }}>

                  {/* Balance summary */}
                  {(detail.opening_balance_pkr != null || detail.closing_balance_pkr != null || detail.receipts_pkr != null || detail.payments_pkr != null) && (() => {
                    const hasParsed = detail.receipts_pkr != null || detail.payments_pkr != null;
                    const tiles = [
                      { label: "Opening Balance", value: detail.opening_balance_pkr, color: COLOURS.SLATE },
                      ...(hasParsed ? [
                        { label: "Receipts", value: detail.receipts_pkr, color: COLOURS.GREEN },
                        { label: "Payments", value: detail.payments_pkr, color: COLOURS.RED },
                      ] : []),
                      { label: "Closing Balance", value: detail.closing_balance_pkr, color: COLOURS.SLATE },
                      {
                        label: "Net Change",
                        value: (detail.closing_balance_pkr ?? 0) - (detail.opening_balance_pkr ?? 0),
                        color: netColour((detail.closing_balance_pkr ?? 0) - (detail.opening_balance_pkr ?? 0)),
                      },
                    ];
                    const cols = tiles.length === 5 ? "1fr 1fr 1fr 1fr 1fr" : "1fr 1fr 1fr";
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: cols, gap: "10px", marginBottom: "18px" }}>
                        {tiles.map(({ label, value, color }) => (
                          <div key={label} style={{
                            padding: "10px 12px", borderRadius: "8px",
                            backgroundColor: "#FAFBFD", border: `1px solid ${COLOURS.HAIRLINE}`,
                          }}>
                            <div style={{ fontSize: "10px", color: COLOURS.SLATE, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              {label}
                            </div>
                            <div style={{ fontSize: "15px", fontWeight: 700, color, marginTop: "4px" }}>
                              {pkr(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Receipts */}
                  <SectionHeader
                    label="Receipts"
                    total={detail.receipts.reduce((s, t) => s + Number(t.amount_pkr), 0)}
                    color={COLOURS.GREEN}
                    onAdd={() => openAddTxn("receipt")}
                  />
                  {detail.receipts.length === 0 && addTxn?.txn_type !== "receipt" && (
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, padding: "8px 0 12px" }}>No receipts recorded.</div>
                  )}
                  {detail.receipts.map((t) => renderTxnRow(t, "receipt"))}

                  {/* Add receipt inline form */}
                  {addTxn?.txn_type === "receipt" && (
                    <AddTxnInline
                      draft={addTxn}
                      categories={RECEIPT_CATEGORIES}
                      onChange={(f, v) => setAddTxn((d) => d ? { ...d, [f]: v } : d)}
                      onSave={saveAddTxn}
                      onCancel={() => setAddTxn(null)}
                      saving={savingTxn}
                    />
                  )}

                  {/* Payments */}
                  <SectionHeader
                    label="Payments"
                    total={detail.payments.reduce((s, t) => s + Number(t.amount_pkr), 0)}
                    color={COLOURS.RED}
                    onAdd={() => openAddTxn("payment")}
                  />
                  {detail.payments.length === 0 && addTxn?.txn_type !== "payment" && (
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, padding: "8px 0 12px" }}>No payments recorded.</div>
                  )}
                  {detail.payments.map((t) => renderTxnRow(t, "payment"))}

                  {/* Add payment inline form */}
                  {addTxn?.txn_type === "payment" && (
                    <AddTxnInline
                      draft={addTxn}
                      categories={PAYMENT_CATEGORIES}
                      onChange={(f, v) => setAddTxn((d) => d ? { ...d, [f]: v } : d)}
                      onSave={saveAddTxn}
                      onCancel={() => setAddTxn(null)}
                      saving={savingTxn}
                    />
                  )}

                  {detail.notes && (
                    <div style={{ marginTop: "14px", fontSize: "12px", color: COLOURS.SLATE }}>
                      <strong>Notes:</strong> {detail.notes}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Upload modal ──────────────────────────────────────────────────────── */}
      {showUpload && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            backgroundColor: "rgba(15,23,42,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
          }}
          onClick={closeUpload}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "white", borderRadius: RADII.CARD,
              maxWidth: "620px", width: "100%", maxHeight: "90vh",
              display: "flex", flexDirection: "column",
              boxShadow: "0 20px 60px rgba(15,23,42,0.2)",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "16px 20px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
            }}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>
                  Upload Cash Sheet
                </div>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                  {COMPANY_TABS.find((ct) => ct.id === company)?.label ?? company}
                </div>
              </div>
              <button
                onClick={closeUpload}
                style={{
                  width: "28px", height: "28px", borderRadius: "50%", border: "none",
                  backgroundColor: COLOURS.HAIRLINE, cursor: "pointer", fontSize: "16px",
                  display: "flex", alignItems: "center", justifyContent: "center", color: COLOURS.SLATE,
                }}
              >×</button>
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: "auto", padding: "18px 20px", flex: 1 }}>

              {/* Date + Balances */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={labelStyle}>Date *</label>
                  <DateInput
                    value={uploadForm.sheet_date}
                    onChange={(e) => setUploadForm({ ...uploadForm, sheet_date: e.target.value })}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Opening Balance (PKR)</label>
                  <input
                    type="number" placeholder="Optional"
                    value={uploadForm.opening_balance_pkr}
                    onChange={(e) => setUploadForm({ ...uploadForm, opening_balance_pkr: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Closing Balance (PKR)</label>
                  <input
                    type="number" placeholder="Optional"
                    value={uploadForm.closing_balance_pkr}
                    onChange={(e) => setUploadForm({ ...uploadForm, closing_balance_pkr: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}
                  />
                </div>
              </div>

              {/* PDF upload — drag & drop zone */}
              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>Cash Sheet PDF (optional)</label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type === "application/pdf") {
                      setUploadFile(file);
                    } else if (file) {
                      showToast("Please drop a PDF file", "error");
                    }
                  }}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                    borderRadius: "8px",
                    padding: "16px",
                    textAlign: "center" as const,
                    cursor: "pointer",
                    backgroundColor: dragOver ? "#F0FDF4" : "#FAFBFD",
                    transition: "all 0.15s",
                    userSelect: "none" as const,
                  }}
                >
                  {uploadFile ? (
                    <div style={{ fontSize: "13px", color: COLOURS.GREEN, fontWeight: 600 }}>
                      ✓ {uploadFile.name} ({(uploadFile.size / 1024).toFixed(0)} KB)
                      <button
                        onClick={(e) => { e.stopPropagation(); setUploadFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                        style={{
                          marginLeft: "8px", background: "none", border: "none",
                          color: COLOURS.SLATE, cursor: "pointer", fontSize: "14px", lineHeight: 1,
                        }}
                      >✕</button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: "22px", marginBottom: "4px" }}>📄</div>
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                        Drag & drop a PDF here, or <span style={{ color: COLOURS.NAVY, fontWeight: 600 }}>click to browse</span>
                      </div>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  style={{ display: "none" }}
                />
              </div>

              {/* Notes */}
              <div style={{ marginBottom: "18px" }}>
                <label style={labelStyle}>Notes (optional)</label>
                <input
                  placeholder="Any additional context"
                  value={uploadForm.notes}
                  onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}
                />
              </div>

              {/* Transactions */}
              <div style={{
                borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "14px", marginBottom: "14px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <span style={{
                    fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE,
                    textTransform: "uppercase", letterSpacing: "0.07em",
                  }}>
                    Transactions ({draftTxns.length})
                  </span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      onClick={() => addDraftRow("receipt")}
                      style={{
                        fontSize: "11px", fontWeight: 600, padding: "4px 10px",
                        borderRadius: RADII.PILL, border: `1px solid #BBF7D0`,
                        backgroundColor: "#F0FDF4", color: COLOURS.GREEN, cursor: "pointer",
                      }}
                    >+ Receipt</button>
                    <button
                      onClick={() => addDraftRow("payment")}
                      style={{
                        fontSize: "11px", fontWeight: 600, padding: "4px 10px",
                        borderRadius: RADII.PILL, border: `1px solid #FED7AA`,
                        backgroundColor: "#FFF7F0", color: "#EA580C", cursor: "pointer",
                      }}
                    >+ Payment</button>
                  </div>
                </div>

                {draftTxns.length === 0 && (
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE, fontStyle: "italic" }}>
                    Add receipts and payments using the buttons above.
                  </div>
                )}
                {draftTxns.map((t) => renderDraftRow(t))}
              </div>

            </div>

            {/* Footer */}
            <div style={{
              padding: "12px 20px", borderTop: `1px solid ${COLOURS.HAIRLINE}`,
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
            }}>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                {draftTxns.filter((t) => t.description && t.amount_pkr).length} valid transactions
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={closeUpload}
                  style={{
                    padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500,
                    border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white",
                    color: COLOURS.NAVY, cursor: "pointer",
                  }}
                >Cancel</button>
                <button
                  onClick={submitUpload}
                  disabled={saving || !uploadForm.sheet_date}
                  style={{ ...primaryButtonStyle, opacity: (saving || !uploadForm.sheet_date) ? 0.6 : 1 }}
                >
                  {saving ? "Saving…" : "Save Cash Sheet"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toastElement}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE,
  display: "block", marginBottom: "4px",
};

function SectionHeader({
  label, total, color, onAdd,
}: {
  label: string; total: number; color: string; onAdd: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      marginTop: "16px", marginBottom: "2px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{
          fontSize: "11px", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.07em", color: COLOURS.SLATE,
        }}>{label}</span>
        {total > 0 && (
          <span style={{ fontSize: "12px", fontWeight: 700, color }}>
            PKR {Math.round(total).toLocaleString("en-PK")}
          </span>
        )}
      </div>
      <button
        onClick={onAdd}
        style={{
          fontSize: "11px", fontWeight: 600, padding: "3px 9px",
          borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`,
          backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer",
        }}
      >+ Add</button>
    </div>
  );
}

function AddTxnInline({
  draft, categories, onChange, onSave, onCancel, saving,
}: {
  draft: DraftTxn;
  categories: string[];
  onChange: (field: keyof DraftTxn, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const borderColor = draft.txn_type === "receipt" ? "#BBF7D0" : "#FED7AA";
  const bg = draft.txn_type === "receipt" ? "#F0FDF4" : "#FFF7F0";

  return (
    <div style={{
      padding: "10px 12px", borderRadius: "8px", marginTop: "6px", marginBottom: "6px",
      backgroundColor: bg, border: `1px solid ${borderColor}`,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "8px", marginBottom: "8px" }}>
        <input
          autoFocus
          placeholder="Description *"
          value={draft.description}
          onChange={(e) => onChange("description", e.target.value)}
          style={{ ...inputStyle, fontSize: "12px" }}
        />
        <input
          type="number"
          placeholder="Amount (PKR) *"
          value={draft.amount_pkr}
          onChange={(e) => onChange("amount_pkr", e.target.value)}
          style={{ ...inputStyle, fontSize: "12px" }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "8px" }}>
        <select
          value={draft.category}
          onChange={(e) => onChange("category", e.target.value)}
          style={{ ...inputStyle, fontSize: "11px" }}
        >
          <option value="">Category (optional)</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          placeholder="Bank account"
          value={draft.bank_account}
          onChange={(e) => onChange("bank_account", e.target.value)}
          style={{ ...inputStyle, fontSize: "11px" }}
        />
        <input
          placeholder="Reference / cheque #"
          value={draft.reference}
          onChange={(e) => onChange("reference", e.target.value)}
          style={{ ...inputStyle, fontSize: "11px" }}
        />
      </div>
      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{
          fontSize: "12px", padding: "4px 12px", borderRadius: RADII.PILL,
          border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white",
          color: COLOURS.SLATE, cursor: "pointer",
        }}>Cancel</button>
        <button
          onClick={onSave}
          disabled={saving || !draft.description || !draft.amount_pkr}
          style={{ ...primaryButtonStyle, opacity: (saving || !draft.description || !draft.amount_pkr) ? 0.6 : 1 }}
        >{saving ? "Saving…" : "Add"}</button>
      </div>
    </div>
  );
}
