// Tax deadline alert engine.
// Call computeAndStoreTaxAlerts(supabase, taxYear) from the nightly cron
// or after any data save on the Accounts Tax page.
// No globals, no side effects beyond DB writes.

import { sendNotificationEmail } from "./send-email";
import { createServiceClient } from "./supabase-server";

// ── Types ──────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createServiceClient>;

type ScheduleStatus = "Not Started" | "In Progress" | "External Auditors" | "Completed";

type AlertType =
  | "schedule_q1" | "schedule_q2" | "schedule_q3" | "schedule_q4" | "schedule_annual"
  | "monthly_fbr" | "monthly_pra"
  | "quarterly_income_tax";

// ── Constants (mirrors AccountsTaxDashboard) ───────────────────────

const QUARTERLY_ENTITIES = ["UT","IMP","BARANH","HD","ALMAHAR"];
const ANNUAL_ENTITIES    = ["UT","IMP","BARANH","HD","ALMAHAR","KK_JHANG","K_SALEEM","KA_SALEEM","W_SALEEM","SH_SALEEM"];
const QUARTERLY_STEP_COUNT = 5;
const ANNUAL_STEP_COUNT    = 6;

const FBR_ENTITIES = ["UT","IMP","ALMAHAR"];
const PRA_ENTITIES = ["UT","IMP","BARANH","HD","ALMAHAR"];
const INCOME_TAX_ENTITIES = ["UT","IMP","BARANH","HD","ALMAHAR"];

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

// ── Fiscal helpers ─────────────────────────────────────────────────

function fiscalYearStart(taxYear: string): number {
  return parseInt(taxYear.split("-")[0], 10);
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function deadlineDate(year: number, month: number, day: number): Date {
  // month is 1-based
  return new Date(`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T00:00:00`);
}

// ── Deadlines ─────────────────────────────────────────────────────

function scheduleDeadlines(taxYear: string): Record<string, { tier1: Date; tier2: Date; entities: string[]; stepCount: number }> {
  const s = fiscalYearStart(taxYear);
  const n = s + 1;
  return {
    schedule_q1:     { tier1: deadlineDate(s,  10, 15), tier2: deadlineDate(s,  11, 15), entities: QUARTERLY_ENTITIES, stepCount: QUARTERLY_STEP_COUNT },
    schedule_q2:     { tier1: deadlineDate(n,   1, 15), tier2: deadlineDate(n,   2, 15), entities: QUARTERLY_ENTITIES, stepCount: QUARTERLY_STEP_COUNT },
    schedule_q3:     { tier1: deadlineDate(n,   4, 15), tier2: deadlineDate(n,   5, 15), entities: QUARTERLY_ENTITIES, stepCount: QUARTERLY_STEP_COUNT },
    schedule_q4:     { tier1: deadlineDate(n,   7, 15), tier2: deadlineDate(n,   8, 15), entities: QUARTERLY_ENTITIES, stepCount: QUARTERLY_STEP_COUNT },
    schedule_annual: { tier1: deadlineDate(n,   7, 15), tier2: deadlineDate(n,   8, 15), entities: ANNUAL_ENTITIES,    stepCount: ANNUAL_STEP_COUNT    },
  };
}

// Map alert_type → section key used in tax_schedule_entries
const ALERT_TYPE_TO_SECTION: Record<string, string> = {
  schedule_q1:     "Q1",
  schedule_q2:     "Q2",
  schedule_q3:     "Q3",
  schedule_q4:     "Q4",
  schedule_annual: "Annual",
};

// Map alert_type → period_key stored in tax_deadline_alerts
const ALERT_TYPE_TO_PERIOD: Record<string, string> = {
  schedule_q1:     "Q1",
  schedule_q2:     "Q2",
  schedule_q3:     "Q3",
  schedule_q4:     "Q4",
  schedule_annual: "Annual",
};

// ── Alert message builders ─────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthName(ym: string): string {
  const m = parseInt(ym.split("-")[1], 10);
  return MONTH_NAMES[m - 1] ?? ym;
}

function scheduleMessage(alertType: string, count: number): string {
  const labels: Record<string, string> = {
    schedule_q1: "Q1 Accounts Schedule",
    schedule_q2: "Q2 Accounts Schedule",
    schedule_q3: "Q3 Accounts Schedule",
    schedule_q4: "Q4 Accounts Schedule",
    schedule_annual: "Annual Returns Schedule",
  };
  return `${count} step${count !== 1 ? "s" : ""} overdue in ${labels[alertType] ?? alertType}`;
}

// ── Main function ──────────────────────────────────────────────────

