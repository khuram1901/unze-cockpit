"use client";

import {
  useCallback, useEffect, useRef, useState,
  type ReactNode, type CSSProperties,
} from "react";
import Link from "next/link";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch, supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { formatDateUK } from "../lib/dateUtils";

const {
  NAVY, SLATE, HAIRLINE, GREEN, AMBER, RED, BLUE,
  INK_400, INK_700, CANVAS, CARD_ALT,
  SUCCESS_SOFT, WARNING_SOFT, DANGER_SOFT,
} = COLOURS;
const BLUE_SOFT  = "#E8EBFC";
const PURPLE     = "#7C4CA5";
const PURPLE_SOFT = "#F2E8FA";

/* ─── types ──────────────────────────────────────────────────── */
type QuickLink   = { href: string; title: string; icon: string; color: string };
type TaskItem    = { id: string; description: string; due_date: string; priority: string; status: string; assigned_to?: string; assigned_to_email?: string; assigned_by?: string };
type TeamMember  = { name: string; email: string; overdueCount: number; todayCount: number };
type WelcomeData = {
  firstName:          string;
  name?:              string;
  role:               string | null;
  department:         string | null;
  photoUrl:           string | null;
  quickLinks:         QuickLink[];
  myOverdueCount:     number;
  myTodayCount:       number;
  myTomorrowCount:    number;
  myWeekCount:        number;
  myTasks:            TaskItem[];
  // Manager extras
  teamSize?:           number;
  teamOverdueCount?:   number;
  teamTodayCount?:     number;
  teamCompletedMonth?: number;
  teamOverdueTasks?:   TaskItem[];
  teamMemberStatus?:   TeamMember[];
  // Privileged extras
  groupOverdueCount?:  number;
  machineIssueCount?:  number;
};
type Weather = { temp: number; apparent: number; humidity: number; code: number; city: string };
type FxRates  = { USD: number; GBP: number; CNY: number };
type Holding  = { ticker: string; company_name: string; quantity: number; buy_price: number; current_price?: number };

/* ─── WMO weather codes ──────────────────────────────────────── */
const WMO: Record<number, [string, string]> = {
  0: ["Clear sky","☀️"],1:["Mainly clear","🌤️"],2:["Partly cloudy","⛅"],3:["Overcast","☁️"],
  45:["Foggy","🌫️"],48:["Icy fog","🌫️"],
  51:["Light drizzle","🌦️"],53:["Drizzle","🌦️"],55:["Heavy drizzle","🌦️"],
  61:["Slight rain","🌧️"],63:["Rain","🌧️"],65:["Heavy rain","🌧️"],
  71:["Light snow","❄️"],73:["Snow","❄️"],75:["Heavy snow","❄️"],
  80:["Showers","🌦️"],82:["Heavy showers","⛈️"],
  95:["Thunderstorm","⛈️"],96:["Thunderstorm + hail","⛈️"],
};
function wmo(code: number): [string, string] { return WMO[code] ?? ["Unknown","🌡️"]; }

/* ─── Motivational quotes (seeded by day-of-year) ───────────── */
const QUOTES = [
  ["The secret of getting ahead is getting started.","Mark Twain"],
  ["Leadership is not about being in charge. It is about taking care of those in your charge.","Simon Sinek"],
  ["Excellence is never an accident. It is the result of high intention and sincere effort.","Aristotle"],
  ["The best way to predict the future is to create it.","Peter Drucker"],
  ["Quality means doing it right when no one is looking.","Henry Ford"],
  ["Success is not final, failure is not fatal — it is the courage to continue that counts.","Winston Churchill"],
  ["The greatest glory in living lies not in never falling, but in rising every time we fall.","Nelson Mandela"],
  ["Management is doing things right; leadership is doing the right things.","Peter Drucker"],
  ["Coming together is a beginning. Keeping together is progress. Working together is success.","Henry Ford"],
  ["Perfection is not attainable, but if we chase perfection we can catch excellence.","Vince Lombardi"],
  ["Growth is never by mere chance; it is the result of forces working together.","James Cash Penney"],
  ["The measure of intelligence is the ability to change.","Albert Einstein"],
  ["Opportunities don't happen. You create them.","Chris Grosser"],
  ["Don't count the days, make the days count.","Muhammad Ali"],
  ["The only place where success comes before work is in the dictionary.","Vidal Sassoon"],
  ["Believe you can and you're halfway there.","Theodore Roosevelt"],
  ["Act as if what you do makes a difference. It does.","William James"],
  ["Either you run the day, or the day runs you.","Jim Rohn"],
  ["The strength of the team is each individual member. The strength of each member is the team.","Phil Jackson"],
  ["The function of leadership is to produce more leaders, not more followers.","Ralph Nader"],
  ["An organisation's ability to learn and translate that learning into action rapidly is the ultimate competitive advantage.","Jack Welch"],
  ["The harder you work for something, the greater you will feel when you achieve it.","Unknown"],
  ["Dream big. Work hard. Stay focused. Surround yourself with good people.","Unknown"],
  ["Success usually comes to those who are too busy to be looking for it.","Henry David Thoreau"],
  ["Don't be afraid to give up the good to go for the great.","John D. Rockefeller"],
  ["I find that the harder I work, the more luck I seem to have.","Thomas Jefferson"],
  ["Do not wait to strike till the iron is hot, but make it hot by striking.","W. B. Yeats"],
  ["The only way to do great work is to love what you do.","Steve Jobs"],
  ["It is not the mountain we conquer but ourselves.","Edmund Hillary"],
  ["What we do today, right now, will have an accumulated effect on all our tomorrows.","Alexandra Stoddard"],
  ["In the middle of every difficulty lies opportunity.","Albert Einstein"],
];
function getDailyQuote(): [string, string] {
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return QUOTES[doy % QUOTES.length] as [string, string];
}

