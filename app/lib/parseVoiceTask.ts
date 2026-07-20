/**
 * parseVoiceTask
 *
 * Converts a raw voice transcript into structured task fields.
 * Handles the patterns staff naturally say:
 *
 *   "Remind Sundas to get the agreement signed by Friday"
 *   "Tell Usman to check the production report"
 *   "Ask Ahmed to call the supplier about the delivery tomorrow"
 *   "Assign the invoice review to Asif by next week"
 *   "Get Abdul to prepare the monthly summary today"
 *
 * No AI or API calls — pure client-side pattern matching.
 */

export type ParsedVoiceTask = {
  description: string;
  assigneeName: string | null;  // raw spoken name — caller resolves to a Member
  dueDate: string | null;       // YYYY-MM-DD or null
};

// ── Date extraction ───────────────────────────────────────────────────────────

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextWeekdayOffset(targetDow: number): number {
  const today = new Date().getDay(); // 0=Sun … 6=Sat
  const diff = (targetDow - today + 7) % 7;
  return diff === 0 ? 7 : diff;
}

type DateRule = { pattern: RegExp; resolve: () => string };

const DATE_RULES: DateRule[] = [
  // "end of today" / "today" / "eod"
  { pattern: /\b(by |due )?(end of )?today\b|\beod\b/i, resolve: () => offsetDate(0) },
  // "tomorrow"
  { pattern: /\btomorrow\b/i, resolve: () => offsetDate(1) },
  // "this friday" / "friday" / "by friday"
  { pattern: /\b(by |due |this |coming )?friday\b/i, resolve: () => offsetDate(nextWeekdayOffset(5)) },
  // "this thursday"
  { pattern: /\b(by |due |this |coming )?thursday\b/i, resolve: () => offsetDate(nextWeekdayOffset(4)) },
  // "this wednesday"
  { pattern: /\b(by |due |this |coming )?wednesday\b/i, resolve: () => offsetDate(nextWeekdayOffset(3)) },
  // "this tuesday"
  { pattern: /\b(by |due |this |coming )?tuesday\b/i, resolve: () => offsetDate(nextWeekdayOffset(2)) },
  // "next monday" / "monday" / "next week"
  { pattern: /\b(next |coming )?monday\b|\bnext week\b/i, resolve: () => offsetDate(nextWeekdayOffset(1) || 7) },
  // "this week" → Friday
  { pattern: /\bthis week\b/i, resolve: () => offsetDate(nextWeekdayOffset(5)) },
  // "end of week" → Friday
  { pattern: /\bend of (the )?week\b/i, resolve: () => offsetDate(nextWeekdayOffset(5)) },
];

function extractDate(text: string): { date: string | null; clean: string } {
  for (const { pattern, resolve } of DATE_RULES) {
    if (pattern.test(text)) {
      return {
        date: resolve(),
        clean: text.replace(pattern, "").replace(/\s{2,}/g, " ").trim().replace(/,?\s*$/, ""),
      };
    }
  }
  return { date: null, clean: text };
}

// ── Trigger-word patterns ─────────────────────────────────────────────────────
//
// Each pattern captures (assignee, task) or (task, assignee) in groups 1 & 2.

type TriggerRule = { pattern: RegExp; assigneeGroup: 1 | 2; taskGroup: 1 | 2 };

const TRIGGER_RULES: TriggerRule[] = [
  // "remind / ask / tell / get / have [name] to [task]"
  {
    pattern: /^(?:remind|ask|tell|get|have|make|request)\s+(.+?)\s+to\s+(.+)$/i,
    assigneeGroup: 1,
    taskGroup: 2,
  },
  // "ask [name] about / regarding [task]"
  {
    pattern: /^ask\s+(.+?)\s+(?:about|regarding|re)\s+(.+)$/i,
    assigneeGroup: 1,
    taskGroup: 2,
  },
  // "assign [task] to [name]"
  {
    pattern: /^assign\s+(.+?)\s+to\s+(.+)$/i,
    assigneeGroup: 2,
    taskGroup: 1,
  },
  // "[task] for [name]"
  {
    pattern: /^(.+?)\s+for\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})$/i,
    assigneeGroup: 2,
    taskGroup: 1,
  },
  // "follow up with [name] on / about [task]"
  {
    pattern: /^follow(?:\s+up)?\s+with\s+(.+?)\s+(?:on|about|regarding)\s+(.+)$/i,
    assigneeGroup: 1,
    taskGroup: 2,
  },
  // "check with [name] on / about [task]"
  {
    pattern: /^check\s+with\s+(.+?)\s+(?:on|about|regarding)\s+(.+)$/i,
    assigneeGroup: 1,
    taskGroup: 2,
  },
];

// ── Name normalisation ────────────────────────────────────────────────────────
// Speech-to-text sometimes inserts "the" before names, capitalises oddly, etc.

function cleanName(raw: string): string {
  return raw
    .replace(/^(the|mr|mrs|ms|dr|sir)\s+/i, "")
    .trim();
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseVoiceTask(transcript: string): ParsedVoiceTask {
  // Normalise whitespace
  let text = transcript.trim().replace(/\s+/g, " ");

  // Strip trailing punctuation the STT engine sometimes appends
  text = text.replace(/[.!?]+$/, "").trim();

  // 1. Pull the date out first so it doesn't confuse the name matcher
  const { date, clean } = extractDate(text);
  text = clean;

  // 2. Try each trigger rule
  for (const { pattern, assigneeGroup, taskGroup } of TRIGGER_RULES) {
    const m = text.match(pattern);
    if (m) {
      return {
        description: m[taskGroup].trim(),
        assigneeName: cleanName(m[assigneeGroup]),
        dueDate: date,
      };
    }
  }

  // 3. No trigger found — whole transcript becomes the description, no assignee parsed
  return {
    description: text,
    assigneeName: null,
    dueDate: date,
  };
}

// ── Fuzzy member lookup ───────────────────────────────────────────────────────
// Tries multiple strategies in order of confidence.

export function matchMemberByName<T extends { name: string }>(
  spoken: string,
  members: T[]
): T | null {
  if (!spoken || members.length === 0) return null;

  const q = spoken.toLowerCase().trim();

  // 1. Exact full name
  const exact = members.find((m) => m.name.toLowerCase() === q);
  if (exact) return exact;

  // 2. First word of spoken matches first name of member
  const spokenFirst = q.split(" ")[0];
  const byFirst = members.find(
    (m) => m.name.toLowerCase().split(" ")[0] === spokenFirst
  );
  if (byFirst) return byFirst;

  // 3. Last word of spoken matches last name of member
  const spokenLast = q.split(" ").pop()!;
  const byLast = members.find((m) => {
    const parts = m.name.toLowerCase().split(" ");
    return parts[parts.length - 1] === spokenLast;
  });
  if (byLast) return byLast;

  // 4. Member name contains the spoken query
  const contains = members.find((m) =>
    m.name.toLowerCase().includes(q)
  );
  if (contains) return contains;

  // 5. Spoken query contains member's first name (handles "Abdul Rehman" → "Abdul")
  const spokenContainsMemberFirst = members.find((m) => {
    const firstName = m.name.toLowerCase().split(" ")[0];
    return firstName.length >= 3 && q.includes(firstName);
  });
  if (spokenContainsMemberFirst) return spokenContainsMemberFirst;

  return null;
}