export async function computeAndStoreTaxAlerts(
  supabase: SupabaseClient,
  taxYear: string
): Promise<{ upserted: number; resolved: number; emailsSent: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Load data
  const [schedRes, filingRes] = await Promise.all([
    supabase.from("tax_schedule_entries")
      .select("section, step_index, entity_key, status")
      .eq("tax_year", taxYear),
    supabase.from("tax_return_filings")
      .select("return_type, entity_key, period_key, filed")
      .eq("tax_year", taxYear),
  ]);

  const scheduleRows = schedRes.data ?? [];
  const filingRows   = filingRes.data ?? [];

  // Index for fast lookup
  const schedMap = new Map<string, ScheduleStatus>();
  for (const r of scheduleRows) {
    schedMap.set(`${r.section}:${r.step_index}:${r.entity_key}`, r.status as ScheduleStatus);
  }

  const filedSet = new Set<string>();
  for (const r of filingRows) {
    if (r.filed) filedSet.add(`${r.return_type}:${r.entity_key}:${r.period_key}`);
  }

  let upserted = 0;
  let resolved = 0;
  let emailsSent = 0;

  // ── 1. Schedule alerts ──────────────────────────────────────────

  const schedDls = scheduleDeadlines(taxYear);

  for (const [alertType, dl] of Object.entries(schedDls)) {
    const section = ALERT_TYPE_TO_SECTION[alertType];
    const periodKey = ALERT_TYPE_TO_PERIOD[alertType];

    // Count incomplete cells
    let incompleteCount = 0;
    for (const ek of dl.entities) {
      for (let i = 1; i <= dl.stepCount; i++) {
        const status = schedMap.get(`${section}:${i}:${ek}`) ?? "Not Started";
        if (status !== "Completed") incompleteCount++;
      }
    }

    if (incompleteCount === 0) {
      // Resolve any existing alerts for this section
      const result = await supabase.from("tax_deadline_alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("tax_year", taxYear)
        .eq("alert_type", alertType)
        .eq("resolved", false)
        .select("id");
      resolved += result?.data?.length ?? 0;
      continue;
    }

    const message = scheduleMessage(alertType, incompleteCount);

    for (const tier of [1, 2] as const) {
      const deadline = tier === 1 ? dl.tier1 : dl.tier2;
      if (today < deadline) continue;

      const result = await upsertAlert(supabase, {
        taxYear, alertType, periodKey,
        tier, overdueCount: incompleteCount, message,
      });
      if (result.inserted) {
        upserted++;
        if (tier === 1) {
          const sent = await notifyShakeel(supabase, message);
          if (sent) emailsSent++;
        }
      } else if (result.updated) {
        upserted++;
      }
    }
  }

  // ── 2. Monthly return alerts ────────────────────────────────────

  const s = fiscalYearStart(taxYear);
  const n = s + 1;
  const allMonths = [
    `${s}-07`,`${s}-08`,`${s}-09`,
    `${s}-10`,`${s}-11`,`${s}-12`,
    `${n}-01`,`${n}-02`,`${n}-03`,
    `${n}-04`,`${n}-05`,`${n}-06`,
  ];

  const monthlyTypes: { alertType: AlertType; returnType: string; entities: string[]; label: string }[] = [
    { alertType: "monthly_fbr", returnType: "FBR_SALES_TAX", entities: FBR_ENTITIES, label: "FBR Sales Tax" },
    { alertType: "monthly_pra", returnType: "PRA_TAX",       entities: PRA_ENTITIES, label: "PRA Tax"       },
  ];

  for (const mt of monthlyTypes) {
    for (const period of allMonths) {
      const [yr, mo] = period.split("-").map(Number);
      const tier1 = deadlineDate(yr, mo, 15);
      const tier2Next = addMonths(tier1, 1);
      const tier2 = deadlineDate(tier2Next.getFullYear(), tier2Next.getMonth() + 1, 15);

      if (today < tier1) continue;

      const notFiledCount = mt.entities.filter((ek) => !filedSet.has(`${mt.returnType}:${ek}:${period}`)).length;

      if (notFiledCount === 0) {
        const result = await supabase.from("tax_deadline_alerts")
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq("tax_year", taxYear)
          .eq("alert_type", mt.alertType)
          .eq("period_key", period)
          .eq("resolved", false)
          .select("id");
        resolved += result?.data?.length ?? 0;
        continue;
      }

      const message = `${notFiledCount} compan${notFiledCount !== 1 ? "ies" : "y"} overdue on ${monthName(period)} ${mt.label} return`;

      for (const tier of [1, 2] as const) {
        const deadline = tier === 1 ? tier1 : tier2;
        if (today < deadline) continue;

        const result = await upsertAlert(supabase, {
          taxYear, alertType: mt.alertType, periodKey: period,
          tier, overdueCount: notFiledCount, message,
        });
        if (result.inserted) {
          upserted++;
          if (tier === 1) {
            const sent = await notifyShakeel(supabase, message);
            if (sent) emailsSent++;
          }
        } else if (result.updated) {
          upserted++;
        }
      }
    }
  }

  // ── 3. Quarterly income tax alerts ─────────────────────────────

  const quarterDeadlines: { periodKey: string; tier1: Date; tier2: Date }[] = [
    { periodKey: "Q1", tier1: deadlineDate(s,  10, 15), tier2: deadlineDate(s,  11, 15) },
    { periodKey: "Q2", tier1: deadlineDate(n,   1, 15), tier2: deadlineDate(n,   2, 15) },
    { periodKey: "Q3", tier1: deadlineDate(n,   4, 15), tier2: deadlineDate(n,   5, 15) },
    { periodKey: "Q4", tier1: deadlineDate(n,   7, 15), tier2: deadlineDate(n,   8, 15) },
  ];

  for (const qd of quarterDeadlines) {
    if (today < qd.tier1) continue;

    const notFiledCount = INCOME_TAX_ENTITIES.filter(
      (ek) => !filedSet.has(`INCOME_TAX:${ek}:${qd.periodKey}`)
    ).length;

    if (notFiledCount === 0) {
      const result = await supabase.from("tax_deadline_alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("tax_year", taxYear)
        .eq("alert_type", "quarterly_income_tax")
        .eq("period_key", qd.periodKey)
        .eq("resolved", false)
        .select("id");
      resolved += result?.data?.length ?? 0;
      continue;
    }

    const message = `${notFiledCount} compan${notFiledCount !== 1 ? "ies" : "y"} overdue on ${qd.periodKey} Income Tax return`;

    for (const tier of [1, 2] as const) {
      const deadline = tier === 1 ? qd.tier1 : qd.tier2;
      if (today < deadline) continue;

      const result = await upsertAlert(supabase, {
        taxYear, alertType: "quarterly_income_tax", periodKey: qd.periodKey,
        tier, overdueCount: notFiledCount, message,
      });
      if (result.inserted) {
        upserted++;
        if (tier === 1) {
          const sent = await notifyShakeel(supabase, message);
          if (sent) emailsSent++;
        }
      } else if (result.updated) {
        upserted++;
      }
    }
  }

  return { upserted, resolved, emailsSent };
}

// ── Helpers ────────────────────────────────────────────────────────

async function upsertAlert(
  supabase: SupabaseClient,
  opts: {
    taxYear: string;
    alertType: string;
    periodKey: string;
    tier: 1 | 2;
    overdueCount: number;
    message: string;
  }
): Promise<{ inserted: boolean; updated: boolean }> {
  const now = new Date().toISOString();

  // Try insert first — if it already exists, update the count and last_checked_at
  const { data: existing } = await supabase
    .from("tax_deadline_alerts")
    .select("id, first_triggered_at")
    .eq("tax_year", opts.taxYear)
    .eq("alert_type", opts.alertType)
    .eq("period_key", opts.periodKey)
    .eq("tier", opts.tier)
    .maybeSingle();

  if (!existing) {
    // New alert — insert
    await supabase.from("tax_deadline_alerts").insert({
      tax_year:           opts.taxYear,
      alert_type:         opts.alertType,
      period_key:         opts.periodKey,
      tier:               opts.tier,
      overdue_count:      opts.overdueCount,
      alert_message:      opts.message,
      resolved:           false,
      first_triggered_at: now,
      last_checked_at:    now,
    });
    return { inserted: true, updated: false };
  }

  // Existing — update count and mark unresolved if it was resolved
  await supabase.from("tax_deadline_alerts")
    .update({
      overdue_count:   opts.overdueCount,
      alert_message:   opts.message,
      resolved:        false,
      resolved_at:     null,
      last_checked_at: now,
    })
    .eq("id", existing.id);

  return { inserted: false, updated: true };
}

async function notifyShakeel(
  supabase: SupabaseClient,
  alertMessage: string
): Promise<boolean> {
  try {
    // Resolve Shakeel's email dynamically — don't hardcode
    const { data: shakeelMember } = await supabase
      .from("members")
      .select("email, first_name, name, notify_email")
      .ilike("name", "%shakeel%")
      .maybeSingle();

    if (!shakeelMember?.email) return false;

    await sendNotificationEmail({
      to:      shakeelMember.email,
      subject: "Tax deadline overdue — action required",
      heading: "Tax Deadline Overdue",
      body: `
        <p><strong>${shakeelMember.first_name || shakeelMember.name || "Shakeel"}</strong>, a tax deadline has been missed and requires your attention:</p>
        <p style="background:#fef2f2;padding:12px;border-radius:6px;border-left:3px solid #dc2626">
          ${alertMessage}
        </p>
        <p>Please review the Accounts (Tax) page and take action before this is escalated to the CEO.</p>
      `,
      linkUrl:   `${APP_URL}/accounts-tax`,
      linkLabel: "Open Accounts (Tax)",
      triggerType: "tax_deadline_alert",
      recipientName: shakeelMember.first_name || shakeelMember.name || "Shakeel",
    });

    return true;
  } catch {
    return false;
  }
}