/* ─── helpers ────────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function tz(zone: string) {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function tomorrowStr() { return new Date(Date.now() + 86400000).toISOString().slice(0, 10); }
function daysOverdue(due: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(due).getTime()) / 86400000));
}
function avatarInitials(firstName: string) {
  return (firstName || "U").slice(0, 2).toUpperCase();
}
function avatarGrad(role: string | null) {
  if (role === "CEO" || role === "Admin") return "linear-gradient(135deg, #B4791F, #e8a83c)";
  if (role === "Manager")                 return "linear-gradient(135deg, #0F7B5F, #1aad87)";
  if (role === "Executive")               return "linear-gradient(135deg, #7C4CA5, #a066d4)";
  return                                        "linear-gradient(135deg, #5B6FC9, #3B4CCA)";
}
function roleBadgeStyle(role: string | null): CSSProperties {
  if (role === "CEO" || role === "Admin")
    return { background: "rgba(59,76,202,0.25)", color: "#B4BFFF", border: "1px solid rgba(59,76,202,0.4)" };
  if (role === "Manager")
    return { background: "rgba(15,123,95,0.25)", color: "#7DD9C2", border: "1px solid rgba(15,123,95,0.4)" };
  if (role === "Executive")
    return { background: "rgba(124,76,165,0.25)", color: "#D4A8F0", border: "1px solid rgba(124,76,165,0.4)" };
  return { background: "rgba(100,116,139,0.25)", color: "#CBD5E1", border: "1px solid rgba(100,116,139,0.3)" };
}
function roleLabel(role: string | null, email?: string) {
  if (email === "khuram1901@gmail.com" || email === "k.saleem@unzegroup.com") return "CEO & Founder";
  if (email === "kamran@unze.co.uk") return "Group CEO · IFPL";
  if (role === "CEO")       return "CEO";
  if (role === "Admin")     return "Admin";
  if (role === "Executive") return "Executive";
  if (role === "Manager")   return "Head of Department";
  return "Member";
}
function iconBg(color: string): CSSProperties {
  const map: Record<string, string> = {
    blue: BLUE_SOFT, green: SUCCESS_SOFT, amber: WARNING_SOFT,
    red: DANGER_SOFT, purple: PURPLE_SOFT, slate: "#F1F5F9",
    navy: "rgba(15,23,32,0.07)",
  };
  return { background: map[color] ?? BLUE_SOFT };
}

/* ─── Avatar with conic ring ─────────────────────────────────── */
function AvatarRing({ photoUrl, initials, role, size = 88 }: { photoUrl: string | null; initials: string; role: string | null; size?: number }) {
  const gap = 4;
  const outer = size + gap * 2;
  return (
    <div style={{ position: "relative", width: outer, height: outer, flexShrink: 0 }}>
      {/* Conic gradient ring */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "conic-gradient(from 180deg, #3B4CCA, #7B8EF2, #0F7B5F, #5BC4A0, #3B4CCA)",
        filter: "blur(1px)", opacity: 0.85,
      }} />
      {/* Mask */}
      <div style={{ position: "absolute", inset: 3, borderRadius: "50%", background: "#162232" }} />
      {/* Photo or initials */}
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={initials} style={{
          position: "absolute", inset: gap, borderRadius: "50%",
          width: size, height: size, objectFit: "cover",
          border: "2px solid rgba(255,255,255,0.15)", zIndex: 1,
        }} />
      ) : (
        <div style={{
          position: "absolute", inset: gap, borderRadius: "50%", zIndex: 1,
          background: avatarGrad(role),
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
          fontWeight: 800, fontSize: size * 0.31, color: "#fff",
          border: "2px solid rgba(255,255,255,0.15)",
        }}>
          {initials}
        </div>
      )}
    </div>
  );
}

/* ─── Purpose banner ─────────────────────────────────────────── */
function PurposeBanner() {
  return (
    <div style={{
      background: "#fff", borderBottom: `1px solid ${HAIRLINE}`,
      padding: "10px 40px", display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 3, height: 28, borderRadius: 2, flexShrink: 0,
        background: `linear-gradient(180deg, ${BLUE}, ${GREEN})`,
      }} />
      <p style={{ fontSize: 12.5, color: SLATE, lineHeight: 1.45, margin: 0 }}>
        <strong style={{ color: NAVY, fontWeight: 600 }}>Our purpose: </strong>
        Through service and sustainable business growth, we create opportunities that enhance the lifestyle of our employees, customers, and the community we operate in.
      </p>
    </div>
  );
}

