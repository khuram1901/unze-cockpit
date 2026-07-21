"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch, supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";

const {
  NAVY, SLATE, HAIRLINE, GREEN, AMBER, RED, BLUE,
  INK_400, CANVAS, SUCCESS_SOFT, DANGER_SOFT, WARNING_SOFT,
} = COLOURS;

/* ─── types ─────────────────────────────────────────────────── */
type CalEvent  = { start: string; end: string; title?: string };
type NewsStory = { title: string; link: string; ago: string; source: string; color: string };
type FxRates   = { USD: number; GBP: number; CNY: number };
type Weather   = { temp: number; apparent: number; humidity: number; code: number; city: string };

type TaskItem = {
  id: string;
  description: string;
  due_date: string | null;
  priority: string | null;
  status: string;
};

type TeamTaskItem = TaskItem & {
  assigned_to: string | null;
  assigned_to_email: string | null;
};

// Shape the API can return (union of all roles)
type WelcomeData = {
  firstName: string;
  role: string | null;
  department: string | null;
  // Admin/CEO/Exec
  overdueTaskCount?: number;
  machineIssueCount?: number;
  // HOD (Manager)
  teamOverdueCount?: number;
  teamPendingCount?: number;
  teamCompletedMonth?: number;
  myOverdueCount?: number;
  myTodayCount?: number;
  teamOverdueTasks?: TeamTaskItem[];
  myTasks?: TaskItem[];
  // Member
  myUpcomingCount?: number;
};

/* ─── WMO weather codes ──────────────────────────────────────── */
const WMO: Record<number, [string, string]> = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
  45: ["Foggy", "🌫️"], 48: ["Icy fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌦️"],
  61: ["Slight rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  71: ["Light snow", "❄️"], 73: ["Snow", "❄️"], 75: ["Heavy snow", "❄️"],
  80: ["Showers", "🌦️"], 82: ["Heavy showers", "⛈️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm + hail", "⛈️"],
};
function wmo(code: number): [string, string] { return WMO[code] ?? ["Unknown", "🌡️"]; }

/* ─── world clocks ────────────────────────────────────────────── */
const CLOCKS = [
  { city: "Lahore",   tz: "Asia/Karachi",    flag: "🇵🇰", color: GREEN },
  { city: "London",   tz: "Europe/London",   flag: "🇬🇧", color: BLUE },
  { city: "Dubai",    tz: "Asia/Dubai",       flag: "🇦🇪", color: AMBER },
  { city: "New York", tz: "America/New_York", flag: "🇺🇸", color: "#C0392B" },
];

/* ─── currency config ────────────────────────────────────────── */
const CURRENCIES = [
  { code: "USD", symbol: "$", flag: "🇺🇸", label: "US Dollar",    key: "USD" as const, color: "#27AE60" },
  { code: "GBP", symbol: "£", flag: "🇬🇧", label: "British Pound", key: "GBP" as const, color: "#2C3E8C" },
  { code: "CNY", symbol: "¥", flag: "🇨🇳", label: "Chinese Yuan",  key: "CNY" as const, color: "#C0392B" },
];

/* ─── department → dashboard URL map ─────────────────────────── */
const DEPT_DASHBOARD: Record<string, string> = {
  "HR":                "/department/hr",
  "Admin":             "/department/admin",
  "Audit":             "/department/audit",
  "Tax":               "/department/tax",
  "Legal":             "/department/tax",        // alias
  "IT":                "/department/it",
  "Finance":           "/finance",
  "Unze Trading Ops":  "/dashboard",
  "Sales":             "/dashboard",
};

/* ─── helpers ─────────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
function longDate() {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function clockStr(tz: string) {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz });
}
function shortTime(tz: string) {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}
function fmtEvtTime(iso: string) {
  if (!iso.includes("T")) return "All day";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });
}
function dayOffset(n: number) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
function dayLabel(n: number) {
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  return new Date(Date.now() + n * 86400000).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}
function daysOverdue(dueDate: string): number {
  const due = new Date(dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - due.getTime()) / 86400000);
}
function daysUntil(dueDate: string): number {
  const due = new Date(dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((due.getTime() - now.getTime()) / 86400000);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

const DAY_COLORS = [GREEN, BLUE, SLATE];

/* ─── shared card shell ───────────────────────────────────────── */
function Card({ children, accentColor, style }: { children: ReactNode; accentColor?: string; style?: CSSProperties }) {
  return (
    <div style={{
      backgroundColor: "white",
      border: `1px solid ${HAIRLINE}`,
      borderRadius: RADII.CARD,
      borderTop: accentColor ? `3px solid ${accentColor}` : undefined,
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}>
      {children}
    </div>
  );
}

function CardLabel({ children, color, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: color ?? INK_400, marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px", ...style }}>
      {children}
    </div>
  );
}

function PriorityDot({ priority }: { priority: string | null }) {
  const color = priority === "High" ? RED : priority === "Medium" ? AMBER : SLATE;
  return <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: color, flexShrink: 0, display: "inline-block", marginTop: "4px" }} />;
}

