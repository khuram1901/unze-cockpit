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

// Prefer whichever copy of a duplicated event actually carries information.
export function richness(e: CalendarEvent): number {
  return (
    (e.meetingLink ? 8 : 0) +
    (e.description ? 4 : 0) +
    (e.location ? 2 : 0) +
    (e.attendees?.length ? 2 : 0) +
    (e.htmlLink ? 1 : 0) +
    (e.title && e.title !== "Busy" ? 1 : 0)
  );
}

// Merge a duplicate into the copy we're keeping, so no detail is lost.
export function mergeEvents(keep: CalendarEvent, other: CalendarEvent): CalendarEvent {
  const base = richness(other) > richness(keep) ? { ...other } : { ...keep };
  const alt  = richness(other) > richness(keep) ? keep : other;
  base.title        = base.title && base.title !== "Busy" ? base.title : alt.title;
  base.description  = base.description  || alt.description;
  base.location     = base.location     || alt.location;
  base.meetingLink  = base.meetingLink  || alt.meetingLink;
  base.meetingType  = base.meetingType  || alt.meetingType;
  base.meetingCode  = base.meetingCode  || alt.meetingCode;
  base.htmlLink     = base.htmlLink     || alt.htmlLink;
  base.organizer    = base.organizer    || alt.organizer;
  base.myResponse   = base.myResponse   || alt.myResponse;
  base.attendees    = (base.attendees?.length ? base.attendees : alt.attendees);
  base.duplicateCount = (keep.duplicateCount || 1) + (other.duplicateCount || 1);
  return base;
}

// Same instant + same normalised title = the same meeting, whichever
// calendar or account it arrived on.
export function fuzzyKey(e: CalendarEvent): string {
  const t = (e.title || "")
    .toLowerCase()
    .replace(/^(invitation:|fwd:|re:|updated invitation:|accepted:|canceled:)\s*/i, "")
    .replace(/\s*@\s*.*$/, "")      // drop Google's " @ Thu Aug 14, 2026 ..." suffix
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const startMs = new Date(e.start).getTime();
  const endMs = new Date(e.end).getTime();
  return `${Number.isNaN(startMs) ? e.start : startMs}|${Number.isNaN(endMs) ? e.end : endMs}|${t}`;
}

// Two-pass de-duplication: exact identity (iCalUID / event id) first, then a
// fuzzy pass for the same meeting duplicated under different ids.
export function dedupe(events: CalendarEvent[]): { events: CalendarEvent[]; removed: number } {
  const byUid = new Map<string, CalendarEvent>();
  const order: string[] = [];
  events.forEach((e, i) => {
    const key = e.uid || e.id || `__pos_${i}`;
    const existing = byUid.get(key);
    if (existing) byUid.set(key, mergeEvents(existing, e));
    else { byUid.set(key, e); order.push(key); }
  });

  const byFuzzy = new Map<string, CalendarEvent>();
  const fuzzyOrder: string[] = [];
  for (const key of order) {
    const e = byUid.get(key)!;
    const fk = fuzzyKey(e);
    const existing = byFuzzy.get(fk);
    if (existing) byFuzzy.set(fk, mergeEvents(existing, e));
    else { byFuzzy.set(fk, e); fuzzyOrder.push(fk); }
  }

  const out = fuzzyOrder.map((k) => byFuzzy.get(k)!);
  return { events: out, removed: events.length - out.length };
}