/* ─── Task Banner ────────────────────────────────────────────── */
type TaskBannerProps = {
  myOverdue: number; myToday: number; myTomorrow: number; myWeek: number;
  teamOverdue?: number; teamToday?: number;
};
function TaskBanner({ myOverdue, myToday, myTomorrow, myWeek, teamOverdue, teamToday }: TaskBannerProps) {
  const pill = (num: number, label: string, cls: CSSProperties): ReactNode => (
    <Link href="/tasks" style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 14px", borderRadius: 20, textDecoration: "none",
      fontSize: 12.5, fontWeight: 600, transition: "opacity .15s",
      ...cls,
    }}>
      <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-display,'Inter Tight',sans-serif)" }}>{num}</span>
      {label}
    </Link>
  );
  const sep = <span style={{ color: HAIRLINE, fontSize: 16, margin: "0 4px" }}>|</span>;
  const lbl = (t: string) => (
    <span style={{ fontSize: 11.5, fontWeight: 600, color: INK_400, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t}</span>
  );
  return (
    <div style={{
      background: "#fff", borderBottom: `1px solid ${HAIRLINE}`,
      padding: "12px 40px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      {lbl("My tasks")}
      {pill(myOverdue,  "Overdue",    { background: DANGER_SOFT,  color: RED,   border: `1px solid #EAC4C2` })}
      {pill(myToday,    "Due Today",  { background: WARNING_SOFT, color: AMBER, border: `1px solid #E8D5B0` })}
      {pill(myTomorrow, "Tomorrow",   { background: BLUE_SOFT,    color: BLUE,  border: `1px solid #C7CDF5` })}
      {pill(myWeek,     "This Week",  { background: SUCCESS_SOFT, color: GREEN, border: `1px solid #AFDDD2` })}
      {(teamOverdue !== undefined || teamToday !== undefined) && sep}
      {(teamOverdue !== undefined || teamToday !== undefined) && lbl("Team")}
      {teamOverdue !== undefined && pill(teamOverdue, "Team Overdue", { background: DANGER_SOFT,  color: RED,   border: `1px solid #EAC4C2` })}
      {teamToday   !== undefined && pill(teamToday,   "Team Today",   { background: WARNING_SOFT, color: AMBER, border: `1px solid #E8D5B0` })}
    </div>
  );
}

/* ─── World Clocks + Weather (shared card) ───────────────────── */
function ClockWeatherCard({ tick, weather }: { tick: number; weather: Weather | null }) {
  void tick; // used to trigger re-render
  return (
    <div style={{ background: CARD_ALT, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
      {/* Clocks */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
        {[
          { city: "Lahore",   zone: "Asia/Karachi" },
          { city: "London",   zone: "Europe/London" },
          { city: "New York", zone: "America/New_York" },
        ].map((c, i) => (
          <div key={c.city} style={{
            padding: "14px 12px", textAlign: "center",
            borderRight: i < 2 ? `1px solid ${HAIRLINE}` : undefined,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: INK_400, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{c.city}</div>
            <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 20, color: NAVY, letterSpacing: "-0.03em" }}>{tz(c.zone)}</div>
          </div>
        ))}
      </div>
      {/* Weather */}
      {weather && (
        <div style={{ borderTop: `1px solid ${HAIRLINE}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 26 }}>{wmo(weather.code)[1]}</span>
          <div>
            <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 18, color: NAVY }}>{weather.temp}°C</div>
            <div style={{ fontSize: 11.5, color: INK_400 }}>{wmo(weather.code)[0]} · feels {weather.apparent}°C</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 12, color: SLATE, fontWeight: 500 }}>{weather.humidity}% humid</div>
            <div style={{ fontSize: 10.5, color: INK_400 }}>Lahore, PK</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Quote of the Day ───────────────────────────────────────── */
function QuoteCard() {
  const [text, author] = getDailyQuote();
  return (
    <div style={{
      background: `linear-gradient(135deg, ${NAVY} 0%, #1a2a42 100%)`,
      borderRadius: RADII.CARD, padding: 22, position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: -10, left: 12, fontSize: 100,
        fontFamily: "Georgia,serif", color: "rgba(255,255,255,0.05)", lineHeight: 1, fontWeight: 700,
      }}>"</div>
      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "rgba(255,255,255,0.88)", fontStyle: "italic", position: "relative", margin: 0 }}>
        "{text}"
      </p>
      <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", marginTop: 12, fontStyle: "normal", margin: "12px 0 0" }}>— {author}</p>
    </div>
  );
}

/* ─── Quick Links card ───────────────────────────────────────── */
function QuickLinksCard({ links }: { links: QuickLink[] }) {
  return (
    <div style={{ background: CARD_ALT, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, letterSpacing: "-0.01em", margin: 0 }}>Quick Links</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, padding: "14px 16px" }}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            padding: "11px 6px", borderRadius: 10, textDecoration: "none", transition: "background .15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = CANVAS)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, ...iconBg(l.color),
            }}>{l.icon}</div>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: INK_700, textAlign: "center", lineHeight: 1.2 }}>{l.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ─── Task section label ─────────────────────────────────────── */
function SectionLabel({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, color, textTransform: "uppercase",
      letterSpacing: "0.1em", padding: "10px 0 6px",
    }}>● {children}</div>
  );
}

/* ─── Single task row ────────────────────────────────────────── */
function TaskRow({ task, today, tomorrow }: { task: TaskItem; today: string; tomorrow: string }) {
  const isOverdue  = task.due_date < today;
  const isToday    = task.due_date === today;
  const dotColor   = isOverdue ? RED : isToday ? AMBER : BLUE;
  const badgeBg    = isOverdue ? DANGER_SOFT  : isToday ? WARNING_SOFT : BLUE_SOFT;
  const badgeFg    = isOverdue ? RED : isToday ? AMBER : BLUE;
  const badgeLabel = isOverdue
    ? `${daysOverdue(task.due_date)}d overdue`
    : isToday ? "Today"
    : task.due_date === tomorrow ? "Tomorrow"
    : formatDateUK(task.due_date);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: INK_700, lineHeight: 1.35 }}>{task.description}</div>
        <div style={{ fontSize: 11, color: INK_400, marginTop: 3 }}>
          {task.assigned_by ? `From ${task.assigned_by}` : "Self assigned"} · {task.priority ?? "Medium"} priority
        </div>
      </div>
      <div style={{
        fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
        background: badgeBg, color: badgeFg, flexShrink: 0, alignSelf: "flex-start", marginTop: 2, whiteSpace: "nowrap",
      }}>{badgeLabel}</div>
    </div>
  );
}

