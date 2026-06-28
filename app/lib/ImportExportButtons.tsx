"use client";

import { useRef, useState } from "react";
import { COLOURS } from "./SharedUI";

type Props = {
  onExport: () => void;
  onImport: (rows: Record<string, string>[]) => void;
  templateHeaders: string[];
  templateFilename: string;
  templateRows?: string[][];
  importLabel?: string;
  exportLabel?: string;
};

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += char;
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ""; });
    rows.push(row);
  }
  return rows;
}

function generateTemplate(headers: string[], filename: string, rows?: string[][]) {
  let csv = headers.join(",") + "\n";
  if (rows) {
    for (const row of rows) csv += row.map((c) => c.includes(",") ? `"${c}"` : c).join(",") + "\n";
  }
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ImportExportButtons({ onExport, onImport, templateHeaders, templateFilename, templateRows, importLabel, exportLabel }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      let rows: Record<string, string>[] = [];
      if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
        rows = data.map((r) => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(r)) out[k] = String(v);
          return out;
        });
      } else {
        const text = await file.text();
        rows = parseCSV(text);
      }
      if (rows.length === 0) {
        alert("No data rows found. Make sure the first row is headers.");
      } else {
        onImport(rows);
      }
    } catch {
      alert("Failed to read the file.");
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
      {/* Export button */}
      <div style={{ position: "relative" }} className="tooltip-wrap">
        <button
          onClick={onExport}
          style={iconBtn}
          title={exportLabel || "Export as CSV"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v8M5 7l3 3 3-3M3 12h10" />
          </svg>
        </button>
      </div>

      {/* Import button */}
      <div style={{ position: "relative" }} className="tooltip-wrap">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          style={{ ...iconBtn, opacity: importing ? 0.5 : 1 }}
          title={importLabel || "Import from CSV"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 10V2M5 5l3-3 3 3M3 12h10" />
          </svg>
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
      </div>

      {/* Download template */}
      <div style={{ position: "relative" }} className="tooltip-wrap">
        <button
          onClick={() => generateTemplate(templateHeaders, templateFilename, templateRows)}
          style={iconBtn}
          title="Download CSV template"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <path d="M5 6h6M5 8.5h4M5 11h2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  backgroundColor: "var(--bg-card, #ffffff)",
  color: "var(--text-primary, #1e293b)",
  border: `1px solid ${COLOURS.BORDER}`,
  borderRadius: "6px",
  padding: "6px 8px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background-color 0.15s",
};
