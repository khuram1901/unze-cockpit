/**
 * Shared PKR currency formatter for Retail Sales.
 *
 * Format: "PKR 1,234,567.50"
 *   - Uses Intl.NumberFormat('en-PK') for locale-correct comma grouping
 *   - Always 2 decimal places
 *   - "—" for null/undefined
 *
 * Import this instead of writing a local pkr() function.
 * Used in: RetailSalesTab.tsx, daily-sales/page.tsx, any future retail pages.
 */

const _pkrFmt = new Intl.NumberFormat("en-PK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a number as PKR currency: "PKR 1,234,567.50"
 * Returns "—" for null or undefined.
 */
export function formatPKR(n: number | null | undefined): string {
  if (n == null) return "—";
  return "PKR " + _pkrFmt.format(n);
}
