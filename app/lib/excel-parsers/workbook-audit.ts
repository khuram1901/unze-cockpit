import * as XLSX from "xlsx";

// Shared Excel integrity audit (28/07/2026) — runs inside all three P&L
// parsers (Unze Trading, Imperial, Restaurants) so every upload checks the
// workbook itself, not just the extracted numbers. Khuram's requirement:
// "when the dashboard is presented I'm confident it's exactly what I'm
// seeing."
//
// What it CAN catch (and does):
//   1. Broken formula cells — #REF!, #DIV/0!, #VALUE!, #NAME?, #N/A left
//      behind by deleted rows/columns. These read as garbage or zero and
//      silently corrupt totals.
//   2. Month gaps — a missing calendar month inside a continuous series
//      (someone deleted or forgot a column).
//   3. Frozen series — the same non-zero sales figure repeated 3+ months in
//      a row, the classic sign of a copy-paste that was never updated
//      (exactly what's wrong with the Baranh file's Consolidated sheet).
//
// What it CANNOT do: re-run Excel's calculation engine. If a formula's
// cached value is stale, the arithmetic identity checks in each parser are
// the net that catches it (totals stop reconciling with their parts).
//
// Issues come back as warning-tier check objects (blocking=false) so they
// surface in upload results and the clickable data-quality panels without
// ever rejecting a month.

export type AuditIssue = { name: string };

const MAX_ISSUES_PER_KIND = 10;

// 1. Scan the given sheets for cells whose type is error ('e') or whose
// text is an Excel error literal saved as a string. Consecutive error cells
// in the same column collapse into one range ("DS4:DS13") so a single
// broken column reads as one finding, not ten.
function errorCause(err: string): string {
  if (err.startsWith("#REF")) return "a deleted row/column has broken this formula's reference";
  if (err.startsWith("#DIV")) return "the formula divides by an empty or zero cell";
  if (err.startsWith("#VALUE")) return "the formula points at text where it expects a number";
  if (err.startsWith("#NAME")) return "the formula uses a name Excel doesn't recognise";
  return "the formula result is an error";
}
export function findErrorCells(wb: XLSX.WorkBook, sheetNames: string[]): AuditIssue[] {
  type Hit = { row: number; err: string };
  const issues: AuditIssue[] = [];
  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    // Collect hits per column, then merge consecutive rows into ranges.
    const byCol = new Map<string, Hit[]>();
    for (const addr of Object.keys(ws)) {
      if (addr[0] === "!") continue;
      const cell = ws[addr] as XLSX.CellObject;
      const isErrorType = cell && cell.t === "e";
      const isErrorText = cell && cell.t === "s" && typeof cell.v === "string" && /^#(REF|DIV\/0|VALUE|NAME\?|NULL|N\/A|NUM)/.test(cell.v.trim());
      if (!isErrorType && !isErrorText) continue;
      const m = addr.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      // For true error cells (t === "e") cell.v is the NUMERIC error code —
      // map it to the Excel literal so warnings never show a bare number.
      const ERR_CODES: Record<number, string> = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A" };
      const err = (cell.t === "e" && typeof cell.v === "number" && ERR_CODES[cell.v])
        ? ERR_CODES[cell.v]
        : String(cell.w || cell.v || "#ERROR").trim();
      if (!byCol.has(m[1])) byCol.set(m[1], []);
      byCol.get(m[1])!.push({ row: parseInt(m[2], 10), err });
    }
    for (const [col, hits] of byCol) {
      hits.sort((a, b) => a.row - b.row);
      let start = 0;
      for (let i = 1; i <= hits.length; i++) {
        if (i === hits.length || hits[i].row !== hits[i - 1].row + 1 || hits[i].err !== hits[start].err) {
          const first = hits[start];
          const last = hits[i - 1];
          const where = first.row === last.row ? `${col}${first.row}` : `${col}${first.row}:${col}${last.row} (${i - start} cells)`;
          issues.push({ name: `Excel audit — ${first.err} at '${name}'!${where} — ${errorCause(first.err)}` });
          start = i;
          if (issues.length >= MAX_ISSUES_PER_KIND) return issues;
        }
      }
    }
  }
  return issues;
}

// 2. Missing calendar months inside the series (months as YYYY-MM-01).
export function findMonthGaps(months: string[]): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const sorted = [...new Set(months)].sort();
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00Z");
    const cur = new Date(sorted[i] + "T00:00:00Z");
    const diff = (cur.getUTCFullYear() - prev.getUTCFullYear()) * 12 + (cur.getUTCMonth() - prev.getUTCMonth());
    if (diff > 1) {
      const missing = diff - 1;
      const label = prev.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) + " and " + cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
      issues.push({ name: `Excel audit — ${missing} month${missing > 1 ? "s" : ""} missing between ${label} — was a column deleted or skipped?` });
      if (issues.length >= MAX_ISSUES_PER_KIND) break;
    }
  }
  return issues;
}

// 3. The same non-zero value repeated monthsInARow+ consecutive months for
// a line that should vary (sales). seriesLabel example: "Gulberg Gross Sales".
export function findFrozenSeries(seriesLabel: string, values: number[], monthsInARow = 3): AuditIssue[] {
  let run = 1;
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== 0 && values[i] === values[i - 1]) {
      run++;
      if (run >= monthsInARow) {
        return [{ name: `Excel audit — ${seriesLabel} shows the identical figure (${(values[i] / 1e6).toFixed(2)}m) for ${run}+ consecutive months — looks like a copy-paste that was never updated` }];
      }
    } else {
      run = 1;
    }
  }
  return [];
}