/* ─── main page ───────────────────────────────────────────────── */
export default function WelcomePage() {
  const router   = useRouter();
  const isMobile = useMobile();
  const tickRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const [data,         setData]         = useState<WelcomeData | null>(null);
  const [calEvents,    setCalEvents]    = useState<CalEvent[]>([]);
  const [news,         setNews]         = useState<NewsStory[]>([]);
  const [weather,      setWeather]      = useState<Weather | null>(null);
  const [fx,           setFx]           = useState<FxRates | null>(null);
  const [tick,         setTick]         = useState(0);
  const [expandedDay,  setExpandedDay]  = useState<number | null>(null);
  const [newsExpanded, setNewsExpanded] = useState(false);

  /* live clock */
  useEffect(() => {
    tickRef.current = setInterval(() => setTick(n => n + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  /* weather */
  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    try {
      const [wRes, gRes] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&timezone=auto`),
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`),
      ]);
      const [wd, gd] = await Promise.all([wRes.json(), gRes.json()]);
      const city = gd?.address?.city || gd?.address?.town || gd?.address?.village || "Your location";
      setWeather({
        temp:     Math.round(wd.current.temperature_2m),
        apparent: Math.round(wd.current.apparent_temperature),
        humidity: wd.current.relative_humidity_2m,
        code:     wd.current.weather_code,
        city,
      });
    } catch { /* non-fatal */ }
  }, []);

  /* main data load */
  useEffect(() => {
    let active = true;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }

      const today = dayOffset(0);
      const role = (await supabase.from("members").select("role").eq("email", user.email!).maybeSingle()).data?.role ?? null;

      // For HODs and Members we only need the welcome API + weather
      // For Admin/CEO/Exec we also load calendar, FX, and news
      const isPrivileged = !role || role === "Admin" || role === "CEO" || role === "Executive";

      const fetches: Promise<unknown>[] = [authFetch("/api/welcome")];
      if (isPrivileged) {
        fetches.push(
          authFetch(`/api/calendar/freebusy?date=${today}`),
          authFetch("/api/fx/multi"),
          authFetch("/api/welcome/news"),
        );
      } else if (role === "Member") {
        // Members want FX too (they picked clocks + weather, no FX — skip)
      }

      const [summaryRes, calRes, fxRes, newsRes] = await Promise.all(fetches) as Response[];

      if (!active) return;

      if (summaryRes?.ok) {
        const s: WelcomeData = await summaryRes.json();
        setData(s);
      }
      if (calRes?.ok) {
        const c = await calRes.json();
        const cutoff = dayOffset(3);
        setCalEvents(
          ((c.busy || []) as CalEvent[])
            .filter(e => e.start.slice(0, 10) >= today && e.start.slice(0, 10) < cutoff)
            .sort((a, b) => a.start.localeCompare(b.start))
        );
      }
      if (fxRes?.ok)  { const f = await fxRes.json();  setFx(f); }
      if (newsRes?.ok){ const n = await newsRes.json(); setNews(n.stories || []); }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          p  => fetchWeather(p.coords.latitude, p.coords.longitude),
          () => fetchWeather(31.5204, 74.3587),
        );
      } else { fetchWeather(31.5204, 74.3587); }
    }
    load();
    return () => { active = false; };
  }, [router, fetchWeather]);

  void tick; // consumed indirectly by clockStr re-renders

  const role = data?.role ?? null;

  // ── HOD layout ────────────────────────────────────────────────
  if (role === "Manager") {
    return (
      <AuthWrapper>
        <HODLayout
          data={data!}
          isMobile={isMobile}
          router={router}
          clockStr={clockStr}
        />
      </AuthWrapper>
    );
  }

  // ── Member layout ─────────────────────────────────────────────
  if (role === "Member") {
    return (
      <AuthWrapper>
        <MemberLayout
          data={data!}
          weather={weather}
          isMobile={isMobile}
          router={router}
          clockStr={clockStr}
          shortTime={shortTime}
          wmo={wmo}
        />
      </AuthWrapper>
    );
  }

  // ── Admin / CEO / Executive (or loading) — original layout ────
  const gap   = "12px";
  const col4  = isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr";
  const col3  = isMobile ? "1fr" : "1fr 1fr 1fr";
  const overdueCount  = data?.overdueTaskCount ?? 0;
  const machineCount  = data?.machineIssueCount ?? 0;

  return (
    <AuthWrapper>
      <div style={{ backgroundColor: CANVAS, minHeight: "100vh", paddingBottom: "40px" }}>

        {/* ── HERO ──────────────────────────────────────────────── */}
        <div style={{
          background: `linear-gradient(135deg, ${NAVY} 0%, #1B2B40 60%, #1A3350 100%)`,
          padding: isMobile ? "28px 18px 24px" : "36px 36px 30px",
          marginBottom: "20px",
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: "16px",
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{ position: "absolute", right: isMobile ? "-60px" : "120px", top: "-80px", width: "260px", height: "260px", borderRadius: "50%", background: "rgba(59,76,202,0.12)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", right: isMobile ? "10px" : "60px", bottom: "-40px", width: "140px", height: "140px", borderRadius: "50%", background: "rgba(59,76,202,0.08)", pointerEvents: "none" }} />

          <div style={{ position: "relative" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>{longDate()}</div>
            <div style={{ fontSize: isMobile ? "26px" : "34px", fontWeight: 800, color: "white", lineHeight: 1.2 }}>
              {greeting()}{data?.firstName ? `, ${data.firstName}` : ""}.
            </div>
            <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", marginTop: "6px" }}>Here's your morning brief.</div>
            <div style={{ display: "flex", gap: "10px", marginTop: "18px", flexWrap: "wrap" }}>
              <HeroBadge count={overdueCount} label="overdue" color="#F87171" bg="rgba(248,113,113,0.15)" />
              <HeroBadge count={machineCount} label={machineCount === 1 ? "machine issue" : "machine issues"} color="#FCD34D" bg="rgba(252,211,77,0.12)" />
            </div>
          </div>

          <div style={{ position: "relative", textAlign: isMobile ? "left" : "right", flexShrink: 0 }}>
            <div style={{ fontSize: isMobile ? "38px" : "52px", fontWeight: 700, fontFamily: "monospace", color: "white", letterSpacing: "2px", lineHeight: 1 }}>
              {clockStr("Asia/Karachi")}
            </div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginTop: "4px", textTransform: "uppercase" }}>
              Pakistan Standard Time · PKT
            </div>
            <button
              onClick={() => router.replace("/home")}
              style={{ marginTop: "14px", padding: "9px 22px", backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: RADII.PILL, color: "white", fontSize: "13px", fontWeight: 600, cursor: "pointer", letterSpacing: "0.02em" }}
            >
              Open Dashboard →
            </button>
          </div>
        </div>

        <div style={{ padding: isMobile ? "0 12px" : "0 20px" }}>

          {/* ── ROW 1: clocks + weather + FX + stats ─────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: col4, gap, marginBottom: gap }}>

            <Card accentColor={NAVY}>
              <CardLabel color={NAVY}>🌍 World Clocks</CardLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                {CLOCKS.map(c => (
                  <div key={c.tz} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px", lineHeight: 1 }}>{c.flag}</span>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: NAVY }}>{c.city}</div>
                    </div>
                    <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "monospace", color: "white", backgroundColor: c.color, padding: "2px 8px", borderRadius: "6px" }}>
                      {shortTime(c.tz)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card accentColor={BLUE}>
              <CardLabel color={BLUE}>🌤 Weather</CardLabel>
              {weather ? (
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: SLATE, marginBottom: "8px" }}>{weather.city}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "36px", lineHeight: 1 }}>{wmo(weather.code)[1]}</span>
                    <span style={{ fontSize: "34px", fontWeight: 800, color: NAVY, lineHeight: 1 }}>{weather.temp}°C</span>
                  </div>
                  <div style={{ fontSize: "13px", color: SLATE, marginTop: "4px", fontWeight: 500 }}>{wmo(weather.code)[0]}</div>
                  <div style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
                    <Chip label={`Feels ${weather.apparent}°C`} color={BLUE} />
                    <Chip label={`${weather.humidity}% humidity`} color={SLATE} />
                  </div>
                </div>
              ) : (
                <div style={{ color: INK_400, fontSize: "13px", marginTop: "4px" }}>Locating…</div>
              )}
            </Card>

            <Card accentColor={GREEN} style={{ gridColumn: isMobile ? "span 2" : "span 1" }}>
              <CardLabel color={GREEN}>💱 PKR Exchange</CardLabel>
              {fx ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {CURRENCIES.map(c => (
                    <div key={c.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: "8px", backgroundColor: CANVAS }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "18px" }}>{c.flag}</span>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: c.color }}>{c.code}</div>
                          <div style={{ fontSize: "10px", color: INK_400 }}>{c.label}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "16px", fontWeight: 800, fontFamily: "monospace", color: NAVY }}>₨ {fx[c.key].toFixed(0)}</div>
                        <div style={{ fontSize: "10px", color: INK_400 }}>per {c.symbol}1</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: INK_400, fontSize: "13px" }}>Loading rates…</div>
              )}
            </Card>

            <Card accentColor={overdueCount > 0 ? RED : GREEN}>
              <CardLabel color={overdueCount > 0 ? RED : GREEN}>📋 At a Glance</CardLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                <StatRow colour={overdueCount > 0 ? RED : GREEN} count={overdueCount}
                  label={overdueCount === 1 ? "overdue task" : "overdue tasks"} empty="All tasks on track" />
                <StatRow colour={machineCount > 0 ? AMBER : GREEN} count={machineCount}
                  label={machineCount === 1 ? "machine issue" : "machine issues"} empty="All machines running" />
              </div>
              <a href="/home" style={{ fontSize: "12px", color: BLUE, fontWeight: 600, textDecoration: "none", marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${HAIRLINE}`, display: "block" }}>
                Open dashboard →
              </a>
            </Card>
          </div>

          {/* ── ROW 2: 3-day calendar ─────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: col3, gap, marginBottom: gap }}>
            {[0, 1, 2].map(offset => {
              const dateStr  = dayOffset(offset);
              const events   = calEvents.filter(e => e.start.slice(0, 10) === dateStr);
              const color    = DAY_COLORS[offset];
              const label    = dayLabel(offset);
              const isExpanded = expandedDay === offset;
              const PREVIEW  = 3;
              return (
                <Card key={offset} accentColor={color}>
                  <CardLabel color={color}>
                    📅 {label}
                    <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 700, backgroundColor: color, color: "white", padding: "1px 7px", borderRadius: "20px" }}>
                      {events.length} {events.length === 1 ? "event" : "events"}
                    </span>
                  </CardLabel>
                  {events.length === 0 ? (
                    <div style={{ fontSize: "13px", color: INK_400, fontStyle: "italic" }}>Nothing scheduled.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {(isExpanded ? events : events.slice(0, PREVIEW)).map((ev, i) => {
                        const start = fmtEvtTime(ev.start);
                        const end   = fmtEvtTime(ev.end);
                        const time  = start === "All day" ? "All day" : `${start}–${end}`;
                        return (
                          <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "6px 8px", borderRadius: "6px", backgroundColor: i % 2 === 0 ? CANVAS : "transparent" }}>
                            <span style={{ fontSize: "10px", fontWeight: 600, color: "white", backgroundColor: color, padding: "2px 6px", borderRadius: "4px", flexShrink: 0, marginTop: "1px", minWidth: "70px", textAlign: "center" }}>{time}</span>
                            <span style={{ fontSize: "13px", color: NAVY, fontWeight: 500, lineHeight: 1.35 }}>{ev.title || "Busy"}</span>
                          </div>
                        );
                      })}
                      {events.length > PREVIEW && (
                        <button onClick={() => setExpandedDay(isExpanded ? null : offset)} style={{ marginTop: "4px", background: "none", border: "none", fontSize: "12px", fontWeight: 600, color, cursor: "pointer", textAlign: "left", padding: "2px 8px" }}>
                          {isExpanded ? "▲ Show less" : `▼ Show all ${events.length} events`}
                        </button>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* ── ROW 3: news ───────────────────────────────────────── */}
          <Card accentColor={NAVY} style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <CardLabel color={NAVY} style={{ marginBottom: 0 }}>📰 Latest News</CardLabel>
              {news.length > 0 && (
                <button onClick={() => setNewsExpanded(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: NAVY, padding: "2px 6px" }}>
                  {newsExpanded ? "▲ Show less" : "▼ Show more"}
                </button>
              )}
            </div>
            {news.length === 0 ? (
              <div style={{ color: INK_400, fontSize: "13px" }}>Loading headlines…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "0" }}>
                {(newsExpanded ? news : news.slice(0, 6)).map((s, i) => (
                  <a key={i} href={s.link} target="_blank" rel="noreferrer"
                    style={{ textDecoration: "none", display: "block", padding: "10px 14px", borderBottom: `1px solid ${HAIRLINE}`, borderRight: (!isMobile && (i % 3 !== 2)) ? `1px solid ${HAIRLINE}` : "none" }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = CANVAS; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
                      <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", color: "white", backgroundColor: s.color, letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0 }}>{s.source}</span>
                      {s.ago && <span style={{ fontSize: "10px", color: INK_400 }}>{s.ago}</span>}
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, lineHeight: 1.4 }}>{s.title}</div>
                  </a>
                ))}
              </div>
            )}
          </Card>

        </div>
      </div>
    </AuthWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HOD LAYOUT
   ═══════════════════════════════════════════════════════════════ */