/* ─── My Tasks card ──────────────────────────────────────────── */
function MyTasksCard({ tasks, title = "My Tasks", subtitle = "Personal assignments" }: { tasks: TaskItem[]; title?: string; subtitle?: string }) {
  const today    = todayStr();
  const tomorrow = tomorrowStr();
  const overdue  = tasks.filter(t => t.due_date < today);
  const dueToday = tasks.filter(t => t.due_date === today);
  const upcoming = tasks.filter(t => t.due_date > today);
  return (
    <div style={{ background: CARD_ALT, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, letterSpacing: "-0.01em", margin: 0 }}>{title}</h3>
          <p style={{ fontSize: 11, color: INK_400, marginTop: 2, marginBottom: 0 }}>{subtitle}</p>
        </div>
        <Link href="/tasks" style={{ fontSize: 12, color: BLUE, fontWeight: 500, textDecoration: "none" }}>View all →</Link>
      </div>
      <div style={{ padding: "4px 20px 16px" }}>
        {overdue.length > 0 && (
          <>
            <SectionLabel color={RED}>Overdue</SectionLabel>
            {overdue.map(t => <TaskRow key={t.id} task={t} today={today} tomorrow={tomorrow} />)}
          </>
        )}
        {dueToday.length > 0 && (
          <>
            <SectionLabel color={AMBER}>Due Today</SectionLabel>
            {dueToday.map(t => <TaskRow key={t.id} task={t} today={today} tomorrow={tomorrow} />)}
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <SectionLabel color={BLUE}>Upcoming</SectionLabel>
            {upcoming.map(t => <TaskRow key={t.id} task={t} today={today} tomorrow={tomorrow} />)}
          </>
        )}
        {tasks.length === 0 && (
          <div style={{ padding: "20px 0", textAlign: "center", color: INK_400, fontSize: 13 }}>
            ✓ No tasks due this week — you&apos;re all clear!
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Member color from index ────────────────────────────────── */
const MEMBER_COLORS = ["#5B6FC9","#0F7B5F","#B4791F","#7C4CA5","#B3261E","#3B7BC8","#1a8c6e"];
function memberColor(i: number) { return MEMBER_COLORS[i % MEMBER_COLORS.length]; }

/* ─── Team Status card ───────────────────────────────────────── */
function TeamStatusCard({ data }: { data: WelcomeData }) {
  const members  = data.teamMemberStatus ?? [];
  const dept     = data.department ?? "Department";
  const teamSize = data.teamSize ?? members.length + 1;
  return (
    <div style={{ background: CARD_ALT, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, letterSpacing: "-0.01em", margin: 0 }}>Team Status</h3>
          <p style={{ fontSize: 11, color: INK_400, marginTop: 2, marginBottom: 0 }}>{dept} · {teamSize} member{teamSize !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/tasks" style={{ fontSize: 12, color: BLUE, fontWeight: 500, textDecoration: "none" }}>Tasks →</Link>
      </div>
      <div style={{ padding: "4px 20px 10px" }}>
        {members.map((m, i) => (
          <div key={m.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: memberColor(i), display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700, color: "#fff",
            }}>
              {m.name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: INK_700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
            <div style={{ display: "flex", gap: 5 }}>
              {m.overdueCount > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: DANGER_SOFT, color: RED }}>
                  {m.overdueCount} overdue
                </span>
              )}
              {m.todayCount > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: WARNING_SOFT, color: AMBER }}>
                  {m.todayCount} today
                </span>
              )}
              {m.overdueCount === 0 && m.todayCount === 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: SUCCESS_SOFT, color: GREEN }}>
                  ✓ clear
                </span>
              )}
            </div>
          </div>
        ))}
        {members.length === 0 && (
          <div style={{ padding: "16px 0", textAlign: "center", color: INK_400, fontSize: 13 }}>No team members found.</div>
        )}
      </div>
      {/* Mini stat bar */}
      <div style={{ borderTop: `1px solid ${HAIRLINE}`, display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
        {[
          { num: data.teamOverdueCount ?? 0,   label: "Overdue",      color: RED   },
          { num: data.teamTodayCount ?? 0,     label: "Today",        color: AMBER },
          { num: data.teamCompletedMonth ?? 0, label: "Done this mo", color: GREEN },
        ].map((s, i) => (
          <div key={s.label} style={{
            padding: "12px 10px", textAlign: "center",
            borderRight: i < 2 ? `1px solid ${HAIRLINE}` : undefined,
          }}>
            <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 22, color: s.color, letterSpacing: "-0.03em" }}>{s.num}</div>
            <div style={{ fontSize: 10.5, color: INK_400, marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Team Overdue Tasks card (HOD) ──────────────────────────── */
function TeamOverdueCard({ data }: { data: WelcomeData }) {
  const today    = todayStr();
  const tomorrow = tomorrowStr();
  const tasks    = data.teamOverdueTasks ?? [];
  const members  = data.teamMemberStatus ?? [];
  const dept     = data.department ?? "Department";
  const teamSize = data.teamSize ?? members.length + 1;

  return (
    <div style={{ background: CARD_ALT, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, letterSpacing: "-0.01em", margin: 0 }}>Team Overdue Tasks</h3>
          <p style={{ fontSize: 11, color: INK_400, marginTop: 2, marginBottom: 0 }}>
            {dept} · {data.teamOverdueCount ?? tasks.length} overdue across {teamSize} members
          </p>
        </div>
        <Link href="/tasks" style={{ fontSize: 12, color: BLUE, fontWeight: 500, textDecoration: "none" }}>All tasks →</Link>
      </div>
      <div style={{ padding: "4px 20px 10px" }}>
        {tasks.length === 0
          ? <div style={{ padding: "20px 0", textAlign: "center", color: INK_400, fontSize: 13 }}>✓ No team overdue tasks — great job!</div>
          : tasks.map(t => <TaskRow key={t.id} task={{ ...t, assigned_by: t.assigned_to || t.assigned_to_email?.split("@")[0] || "" }} today={today} tomorrow={tomorrow} />)
        }
      </div>
      {/* Member status below */}
      {members.length > 0 && (
        <div style={{ borderTop: `1px solid ${HAIRLINE}`, padding: "10px 20px" }}>
          {members.map((m, i) => (
            <div key={m.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: i < members.length - 1 ? `1px solid ${HAIRLINE}` : undefined }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                background: memberColor(i), display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9.5, fontWeight: 700, color: "#fff",
              }}>
                {m.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: INK_700 }}>{m.name}</div>
              <div style={{ display: "flex", gap: 4 }}>
                {m.overdueCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 8, background: DANGER_SOFT, color: RED }}>{m.overdueCount} overdue</span>}
                {m.todayCount > 0   && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 8, background: WARNING_SOFT, color: AMBER }}>{m.todayCount} today</span>}
                {m.overdueCount === 0 && m.todayCount === 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 8, background: SUCCESS_SOFT, color: GREEN }}>✓ clear</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── HOD dark stat strip ────────────────────────────────────── */
function HodStatStrip({ data }: { data: WelcomeData }) {
  const stats = [
    { label: "Team size",             value: data.teamSize ?? 0,            color: "#fff"    },
    { label: "Team overdue",          value: data.teamOverdueCount ?? 0,    color: "#F8E4E2" },
    { label: "Completed this month",  value: data.teamCompletedMonth ?? 0,  color: "#7DD9C2" },
    { label: "Pending today",         value: data.teamTodayCount ?? 0,      color: "#FBF1DE" },
    { label: "My overdue",            value: data.myOverdueCount,           color: data.myOverdueCount > 0 ? "#F8E4E2" : "#7DD9C2" },
  ];
  return (
    <div style={{
      background: "linear-gradient(90deg, #0c1520 0%, #111d2e 100%)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      padding: "14px 40px", display: "flex", gap: 40, alignItems: "center",
    }}>
      {stats.map((s, i) => (
        <>
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, whiteSpace: "nowrap" }}>{s.label}</div>
            <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 20, color: s.color }}>{s.value}</div>
          </div>
          {i < stats.length - 1 && <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.08)" }} />}
        </>
      ))}
    </div>
  );
}

