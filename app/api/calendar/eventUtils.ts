/* ─── Event shape returned to the client ─────────────────────── */
export type CalendarEvent = {
  start: string;
  end: string;
  title?: string;
  account?: string;
  /* rich detail */
  id?: string;
  uid?: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  organizer?: { email?: string; name?: string };
  attendees?: { email?: string; name?: string; response?: string; self?: boolean }[];
  meetingLink?: string;
  meetingType?: "zoom" | "meet" | "teams" | "webex" | "other";
  meetingCode?: string;
  htmlLink?: string;
  calendarName?: string;
  recurring?: boolean;
  myResponse?: string;
  /* how many raw copies collapsed into this one */
  duplicateCount?: number;
  /* other wordings of the same event, kept so nothing is hidden */
  altTitles?: string[];
};

/* ─── Helpers ────────────────────────────────────────────────── */

// Google descriptions are HTML. Flatten to readable plain text while keeping
// any bare URLs visible (that's where Zoom links usually hide).
export function htmlToText(html?: string | null): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (_m, href, label) => {
      const clean = String(label).replace(/<[^>]+>/g, "").trim();
      return !clean || clean === href ? href : `${clean} (${href})`;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

const MEETING_PATTERNS: { type: CalendarEvent["meetingType"]; re: RegExp }[] = [
  { type: "zoom",  re: /https?:\/\/[a-z0-9.-]*zoom\.(?:us|com)\/[^\s<>"')\]]+/i },
  { type: "meet",  re: /https?:\/\/meet\.google\.com\/[^\s<>"')\]]+/i },
  { type: "teams", re: /https?:\/\/teams\.(?:microsoft|live)\.com\/[^\s<>"')\]]+/i },
  { type: "webex", re: /https?:\/\/[a-z0-9.-]*webex\.com\/[^\s<>"')\]]+/i },
];

export function classifyLink(url: string): CalendarEvent["meetingType"] {
  for (const p of MEETING_PATTERNS) if (p.re.test(url)) return p.type;
  return "other";
}

// Look for a joinable link in: conferenceData → hangoutLink → location → description.
export function extractMeeting(ev: {
  conferenceData?: { entryPoints?: { entryPointType?: string | null; uri?: string | null; meetingCode?: string | null }[] | null } | null;
  hangoutLink?: string | null;
  location?: string | null;
  description?: string | null;
}): { meetingLink?: string; meetingType?: CalendarEvent["meetingType"]; meetingCode?: string } {
  const video = (ev.conferenceData?.entryPoints || []).find(
    (e) => e.entryPointType === "video" && e.uri
  );
  if (video?.uri) {
    return {
      meetingLink: video.uri,
      meetingType: classifyLink(video.uri),
      meetingCode: video.meetingCode || undefined,
    };
  }
  if (ev.hangoutLink) {
    return { meetingLink: ev.hangoutLink, meetingType: "meet" };
  }
  const haystack = `${ev.location || ""}\n${ev.description || ""}`;
  for (const p of MEETING_PATTERNS) {
    const m = haystack.match(p.re);
    if (m) return { meetingLink: m[0].replace(/[.,;]+$/, ""), meetingType: p.type };
  }
  return {};
}

/* ─── De-duplication ─────────────────────────────────────────── */
//
// Khuram's account has an Exchange↔Google sync that copies meetings onto a
// second Google calendar with a mangled title and a brand-new UID, e.g.
//   "Khuram & Lisa Governance Call"
//   "Busy: Khuram & Lisa Governance Call [copied]"
// Neither the UID nor the raw title matches, so identity alone can't collapse
// them. Everything below exists to recognise those sync copies.

const SYNC_SUFFIX = /\s*\[(?:exchange[-\s]?)?copied\]\s*$/i;
const SYNC_PREFIX = /^\s*busy\s*[:–-]\s*/i;

// Returns the human title with the sync-tool decoration removed, plus whether
// this row WAS a sync copy (which the slot pass below relies on).
export function stripSyncMarkers(title?: string): { clean: string; isCopy: boolean } {
  const raw = (title || "").trim();
  const withoutSuffix = raw.replace(SYNC_SUFFIX, "");
  const withoutPrefix = withoutSuffix.replace(SYNC_PREFIX, "");
  const isCopy = withoutSuffix !== raw || withoutPrefix !== withoutSuffix;
  return { clean: withoutPrefix.trim() || raw, isCopy };
}

function normTitle(title?: string): string {
  return stripSyncMarkers(title)
    .clean.toLowerCase()
    .replace(/^(invitation|fwd|re|updated invitation|accepted|canceled|cancelled):\s*/i, "")
    .replace(/\s*@\s*.*$/, "")      // drop Google's " @ Thu Aug 14, 2026 ..." suffix
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["the","and","for","with","from","call","meet","meeting","busy","save","date","summit","review","update"]);

// Distinctive words — used to decide whether two differently-worded sync
// copies in the same slot really describe the same thing.
function tokens(title?: string): Set<string> {
  return new Set(normTitle(title).split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

function sharedTokenCount(a?: string, b?: string): number {
  const ta = tokens(a), tb = tokens(b);
  let n = 0;
  for (const w of ta) if (tb.has(w)) n++;
  return n;
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Prefer whichever copy of a duplicated event actually carries information —
// and prefer the untouched original over the sync tool's "Busy: … [copied]".
export function richness(e: CalendarEvent): number {
  const { clean, isCopy } = stripSyncMarkers(e.title);
  return (
    (e.meetingLink ? 8 : 0) +
    (e.description ? 4 : 0) +
    (e.location ? 2 : 0) +
    (e.attendees?.length ? 2 : 0) +
    (e.htmlLink ? 1 : 0) +
    (clean && clean !== "Busy" ? 1 : 0) +
    (isCopy ? 0 : 6)          // an original beats a sync copy
  );
}

// Merge a duplicate into the copy we're keeping, so no detail is lost.
export function mergeEvents(keep: CalendarEvent, other: CalendarEvent): CalendarEvent {
  const otherWins = richness(other) > richness(keep);
  const base: CalendarEvent = { ...(otherWins ? other : keep) };
  const alt = otherWins ? keep : other;

  const baseClean = stripSyncMarkers(base.title).clean;
  const altClean  = stripSyncMarkers(alt.title).clean;
  base.title       = baseClean && baseClean !== "Busy" ? baseClean : altClean;
  base.description = base.description || alt.description;
  base.location    = base.location    || alt.location;
  base.meetingLink = base.meetingLink || alt.meetingLink;
  base.meetingType = base.meetingType || alt.meetingType;
  base.meetingCode = base.meetingCode || alt.meetingCode;
  base.htmlLink    = base.htmlLink    || alt.htmlLink;
  base.organizer   = base.organizer   || alt.organizer;
  base.myResponse  = base.myResponse  || alt.myResponse;
  base.attendees   = base.attendees?.length ? base.attendees : alt.attendees;

  // Widest span wins — the sync copy of a multi-day "save the date" often
  // ends a day earlier than the original.
  if (ms(alt.start) && ms(alt.start) < ms(base.start)) base.start = alt.start;
  if (ms(alt.end) > ms(base.end)) base.end = alt.end;

  // Keep any genuinely different wording so nothing is silently hidden.
  const alts = new Set([...(base.altTitles || []), ...(alt.altTitles || [])]);
  if (altClean && normTitle(altClean) !== normTitle(base.title)) alts.add(altClean);
  base.altTitles = alts.size ? [...alts] : undefined;

  base.duplicateCount = (keep.duplicateCount || 1) + (other.duplicateCount || 1);
  return base;
}

// Generic grouping helper: collapse by `key`, preserving first-seen order.
// A null/undefined key means "leave this one alone".
function collapse(events: CalendarEvent[], key: (e: CalendarEvent, i: number) => string | null): CalendarEvent[] {
  const map = new Map<string, CalendarEvent>();
  const order: string[] = [];
  events.forEach((e, i) => {
    const k = key(e, i) ?? `__keep_${i}`;
    const existing = map.get(k);
    if (existing) map.set(k, mergeEvents(existing, e));
    else { map.set(k, e); order.push(k); }
  });
  return order.map((k) => map.get(k)!);
}

export function fuzzyKey(e: CalendarEvent): string {
  return `${ms(e.start)}|${ms(e.end)}|${normTitle(e.title)}`;
}

export function dedupe(events: CalendarEvent[]): { events: CalendarEvent[]; removed: number } {
  // 1. Exact identity — the same event read off two calendars.
  let out = collapse(events, (e, i) => e.uid || e.id || `__pos_${i}`);

  // 2. Same title (sync decoration stripped) in exactly the same slot.
  out = collapse(out, (e) => fuzzyKey(e));

  // 3. Same title and same start, different end — the sync copy of a
  //    multi-day event often ends a day early. Start + title is enough.
  out = collapse(out, (e) => `${ms(e.start)}|${normTitle(e.title)}`);

  // 4. Sync copies filling the identical slot but worded differently, e.g.
  //    "Flight to Redmond/Bend (AS 2094)" vs "Flight: AS 2094 from SEA to RDM".
  //    Deliberately narrow: BOTH rows must carry the sync marker, occupy the
  //    exact same start and end, and share at least two distinctive words —
  //    so two genuinely different meetings double-booked in one slot survive.
  const slots = new Map<string, CalendarEvent[]>();
  const slotOrder: string[] = [];
  out.forEach((e, i) => {
    const k = stripSyncMarkers(e.title).isCopy ? `${ms(e.start)}|${ms(e.end)}` : `__solo_${i}`;
    if (!slots.has(k)) { slots.set(k, []); slotOrder.push(k); }
    slots.get(k)!.push(e);
  });
  const merged: CalendarEvent[] = [];
  for (const k of slotOrder) {
    const group = slots.get(k)!;
    const buckets: CalendarEvent[] = [];
    for (const e of group) {
      const hit = buckets.findIndex((b) => sharedTokenCount(b.title, e.title) >= 2);
      if (hit >= 0) buckets[hit] = mergeEvents(buckets[hit], e);
      else buckets.push(e);
    }
    merged.push(...buckets);
  }

  // Finally, show the human title rather than the sync tool's decoration.
  const cleaned = merged.map((e) => {
    const { clean } = stripSyncMarkers(e.title);
    return clean && clean !== e.title ? { ...e, title: clean } : e;
  });

  return { events: cleaned, removed: events.length - cleaned.length };
}
