"use client";

/**
 * ExcelImportPanel — 3-step Excel import flow:
 *   1. Upload  — drag-and-drop or file picker
 *   2. Preview — table of rows with conflict flags; confirm or cancel
 *   3. Done    — success/error summary
 *
 * Calls /api/daily-sales/import-preview → /api/daily-sales/import-confirm.
 */

import { useCallback, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";

interface Store {
  id: string;
  fm_code: string;
  name: string;
}

interface PreviewRow {
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
  conflict: boolean;
  conflict_reason: string | null;
}

interface Props {
  stores: Store[];
  defaultStoreId: string;
  year: number;
  month: number;
  onClose: () => void;
  onImported: () => void;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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

function pkr(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-PK");
}

/** Parse a minimal XLSX/CSV-like file into row objects. */
async function parseExcel(file: File): Promise<Record<string, unknown>[]> {
  // Dynamically import xlsx so it's not in the main bundle
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, unknown>[];
  return json;
}

type Step = "upload" | "preview" | "done";

export default function ExcelImportPanel({ stores, defaultStoreId, year, month, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [storeId, setStoreId] = useState(defaultStoreId || stores[0]?.id || "");
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [summary, setSummary] = useState({ inserted: 0, updated: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (f: File) => {
    setFile(f);
    setParseError(null);
    setParsing(true);
    try {
      const rows = await parseExcel(f);
      setRawRows(rows);
      // Call preview RPC
      const res = await apiFetch("/api/daily-sales/import-preview", {
        method: "POST",
        body: JSON.stringify({ store_id: storeId, rows }),
      });
      const json = await res.json() as { preview?: PreviewRow[]; batch_id?: string; error?: string };
      if (!res.ok) {
        setParseError(json.error ?? "Preview failed");
        return;
      }
      setPreviewRows(json.preview ?? []);
      setBatchId(json.batch_id ?? null);
      setStep("preview");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Failed to parse file");
    } finally {
      setParsing(false);
    }
  }, [storeId]);

  async function confirm() {
    if (!batchId) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await apiFetch("/api/daily-sales/import-confirm", {
        method: "POST",
        body: JSON.stringify({ store_id: storeId, batch_id: batchId, rows: rawRows }),
      });
      const json = await res.json() as { result?: { inserted?: number; updated?: number }; error?: string };
      if (!res.ok) {
        setConfirmError(json.error ?? "Import failed");
        return;
      }
      setSummary({ inserted: json.result?.inserted ?? 0, updated: json.result?.updated ?? 0 });
      setStep("done");
      onImported();
    } finally {
      setConfirming(false);
    }
  }

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.25)", zIndex: 200,
  };
  const panel: React.CSSProperties = {
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: step === "preview" ? 760 : 480,
    maxWidth: "100vw",
    background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,.12)", zIndex: 201,
    display: "flex", flexDirection: "column",
    transition: "width .25s ease",
  };

  const conflicts = previewRows.filter(r => r.conflict).length;

  return (
    <>
      <div style={overlay} onClick={step === "upload" ? onClose : undefined} />
      <div style={panel}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #EEF0F3", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F1720" }}>Import Excel</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
              {MONTHS[month - 1]} {year}
              {step === "preview" && ` · ${previewRows.length} rows${conflicts > 0 ? ` · ${conflicts} conflict${conflicts !== 1 ? "s" : ""}` : ""}`}
            </div>
          </div>
          {/* Step indicator */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {(["upload","preview","done"] as Step[]).map((s, i) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: step === s ? "#0F1720" : (["upload","preview","done"].indexOf(step) > i ? "#0F7B5F" : "#EEF0F3"),
                  color: (step === s || ["upload","preview","done"].indexOf(step) > i) ? "#fff" : "#64748B",
                }}>
                  {["upload","preview","done"].indexOf(step) > i ? "✓" : i + 1}
                </div>
                {i < 2 && <div style={{ width: 16, height: 1, background: "#EEF0F3" }} />}
              </div>
            ))}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#64748B", lineHeight: 1, fontFamily: "inherit" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {/* ── Step 1: Upload ── */}
          {step === "upload" && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#64748B", display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                Store
                <div style={{ position: "relative" }}>
                  <select
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                    style={{ width: "100%", padding: "9px 30px 9px 12px", border: "1px solid #EEF0F3", borderRadius: 8, fontSize: 13, fontFamily: "inherit", appearance: "none", background: "#fff" }}
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 10, color: "#64748B" }}>▾</span>
                </div>
              </label>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={async (e) => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) void processFile(f);
                }}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? "#0F1720" : "#EEF0F3"}`,
                  borderRadius: 12, padding: "48px 24px", textAlign: "center",
                  cursor: "pointer", background: dragOver ? "#F8F9FB" : "#FAFBFC",
                  transition: "border-color .15s, background .15s",
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0F1720", marginBottom: 6 }}>
                  Drag &amp; drop your Excel file here
                </div>
                <div style={{ fontSize: 12, color: "#64748B" }}>or click to browse</div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 8 }}>Accepts .xlsx and .csv</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv,.xls"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void processFile(f); }}
              />

              {parsing && (
                <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, color: "#64748B", fontSize: 13 }}>
                  <div style={{ width: 16, height: 16, border: "2px solid #EEF0F3", borderTopColor: "#0F1720", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                  Parsing {file?.name}…
                </div>
              )}
              {parseError && (
                <div style={{ marginTop: 16, padding: "12px 14px", background: "#FFF5F5", border: "1px solid #FDECEA", borderRadius: 8, color: "#B3261E", fontSize: 13 }}>
                  {parseError}
                </div>
              )}

              <div style={{ marginTop: 20, padding: "14px 16px", background: "#F8F9FB", borderRadius: 8, fontSize: 12, color: "#64748B" }}>
                <strong style={{ color: "#0F1720" }}>Expected columns:</strong> Date, Cash Sale, Float, Expenses, Other Income, Deposit, Allied Bank CC, HBL CC, Gift Karte, Gift Vouchers, Cr Notes, Remarks
              </div>
            </div>
          )}

          {/* ── Step 2: Preview ── */}
          {step === "preview" && (
            <div>
              {conflicts > 0 && (
                <div style={{ padding: "10px 14px", background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 8, fontSize: 12, color: "#B4791F", marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
                  <span>⚠</span>
                  <span><strong>{conflicts} row{conflicts !== 1 ? "s" : ""}</strong> already exist and will be overwritten.</span>
                </div>
              )}

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #EEF0F3", background: "#F8F9FB" }}>
                      {["Date","Cash","Float","Exp","Other","Deposit","Allied CC","HBL CC","Gift Karte","Vouchers","Cr Notes","Remarks","Status"].map(h => (
                        <th key={h} style={{ padding: "7px 8px", fontWeight: 600, color: "#64748B", textAlign: h === "Date" || h === "Remarks" || h === "Status" ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #EEF0F3", background: r.conflict ? "#FFFBEB" : "#fff" }}>
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap", fontWeight: 600, color: "#0F1720" }}>{formatDateUK(r.sales_date)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.cash_sale)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.campaign_float_cash)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.expenses)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.other_income)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.deposit)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.allied_bank_cc_sale)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.hbl_cc_sale)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.gift_karte)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.gift_vouchers)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{pkr(r.credit_notes_issue)}</td>
                        <td style={{ padding: "6px 8px", color: "#64748B", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.remarks || "—"}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {r.conflict ? (
                            <span style={{ fontSize: 10, fontWeight: 600, background: "#FEF3C7", color: "#B4791F", padding: "2px 6px", borderRadius: 6, whiteSpace: "nowrap" }}>
                              Overwrite
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 600, background: "#F0FBF7", color: "#0F7B5F", padding: "2px 6px", borderRadius: 6 }}>
                              New
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {confirmError && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "#FFF5F5", border: "1px solid #FDECEA", borderRadius: 8, color: "#B3261E", fontSize: 13 }}>
                  {confirmError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Done ── */}
          {step === "done" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0F1720", marginBottom: 8 }}>Import complete</div>
              <div style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>
                {summary.inserted} row{summary.inserted !== 1 ? "s" : ""} inserted
                {summary.updated > 0 && `, ${summary.updated} updated`}
              </div>
              <button
                onClick={onClose}
                style={{ padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none", background: "#0F1720", color: "#fff", fontFamily: "inherit" }}
              >
                Close
              </button>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        {step !== "done" && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid #EEF0F3", display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {step === "upload" && (
              <button onClick={onClose} style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid #EEF0F3", background: "#fff", color: "#64748B", fontFamily: "inherit" }}>
                Cancel
              </button>
            )}
            {step === "preview" && (
              <>
                <button
                  onClick={() => { setStep("upload"); setPreviewRows([]); setBatchId(null); setFile(null); }}
                  style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid #EEF0F3", background: "#fff", color: "#64748B", fontFamily: "inherit" }}
                >
                  Back
                </button>
                <button
                  onClick={() => void confirm()}
                  disabled={confirming}
                  style={{ padding: "8px 24px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: confirming ? "default" : "pointer", border: "none", background: "#0F1720", color: "#fff", fontFamily: "inherit", opacity: confirming ? 0.6 : 1 }}
                >
                  {confirming ? "Importing…" : `Confirm Import (${previewRows.length} rows)`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