/* ─── CEO dark stat strip ────────────────────────────────────── */
function CeoStatStrip({ data }: { data: WelcomeData }) {
  return (
    <div style={{
      background: "linear-gradient(90deg, #0a1118 0%, #0f1820 100%)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      padding: "14px 40px", display: "flex", gap: 0, alignItems: "center",
    }}>
      {[
        {
          label: "Group tasks",
          sub: [
            { n: data.groupOverdueCount ?? 0,  l: "Overdue", c: "#F8E4E2" },
            { n: data.myTodayCount,             l: "Today",   c: "#FBF1DE" },
          ],
        },
        { label: "Machine issues", single: { n: data.machineIssueCount ?? 0, c: data.machineIssueCount ? "#FBF1DE" : "#7DD9C2" } },
        {
          label: "My tasks",
          sub: [
            { n: data.myOverdueCount, l: "Overdue", c: data.myOverdueCount > 0 ? "#F8E4E2" : "#7DD9C2" },
            { n: data.myTodayCount,   l: "Today",   c: "#FBF1DE" },
          ],
        },
      ].map((block, bi) => (
        <div key={block.label} style={{
          paddingRight: 32, marginRight: 32,
          borderRight: bi < 2 ? "1px solid rgba(255,255,255,0.07)" : undefined,
        }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{block.label}</div>
          {block.single ? (
            <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 26, color: block.single.c, letterSpacing: "-0.03em", lineHeight: 1 }}>{block.single.n}</div>
          ) : (
            <div style={{ display: "flex", gap: 16 }}>
              {(block.sub ?? []).map(s => (
                <div key={s.l}>
                  <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 18, color: s.c }}>{s.n}</div>
                  <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)" }}>{s.l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── FX strip (CEO hero right) ──────────────────────────────── */
function FxStrip({ fx }: { fx: FxRates | null }) {
  if (!fx) return null;
  const pairs = [
    { label: "USD/PKR", value: fx.USD },
    { label: "GBP/PKR", value: fx.GBP },
    { label: "CNY/PKR", value: fx.CNY },
  ];
  return (
    <div style={{
      display: "flex", gap: 0,
      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 10, overflow: "hidden",
    }}>
      {pairs.map((p, i) => (
        <div key={p.label} style={{
          padding: "10px 14px", textAlign: "center",
          borderRight: i < 2 ? "1px solid rgba(255,255,255,0.08)" : undefined,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{p.label}</div>
          <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 16, color: "#fff" }}>{p.value.toFixed(0)}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── Portfolio card (CEO) ───────────────────────────────────── */
function PortfolioCard({ holdings, portfolioTotal }: { holdings: Holding[]; portfolioTotal: number | null }) {
  return (
    <div style={{ background: CARD_ALT, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, letterSpacing: "-0.01em", margin: 0 }}>Portfolio</h3>
          <p style={{ fontSize: 11, color: INK_400, marginTop: 2, marginBottom: 0 }}>PSX investments · live</p>
        </div>
        <Link href="/investments" style={{ fontSize: 12, color: BLUE, fontWeight: 500, textDecoration: "none" }}>View →</Link>
      </div>
      {portfolioTotal !== null && (
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: 11, color: INK_400 }}>Portfolio value</div>
            <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 20, color: NAVY, letterSpacing: "-0.03em" }}>
              ₨ {(portfolioTotal / 1000).toFixed(0)}K
            </div>
          </div>
          <Link href="/investments" style={{ fontSize: 11.5, color: BLUE, fontWeight: 500, textDecoration: "none" }}>Full breakdown →</Link>
        </div>
      )}
      <div style={{ padding: "4px 20px 12px" }}>
        {holdings.length === 0
          ? <div style={{ padding: "16px 0", textAlign: "center", color: INK_400, fontSize: 13 }}>No holdings found.</div>
          : holdings.slice(0, 5).map(h => (
              <div key={h.ticker} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
                <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 12, color: NAVY, width: 54, flexShrink: 0 }}>{h.ticker}</div>
                <div style={{ fontSize: 11.5, color: INK_400, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.company_name}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: INK_700, textAlign: "right", whiteSpace: "nowrap" }}>
                  {h.quantity.toLocaleString()} u
                </div>
              </div>
            ))
        }
        {holdings.length > 5 && (
          <div style={{ padding: "8px 0", fontSize: 11.5, color: BLUE, fontWeight: 500, textAlign: "center" }}>
            +{holdings.length - 5} more holdings →
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Shared hero section ────────────────────────────────────── */
type HeroProps = {
  data: WelcomeData;
  tick: number;
  weather: Weather | null;
  fx?: FxRates | null;
  email?: string;
};
function Hero({ data, tick, weather, fx, email }: HeroProps) {
  void tick;
  const initials = avatarInitials(data.firstName);
  const deptLabel = data.department ? `${data.department}` : "Unze Group";
  return (
    <div style={{
      background: "linear-gradient(135deg, #0F1720 0%, #162232 60%, #1a2a42 100%)",
      position: "relative", overflow: "hidden", padding: "40px 40px 36px",
    }}>
      {/* Radial glow accents */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `
          radial-gradient(ellipse 600px 300px at 80% -20%, rgba(59,76,202,0.18) 0%, transparent 70%),
          radial-gradient(ellipse 400px 400px at -10% 120%, rgba(15,123,95,0.12) 0%, transparent 60%)
        `,
      }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", gap: 28 }}>
        {/* Avatar */}
        <AvatarRing photoUrl={data.photoUrl} initials={initials} role={data.role} />
        {/* Name + badges */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", fontWeight: 400, letterSpacing: "0.02em", textTransform: "uppercase", marginBottom: 5 }}>
            {greeting()}
          </div>
          <h1 style={{
            fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
            fontWeight: 800, fontSize: "clamp(22px,4vw,32px)", color: "#fff",
            letterSpacing: "-0.025em", lineHeight: 1.1, margin: "0 0 10px",
          }}>
            {data.firstName}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 600,
              ...roleBadgeStyle(data.role),
            }}>
              {roleLabel(data.role, email)}
            </span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 600,
              background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>
              {deptLabel}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.42)", fontStyle: "italic", lineHeight: 1.5, margin: 0, maxWidth: 520 }}>
            <strong style={{ color: "rgba(255,255,255,0.65)", fontStyle: "normal", fontWeight: 500 }}>Unze Group</strong>
            {" "}— Service, growth, and opportunity for all.
          </p>
        </div>
        {/* Right: clocks + weather + fx (CEO) */}
        <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-end" }}>
          {/* World clocks */}
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {[
              { city: "Lahore",   zone: "Asia/Karachi" },
              { city: "London",   zone: "Europe/London" },
              { city: "New York", zone: "America/New_York" },
            ].map((c, i, arr) => (
              <div key={c.city} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{c.city}</div>
                  <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 700, fontSize: 18, color: "#fff", letterSpacing: "-0.02em" }}>{tz(c.zone)}</div>
                </div>
                {i < arr.length - 1 && <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.1)" }} />}
              </div>
            ))}
          </div>
          {/* Weather chip */}
          {weather && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12, padding: "8px 14px",
            }}>
              <span style={{ fontSize: 20 }}>{wmo(weather.code)[1]}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "var(--font-display,'Inter Tight',sans-serif)" }}>{weather.temp}°C</div>
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>{wmo(weather.code)[0]} · Lahore</div>
              </div>
            </div>
          )}
          {/* FX strip (CEO only) */}
          {fx && <FxStrip fx={fx} />}
        </div>
      </div>
    </div>
  );
}

