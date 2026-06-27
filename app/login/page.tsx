"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMobile } from "../lib/useMobile";

type MemberProfile = {
  role: string | null;
  department: string | null;
};

const slides = [
  {
    image: "/unze-logo.png",
    title: "Unze Group",
    subtitle: "Trusted Since 1989",
    type: "logo",
  },
  {
    image: "/hero-retail.jpg",
    title: "Retail Division",
    subtitle: "Footwear, fashion and customer experience",
  },
  {
    image: "/hero-hospitality.jpg",
    title: "Hospitality Division",
    subtitle: "Haute Dolci · Baranh · Elysian",
  },
  {
    image: "/hero-manufacturing-poles.jpg",
    title: "Manufacturing Division",
    subtitle: "Production · Dispatch · Stock Control",
  },
  {
    image: "/hero-dashboard.jpg",
    title: "Executive Command Centre",
    subtitle: "Operations · Finance · Tasks · Meetings",
  },
];

function getLandingRoute(profile: MemberProfile | null, email: string) {
  const lower = email.toLowerCase();
  if (lower === "khuram1901@gmail.com") return "/home";
  if (lower === "pa.ceo@unze.co.uk") return "/home";
  const role = profile?.role || "Member";
  if (role === "Admin" || role === "Executive") return "/home";
  return "/my-dashboard";
}

export default function LoginPage() {
  const router = useRouter();
  const isMobile = useMobile();

  const [active, setActive] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, 16000);
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
      .single();

    router.push(getLandingRoute(member, email));
  }

  const slide = slides[active];

  return (
    <main style={{
      minHeight: "100vh",
      fontFamily: "sans-serif",
      background: "#f4f6f9",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: isMobile ? "16px" : "32px",
    }}>
      <div style={{
        maxWidth: "960px",
        width: "100%",
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        borderRadius: "16px",
        overflow: "hidden",
        backgroundColor: "#ffffff",
        border: "1px solid #e2e8f0",
        boxShadow: "0 8px 30px rgba(15,23,42,0.08)",
      }}>
        {/* Left — Form */}
        <div style={{ padding: isMobile ? "28px 24px" : "48px 40px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" }}>
            <img src="/unze-logo.png" alt="Unze Group" style={{ height: "36px", objectFit: "contain" }} />
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.3px" }}>PulseDesk</span>
          </div>

          <h1 style={{ fontSize: isMobile ? "24px" : "28px", fontWeight: 800, color: "#0f172a", margin: "0 0 6px", lineHeight: 1.15 }}>
            Welcome back
          </h1>
          <p style={{ color: "#64748b", fontSize: "15px", margin: "0 0 28px", lineHeight: 1.5 }}>
            Sign in to access your dashboard
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "18px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@unzegroup.com"
                style={{
                  display: "block", width: "100%", padding: "10px 14px",
                  border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "15px",
                  boxSizing: "border-box", outline: "none",
                  transition: "border-color 0.15s",
                  backgroundColor: "#f8fafc",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.backgroundColor = "#fff"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.backgroundColor = "#f8fafc"; }}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>Password</label>
                <Link href="/forgot-password" style={{ fontSize: "12px", color: "#3b82f6", textDecoration: "none", fontWeight: 500 }}>
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Enter your password"
                  style={{
                    display: "block", width: "100%", padding: "10px 42px 10px 14px",
                    border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "15px",
                    boxSizing: "border-box", outline: "none",
                    transition: "border-color 0.15s",
                    backgroundColor: "#f8fafc",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.backgroundColor = "#fff"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.backgroundColor = "#f8fafc"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
                    border: "none", background: "transparent", cursor: "pointer",
                    padding: "4px", color: "#94a3b8", display: "flex", alignItems: "center",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

            <button type="submit" disabled={loading} style={{
              width: "100%", backgroundColor: "#0f172a", color: "white",
              border: "none", borderRadius: "8px", padding: "11px 18px",
              fontSize: "15px", fontWeight: 600, cursor: loading ? "wait" : "pointer",
              transition: "background-color 0.15s",
              opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {message && (
            <div style={{
              marginTop: "16px", padding: "10px 14px",
              borderRadius: "8px", fontSize: "13px", fontWeight: 500,
              backgroundColor: message.startsWith("Error") ? "#fef2f2" : "#f0fdf4",
              color: message.startsWith("Error") ? "#dc2626" : "#16a34a",
              border: `1px solid ${message.startsWith("Error") ? "#fecaca" : "#bbf7d0"}`,
            }}>
              {message}
            </div>
          )}
        </div>

        {/* Right — Carousel */}
        {!isMobile && (
          <div style={{ position: "relative", minHeight: "520px", overflow: "hidden" }}>
            {slide.type === "logo" ? (
              <div style={{
                height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)",
                padding: "48px",
              }}>
                <img src={slide.image} alt={slide.title} style={{
                  maxWidth: "75%", maxHeight: "200px", objectFit: "contain",
                  filter: "brightness(0) invert(1) drop-shadow(0 12px 24px rgba(0,0,0,0.3))",
                }} />
              </div>
            ) : (
              <div style={{
                height: "100%",
                backgroundImage: `linear-gradient(to bottom, rgba(15,23,42,0.10), rgba(15,23,42,0.55)), url('${slide.image}')`,
                backgroundSize: "cover", backgroundPosition: "center",
              }} />
            )}

            {/* Caption overlay */}
            <div style={{
              position: "absolute", left: "20px", right: "20px", bottom: "20px",
              backgroundColor: "rgba(15,23,42,0.85)", backdropFilter: "blur(12px)",
              borderRadius: "12px", padding: "16px 18px",
              border: "1px solid rgba(255,255,255,0.10)",
            }}>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "#ffffff", marginBottom: "3px" }}>
                {slide.title}
              </div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)" }}>
                {slide.subtitle}
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
                {slides.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setActive(index)}
                    aria-label={`Show slide ${index + 1}`}
                    style={{
                      width: active === index ? "24px" : "7px",
                      height: "7px",
                      borderRadius: "999px",
                      border: "none",
                      backgroundColor: active === index ? "#ffffff" : "rgba(255,255,255,0.35)",
                      cursor: "pointer",
                      transition: "all 0.25s ease",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: "24px", color: "#94a3b8", fontSize: "12px", textAlign: "center" }}>
        &copy; Unze Group 1989&ndash;2026 &middot; v3.0 &middot; All Rights Reserved
      </div>
    </main>
  );
}
