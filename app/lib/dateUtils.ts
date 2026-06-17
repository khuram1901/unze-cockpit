// Shared date utilities for the entire app.
// All displayed dates MUST use DD/MM/YYYY (UK format) per PRD.
// All files should import from here — no more local copies of these functions.

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

// ISO date for inputs and database (YYYY-MM-DD)
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthISO(): string {
  return new Date().toISOString().slice(0, 7);
}