/* ─── Layout: Member ─────────────────────────────────────────── */
function MemberLayout({ data, tick, weather, email }: { data: WelcomeData; tick: number; weather: Weather | null; email?: string }) {
  return (
    <>
      <Hero data={data} tick={tick} weather={weather} email={email} />
      <PurposeBanner />
      <TaskBanner myOverdue={data.myOverdueCount} myToday={data.myTodayCount} myTomorrow={data.myTomorrowCount} myWeek={data.myWeekCount} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, padding: "24px 40px 40px" }}>
        <MyTasksCard tasks={data.myTasks} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <QuoteCard />
          <ClockWeatherCard tick={tick} weather={weather} />
          <QuickLinksCard links={data.quickLinks} />
        </div>
      </div>
    </>
  );
}

/* ─── Layout: Manager ────────────────────────────────────────── */
function ManagerLayout({ data, tick, weather, email }: { data: WelcomeData; tick: number; weather: Weather | null; email?: string }) {
  const hasTeam = (data.teamMemberStatus ?? []).length > 0;
  return (
    <>
      <Hero data={data} tick={tick} weather={weather} email={email} />
      <PurposeBanner />
      <TaskBanner
        myOverdue={data.myOverdueCount} myToday={data.myTodayCount}
        myTomorrow={data.myTomorrowCount} myWeek={data.myWeekCount}
        teamOverdue={data.teamOverdueCount} teamToday={data.teamTodayCount}
      />
      <div style={{ display: "grid", gridTemplateColumns: hasTeam ? "1fr 1fr 320px" : "1fr 320px", gap: 20, padding: "24px 40px 40px" }}>
        <MyTasksCard tasks={data.myTasks} />
        {hasTeam && <TeamStatusCard data={data} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <QuoteCard />
          <QuickLinksCard links={data.quickLinks} />
        </div>
      </div>
    </>
  );
}

/* ─── Layout: HOD (Manager with team overdue list) ───────────── */
function HodLayout({ data, tick, weather, email }: { data: WelcomeData; tick: number; weather: Weather | null; email?: string }) {
  return (
    <>
      <Hero data={data} tick={tick} weather={weather} email={email} />
      <HodStatStrip data={data} />
      <PurposeBanner />
      <TaskBanner
        myOverdue={data.myOverdueCount} myToday={data.myTodayCount}
        myTomorrow={data.myTomorrowCount} myWeek={data.myWeekCount}
        teamOverdue={data.teamOverdueCount} teamToday={data.teamTodayCount}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 320px", gap: 20, padding: "24px 40px 40px" }}>
        <TeamOverdueCard data={data} />
        <MyTasksCard tasks={data.myTasks} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <QuoteCard />
          <QuickLinksCard links={data.quickLinks} />
        </div>
      </div>
    </>
  );
}

/* ─── Kamran Hero — bespoke executive header ─────────────────── */
// Full name, large avatar, Lahore / London / Guangzhou clocks,
// weather chip, PKR FX strip. No shared Hero component is used here.
function KamranHero({ data, tick, weather, fx }: {
  data: WelcomeData; tick: number; weather: Weather | null; fx: FxRates | null;
}) {
  void tick;
  const fullName = data.name || data.firstName;
  const initials = (fullName || "KS").slice(0, 2).toUpperCase();
  return (
    <div style={{
      background: "linear-gradient(135deg, #0a1118 0%, #0f1f30 50%, #132840 100%)",
      position: "relative", overflow: "hidden", padding: "44px 44px 40px",
    }}>
      {/* Decorative glows */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `
          radial-gradient(ellipse 700px 350px at 90% -30%, rgba(59,76,202,0.16) 0%, transparent 65%),
          radial-gradient(ellipse 500px 400px at -5% 130%, rgba(15,123,95,0.10) 0%, transparent 55%),
          radial-gradient(ellipse 300px 300px at 50% 110%, rgba(180,121,31,0.07) 0%, transparent 60%)
        `,
      }} />
      {/* Gold accent top bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: "linear-gradient(90deg, #B4791F 0%, #e8a83c 40%, #0F7B5F 100%)",
      }} />

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Top row: Avatar + Name + Clocks */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 28 }}>
          {/* Large Avatar */}
          <AvatarRing photoUrl={data.photoUrl} initials={initials} role={data.role} size={108} />

          {/* Name + badges */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
              {greeting()}
            </div>
            <h1 style={{
              fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
              fontWeight: 800, fontSize: "clamp(26px,4vw,38px)", color: "#fff",
              letterSpacing: "-0.03em", lineHeight: 1.05, margin: "0 0 12px",
            }}>
              {fullName}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <span style={{
                display: "inline-flex", alignItems: "center",
                padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                background: "rgba(180,121,31,0.22)", color: "#e8c47a",
                border: "1px solid rgba(180,121,31,0.35)",
              }}>
                Group CEO · IFPL
              </span>
              <span style={{
                display: "inline-flex", alignItems: "center",
                padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}>
                Imperial Footwear Pakistan
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.38)", fontStyle: "italic", lineHeight: 1.5, margin: 0, maxWidth: 480 }}>
              <strong style={{ color: "rgba(255,255,255,0.6)", fontStyle: "normal", fontWeight: 500 }}>Unze Group</strong>
              {" "}— Service, growth, and opportunity for all.
            </p>
          </div>

          {/* Right column: Clocks + weather + FX */}
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end" }}>
            {/* 3-city clocks */}
            <div style={{
              display: "flex", gap: 0, alignItems: "stretch",
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 12, overflow: "hidden",
            }}>
              {[
                { city: "Lahore",    zone: "Asia/Karachi",  flag: "🇵🇰" },
                { city: "London",    zone: "Europe/London", flag: "🇬🇧" },
                { city: "Guangzhou", zone: "Asia/Shanghai", flag: "🇨🇳" },
              ].map((c, i) => (
                <div key={c.city} style={{
                  padding: "14px 18px", textAlign: "center",
                  borderRight: i < 2 ? "1px solid rgba(255,255,255,0.08)" : undefined,
                  minWidth: 90,
                }}>
                  <div style={{ fontSize: 14, marginBottom: 3 }}>{c.flag}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.32)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{c.city}</div>
                  <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>{tz(c.zone)}</div>
                </div>
              ))}
            </div>

            {/* Weather chip */}
            {weather && (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 10, padding: "10px 16px", alignSelf: "stretch", justifyContent: "center",
              }}>
                <span style={{ fontSize: 22 }}>{wmo(weather.code)[1]}</span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", fontFamily: "var(--font-display,'Inter Tight',sans-serif)", letterSpacing: "-0.02em" }}>{weather.temp}°C</div>
                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.38)" }}>{wmo(weather.code)[0]} · Lahore</div>
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>Feels {weather.apparent}°C</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>{weather.humidity}% humid</div>
                </div>
              </div>
            )}

            {/* PKR FX strip */}
            {fx && (
              <div style={{
                display: "flex", gap: 0,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10, overflow: "hidden", alignSelf: "stretch",
              }}>
                {(["USD","GBP","CNY"] as const).map((k, i) => (
                  <div key={k} style={{
                    flex: 1, padding: "10px 12px", textAlign: "center",
                    borderRight: i < 2 ? "1px solid rgba(255,255,255,0.08)" : undefined,
                  }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.32)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{k}/PKR</div>
                    <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontWeight: 800, fontSize: 15, color: "#fff" }}>&#x20a8;{fx[k].toFixed(0)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Layout: CEO / Admin / Executive ───────────────────────── */
/* ─── Kamran layout — CEO with own /home exec dashboard ─────── */
function KamranLayout({ data, tick, weather, fx }: {
  data: WelcomeData; tick: number; weather: Weather | null; fx: FxRates | null;
}) {
  return (
    <>
      <KamranHero data={data} tick={tick} weather={weather} fx={fx} />
      <PurposeBanner />
      <TaskBanner
        myOverdue={data.myOverdueCount} myToday={data.myTodayCount}
        myTomorrow={data.myTomorrowCount} myWeek={data.myWeekCount}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 356px", gap: 20, padding: "24px 44px 44px" }}>
        <MyTasksCard tasks={data.myTasks} title="My Tasks" subtitle="Personal assignments" />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <QuoteCard />
          <QuickLinksCard links={data.quickLinks} />
          {/* Executive Dashboard shortcut */}
          <div style={{
            background: `linear-gradient(135deg, ${NAVY} 0%, #162232 100%)`,
            borderRadius: RADII.CARD, padding: "20px 22px",
            display: "flex", flexDirection: "column", gap: 8,
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.38)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Imperial Footwear</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "white", lineHeight: 1.25 }}>Executive Operations Dashboard</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.55 }}>
              Production, dispatch, cash flow, receivables and team KPIs.
            </div>
            <Link href="/home" style={{
              display: "block", marginTop: 6,
              padding: "9px 0", textAlign: "center",
              background: "rgba(180,121,31,0.25)",
              border: "1px solid rgba(180,121,31,0.4)", borderRadius: RADII.PILL,
              color: "#e8c47a", fontSize: 13, fontWeight: 700, textDecoration: "none",
            }}>
              Open Dashboard &#8594;
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function CeoLayout({ data, tick, weather, fx, holdings, portfolioTotal, email }: {
  data: WelcomeData; tick: number; weather: Weather | null;
  fx: FxRates | null; holdings: Holding[]; portfolioTotal: number | null; email?: string;
}) {
  const showPortfolio = holdings.length > 0 || portfolioTotal !== null;
  const cols = showPortfolio
    ? "1fr 1fr 1fr 300px"
    : "1fr 1fr 300px";
  return (
    <>
      <Hero data={data} tick={tick} weather={weather} fx={fx} email={email} />
      <CeoStatStrip data={data} />
      <PurposeBanner />
      <TaskBanner myOverdue={data.myOverdueCount} myToday={data.myTodayCount} myTomorrow={data.myTomorrowCount} myWeek={data.myWeekCount} />
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 20, padding: "24px 40px 40px" }}>
        <MyTasksCard tasks={data.myTasks} title="My Tasks" subtitle="Personal CEO assignments" />
        {/* Group task health card */}
        <div style={{ background: CARD_ALT, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${HAIRLINE}` }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, margin: 0 }}>Group Task Health</h3>
            <p style={{ fontSize: 11, color: INK_400, marginTop: 2, marginBottom: 0 }}>All teams · live snapshot</p>
          </div>
          <div style={{ padding: "12px 20px" }}>
            {[
              { label: "Group overdue tasks",  value: data.groupOverdueCount ?? 0,  color: RED,   soft: DANGER_SOFT  },
              { label: "Machine issues open",  value: data.machineIssueCount ?? 0,  color: AMBER, soft: WARNING_SOFT },
              { label: "My tasks overdue",     value: data.myOverdueCount,          color: data.myOverdueCount > 0 ? RED : GREEN, soft: data.myOverdueCount > 0 ? DANGER_SOFT : SUCCESS_SOFT },
              { label: "My tasks due today",   value: data.myTodayCount,            color: AMBER, soft: WARNING_SOFT },
            ].map(row => (
              <div key={row.label} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 0", borderBottom: `1px solid ${HAIRLINE}`,
              }}>
                <span style={{ fontSize: 13, color: INK_700 }}>{row.label}</span>
                <span style={{
                  fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
                  fontWeight: 800, fontSize: 18, color: row.color,
                  background: row.soft, padding: "2px 12px", borderRadius: 8,
                }}>
                  {row.value}
                </span>
              </div>
            ))}
            <div style={{ paddingTop: 14, textAlign: "center" }}>
              <Link href="/tasks" style={{ fontSize: 12, color: BLUE, fontWeight: 600, textDecoration: "none" }}>View all group tasks →</Link>
            </div>
          </div>
        </div>
        {showPortfolio && <PortfolioCard holdings={holdings} portfolioTotal={portfolioTotal} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <QuoteCard />
          <ClockWeatherCard tick={tick} weather={weather} />
          <QuickLinksCard links={data.quickLinks} />
        </div>
      </div>
    </>
  );
}

/* ─── Main page ──────────────────────────────────────────────── */
function WelcomePageInner() {
  const [data,           setData]           = useState<WelcomeData | null>(null);
  const [weather,        setWeather]        = useState<Weather | null>(null);
  const [fx,             setFx]             = useState<FxRates | null>(null);
  const [holdings,       setHoldings]       = useState<Holding[]>([]);
  const [portfolioTotal, setPortfolioTotal] = useState<number | null>(null);
  const [tick,           setTick]           = useState(0);
  const [email,          setEmail]          = useState<string | undefined>(undefined);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clock tick
  useEffect(() => {
    tickRef.current = setInterval(() => setTick(n => n + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  // Main data load
  const load = useCallback(async () => {
    const { data: { user } } = await (await import("../lib/supabase")).supabase.auth.getUser();
    setEmail(user?.email ?? undefined);

    const res = await authFetch("/api/welcome");
    if (res.ok) setData(await res.json());

    // Weather (Lahore: 31.5497°N, 74.3436°E)
    try {
      const wRes = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=31.5497&longitude=74.3436&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&timezone=Asia/Karachi",
        { cache: "no-store" }
      );
      if (wRes.ok) {
        const w = await wRes.json();
        setWeather({
          temp:     Math.round(w.current.temperature_2m),
          apparent: Math.round(w.current.apparent_temperature),
          humidity: Math.round(w.current.relative_humidity_2m),
          code:     w.current.weather_code,
          city:     "Lahore",
        });
      }
    } catch { /* weather is optional */ }
  }, []);

  // FX + investments load (CEO/Admin/Exec only, after data.role and email are known)
  useEffect(() => {
    if (!data || email === undefined) return;
    const isPriv = data.role === "CEO" || data.role === "Admin" || data.role === "Executive";
    if (!isPriv) return;

    // FX (all privileged users, including Kamran)
    authFetch("/api/fx/multi").then(r => { if (r.ok) r.json().then(setFx); }).catch(() => {});

    // Investments — only for users who see CeoLayout (not Kamran — his /home has this)
    if (email !== "kamran@unze.co.uk") {
      supabase.from("holdings").select("ticker, company_name, quantity, buy_price").order("ticker").then(({ data: h }) => {
        if (h && h.length > 0) {
          setHoldings(h as Holding[]);
          const total = (h as Holding[]).reduce((s, x) => s + x.quantity * x.buy_price, 0);
          setPortfolioTotal(total);
        }
      });
    }
  }, [data, email]);

  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: CANVAS }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            border: `3px solid ${HAIRLINE}`, borderTopColor: BLUE,
            animation: "spin 0.8s linear infinite", margin: "0 auto 12px",
          }} />
          <p style={{ color: INK_400, fontSize: 13 }}>Loading your dashboard…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const isKamran  = email === "kamran@unze.co.uk";
  const isPriv    = data.role === "CEO" || data.role === "Admin" || data.role === "Executive";
  const isManager = data.role === "Manager";
  const hasTeamOverdue = isManager && (data.teamOverdueTasks ?? []).length > 0;

  return (
    <div style={{ background: CANVAS, minHeight: "100vh" }}>
      {isKamran
        ? <KamranLayout  data={data} tick={tick} weather={weather} fx={fx} />
        : isPriv
        ? <CeoLayout     data={data} tick={tick} weather={weather} fx={fx} holdings={holdings} portfolioTotal={portfolioTotal} email={email} />
        : hasTeamOverdue
        ? <HodLayout     data={data} tick={tick} weather={weather} email={email} />
        : isManager
        ? <ManagerLayout data={data} tick={tick} weather={weather} email={email} />
        : <MemberLayout  data={data} tick={tick} weather={weather} email={email} />
      }
    </div>
  );
}

export default function WelcomePage() {
  return (
    <AuthWrapper>
      <WelcomePageInner />
    </AuthWrapper>
  );
}
