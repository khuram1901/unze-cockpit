import * as XLSX from "xlsx";

export type ForecastRow = {
  category: string;
  flowType: "inflow" | "outflow";
  months: { month: string; amount: number }[];
};

export type ParsedForecast = {
  rows: ForecastRow[];
  months: string[];
  sheetName: string;
};

function excelDateToMonth(serial: number): string {
  const date = new Date((serial - 25569) * 86400000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const SKIP_LABELS = new Set([
  "PROJECTED CASH FLOW:",
  "CASH INFLOW",
  "CASH OUTFLOW",
  "OPENING BALANCE",
  "",
]);

export function parseCashFlowForecast(buffer: Buffer): ParsedForecast {
  const wb = XLSX.read(buffer, { type: "buffer" });

  // Prefer "Monthly-CF" sheet, fall back to first sheet
  const sheetName = wb.SheetNames.includes("Monthly-CF")
    ? "Monthly-CF"
    : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Find the header row with month serial numbers
  let monthColumns: { colIdx: number; month: string }[] = [];
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i];
    const serials = row
      .map((cell, idx) => ({ cell, idx }))
      .filter(({ cell }) => typeof cell === "number" && cell > 40000 && cell < 60000);

    if (serials.length >= 2) {
      headerRowIdx = i;
      monthColumns = serials.map(({ cell, idx }) => ({
        colIdx: idx,
        month: excelDateToMonth(cell as number),
      }));
      break;
    }
  }

  if (monthColumns.length === 0) {
    throw new Error("Could not find month headers in the Excel. Expected Excel serial date numbers in the header row.");
  }

  const months = monthColumns.map((m) => m.month);
  const rows: ForecastRow[] = [];
  let currentFlowType: "inflow" | "outflow" = "inflow";

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    const label = String(row[0] || "").trim();

    if (!label || SKIP_LABELS.has(label)) continue;

    if (label.toUpperCase().includes("CASH OUTFLOW")) {
      currentFlowType = "outflow";
      continue;
    }
    if (label.toUpperCase().includes("CASH INFLOW")) {
      currentFlowType = "inflow";
      continue;
    }

    // Skip total and closing rows
    if (label.toUpperCase().startsWith("TOTAL") || label.toUpperCase().startsWith("CLOSING")) continue;

    const monthAmounts = monthColumns.map(({ colIdx, month }) => ({
      month,
      amount: typeof row[colIdx] === "number" ? row[colIdx] as number : 0,
    }));

    // Only include if at least one month has a non-zero amount
    if (monthAmounts.some((m) => m.amount !== 0)) {
      rows.push({
        category: label,
        flowType: currentFlowType,
        months: monthAmounts,
      });
    }
  }

  return { rows, months, sheetName };
}
