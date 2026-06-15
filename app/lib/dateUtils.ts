export function formatDateUK(dateString: string | null) {
  if (!dateString) return "—";

  const d = new Date(dateString);

  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}