"use client";

import { useState, useRef, useCallback } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { authFetch } from "../../lib/supabase";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { COLOURS, SHADOWS, PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";

type FileResult = {
  filename: string;
  status: "pending" | "uploading" | "saved" | "skipped" | "error";
  date?: string;
  company?: string;
  message?: string;
};

const STATUS_COLOUR: Record<string, string> = {
  pending: COLOURS.SLATE,
  uploading: "#2563eb",
  saved: COLOURS.GREEN,
  skipped: "#d97706",
  error: COLOURS.RED,
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting…",
  uploading: "Processing…",
  saved: "Saved",
  skipped: "Skipped",
  error: "Error",
};

const COMPANY_LABEL: Record<string, string> = {
  unze: "Unze Trading",
  imperial: "Imperial Footwear",
  unknown: "Unknown company",
};

export default function UploadPage() {
  const { checking } = useRequireCapability("finance");
  const isMobile = useMobile();
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<FileResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | File[]) {
    const pdfs = Array.from(incoming).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...pdfs.filter((f) => !existing.has(f.name))];
    });
    setResults([]);
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((f) => f.name !== name));
    setResults([]);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, []);

  async function upload() {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setResults(files.map((f) => ({ filename: f.name, status: "pending" })));

    // Upload all at once — the API returns per-file results
    setResults((prev) => prev.map((r) => ({ ...r, status: "uploading" })));

    const formData = new FormData();
    for (const f of files) formData.append("files", f);

    try {
      const res = await authFetch("/api/finance/upload-pdfs", { method: "POST", body: formData });
      const json = await res.json();

      if (json.error) {
        setResults((prev) => prev.map((r) => ({ ...r, status: "error", message: json.error })));
      } else {
        const resultMap = new Map(
          (json.results as { filename: string; status: string; date?: string; company?: string; message?: string }[])
            .map((r) => [r.filename, r])
        );
        setResults((prev) =>
          prev.map((r) => {
            const match = resultMap.get(r.filename);
            if (!match) return r;
            const status: FileResult["status"] =
              match.status === "saved" ? "saved"
              : match.status.startsWith("skipped") ? "skipped"
              : match.status.startsWith("error") ? "error"
              : "error";
            return { ...r, status, date: match.date, company: match.company, message: match.status };
          })
        );
      }
    } catch (e) {
      setResults((prev) => prev.map((r) => ({ ...r, status: "error", message: e instanceof Error ? e.message : "Upload failed" })));
    }

    setUploading(false);
  }

  function reset() {
    setFiles([]);
    setResults([]);
  }

  const savedCount = results.filter((r) => r.status === "saved").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const done = results.length > 0 && results.every((r) => r.status !== "pending" && r.status !== "uploading");

  if (checking) return null;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "14px 18px", maxWidth: "680px" }}>
        <PageHeader />
        <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "20px" }}>
          Upload Unze Trading or Imperial Footwear cash flow and bank position PDFs. The app detects
          the company automatically from the document — no need to rename files.
        </div>

        {/* Drop zone */}
        {!done && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? COLOURS.NAVY : COLOURS.BORDER}`,
              borderRadius: "10px",
              padding: "36px 20px",
              textAlign: "center",
              backgroundColor: dragOver ? "#f0f4ff" : "var(--bg-card,#fff)",
              cursor: "pointer",
              transition: "all 0.15s",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>📄</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>
              Drop PDFs here or click to browse
            </div>
            <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
              Accepts cash flow and bank position PDFs for both companies
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", overflow: "hidden", marginBottom: "16px" }}>
            {files.map((f, i) => {
              const result = results.find((r) => r.filename === f.name);
              const status = result?.status || "pending";
              return (
                <div key={f.name} style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 14px",
                  borderBottom: i < files.length - 1 ? `1px solid ${COLOURS.BORDER}` : "none",
                  backgroundColor: "var(--bg-card,#fff)",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    {result?.company && (
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "1px" }}>
                        {COMPANY_LABEL[result.company] || result.company}
                        {result.date && ` · ${result.date}`}
                      </div>
                    )}
                    {result?.message && status !== "saved" && (
                      <div style={{ fontSize: "12px", color: STATUS_COLOUR[status], marginTop: "2px" }}>{result.message}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: STATUS_COLOUR[status] }}>
                      {STATUS_LABEL[status]}
                    </span>
                    {!uploading && status === "pending" && (
                      <button onClick={() => removeFile(f.name)} style={{ background: "none", border: "none", cursor: "pointer", color: COLOURS.SLATE, fontSize: "16px", lineHeight: 1 }}>×</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary after done */}
        {done && (
          <div style={{
            border: `1px solid ${errorCount > 0 ? COLOURS.RED : COLOURS.GREEN}`,
            borderLeft: `4px solid ${errorCount > 0 ? COLOURS.RED : COLOURS.GREEN}`,
            borderRadius: "6px", padding: "12px 16px",
            backgroundColor: "var(--bg-card,#fff)", marginBottom: "16px",
          }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: errorCount > 0 ? COLOURS.RED : COLOURS.GREEN }}>
              {savedCount} saved{errorCount > 0 ? `, ${errorCount} failed` : " — all good"}
            </div>
            {errorCount > 0 && (
              <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "4px" }}>
                Check the errors above. Common causes: unrecognised PDF format, or a date that already exists in the database (it will be overwritten — that is fine).
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: "10px" }}>
          {!done && files.length > 0 && (
            <button
              onClick={upload}
              disabled={uploading}
              style={{
                backgroundColor: COLOURS.NAVY, color: "white", border: "none",
                borderRadius: "8px", padding: "10px 24px", fontSize: "15px",
                fontWeight: 700, cursor: uploading ? "not-allowed" : "pointer",
                opacity: uploading ? 0.7 : 1, boxShadow: SHADOWS.CARD,
              }}
            >
              {uploading ? "Processing…" : `Upload ${files.length} file${files.length !== 1 ? "s" : ""}`}
            </button>
          )}
          {(done || files.length > 0) && !uploading && (
            <button
              onClick={reset}
              style={{
                backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE,
                border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px",
                padding: "10px 20px", fontSize: "15px", fontWeight: 600, cursor: "pointer",
              }}
            >
              {done ? "Upload more" : "Clear"}
            </button>
          )}
        </div>

        {/* Help */}
        <div style={{ marginTop: "28px", borderTop: `1px solid ${COLOURS.BORDER}`, paddingTop: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>Naming guide</div>
          <div style={{ fontSize: "13px", color: COLOURS.SLATE, lineHeight: 1.7 }}>
            The app detects the company from the PDF contents — naming doesn't matter. However, for
            the Google Drive folder pickup, include the date in the filename so files group correctly:<br />
            <code style={{ backgroundColor: "#f1f5f9", padding: "1px 5px", borderRadius: "3px" }}>Unze Cash Flow 30-06-2026.pdf</code><br />
            <code style={{ backgroundColor: "#f1f5f9", padding: "1px 5px", borderRadius: "3px" }}>Unze Bank Position 30-06-2026.pdf</code><br />
            <code style={{ backgroundColor: "#f1f5f9", padding: "1px 5px", borderRadius: "3px" }}>Cash Flow 30-06-2026.pdf</code> (Imperial)<br />
            <code style={{ backgroundColor: "#f1f5f9", padding: "1px 5px", borderRadius: "3px" }}>Bank Position 30-06-2026.pdf</code> (Imperial)
          </div>
        </div>
      </main>
    </AuthWrapper>
  );
}
