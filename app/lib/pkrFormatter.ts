/**
 * Shared PKR currency formatters.
 *
 * Two variants:
 *   formatPKR(n)      — "PKR 1,234,567.50"  2 d.p.  for Retail Sales / Daily Sales
 *                        (store figures may have paise)
 *   formatPKRWhole(n) — "PKR 1,234,567"      0 d.p.  for Banking / Finance / Cash sheets
 *                        (all cash-flow figures are whole rupees — no .00 clutter)
 *
 * Both use Intl.NumberFormat('en-PK') for locale-correct comma grouping.
 * Both return "—" for null/undefined.
 *
 * Import the right one instead of writing a local pkr() function.
 */

const _pkrFmt = new Intl.NumberFormat("en-PK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const _pkrWholeFmt = new Intl.NumberFormat("en-PK", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format a number as PKR currency with paise: "PKR 1,234,567.50"
 * Use for Retail Sales and Daily Sales where amounts may have decimal places.
 * Returns "—" for null or undefined.
 */
export function formatPKR(n: number | null | undefined): string {
  if (n == null) return "—";
  return "PKR " + _pkrFmt.format(n);
}

/**
 * Format a number as PKR currency, whole rupees only: "PKR 1,234,567"
 * Use for Banking, Finance, Cash Sheets and any page where figures are always
 * whole rupees (no paise). Avoids the unnecessary ".00" suffix.
 * Returns "—" for null or undefined.
 */
export function formatPKRWhole(n: number | null | undefined): string {
  if (n == null) return "—";
  return "PKR " + _pkrWholeFmt.format(n);
}
