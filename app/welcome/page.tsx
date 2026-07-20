"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch, supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";

const { NAVY, SLATE, BORDER, HAIRLINE, GREEN, AMBER, RED, CARD_ALT } = COLOURS;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatTime(iso: string): string {
  // Handles both datetime strings and bare dates (all-day events)
  if (!iso.includes("T")) return "All day";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });
}

function dayLabel(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const eventDate = iso.slice(0, 10);
  if (eventDate === today) return "Today";
  if (eventDate === tomorrow) return "Tomorrow";
  return new Date(eventDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

type CalEvent = { start: string; end: string; title?: string; account?: string };

export default function WelcomePage() {
  const router = useRouter();
  const isMobile = useMobile();

  const [firstName, setFirstName] = useState("");
  const [overdueCount, setOverdueCount] = useState(0);
  const [machineCount, setMachineCount] = useState(0);
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [calLoading, setCalLoading] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }

      const today = new Date().toISOString().slice(0, 10);

      const [summaryRes, calRes] = await Promise.all([
        authFetch("/api/welcome"),
        authFetch(`/api/calendar/freebusy?date=${today}`),
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
        const events: CalEvent[] = (c.busy || []);
        // Show only today + tomorrow
        const cutoff = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        const filtered = events
          .filter((e) => e.start.slice(0, 10) >= today && e.start.slice(0, 10) < cutoff)
          .sort((a, b) => a.start.localeCompare(b.start));
        setCalEvents(filtered);
      }

      setCalLoading(false);
      setReady(true);
    }

    load();
    return () => { active = false; };
  }, [router]);

  // Group events by day label
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const todayEvents = calEvents.filter((e) => e.start.slice(0, 10) === todayStr);
  const tomorrowEvents = calEvents.filter((e) => e.start.slice(0, 10) === tomorrowStr);

  const cardStyle: React.CSSProperties = {
    backgroundColor: "white",
    border: `1px solid ${HAIRLINE}`,
    borderRadius: RADII.CARD,
    padding: "20px 24px",
    marginBottom: "14px",
  };

  const dividerStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: SLATE,
    marginBottom: "10px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  };

  return (
    <AuthWrapper>
      <main style={{
        padding: isMobile ? "24px 16px" : "40px 32px",
        maxWidth: "640px",
        margin: "0 auto",
      }}>
        {/* ── Greeting ── */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ fontSize: isMobile ? "26px" : "32px", fontWeight: 800, color: NAVY, lineHeight: 1.2, marginBottom: "4px" }}>
            {getGreeting()}{firstName ? `, ${firstName}` : ""}.
          </div>
          <div style={{ fontSize: "15px", color: SLATE }}>
            {formatLongDate(new Date())}
          </div>
        </div>

        {/* ── Calendar ── */}
        <div style={cardStyle}>
          <div style={dividerStyle}>
            📅 Your schedule
            <div style={{ flex: 1, height: "1px", backgroundColor: HAIRLINE }} />
          </div>

          {calLoading ? (
            <div style={{ color: SLATE, fontSize: "14px" }}>Loading calendar…</div>
          ) : calEvents.length === 0 ? (
            <div style={{ color: SLATE, fontSize: "14px" }}>No appointments today or tomorrow.</div>
          ) : (
            <>
              {todayEvents.length > 0 && (
                <div style={{ marginBottom: tomorrowEvents.length > 0 ? "16px" : 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>Today</div>
                  {todayEvents.map((ev, i) => (
                    <EventRow key={i} ev={ev} />
                  ))}
                </div>
              )}
              {todayEvents.length === 0 && (
                <div style={{ fontSize: "14px", color: SLATE, marginBottom: tomorrowEvents.length > 0 ? "16px" : 0 }}>
                  Nothing scheduled for today.
                </div>
              )}
              {tomorrowEvents.length > 0 && (
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>Tomorrow</div>
                  {tomorrowEvents.map((ev, i) => (
                    <EventRow key={i} ev={ev} />
                  ))}
                </div>
              )}
              {tomorrowEvents.length === 0 && (
                <div style={{ fontSize: "14px", color: SLATE }}>Nothing scheduled for tomorrow.</div>
              )}
            </>
          )}
        </div>

        {/* ── Quick summary ── */}
        {ready && (overdueCount > 0 || machineCount > 0) && (
          <div style={{ ...cardStyle, borderLeft: `4px solid ${overdueCount > 0 ? AMBER : SLATE}` }}>
            <div style={dividerStyle}>
              ⚠ Needs attention
              <div style={{ flex: 1, height: "1px", backgroundColor: HAIRLINE }} />
            </div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {overdueCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    backgroundColor: RED, color: "white",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: "13px", fontWeight: 700,
                  }}>{overdueCount}</span>
                  <span style={{ fontSize: "14px", color: NAVY, fontWeight: 600 }}>
                    overdue task{overdueCount !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {machineCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    backgroundColor: AMBER, color: "white",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: "13px", fontWeight: 700,
                  }}>{machineCount}</span>
                  <span style={{ fontSize: "14px", color: NAVY, fontWeight: 600 }}>
                    machine issue{machineCount !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {ready && overdueCount === 0 && machineCount === 0 && (
          <div style={{ ...cardStyle, borderLeft: `4px solid ${GREEN}` }}>
            <div style={{ fontSize: "14px", color: NAVY, fontWeight: 600 }}>
              ✓ Nothing urgent needs your attention today.
            </div>
          </div>
        )}

        {/* ── Go to dashboard ── */}
        <button
          onClick={() => router.push("/home")}
          style={{
            width: "100%",
            padding: "14px 24px",
            backgroundColor: NAVY,
            color: "white",
            border: "none",
            borderRadius: RADII.PILL,
            fontSize: "15px",
            fontWeight: 700,
            cursor: "pointer",
            marginTop: "8px",
          }}
        >
          Open Dashboard →
        </button>

        <div style={{ textAlign: "center", marginTop: "12px" }}>
          <a href="/home" style={{ fontSize: "13px", color: SLATE, textDecoration: "none" }}>Go straight to dashboard</a>
        </div>
      </main>
    </AuthWrapper>
  );
}

function EventRow({ ev }: { ev: CalEvent }) {
  const startTime = formatTime(ev.start);
  const endTime = formatTime(ev.end);
  const timeLabel = startTime === "All day" ? "All day" : `${startTime} – ${endTime}`;

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "12px",
      padding: "8px 0",
      borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
    }}>
      <div style={{
        minWidth: "80px", fontSize: "12px", fontWeight: 600,
        color: COLOURS.SLATE, paddingTop: "2px",
      }}>
        {timeLabel}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ev.title || "Busy"}
        </div>
      </div>
    </div>
  );
}
