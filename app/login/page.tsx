"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { COLOURS, RADII } from "../lib/SharedUI";
import { isDailyEntryOnly, type PermOverrides } from "../lib/permissions";

type MemberProfile = {
  role: string | null;
  department: string | null;
};

const SLIDES = [
  {
    title: "Retail Division",
    body: "Footwear, fashion and customer experience across all locations.",
  },
  {
    title: "Hospitality Division",
    body: "Haute Dolci · Baranh · Elysian — premium dining experiences.",
  },
  {
    title: "Manufacturing Division",
    body: "Production · Dispatch · Stock Control — end-to-end visibility.",
  },
  {
    title: "Executive Command Centre",
    body: "Operations · Finance · Tasks · Meetings, all in one place.",
  },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getLandingRoute(profile: MemberProfile | null, email: string) {
  const lower = email.toLowerCase();
  if (lower === "pa.ceo@unze.co.uk") return "/pa";
  const role = profile?.role || "Member";
  if (role === "Executive") return "/pa";
  // Everyone else lands on the welcome page — fast, personalised, no heavy data load
  return "/welcome";
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [active, setActive] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  // Surfaces a failed/rejected Google sign-in (see app/auth/callback) —
  // e.g. an unregistered Google account got bounced back here with
  // ?error=... on the redirect. Read once via a lazy initializer rather
  // than an effect, since this only ever needs to run on first render.
  const [message, setMessage] = useState(() => {
    const err = searchParams.get("error");
    return err ? "Error: " + err : "";
  });
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const greeting = useMemo(() => getGreeting(), []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setActive((current) => (current + 1) % SLIDES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setLoading(false);
      setMessage("Error: " + error.message);
      return;
    }

    const { data: member } = await supabase
      .from("members")
      .select("role, department")
      .eq("email", email)
      .maybeSingle();

    // Found during the 15 Jul 2026 audit: Google sign-in (app/auth/callback)
    // already rejects and signs out any account with no matching members
    // row, but password login didn't — a stale or deleted member could
    // still log in and land on /home with default (Member) permissions.
    // Now matches the same rule Google sign-in already enforces.
    if (!member) {
      await supabase.auth.signOut();
      setLoading(false);
      setMessage("Error: This account isn't registered. Contact your Unze Group administrator.");
      return;
    }

    // Check if this is a daily-entry-only user (no broader app access)
    const permData = await loadMyPermissions();
    const overrides = (permData as PermOverrides | null);
    const ctx = { email, role: member.role ?? null, department: member.department ?? null, company: null, overrides, widgetOverrides: null };
    if (isDailyEntryOnly(ctx)) {
      router.push("/daily-entry");
      return;
    }

    router.push(getLandingRoute(member, email));
  }

  const slide = SLIDES[active];

  /* ── Left panel (dark) ─────────────────────────────────────── */
  const leftPanel = (
    <div style={{
      width: isMobile ? "100%" : "50%",
      height: isMobile ? "200px" : "100vh",
      backgroundColor: "#0D1117",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: isMobile ? "24px 28px" : "48px 44px",
      boxSizing: "border-box",
      flexShrink: 0,
    }}>
      {/* Brand mark */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
            color: "#0D1117",
            fontWeight: 700,
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>U</div>
          <span style={{ color: "#ffffff", fontSize: "14px", fontWeight: 500 }}>Unze Group</span>
        </div>
        <div style={{
          color: "rgba(255,255,255,0.4)",
          fontSize: "11px",
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
          marginTop: "2px",
        }}>OPERATIONS · V3.0</div>
      </div>

      {/* Centre logo — hidden on mobile */}
      {!isMobile && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <img
            src="/unze-logo.png"
            alt="Unze Group"
            style={{ height: "120px", objectFit: "contain", filter: "brightness(0) invert(1)" }}
          />
          <div style={{
            color: "rgba(255,255,255,0.4)",
            fontSize: "13px",
            letterSpacing: "0.25em",
            textTransform: "uppercase" as const,
            marginTop: "16px",
          }}>G R O U P</div>
          <div style={{
            color: "rgba(255,255,255,0.2)",
            fontSize: "11px",
            letterSpacing: "0.15em",
            marginTop: "6px",
          }}>Est · 1989</div>
        </div>
      )}

      {/* Bottom — rotating taglines (hidden on mobile) */}
      {!isMobile && (
        <div>
          <div key={`title-${active}`} style={{
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: 500,
            marginBottom: "6px",
          }}>{slide.title}</div>
          <div key={`body-${active}`} style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: "13px",
            lineHeight: 1.6,
            maxWidth: "280px",
          }}>{slide.body}</div>

          {/* Dot indicators */}
          <div style={{ display: "flex", gap: "6px", marginTop: "16px" }}>
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                aria-label={`Go to slide ${i + 1}`}
                style={{
                  width: active === i ? "32px" : "24px",
                  height: "3px",
                  borderRadius: RADII.PILL,
                  border: "none",
                  backgroundColor: active === i ? "#ffffff" : "rgba(255,255,255,0.2)",
                  cursor: "pointer",
                  padding: 0,
                  transition: "all 0.25s ease",
                }}
              />
            ))}
          </div>

          <div style={{
            color: "rgba(255,255,255,0.2)",
            fontSize: "11px",
            marginTop: "8px",
          }}>© Unze Group 1989–2026 · v3.0</div>
        </div>
      )}
    </div>
  );

  /* ── Right panel (light) ───────────────────────────────────── */
  const rightPanel = (
    <div style={{
      width: isMobile ? "100%" : "50%",
      flex: isMobile ? 1 : undefined,
      backgroundColor: COLOURS.CARD,
      padding: isMobile ? "32px 24px" : "48px 44px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      boxSizing: "border-box",
      overflowY: "auto" as const,
    }}>
      {/* Greeting */}
      <div style={{
        fontSize: "11px",
        textTransform: "uppercase" as const,
        letterSpacing: "0.08em",
        color: COLOURS.SLATE,
        marginBottom: "6px",
      }}>{greeting}</div>

      {/* Title */}
      <h1 style={{
        fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
        fontSize: "26px",
        fontWeight: 600,
        color: COLOURS.NAVY,
        letterSpacing: "-0.02em",
        margin: "0 0 4px",
      }}>Sign in to Unze OS</h1>

      {/* Subtitle */}
      <p style={{
        fontSize: "13px",
        color: COLOURS.SLATE,
        lineHeight: 1.5,
        margin: "0 0 32px",
      }}>
        Your operations dashboard — cash, receivables, production, and everything else, in one place.
      </p>

      <form onSubmit={handleSubmit}>
        {/* Email */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{
            display: "block",
            fontSize: "12px",
            fontWeight: 500,
            color: COLOURS.SLATE,
            marginBottom: "6px",
          }}>Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@unzegroup.com"
            style={{
              display: "block",
              width: "100%",
              padding: "10px 12px",
              border: `0.5px solid ${COLOURS.HAIRLINE}`,
              borderRadius: RADII.SM,
              backgroundColor: COLOURS.CARD_ALT,
              fontSize: "13px",
              color: COLOURS.NAVY,
              boxSizing: "border-box",
              outline: "none",
              transition: "border-color 0.15s, background-color 0.15s",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = COLOURS.BLUE;
              e.currentTarget.style.backgroundColor = COLOURS.CARD;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = COLOURS.HAIRLINE;
              e.currentTarget.style.backgroundColor = COLOURS.CARD_ALT;
            }}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: "0" }}>
          <label style={{
            display: "block",
            fontSize: "12px",
            fontWeight: 500,
            color: COLOURS.SLATE,
            marginBottom: "6px",
          }}>Password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              style={{
                display: "block",
                width: "100%",
                padding: "10px 42px 10px 12px",
                border: `0.5px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                backgroundColor: COLOURS.CARD_ALT,
                fontSize: "13px",
                color: COLOURS.NAVY,
                boxSizing: "border-box",
                outline: "none",
                transition: "border-color 0.15s, background-color 0.15s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = COLOURS.BLUE;
                e.currentTarget.style.backgroundColor = COLOURS.CARD;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = COLOURS.HAIRLINE;
                e.currentTarget.style.backgroundColor = COLOURS.CARD_ALT;
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{
                position: "absolute",
                right: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: "4px",
                color: COLOURS.SLATE,
                display: "flex",
                alignItems: "center",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {showPassword ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Forgot password */}
        <div style={{ textAlign: "right", marginTop: "-8px", marginBottom: "16px", marginRight: "0" }}>
          <Link href="/forgot-password" style={{ fontSize: "12px", color: COLOURS.BLUE, textDecoration: "none" }}>
            Forgot password?
          </Link>
        </div>

        {/* Keep signed in */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "24px" }}>
          <input
            type="checkbox"
            id="keepSignedIn"
            checked={keepSignedIn}
            onChange={(e) => setKeepSignedIn(e.target.checked)}
            style={{ cursor: "pointer", width: "14px", height: "14px", accentColor: COLOURS.NAVY }}
          />
          <label htmlFor="keepSignedIn" style={{ fontSize: "12px", color: COLOURS.SLATE, cursor: "pointer" }}>
            Keep me signed in for 30 days
          </label>
        </div>

        {/* Sign in button */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "11px",
            backgroundColor: "#0D1117",
            color: "#ffffff",
            border: "none",
            borderRadius: RADII.SM,
            fontSize: "13px",
            fontWeight: 500,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.7 : 1,
            transition: "background-color 0.15s, opacity 0.15s",
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = "#1a2332"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#0D1117"; }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* Error message */}
      {message && (
        <div style={{
          marginTop: "16px",
          padding: "10px 14px",
          borderRadius: RADII.SM,
          fontSize: "13px",
          backgroundColor: message.startsWith("Error") ? COLOURS.DANGER_SOFT : COLOURS.SUCCESS_SOFT,
          color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN,
        }}>
          {message}
        </div>
      )}

      {/* Divider */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        margin: "24px 0 16px",
      }}>
        <div style={{ flex: 1, height: "0.5px", backgroundColor: COLOURS.HAIRLINE }} />
        <span style={{ fontSize: "11px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>or continue with</span>
        <div style={{ flex: 1, height: "0.5px", backgroundColor: COLOURS.HAIRLINE }} />
      </div>

      {/* Social buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <button
          type="button"
          onClick={async () => {
            const { error } = await supabase.auth.signInWithOAuth({
              provider: "google",
              options: { redirectTo: `${window.location.origin}/auth/callback` },
            });
            if (error) setMessage("Error: " + error.message);
          }}
          style={{
            width: "100%",
            padding: "10px 14px",
            border: `0.5px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.SM,
            backgroundColor: COLOURS.CARD,
            fontSize: "12px",
            color: COLOURS.SLATE,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google Workspace
        </button>

        <button
          type="button"
          style={{
            width: "100%",
            padding: "10px 14px",
            border: `0.5px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.SM,
            backgroundColor: COLOURS.CARD,
            fontSize: "12px",
            color: COLOURS.SLATE,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Single Sign-On (SSO)
        </button>
      </div>

      {/* Footer note */}
      <div style={{
        marginTop: "24px",
        fontSize: "11px",
        color: COLOURS.SLATE,
        textAlign: "center",
      }}>
        New to Unze? Contact your Unze Group administrator.
      </div>
    </div>
  );

  return (
    <main style={{
      height: "100vh",
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      overflow: "hidden",
    }}>
      {leftPanel}
      {rightPanel}
    </main>
  );
}
