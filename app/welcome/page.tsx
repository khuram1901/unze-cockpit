"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch, supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";

const { NAVY, SLATE, HAIRLINE, GREEN, AMBER, RED, BLUE, INK_400, CANVAS } = COLOURS;

/* ─── types ─────────────────────────────────────────────────── */
type CalEvent  = { start: string; end: string; title?: string };
type NewsStory = { title: string; link: string; ago: string };
type Weather   = { temp: number; apparent: number; humidity: number; code: number; city: string };

/* ─── WMO weather code map ──────────────────────────────────── */
const WMO: Record<number, [string, string]> = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
  45: ["Foggy", "🌫️"], 48: ["Icy fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌦️"],
  61: ["Slight rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  71: ["Light snow", "❄️"], 73: ["Snow", "❄️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨️"],
  80: ["Rain showers", "🌦️"], 81: ["Showers", "🌦️"], 82: ["Heavy showers", "⛈️"],
  85: ["Snow showers", "🌨️"], 86: ["Heavy snow showers", "🌨️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm + hail", "⛈️"], 99: ["Severe thunderstorm", "⛈️"],
};
function wmoLabel(code: number): [string, string] {
  return WMO[code] ?? ["Unknown", "🌡️"];
}

/* ─── world clock config ────────────────────────────────────── */
const CLOCKS = [
  { city: "Lahore",   tz: "Asia/Karachi",     flag: "🇵🇰", abbr: "PKT" },
  { city: "London",   tz: "Europe/London",    flag: "🇬🇧", abbr: "BST" },
  { city: "Dubai",    tz: "Asia/Dubai",        flag: "🇦🇪", abbr: "GST" },
  { city: "New York", tz: "America/New_York",  flag: "🇺🇸", abbr: "EST" },
];

/* ─── helpers ────────────────────────────────────────────────── */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function longDate(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function clockStr(tz: string): string {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz });
}

function shortTime(tz: string): string {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}

function fmtEvtTime(iso: string): string {
  if (!iso.includes("T")) return "All day";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });
}

function todayStr()    { return new Date().toISOString().slice(0, 10); }
function tomorrowStr() { return new Date(Date.now() + 86400000).toISOString().slice(0, 10); }

