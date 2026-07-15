// Shared achievement/breakage status rules.
//
// Before 15 Jul 2026, the CEO Home page (app/home/page.tsx — quarterly
// escalation detection) and the Ops DashboardView (app/dashboard/DashboardView.tsx
// — per-plant status badges) each hardcoded their own copy of these numbers.
// They happened to agree (85% amber cutoff, 1.5% breakage red cutoff), but
// nothing enforced that — a future edit to one file could silently diverge
// from the other, showing a plant as green on one screen and amber/red on
// the other for the same underlying numbers. Flagged in the full app audit
// (Full-App-Audit-2026-07-15.md). Both files now import from here instead
// of keeping their own copies.

export type KpiStatus = "green" | "amber" | "red" | "none";

/** >= this % of target -> green */
export const ACHIEVEMENT_GREEN_MIN = 95;
/** >= this % of target -> amber, below this -> red */
export const ACHIEVEMENT_AMBER_MIN = 85;
/** > this % breakage rate -> amber */
export const BREAKAGE_AMBER_OVER = 1.0;
/** > this % breakage rate -> red */
export const BREAKAGE_RED_OVER = 1.5;

export function achievementStatus(achievementPct: number, hasTarget: boolean): KpiStatus {
  if (!hasTarget) return "none";
  if (achievementPct >= ACHIEVEMENT_GREEN_MIN) return "green";
  if (achievementPct >= ACHIEVEMENT_AMBER_MIN) return "amber";
  return "red";
}

export function breakageStatus(breakageRatePct: number, hasProduction: boolean): KpiStatus {
  if (!hasProduction) return "none";
  if (breakageRatePct > BREAKAGE_RED_OVER) return "red";
  if (breakageRatePct > BREAKAGE_AMBER_OVER) return "amber";
  return "green";
}
