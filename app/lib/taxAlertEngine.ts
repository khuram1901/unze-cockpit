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
  | "quarterly_income_tax"
  | "annual_personal" | "annual_company";

// ── Constants (mirrors AccountsTaxDashboard) ───────────────────────

const QUARTERLY_ENTITIES = ["UT","IMP","BARANH","HD","ALMAHAR"];
const ANNUAL_ENTITIES    = ["UT","IMP","BARANH","HD","ALMAHAR","KK_JHANG","K_SALEEM","KA_SALEEM","W_SALEEM","SH_SALEEM"];
const QUARTERLY_STEP_COUNT = 5;
const ANNUAL_STEP_COUNT    = 6;

const FBR_ENTITIES = ["UT","IMP","ALMAHAR"];
const PRA_ENTITIES = ["UT","IMP","BARANH","HD","ALMAHAR"];
const INCOME_TAX_ENTITIES = ["UT","IMP","BARANH","HD","ALMAHAR"];

// Annual Returns — split by group
const PERSONAL_ENTITIES       = ["K_SALEEM","KA_SALEEM","W_SALEEM","SH_SALEEM","KK_JHANG"];
const ANNUAL_COMPANY_ENTITIES = ["UT","IMP","BARANH","HD","ALMAHAR"];

const CEO_EMAIL = "k.saleem@unzegroup.com";

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

function fiscalYearEndYear(taxYear: string): number {
  // "2025-26" → 2026, "2026-27" → 2027
  const parts = taxYear.split("-");
  const startYear = parseInt(parts[0], 10);
  const suffix = parts[1];
  // suffix may be 2-digit ("26") or 4-digit ("2026")
  if (suffix.length === 4) return parseInt(suffix, 10);
  return startYear + 1;
}

function daysSince(isoTimestamp: string): number {
  const then = new Date(isoTimestamp);
  then.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - then.getTime()) / 86400000);
}