/* ─── card shell ─────────────────────────────────────────────── */
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      backgroundColor: "white",
      border: `1px solid ${HAIRLINE}`,
      borderRadius: RADII.CARD,
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      ...style,
    }}>
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: INK_400, marginBottom: "6px" }}>
      {children}
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────────── */
export default function WelcomePage() {
  const router  = useRouter();
  const isMobile = useMobile();
  const tickRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  /* state */
  const [firstName,   setFirstName]   = useState("");
  const [overdueCount, setOverdueCount] = useState(0);
  const [machineCount, setMachineCount] = useState(0);
  const [calEvents,   setCalEvents]   = useState<CalEvent[]>([]);
  const [news,        setNews]        = useState<NewsStory[]>([]);
  const [weather,     setWeather]     = useState<Weather | null>(null);
  const [fxRate,      setFxRate]      = useState<number | null>(null);
  const [tick,        setTick]        = useState(0);        // drives live clocks

  /* live clock — 1-second interval */
  useEffect(() => {
    tickRef.current = setInterval(() => setTick(n => n + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  /* weather via browser geolocation → Open-Meteo (free, no key) */
  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&timezone=auto`;
      const weatherRes = await fetch(url);
      const geoRes     = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
      const [wd, gd]   = await Promise.all([weatherRes.json(), geoRes.json()]);
      const city = gd?.address?.city || gd?.address?.town || gd?.address?.village || "Your location";
      setWeather({
        temp:       Math.round(wd.current.temperature_2m),
        apparent:   Math.round(wd.current.apparent_temperature),
        humidity:   wd.current.relative_humidity_2m,
        code:       wd.current.weather_code,
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

      // Fire all API calls in parallel
      const today = todayStr();
      const [summaryRes, calRes, fxRes, newsRes] = await Promise.all([
        authFetch("/api/welcome"),
        authFetch(`/api/calendar/freebusy?date=${today}`),
        authFetch("/api/fx/gbp-pkr"),
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
        const cutoff = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
        setCalEvents(
          ((c.busy || []) as CalEvent[])
            .filter(e => e.start.slice(0, 10) >= today && e.start.slice(0, 10) < cutoff)
            .sort((a, b) => a.start.localeCompare(b.start))
        );
      }
      if (fxRes.ok) {
        const fx = await fxRes.json();
        setFxRate(fx.rate ?? null);
      }
      if (newsRes.ok) {
        const n = await newsRes.json();
        setNews(n.stories || []);
      }

      // Geolocation (async, non-blocking)
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
          ()  => fetchWeather(31.5204, 74.3587) // fallback: Lahore
        );
      } else {
        fetchWeather(31.5204, 74.3587);
      }
    }

    load();
    return () => { active = false; };
  }, [router, fetchWeather]);

  const todayEvts    = calEvents.filter(e => e.start.slice(0, 10) === todayStr());
  const tomorrowEvts = calEvents.filter(e => e.start.slice(0, 10) === tomorrowStr());

  /* ── hero ──────────────────────────────────────────────────── */
  const heroClockStr = clockStr("Asia/Karachi");

  /* ── layout constants ────────────────────────────────────────── */
  const gap = "12px";
  const col4 = isMobile ? "1fr" : "1fr 1fr 1fr 1fr";
  const col2 = isMobile ? "1fr" : "3fr 2fr";
  const pagePad = isMobile ? "0 0 32px" : "0 0 40px";

  return (
    <AuthWrapper>
      <div style={{ backgroundColor: CANVAS, minHeight: "100vh", padding: pagePad }}>

        {/* ── HERO ─────────────────────────────────────────────── */}
        <div style={{
          backgroundColor: NAVY,
          padding: isMobile ? "28px 20px" : "36px 36px 32px",
          marginBottom: "20px",
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: "16px",
        }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px" }}>
              {longDate()}
            </div>
            <div style={{ fontSize: isMobile ? "28px" : "36px", fontWeight: 800, color: "white", lineHeight: 1.15 }}>
              {greeting()}{firstName ? `, ${firstName}` : ""}.
            </div>
            <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.45)", marginTop: "6px" }}>
              Here's your morning brief.
            </div>
          </div>

          {/* live Pakistan clock */}
          <div style={{ textAlign: isMobile ? "left" : "right", flexShrink: 0 }}>
            <div style={{
              fontSize: isMobile ? "36px" : "48px",
              fontWeight: 700,
              fontFamily: "monospace",
              color: "white",
              letterSpacing: "2px",
              lineHeight: 1,
            }}>
              {heroClockStr}
            </div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", marginTop: "4px", textTransform: "uppercase" }}>
              Pakistan Time (PKT)
            </div>
          </div>
        </div>

        <div style={{ padding: isMobile ? "0 12px" : "0 20px" }}>

          {/* ── ROW 1: 4 small widgets ──────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: col4, gap, marginBottom: gap }}>

            {/* World Clocks */}
            <Card>
              <CardLabel>🌍 World Clocks</CardLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {CLOCKS.map(c => (
                  <div key={c.tz} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                      <span style={{ fontSize: "16px" }}>{c.flag}</span>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: NAVY }}>{c.city}</div>
                        <div style={{ fontSize: "10px", color: INK_400 }}>{c.abbr}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: "16px", fontWeight: 700, fontFamily: "monospace", color: NAVY }}>
                      {shortTime(c.tz)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Weather */}
            <Card>
              <CardLabel>🌤 Weather</CardLabel>
              {weather ? (
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: SLATE, marginBottom: "8px" }}>{weather.city}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <span style={{ fontSize: "42px" }}>{wmoLabel(weather.code)[1]}</span>
                    <span style={{ fontSize: "32px", fontWeight: 800, color: NAVY }}>{weather.temp}°C</span>
                  </div>
                  <div style={{ fontSize: "13px", color: SLATE, marginTop: "4px" }}>
                    {wmoLabel(weather.code)[0]}
                  </div>
                  <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                    <span style={{ fontSize: "11px", color: INK_400 }}>Feels like <strong style={{ color: NAVY }}>{weather.apparent}°C</strong></span>
                    <span style={{ fontSize: "11px", color: INK_400 }}>Humidity <strong style={{ color: NAVY }}>{weather.humidity}%</strong></span>
                  </div>
                </div>
              ) : (
                <div style={{ color: INK_400, fontSize: "13px" }}>Locating…</div>
              )}
            </Card>

            {/* FX Rate */}
            <Card>
              <CardLabel>💷 GBP / PKR</CardLabel>
              {fxRate != null ? (
                <div>
                  <div style={{ fontSize: "36px", fontWeight: 800, color: NAVY, fontFamily: "monospace", lineHeight: 1.1 }}>
                    {fxRate.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "12px", color: SLATE, marginTop: "4px" }}>1 British Pound</div>
                  <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {[100, 500, 1000].map(gbp => (
                      <div key={gbp} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                        <span style={{ color: INK_400 }}>£{gbp.toLocaleString()}</span>
                        <span style={{ color: NAVY, fontWeight: 600 }}>₨{(gbp * fxRate).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ color: INK_400, fontSize: "13px" }}>Loading…</div>
              )}
            </Card>

            {/* Quick Stats */}
            <Card>
              <CardLabel>📋 At a Glance</CardLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <StatRow
                  colour={overdueCount > 0 ? RED : GREEN}
                  count={overdueCount}
                  label={overdueCount === 1 ? "overdue task" : "overdue tasks"}
                  empty="All tasks on track"
                />
                <StatRow
                  colour={machineCount > 0 ? AMBER : GREEN}
                  count={machineCount}
                  label={machineCount === 1 ? "machine issue" : "machine issues"}
                  empty="No machine issues"
                />
              </div>
              <div style={{ marginTop: "auto", paddingTop: "12px", borderTop: `1px solid ${HAIRLINE}` }}>
                <a href="/home" style={{ fontSize: "12px", color: BLUE, fontWeight: 600, textDecoration: "none" }}>
                  Open dashboard →
                </a>
              </div>
            </Card>
          </div>

          {/* ── ROW 2: calendar + news ────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: col2, gap, marginBottom: "20px" }}>

            {/* Calendar */}
            <Card>
              <CardLabel>📅 Your schedule</CardLabel>
              {calEvents.length === 0 ? (
                <div style={{ color: INK_400, fontSize: "13px" }}>No appointments today or tomorrow.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {todayEvts.length > 0 && (
                    <CalDay label="Today" events={todayEvts} />
                  )}
                  {todayEvts.length === 0 && (
                    <div style={{ fontSize: "13px", color: INK_400 }}>Nothing scheduled today.</div>
                  )}
                  {tomorrowEvts.length > 0 && (
                    <CalDay label="Tomorrow" events={tomorrowEvts} />
                  )}
                  {tomorrowEvts.length === 0 && (
                    <div style={{ fontSize: "13px", color: INK_400 }}>Nothing scheduled tomorrow.</div>
                  )}
                </div>
              )}
            </Card>

            {/* News */}
            <Card>
              <CardLabel>📰 BBC Business</CardLabel>
              {news.length === 0 ? (
                <div style={{ color: INK_400, fontSize: "13px" }}>Loading headlines…</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {news.map((s, i) => (
                    <a
                      key={i}
                      href={s.link}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        textDecoration: "none",
                        padding: "10px 0",
                        borderBottom: i < news.length - 1 ? `1px solid ${HAIRLINE}` : "none",
                        display: "block",
                      }}
                    >
                      <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, lineHeight: 1.4, marginBottom: "3px" }}>
                        {s.title}
                      </div>
                      {s.ago && (
                        <div style={{ fontSize: "11px", color: INK_400 }}>{s.ago}</div>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── CTA button ───────────────────────────────────── */}
          <button
            onClick={() => router.push("/home")}
            style={{
              display: "block",
              width: "100%",
              maxWidth: isMobile ? "100%" : "320px",
              padding: "14px 32px",
              backgroundColor: NAVY,
              color: "white",
              border: "none",
              borderRadius: RADII.PILL,
              fontSize: "15px",
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            Open Dashboard →
          </button>

        </div>
      </div>
    </AuthWrapper>
  );
}

/* ─── sub-components ─────────────────────────────────────────── */

function StatRow({ colour, count, label, empty }: { colour: string; count: number; label: string; empty: string }) {
  const positive = count === 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      {positive ? (
        <span style={{
          width: "28px", height: "28px", borderRadius: "50%",
          backgroundColor: COLOURS.SUCCESS_SOFT,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: "13px", color: GREEN, fontWeight: 700, flexShrink: 0,
        }}>✓</span>
      ) : (
        <span style={{
          width: "28px", height: "28px", borderRadius: "50%",
          backgroundColor: colour === RED ? COLOURS.DANGER_SOFT : COLOURS.WARNING_SOFT,
          color: colour,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: "13px", fontWeight: 700, flexShrink: 0,
        }}>{count}</span>
      )}
      <span style={{ fontSize: "13px", color: positive ? SLATE : NAVY, fontWeight: positive ? 400 : 600 }}>
        {positive ? empty : label}
      </span>
    </div>
  );
}

function CalDay({ label, events }: { label: string; events: CalEvent[] }) {
  return (
    <div>
      <div style={{ fontSize: "11px", fontWeight: 700, color: INK_400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        {events.map((ev, i) => {
          const start = fmtEvtTime(ev.start);
          const end   = fmtEvtTime(ev.end);
          const time  = start === "All day" ? "All day" : `${start} – ${end}`;
          return (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: "12px",
              padding: "8px 10px", borderRadius: "8px",
              backgroundColor: i % 2 === 0 ? COLOURS.CANVAS : "transparent",
            }}>
              <div style={{ minWidth: "90px", fontSize: "11px", fontWeight: 600, color: SLATE, paddingTop: "2px", flexShrink: 0 }}>
                {time}
              </div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, lineHeight: 1.4 }}>
                {ev.title || "Busy"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
