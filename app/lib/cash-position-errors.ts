// Errors raised by the daily_cash_position_guard() trigger (migration 273).
// The trigger rejects a cash sheet whose figures don't add up or whose opening
// doesn't match the previous day's closing. Those are user-correctable input
// problems, so the API returns 422 with the trigger's own message instead of
// a generic 500.
const REJECTION_PREFIX = "Cash sheet rejected";

export function isCashSheetRejection(message: string | null | undefined): boolean {
  return !!message && message.startsWith(REJECTION_PREFIX);
}

export function cashSheetErrorStatus(message: string | null | undefined): 422 | 500 {
  return isCashSheetRejection(message) ? 422 : 500;
}
