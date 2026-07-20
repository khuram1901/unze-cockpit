"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch, supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";

const { NAVY, SLATE, HAIRLINE, GREEN, AMBER, RED, BLUE, INK_400, CANVAS, SUCCESS_SOFT, DANGER_SOFT, WARNING_SOFT } = COLOURS;

/* ─── types ─────────────────────────────────────────────────── */
type CalEvent  = { start: string; end: string; title?: string };
type NewsStory = { title: string; link: string; ago: string; source: string; color: string };
type FxRates   = { USD: number; GBP: number; CNY: number };
type Weather   = { temp: number; apparent: number; humidity: number; code: number; city: string };

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

const DAY_COLORS = [GREEN, BLUE, SLATE];

/* ─── card shell ──────────────────────────────────────────────── */
function Card({ children, accentColor, style }: { children: React.ReactNode; accentColor?: string; style?: React.CSSProperties }) {
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

function CardLabel({ children, color, style }: { children: React.ReactNode; color?: string; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: color ?? INK_400, marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px", ...style }}>
      {children}
    </div>
  );
}

/* ─── main page ───────────────────────────────────────────────── */
export default function WelcomePage() {
  const router   = useRouter();
  const isMobile = useMobile();
  const tickRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const [firstName,    setFirstName]    = useState("");
  const [overdueCount, setOverdueCount] = useState(0);
  const [machineCount, setMachineCount] = useState(0);
  const [calEvents,    setCalEvents]    = useState<CalEvent[]>([]);
  const [news,         setNews]         = useState<NewsStory[]>([]);
  const [weather,      setWeather]      = useState<Weather | null>(null);
  const [fx,           setFx]           = useState<FxRates | null>(null);
  const [tick,         setTick]         = useState(0);
  const [expandedDay,  setExpandedDay]  = useState<number | null>(null); // null = all collapsed, 0/1/2 = that day expanded
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
      const [summaryRes, calRes, fxRes, newsRes] = await Promise.all([
        authFetch("/api/welcome"),
        authFetch(`/api/calendar/freebusy?date=${today}`),
        authFetch("/api/fx/multi"),
        authFetch("/api/welcome/news"),
      ]);
      if (!active) return;

      if (summaryRes.ok) {
        const s = await summaryRes.json();
        setFirstName(s.firstName || "");
        setOverdueCount(s.overdueTaskCount ?? 0);
        setMachineCount(s.machineIssueCount ?? 0);
      }
      if (calRes.ok) {
        const c = await calRes.json();
        const cutoff = dayOffset(3);
        setCalEvents(
          ((c.busy || []) as CalEvent[])
            .filter(e => e.start.slice(0, 10) >= today && e.start.slice(0, 10) < cutoff)
            .sort((a, b) => a.start.localeCompare(b.start))
        );
      }
      if (fxRes.ok)  { const f = await fxRes.json();  setFx(f); }
      if (newsRes.ok){ const n = await newsRes.json(); setNews(n.stories || []); }

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

  /* ── layout ─────────────────────────────────────────────────── */
  const gap   = "12px";
  const col4  = isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr";
  const col3  = isMobile ? "1fr" : "1fr 1fr 1fr";
  const col2  = isMobile ? "1fr" : "5fr 3fr";
  void tick; // consumed indirectly via clockStr/shortTime which re-evaluate each render

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
          {/* subtle decorative circle */}
          <div style={{
            position: "absolute", right: isMobile ? "-60px" : "120px", top: "-80px",
            width: "260px", height: "260px", borderRadius: "50%",
            background: "rgba(59,76,202,0.12)", pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", right: isMobile ? "10px" : "60px", bottom: "-40px",
            width: "140px", height: "140px", borderRadius: "50%",
            background: "rgba(59,76,202,0.08)", pointerEvents: "none",
          }} />

          <div style={{ position: "relative" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>
              {longDate()}
            </div>
            <div style={{ fontSize: isMobile ? "26px" : "34px", fontWeight: 800, color: "white", lineHeight: 1.2 }}>
              {greeting()}{firstName ? `, ${firstName}` : ""}.
            </div>
            <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", marginTop: "6px" }}>
              Here's your morning brief.
            </div>

            {/* Quick alert strip */}
            <div style={{ display: "flex", gap: "10px", marginTop: "18px", flexWrap: "wrap" }}>
              <HeroBadge count={overdueCount} label="overdue" color="#F87171" bg="rgba(248,113,113,0.15)" />
              <HeroBadge count={machineCount} label={machineCount === 1 ? "machine issue" : "machine issues"} color="#FCD34D" bg="rgba(252,211,77,0.12)" />
            </div>
          </div>

          {/* Live clock */}
          <div style={{ position: "relative", textAlign: isMobile ? "left" : "right", flexShrink: 0 }}>
            <div style={{ fontSize: isMobile ? "38px" : "52px", fontWeight: 700, fontFamily: "monospace", color: "white", letterSpacing: "2px", lineHeight: 1 }}>
              {clockStr("Asia/Karachi")}
            </div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginTop: "4px", textTransform: "uppercase" }}>
              Pakistan Standard Time · PKT
            </div>
            <button
              onClick={() => router.replace("/home")}
              style={{
                marginTop: "14px", padding: "9px 22px",
                backgroundColor: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: RADII.PILL, color: "white",
                fontSize: "13px", fontWeight: 600, cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              Open Dashboard →
            </button>
          </div>
        </div>

        <div style={{ padding: isMobile ? "0 12px" : "0 20px" }}>

          {/* ── ROW 1: clocks + weather + FX + stats ─────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: col4, gap, marginBottom: gap }}>

            {/* World Clocks */}
            <Card accentColor={NAVY}>
              <CardLabel color={NAVY}>🌍 World Clocks</CardLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                {CLOCKS.map(c => (
                  <div key={c.tz} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px", lineHeight: 1 }}>{c.flag}</span>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: NAVY }}>{c.city}</div>
                      </div>
                    </div>
                    <div style={{
                      fontSize: "15px", fontWeight: 700, fontFamily: "monospace",
                      color: "white", backgroundColor: c.color,
                      padding: "2px 8px", borderRadius: "6px",
                    }}>
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

            {/* Currency Exchange */}
            <Card accentColor={GREEN} style={{ gridColumn: isMobile ? "span 2" : "span 1" }}>
              <CardLabel color={GREEN}>💱 PKR Exchange</CardLabel>
              {fx ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {CURRENCIES.map(c => (
                    <div key={c.code} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 10px", borderRadius: "8px",
                      backgroundColor: CANVAS,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "18px" }}>{c.flag}</span>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: c.color }}>{c.code}</div>
                          <div style={{ fontSize: "10px", color: INK_400 }}>{c.label}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "16px", fontWeight: 800, fontFamily: "monospace", color: NAVY }}>
                          ₨ {fx[c.key].toFixed(0)}
                        </div>
                        <div style={{ fontSize: "10px", color: INK_400 }}>per {c.symbol}1</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: INK_400, fontSize: "13px" }}>Loading rates…</div>
              )}
            </Card>

            {/* Quick Stats */}
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
                    <span style={{
                      marginLeft: "auto", fontSize: "10px", fontWeight: 700,
                      backgroundColor: color, color: "white",
                      padding: "1px 7px", borderRadius: "20px",
                    }}>
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
                          <div key={i} style={{
                            display: "flex", gap: "10px", alignItems: "flex-start",
                            padding: "6px 8px", borderRadius: "6px",
                            backgroundColor: i % 2 === 0 ? CANVAS : "transparent",
                          }}>
                            <span style={{
                              fontSize: "10px", fontWeight: 600, color: "white",
                              backgroundColor: color, padding: "2px 6px",
                              borderRadius: "4px", flexShrink: 0, marginTop: "1px",
                              minWidth: "70px", textAlign: "center",
                            }}>{time}</span>
                            <span style={{ fontSize: "13px", color: NAVY, fontWeight: 500, lineHeight: 1.35 }}>
                              {ev.title || "Busy"}
                            </span>
                          </div>
                        );
                      })}
                      {events.length > PREVIEW && (
                        <button
                          onClick={() => setExpandedDay(isExpanded ? null : offset)}
                          style={{
                            marginTop: "4px", background: "none", border: "none",
                            fontSize: "12px", fontWeight: 600, color: color,
                            cursor: "pointer", textAlign: "left", padding: "2px 8px",
                          }}
                        >
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
                <button
                  onClick={() => setNewsExpanded(v => !v)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: "12px", fontWeight: 600, color: NAVY,
                    padding: "2px 6px",
                  }}
                >
                  {newsExpanded ? "▲ Show less" : "▼ Show more"}
                </button>
              )}
            </div>
            {news.length === 0 ? (
              <div style={{ color: INK_400, fontSize: "13px" }}>Loading headlines…</div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                gap: "0",
              }}>
                {(newsExpanded ? news : news.slice(0, 6)).map((s, i) => (
                  <a
                    key={i}
                    href={s.link}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      textDecoration: "none",
                      display: "block",
                      padding: "10px 14px",
                      borderBottom: `1px solid ${HAIRLINE}`,
                      borderRight: (!isMobile && (i % 3 !== 2)) ? `1px solid ${HAIRLINE}` : "none",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = CANVAS; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
                      <span style={{
                        fontSize: "9px", fontWeight: 700, padding: "2px 6px",
                        borderRadius: "4px", color: "white",
                        backgroundColor: s.color, letterSpacing: "0.05em",
                        textTransform: "uppercase", flexShrink: 0,
                      }}>{s.source}</span>
                      {s.ago && <span style={{ fontSize: "10px", color: INK_400 }}>{s.ago}</span>}
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, lineHeight: 1.4 }}>
                      {s.title}
                    </div>
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

/* ─── sub-components ──────────────────────────────────────────── */

function HeroBadge({ count, label, color, bg }: { count: number; label: string; color: string; bg: string }) {
  if (count === 0) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      padding: "4px 10px", borderRadius: "20px", backgroundColor: bg,
    }}>
      <span style={{ fontSize: "13px", fontWeight: 800, color }}>{count}</span>
      <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>{label}</span>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: "11px", fontWeight: 600, padding: "3px 8px",
      borderRadius: "20px", color,
      backgroundColor: color === BLUE ? "#EEF1FC" : COLOURS.HAIRLINE,
    }}>{label}</span>
  );
}

function StatRow({ colour, count, label, empty }: { colour: string; count: number; label: string; empty: string }) {
  const ok = count === 0;
  const bg = ok ? SUCCESS_SOFT : colour === RED ? DANGER_SOFT : WARNING_SOFT;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "8px", backgroundColor: bg }}>
      <span style={{
        width: "26px", height: "26px", borderRadius: "50%",
        backgroundColor: ok ? GREEN : colour, color: "white",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: "12px", fontWeight: 700, flexShrink: 0,
      }}>{ok ? "✓" : count}</span>
      <span style={{ fontSize: "13px", color: ok ? GREEN : NAVY, fontWeight: 600 }}>
        {ok ? empty : label}
      </span>
    </div>
  );
}