function datesEqual(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
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

function annualPersonalDeadlines(taxYear: string): { internal: Date; legal: Date } {
  const endYear = fiscalYearEndYear(taxYear);
  return {
    internal: deadlineDate(endYear, 8, 31),   // 31 Aug
    legal:    deadlineDate(endYear, 9, 30),   // 30 Sep
  };
}

function annualCompanyDeadlines(taxYear: string): { internal: Date; legal: Date } {
  const endYear = fiscalYearEndYear(taxYear);
  return {
    internal: deadlineDate(endYear, 10, 31),  // 31 Oct
    legal:    deadlineDate(endYear, 12, 21),  // 21 Dec
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

  // ── 4. Annual Returns deadline alerts ──────────────────────────

  const annualGroups: {
    alertType: AlertType;
    entities: string[];
    deadlines: { internal: Date; legal: Date };
    label: string;
    legalDateLabel: string;
    internalDateLabel: string;
  }[] = [
    {
      alertType:        "annual_personal",
      entities:         PERSONAL_ENTITIES,
      deadlines:        annualPersonalDeadlines(taxYear),
      label:            "Personal",
      legalDateLabel:   "30 Sep",
      internalDateLabel:"31 Aug",
    },
    {
      alertType:        "annual_company",
      entities:         ANNUAL_COMPANY_ENTITIES,
      deadlines:        annualCompanyDeadlines(taxYear),
      label:            "Company",
      legalDateLabel:   "21 Dec",
      internalDateLabel:"31 Oct",
    },
  ];

  for (const group of annualGroups) {
    const { alertType, entities, deadlines, label, legalDateLabel, internalDateLabel } = group;

    // Count incomplete steps across all entities in this group
    let incompleteCount = 0;
    for (const ek of entities) {
      for (let i = 1; i <= ANNUAL_STEP_COUNT; i++) {
        const status = schedMap.get(`Annual:${i}:${ek}`) ?? "Not Started";
        if (status !== "Completed") incompleteCount++;
      }
    }

    if (incompleteCount === 0) {
      // All done — resolve any open alerts for this group
      const result = await supabase.from("tax_deadline_alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("tax_year", taxYear)
        .eq("alert_type", alertType)
        .eq("resolved", false)
        .select("id");
      resolved += result?.data?.length ?? 0;
      continue;
    }

    const entityList = entities.join(", ");

    // ── Tier 1: internal target passed ──────────────────────────
    if (today >= deadlines.internal) {
      const tier1Message = `${incompleteCount} ${label.toLowerCase()} return steps overdue — internal target ${internalDateLabel} was missed`;

      const tier1Result = await upsertAlert(supabase, {
        taxYear, alertType, periodKey: "Annual",
        tier: 1, overdueCount: incompleteCount, message: tier1Message,
      });

      if (tier1Result.inserted) {
        upserted++;
        // Shakeel email fires ONCE — only on first insert
        const sent = await notifyShakeel(supabase, tier1Message, {
          subject: `Annual returns internal target missed — action required`,
          body: `
            <p>The internal completion target for <strong>${label} Annual Returns</strong> has been missed.</p>
            <p style="background:#fef2f2;padding:12px;border-radius:6px;border-left:3px solid #dc2626">
              <strong>${incompleteCount} step${incompleteCount !== 1 ? "s" : ""} still incomplete</strong> across: ${entityList}.<br/>
              Internal completion target was <strong>${internalDateLabel}</strong>.<br/>
              Legal deadline: <strong>${legalDateLabel}</strong>.
            </p>
            <p>Please update the Accounts (Tax) schedule before this is escalated to the CEO.</p>
          `,
        });
        if (sent) emailsSent++;
      } else if (tier1Result.updated) {
        upserted++;
      }
    }

    // ── Tier 2: CEO escalation zone (internal target → legal deadline, and beyond) ──
    if (today >= deadlines.internal) {
      const isLegalDeadlineDay = datesEqual(today, deadlines.legal);
      const daysRemaining = Math.ceil(
        (deadlines.legal.getTime() - today.getTime()) / 86400000
      );
      const daysRemainingLabel = isLegalDeadlineDay ? "TODAY" : `${Math.max(0, daysRemaining)} day${daysRemaining !== 1 ? "s" : ""}`;

      const tier2Message = isLegalDeadlineDay
        ? `${incompleteCount} ${label.toLowerCase()} return steps overdue — legal deadline ${legalDateLabel} is TODAY`
        : `${incompleteCount} ${label.toLowerCase()} return steps overdue — ${daysRemainingLabel} to legal deadline ${legalDateLabel}`;

      const tier2Result = await upsertAlert(supabase, {
        taxYear, alertType, periodKey: "Annual",
        tier: 2, overdueCount: incompleteCount, message: tier2Message,
      });

      if (tier2Result.inserted || tier2Result.updated) {
        upserted++;

        // 3-day cadence CEO email — always send on legal deadline day
        const shouldEmail =
          isLegalDeadlineDay ||
          tier2Result.existingLastEmailSentAt === null ||
          daysSince(tier2Result.existingLastEmailSentAt) >= 3;

        if (shouldEmail) {
          const sent = await notifyCEO(supabase, {
            alertType,
            incompleteCount,
            label,
            legalDateLabel,
            daysRemainingLabel,
            isLegalDeadlineDay,
          });
          if (sent) {
            emailsSent++;
            // Record the send time so the 3-day gap is tracked
            await supabase.from("tax_deadline_alerts")
              .update({ last_email_sent_at: new Date().toISOString() })
              .eq("tax_year", taxYear)
              .eq("alert_type", alertType)
              .eq("period_key", "Annual")
              .eq("tier", 2);
          }
        }
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
): Promise<{ inserted: boolean; updated: boolean; existingLastEmailSentAt: string | null }> {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("tax_deadline_alerts")
    .select("id, first_triggered_at, last_email_sent_at")
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
    return { inserted: true, updated: false, existingLastEmailSentAt: null };
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

  return {
    inserted: false,
    updated: true,
    existingLastEmailSentAt: existing.last_email_sent_at as string | null,
  };
}

async function notifyShakeel(
  supabase: SupabaseClient,
  alertMessage: string,
  overrides?: { subject?: string; body?: string }
): Promise<boolean> {
  try {
    const { data: shakeelMember } = await supabase
      .from("members")
      .select("email, first_name, name, notify_email")
      .ilike("name", "%shakeel%")
      .maybeSingle();

    if (!shakeelMember?.email) return false;

    const recipientName = shakeelMember.first_name || shakeelMember.name || "Shakeel";
    const subject = overrides?.subject ?? "Tax deadline overdue — action required";
    const body = overrides?.body ?? `
      <p><strong>${recipientName}</strong>, a tax deadline has been missed and requires your attention:</p>
      <p style="background:#fef2f2;padding:12px;border-radius:6px;border-left:3px solid #dc2626">
        ${alertMessage}
      </p>
      <p>Please review the Accounts (Tax) page and take action before this is escalated to the CEO.</p>
    `;

    await sendNotificationEmail({
      to:      shakeelMember.email,
      subject,
      heading: "Tax Deadline Overdue",
      body,
      linkUrl:   `${APP_URL}/accounts-tax`,
      linkLabel: "Open Accounts (Tax)",
      triggerType: "tax_deadline_alert",
      recipientName,
    });

    return true;
  } catch {
    return false;
  }
}

async function notifyCEO(
  supabase: SupabaseClient,
  opts: {
    alertType: string;
    incompleteCount: number;
    label: string;
    legalDateLabel: string;
    daysRemainingLabel: string;
    isLegalDeadlineDay: boolean;
  }
): Promise<boolean> {
  try {
    const subject = opts.isLegalDeadlineDay
      ? `Annual returns — LEGAL DEADLINE TODAY (${opts.label})`
      : `Annual returns overdue — ${opts.daysRemainingLabel} to legal deadline`;

    const body = `
      <p><strong>${opts.incompleteCount} step${opts.incompleteCount !== 1 ? "s" : ""} incomplete</strong> for ${opts.label} Annual Returns.</p>
      <p style="background:#fef2f2;padding:12px;border-radius:6px;border-left:3px solid #dc2626">
        Legal deadline: <strong>${opts.legalDateLabel}</strong><br/>
        Days remaining: <strong>${opts.daysRemainingLabel}</strong>
      </p>
      <p>Please review and update the Accounts (Tax) schedule.</p>
    `;

    await sendNotificationEmail({
      to:      CEO_EMAIL,
      subject,
      heading: "Annual Returns — CEO Escalation",
      body,
      linkUrl:   `${APP_URL}/accounts-tax`,
      linkLabel: "View and update Accounts (Tax)",
      triggerType: "tax_deadline_alert",
      recipientName: "Khuram",
    });

    return true;
  } catch {
    return false;
  }
}