function HODLayout({
  data,
  isMobile,
  router,
  clockStr,
}: {
  data: WelcomeData;
  isMobile: boolean;
  router: ReturnType<typeof useRouter>;
  clockStr: (tz: string) => string;
}) {
  const {
    firstName = "",
    department = "",
    teamOverdueCount = 0,
    teamPendingCount = 0,
    teamCompletedMonth = 0,
    myOverdueCount = 0,
    myTodayCount = 0,
    teamOverdueTasks = [],
    myTasks = [],
  } = data;

  const deptDashHref = (department && DEPT_DASHBOARD[department]) || "/dashboard";
  const today = todayISO();
  const gap = "12px";
  const col2 = isMobile ? "1fr" : "2fr 1fr";
  const col3 = isMobile ? "1fr" : "1fr 1fr 1fr";

  const hasTeamIssues = teamOverdueCount > 0;
  const hasMyIssues   = myOverdueCount > 0 || myTodayCount > 0;

  return (
    <div style={{ backgroundColor: CANVAS, minHeight: "100vh", paddingBottom: "40px" }}>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #1B2B40 60%, #1A3350 100%)`,
        padding: isMobile ? "28px 18px 24px" : "36px 36px 30px",
        marginBottom: "20px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: "16px",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", right: isMobile ? "-60px" : "180px", top: "-80px", width: "260px", height: "260px", borderRadius: "50%", background: "rgba(59,76,202,0.10)", pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>{longDate()}</div>
          <div style={{ fontSize: isMobile ? "26px" : "34px", fontWeight: 800, color: "white", lineHeight: 1.2 }}>
            {greeting()}{firstName ? `, ${firstName}` : ""}.
          </div>
          {department && (
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", marginTop: "5px", fontWeight: 500 }}>
              {department} · Head of Department
            </div>
          )}

          {/* Status badges */}
          <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
            {teamOverdueCount > 0 && (
              <HeroBadge count={teamOverdueCount} label={`team task${teamOverdueCount !== 1 ? "s" : ""} overdue`} color="#F87171" bg="rgba(248,113,113,0.15)" />
            )}
            {teamOverdueCount === 0 && teamPendingCount > 0 && (
              <HeroBadge count={teamPendingCount} label="team tasks on track" color="#6EE7B7" bg="rgba(110,231,183,0.15)" />
            )}
            {myOverdueCount > 0 && (
              <HeroBadge count={myOverdueCount} label={`of mine overdue`} color="#FCD34D" bg="rgba(252,211,77,0.12)" />
            )}
            {myOverdueCount === 0 && myTodayCount > 0 && (
              <HeroBadge count={myTodayCount} label="due today" color="#FCD34D" bg="rgba(252,211,77,0.12)" />
            )}
            {!hasTeamIssues && !hasMyIssues && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 12px", borderRadius: "20px", backgroundColor: "rgba(110,231,183,0.15)" }}>
                <span style={{ fontSize: "13px" }}>✓</span>
                <span style={{ fontSize: "12px", color: "#6EE7B7", fontWeight: 600 }}>All clear — no overdue items</span>
              </div>
            )}
          </div>
        </div>

        {/* Clock + quick action */}
        <div style={{ position: "relative", textAlign: isMobile ? "left" : "right", flexShrink: 0 }}>
          <div style={{ fontSize: isMobile ? "36px" : "48px", fontWeight: 700, fontFamily: "monospace", color: "white", letterSpacing: "2px", lineHeight: 1 }}>
            {clockStr("Asia/Karachi")}
          </div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginTop: "4px", textTransform: "uppercase" }}>
            Pakistan Standard Time
          </div>
          <button
            onClick={() => router.push(deptDashHref)}
            style={{ marginTop: "14px", padding: "9px 20px", backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: RADII.PILL, color: "white", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
          >
            {department || "Department"} Dashboard →
          </button>
        </div>
      </div>

      <div style={{ padding: isMobile ? "0 12px" : "0 20px" }}>

        {/* ── ROW 1: Team Pulse + My Tasks ─────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: col2, gap, marginBottom: gap }}>

          {/* Team Pulse */}
          <Card accentColor={hasTeamIssues ? RED : GREEN}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <CardLabel style={{ marginBottom: 0 }} color={hasTeamIssues ? RED : GREEN}>
                👥 Team Pulse — Overdue
              </CardLabel>
              {teamOverdueCount > 0 && (
                <span style={{ fontSize: "11px", fontWeight: 700, backgroundColor: DANGER_SOFT, color: RED, padding: "3px 10px", borderRadius: "20px" }}>
                  {teamOverdueCount} overdue
                </span>
              )}
            </div>

            {teamOverdueTasks.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" }}>
                <div style={{ fontSize: "15px" }}>✅</div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "#059669" }}>No overdue team tasks</div>
                <div style={{ fontSize: "12px", color: INK_400 }}>
                  {teamPendingCount} task{teamPendingCount !== 1 ? "s" : ""} active · {teamCompletedMonth} completed this month
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
                  {teamOverdueTasks.map((t) => {
                    const days = t.due_date ? daysOverdue(t.due_date) : 0;
                    const isCritical = days >= 7;
                    return (
                      <div key={t.id} style={{
                        display: "flex", gap: "10px", alignItems: "flex-start",
                        padding: "8px 10px", borderRadius: "8px",
                        backgroundColor: isCritical ? DANGER_SOFT : CANVAS,
                        borderLeft: `3px solid ${isCritical ? RED : AMBER}`,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, lineHeight: 1.3, marginBottom: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.description}
                          </div>
                          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                            {t.assigned_to && (
                              <span style={{ fontSize: "11px", color: SLATE, fontWeight: 500 }}>
                                {t.assigned_to.split(" ")[0]}
                              </span>
                            )}
                            {t.priority && (
                              <span style={{ fontSize: "10px", fontWeight: 700, color: t.priority === "High" ? RED : t.priority === "Medium" ? AMBER : SLATE }}>
                                {t.priority}
                              </span>
                            )}
                          </div>
                        </div>
                        <span style={{
                          fontSize: "11px", fontWeight: 700, flexShrink: 0,
                          color: isCritical ? RED : AMBER,
                          backgroundColor: isCritical ? "rgba(239,68,68,0.1)" : "rgba(251,191,36,0.15)",
                          padding: "2px 8px", borderRadius: "12px",
                        }}>
                          {days}d
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "10px", borderTop: `1px solid ${HAIRLINE}` }}>
                  <span style={{ fontSize: "12px", color: INK_400 }}>
                    {teamPendingCount} active · {teamCompletedMonth} done this month
                  </span>
                  <a href="/tasks" style={{ fontSize: "12px", color: BLUE, fontWeight: 600, textDecoration: "none" }}>
                    All tasks →
                  </a>
                </div>
              </>
            )}
          </Card>

          {/* My Tasks */}
          <Card accentColor={myOverdueCount > 0 ? AMBER : (myTodayCount > 0 ? BLUE : GREEN)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <CardLabel style={{ marginBottom: 0 }} color={myOverdueCount > 0 ? AMBER : BLUE}>
                📋 My Tasks
              </CardLabel>
              {(myOverdueCount > 0 || myTodayCount > 0) && (
                <span style={{ fontSize: "11px", fontWeight: 700, backgroundColor: myOverdueCount > 0 ? WARNING_SOFT : SUCCESS_SOFT, color: myOverdueCount > 0 ? AMBER : GREEN, padding: "3px 10px", borderRadius: "20px" }}>
                  {myOverdueCount > 0 ? `${myOverdueCount} overdue` : `${myTodayCount} today`}
                </span>
              )}
            </div>

            {myTasks.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "15px" }}>✅</div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "#059669" }}>You're all caught up</div>
                <div style={{ fontSize: "12px", color: INK_400 }}>No tasks overdue or due today</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
                  {myTasks.map((t) => {
                    const isOverdue = t.due_date ? t.due_date < today : false;
                    const isToday   = t.due_date === today;
                    const days = t.due_date && isOverdue ? daysOverdue(t.due_date) : 0;
                    return (
                      <div key={t.id} style={{
                        display: "flex", gap: "8px", alignItems: "flex-start",
                        padding: "7px 10px", borderRadius: "7px",
                        backgroundColor: isOverdue ? WARNING_SOFT : (isToday ? "rgba(59,130,246,0.06)" : CANVAS),
                        borderLeft: `3px solid ${isOverdue ? AMBER : (isToday ? BLUE : SLATE)}`,
                      }}>
                        <PriorityDot priority={t.priority} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 500, color: NAVY, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.description}
                          </div>
                          <div style={{ fontSize: "11px", color: isOverdue ? AMBER : (isToday ? BLUE : INK_400), fontWeight: 600, marginTop: "2px" }}>
                            {isOverdue ? `${days}d overdue` : "Due today"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <a href="/tasks" style={{ fontSize: "12px", color: BLUE, fontWeight: 600, textDecoration: "none", paddingTop: "10px", borderTop: `1px solid ${HAIRLINE}`, display: "block" }}>
                  View all my tasks →
                </a>
              </>
            )}
          </Card>
        </div>

        {/* ── ROW 2: Team stats + Dept KPI + Quick links ───────── */}
        <div style={{ display: "grid", gridTemplateColumns: col3, gap, marginBottom: gap }}>

          {/* Team health summary */}
          <Card accentColor={BLUE}>
            <CardLabel color={BLUE}>📊 Team Health</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <HealthRow label="Overdue" value={teamOverdueCount} color={teamOverdueCount > 0 ? RED : GREEN} total={teamOverdueCount + teamPendingCount} />
              <HealthRow label="Active" value={teamPendingCount} color={BLUE} total={teamOverdueCount + teamPendingCount} />
              <div style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: "10px", marginTop: "2px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", color: INK_400, fontWeight: 500 }}>Completed this month</span>
                  <span style={{ fontSize: "15px", fontWeight: 800, color: GREEN }}>{teamCompletedMonth}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Department quick-access */}
          <Card accentColor={NAVY}>
            <CardLabel color={NAVY}>🏢 {department || "Department"}</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
              <QuickLink href={deptDashHref} label="Department Dashboard" icon="📈" />
              <QuickLink href="/tasks" label="All Team Tasks" icon="✅" />
              <QuickLink href="/meetings" label="Meetings & Minutes" icon="🗓" />
              <QuickLink href="/my-minutes" label="My Minutes" icon="📝" />
            </div>
          </Card>

          {/* My task breakdown */}
          <Card accentColor={myOverdueCount > 0 ? AMBER : GREEN}>
            <CardLabel color={myOverdueCount > 0 ? AMBER : GREEN}>🙋 My Overview</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <HealthRow label="Overdue" value={myOverdueCount} color={myOverdueCount > 0 ? RED : GREEN} />
              <HealthRow label="Due today" value={myTodayCount} color={myTodayCount > 0 ? AMBER : SLATE} />
            </div>
            <a href="/tasks" style={{ fontSize: "12px", color: BLUE, fontWeight: 600, textDecoration: "none", marginTop: "auto", paddingTop: "14px" }}>
              Open task list →
            </a>
          </Card>
        </div>

      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MEMBER LAYOUT
   ═══════════════════════════════════════════════════════════════ */
