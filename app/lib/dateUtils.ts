// Shared date utilities for the entire app.
// RULE: Every date displayed to the user MUST go through formatDateUK (DD/MM/YYYY).
// NEVER render a raw YYYY-MM-DD database string directly in JSX or email HTML.
// NEVER use new Date().toLocaleDateString() without "en-GB" locale.
// For API routes / email HTML where import isn't available, use: d.split("-").reverse().join("/")
// All files should import from here — no local copies of these functions.

export function formatDateUK(dateString: string | null): string {
  if (!dateString) return "—";
  const [year, month, day] = dateString.slice(0, 10).split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year}`;
}

export function formatDateTimeUK(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMonthUK(monthString: string | null): string {
  if (!monthString) return "—";
  const [year, month] = monthString.split("-");
  if (!year || !month) return "—";
  return `${month}/${year}`;
}

export function workingDaysFromNow(n: number): string {
  const d = new Date();
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

// ISO date for inputs and database (YYYY-MM-DD)
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthISO(): string {
  return new Date().toISOString().slice(0, 7);
}