function MemberLayout({
  data,
  weather,
  isMobile,
  router,
  clockStr,
  shortTime,
  wmo: wmoFn,
}: {
  data: WelcomeData;
  weather: Weather | null;
  isMobile: boolean;
  router: ReturnType<typeof useRouter>;
  clockStr: (tz: string) => string;
  shortTime: (tz: string) => string;
  wmo: (code: number) => [string, string];
}) {
  const {
    firstName = "",
    myOverdueCount = 0,
    myTodayCount = 0,
    myUpcomingCount = 0,
    myTasks = [],
  } = data;

  const today = todayISO();
  const gap = "12px";

  const overdueTasks  = myTasks.filter(t => t.due_date && t.due_date < today);
  const todayTasks    = myTasks.filter(t => t.due_date === today);
  const upcomingTasks = myTasks.filter(t => t.due_date && t.due_date > today);

  const hasAnyTasks = myTasks.length > 0;

  return (
    <div style={{ backgroundColor: CANVAS, minHeight: "100vh", paddingBottom: "40px" }}>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #1B2B40 60%, #1A3350 100%)`,
        padding: isMobile ? "28px 18px 24px" : "36px 36px 30px",
        marginBottom: "20px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: "16px",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", right: isMobile ? "-60px" : "180px", top: "-80px", width: "260px", height: "260px", borderRadius: "50%", background: "rgba(59,76,202,0.10)", pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>{longDate()}</div>
          <div style={{ fontSize: isMobile ? "26px" : "34px", fontWeight: 800, color: "white", lineHeight: 1.2 }}>
            {greeting()}{firstName ? `, ${firstName}` : ""}.
          </div>
          <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", marginTop: "6px" }}>Here's your task view for today.</div>

          <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
            {myOverdueCount > 0 && (
              <HeroBadge count={myOverdueCount} label={`overdue task${myOverdueCount !== 1 ? "s" : ""}`} color="#F87171" bg="rgba(248,113,113,0.15)" />
            )}
            {myTodayCount > 0 && (
              <HeroBadge count={myTodayCount} label={`due today`} color="#FCD34D" bg="rgba(252,211,77,0.12)" />
            )}
            {myUpcomingCount > 0 && (
              <HeroBadge count={myUpcomingCount} label="coming up" color="#93C5FD" bg="rgba(147,197,253,0.12)" />
            )}
            {myOverdueCount === 0 && myTodayCount === 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 12px", borderRadius: "20px", backgroundColor: "rgba(110,231,183,0.15)" }}>
                <span style={{ fontSize: "13px" }}>✓</span>
                <span style={{ fontSize: "12px", color: "#6EE7B7", fontWeight: 600 }}>Nothing overdue — great work!</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ position: "relative", textAlign: isMobile ? "left" : "right", flexShrink: 0 }}>
          <div style={{ fontSize: isMobile ? "36px" : "48px", fontWeight: 700, fontFamily: "monospace", color: "white", letterSpacing: "2px", lineHeight: 1 }}>
            {clockStr("Asia/Karachi")}
          </div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginTop: "4px", textTransform: "uppercase" }}>
            Pakistan Standard Time
          </div>
          <button
            onClick={() => router.push("/tasks")}
            style={{ marginTop: "14px", padding: "9px 20px", backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: RADII.PILL, color: "white", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
          >
            Open Task List →
          </button>
        </div>
      </div>

      <div style={{ padding: isMobile ? "0 12px" : "0 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "3fr 2fr", gap }}>

          {/* ── Left: My Tasks ───────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap }}>

            {/* Overdue */}
            {overdueTasks.length > 0 && (
              <Card accentColor={RED}>
                <CardLabel color={RED}>
                  🚨 Overdue
                  <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 700, backgroundColor: DANGER_SOFT, color: RED, padding: "2px 8px", borderRadius: "12px" }}>
                    {overdueTasks.length}
                  </span>
                </CardLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {overdueTasks.map((t) => {
                    const days = t.due_date ? daysOverdue(t.due_date) : 0;
                    return (
                      <div key={t.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "8px 10px", borderRadius: "8px", backgroundColor: DANGER_SOFT, borderLeft: `3px solid ${RED}` }}>
                        <PriorityDot priority={t.priority} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, lineHeight: 1.3, marginBottom: "2px" }}>{t.description}</div>
                          <div style={{ fontSize: "11px", color: RED, fontWeight: 700 }}>{days} day{days !== 1 ? "s" : ""} overdue</div>
                        </div>
                        {t.priority && (
                          <span style={{ fontSize: "10px", fontWeight: 700, color: t.priority === "High" ? RED : AMBER, flexShrink: 0 }}>{t.priority}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Due today */}
            {todayTasks.length > 0 && (
              <Card accentColor={AMBER}>
                <CardLabel color={AMBER}>
                  📅 Due Today
                  <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 700, backgroundColor: WARNING_SOFT, color: AMBER, padding: "2px 8px", borderRadius: "12px" }}>
                    {todayTasks.length}
                  </span>
                </CardLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {todayTasks.map((t) => (
                    <div key={t.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "8px 10px", borderRadius: "8px", backgroundColor: WARNING_SOFT, borderLeft: `3px solid ${AMBER}` }}>
                      <PriorityDot priority={t.priority} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, lineHeight: 1.3 }}>{t.description}</div>
                        {t.priority && (
                          <div style={{ fontSize: "11px", color: t.priority === "High" ? RED : AMBER, fontWeight: 600, marginTop: "2px" }}>{t.priority} priority</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Upcoming next 7 days */}
            {upcomingTasks.length > 0 && (
              <Card accentColor={BLUE}>
                <CardLabel color={BLUE}>
                  🔜 Upcoming — Next 7 Days
                  <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 700, backgroundColor: SUCCESS_SOFT, color: BLUE, padding: "2px 8px", borderRadius: "12px" }}>
                    {upcomingTasks.length}
                  </span>
                </CardLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {upcomingTasks.map((t) => {
                    const days = t.due_date ? daysUntil(t.due_date) : 0;
                    const dueLabel = days === 1 ? "Tomorrow" : `In ${days} days`;
                    return (
                      <div key={t.id} style={{ display: "flex", gap: "8px", alignItems: "center", padding: "7px 10px", borderRadius: "7px", backgroundColor: CANVAS }}>
                        <PriorityDot priority={t.priority} />
                        <div style={{ flex: 1, minWidth: 0, fontSize: "13px", fontWeight: 500, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.description}
                        </div>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: BLUE, flexShrink: 0, backgroundColor: "rgba(59,130,246,0.1)", padding: "2px 7px", borderRadius: "10px" }}>
                          {dueLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* All clear state */}
            {!hasAnyTasks && (
              <Card accentColor={GREEN}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "30px 20px", gap: "12px", textAlign: "center" }}>
                  <div style={{ fontSize: "40px" }}>✅</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#059669" }}>All caught up!</div>
                  <div style={{ fontSize: "13px", color: INK_400 }}>No tasks overdue, due today, or in the next 7 days.</div>
                  <a href="/tasks" style={{ fontSize: "13px", color: BLUE, fontWeight: 600, textDecoration: "none" }}>View all tasks →</a>
                </div>
              </Card>
            )}

            {/* Footer link */}
            {hasAnyTasks && (
              <div style={{ textAlign: "right" }}>
                <a href="/tasks" style={{ fontSize: "12px", color: BLUE, fontWeight: 600, textDecoration: "none" }}>View full task list →</a>
              </div>
            )}
          </div>

          {/* ── Right: Clocks + Weather ───────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap }}>

            {/* World Clocks */}
            <Card accentColor={NAVY}>
              <CardLabel color={NAVY}>🌍 World Clocks</CardLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                {CLOCKS.map(c => (
                  <div key={c.tz} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px", lineHeight: 1 }}>{c.flag}</span>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: NAVY }}>{c.city}</div>
                    </div>
                    <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "monospace", color: "white", backgroundColor: c.color, padding: "2px 8px", borderRadius: "6px" }}>
                      {shortTime(c.tz)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Weather */}
            <Card accentColor={BLUE}>
              <CardLabel color={BLUE}>🌤 Weather</CardLabel>
              {weather ? (
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: SLATE, marginBottom: "8px" }}>{weather.city}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "36px", lineHeight: 1 }}>{wmoFn(weather.code)[1]}</span>
                    <span style={{ fontSize: "34px", fontWeight: 800, color: NAVY, lineHeight: 1 }}>{weather.temp}°C</span>
                  </div>
                  <div style={{ fontSize: "13px", color: SLATE, marginTop: "4px", fontWeight: 500 }}>{wmoFn(weather.code)[0]}</div>
                  <div style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
                    <Chip label={`Feels ${weather.apparent}°C`} color={BLUE} />
                    <Chip label={`${weather.humidity}% humidity`} color={SLATE} />
                  </div>
                </div>
              ) : (
                <div style={{ color: INK_400, fontSize: "13px" }}>Locating…</div>
              )}
            </Card>

            {/* Quick links */}
            <Card accentColor={SLATE}>
              <CardLabel color={SLATE}>🔗 Quick Links</CardLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <QuickLink href="/tasks"    label="My Tasks"    icon="✅" />
                <QuickLink href="/calendar" label="Calendar"    icon="📅" />
                <QuickLink href="/profile"  label="My Profile"  icon="👤" />
              </div>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── sub-components ──────────────────────────────────────────── */

function HeroBadge({ count, label, color, bg }: { count: number; label: string; color: string; bg: string }) {
  if (count === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "20px", backgroundColor: bg }}>
      <span style={{ fontSize: "13px", fontWeight: 800, color }}>{count}</span>
      <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>{label}</span>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: "11px", fontWeight: 600, padding: "3px 8px", borderRadius: "20px", color, backgroundColor: color === BLUE ? "#EEF1FC" : COLOURS.HAIRLINE }}>
      {label}
    </span>
  );
}

function StatRow({ colour, count, label, empty }: { colour: string; count: number; label: string; empty: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: "8px", backgroundColor: CANVAS }}>
      <span style={{ fontSize: "13px", color: count > 0 ? colour : "#059669", fontWeight: 600 }}>
        {count > 0 ? label : empty}
      </span>
      {count > 0 && (
        <span style={{ fontSize: "18px", fontWeight: 800, color: colour }}>{count}</span>
      )}
    </div>
  );
}

function HealthRow({ label, value, color, total }: { label: string; value: number; color: string; total?: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: total ? "5px" : "0" }}>
        <span style={{ fontSize: "12px", color: INK_400, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: "16px", fontWeight: 800, color }}>{value}</span>
      </div>
      {total !== undefined && total > 0 && (
        <div style={{ height: "4px", backgroundColor: HAIRLINE, borderRadius: "2px" }}>
          <div style={{ height: "100%", width: `${pct}%`, backgroundColor: color, borderRadius: "2px", transition: "width 0.4s ease" }} />
        </div>
      )}
    </div>
  );
}

function QuickLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <a href={href} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px", borderRadius: "8px", backgroundColor: CANVAS, border: `1px solid ${HAIRLINE}`, textDecoration: "none", transition: "background 0.15s" }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#EEF1FC"; }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = CANVAS; }}
    >
      <span style={{ fontSize: "16px" }}>{icon}</span>
      <span style={{ fontSize: "13px", fontWeight: 600, color: NAVY }}>{label}</span>
      <span style={{ marginLeft: "auto", color: INK_400, fontSize: "12px" }}>→</span>
    </a>
  );
}
