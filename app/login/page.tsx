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
    subtitle: "Haute Dolci • Baranh • Elysian",
  },
  {
    image: "/hero-manufacturing-poles.jpg",
    title: "Manufacturing Division",
    subtitle: "Production • Dispatch • Stock Control",
  },
  {
    image: "/hero-dashboard.jpg",
    title: "Executive Command Centre",
    subtitle: "Operations • Finance • Tasks • Meetings",
  },
];

function getLandingRoute(profile: MemberProfile | null, email: string) {
  if (email.toLowerCase() === "khuram1901@gmail.com") return "/executive";
  const role = profile?.role || "Member";
  if (role === "Admin" || role === "Executive") return "/executive";
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

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

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
    <main style={{ ...pageStyle, padding: isMobile ? "16px" : "32px" }}>
      <section style={{ ...shellStyle, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))", gap: isMobile ? "20px" : "36px" }}>
        <div style={{ ...loginCardStyle, padding: isMobile ? "20px" : "34px" }}>
          <Link href="/" style={backLinkStyle}>
            ← Back to Home
          </Link>

          <h1 style={{ ...titleStyle, fontSize: isMobile ? "24px" : "42px", margin: isMobile ? "16px 0 10px" : "28px 0 14px" }}>Unze Pulse Dashboard</h1>

          <p style={{ ...subtitleStyle, fontSize: isMobile ? "13px" : "17px", marginBottom: isMobile ? "16px" : "26px" }}>
            Sign in to access your dashboard, tasks, and operations pulse.
          </p>

          <form onSubmit={handleSubmit}>
            <label style={labelStyle}>
              Email
              <input
                style={inputStyle}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label style={labelStyle}>
              Password
              <div style={{ position: "relative", marginTop: "6px", marginBottom: "16px" }}>
                <input
                  style={{
                    ...inputStyle,
                    marginTop: 0,
                    marginBottom: 0,
                    paddingRight: "48px",
                  }}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  style={eyeButtonStyle}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </label>

            <button type="submit" disabled={loading} style={primaryButtonStyle}>
              {loading ? "Please wait..." : "Sign In"}
            </button>
          </form>

          {message && <p style={errorStyle}>{message}</p>}

          <div style={{ marginTop: "18px", textAlign: "center" }}>
            <Link href="/forgot-password" style={forgotLinkStyle}>
              Forgot password?
            </Link>
          </div>
        </div>

        {!isMobile && <HeroCarousel slide={slide} active={active} setActive={setActive} />}
      </section>

      <div style={footerStyle}>© Unze Group 1989–2026 · Pulse v2.0</div>
    </main>
  );
}

function HeroCarousel({
  slide,
  active,
  setActive,
}: {
  slide: (typeof slides)[number];
  active: number;
  setActive: (index: number) => void;
}) {
  return (
    <div style={heroBoxStyle}>
      {slide.type === "logo" ? (
        <div style={logoSlideStyle}>
          <img src={slide.image} alt={slide.title} style={logoImageStyle} />
        </div>
      ) : (
        <div
          style={{
            height: "430px",
            backgroundImage: `linear-gradient(rgba(31,42,68,0.20), rgba(31,42,68,0.65)), url('${slide.image}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}

      <div style={captionStyle}>
        <div style={captionTitleStyle}>{slide.title}</div>
        <div style={captionSubtitleStyle}>{slide.subtitle}</div>

        <div style={dotsStyle}>
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => setActive(index)}
              aria-label={`Show slide ${index + 1}`}
              style={{
                width: active === index ? "28px" : "8px",
                height: "8px",
                borderRadius: "999px",
                border: "none",
                backgroundColor: active === index ? "#ffffff" : "rgba(255,255,255,0.45)",
                cursor: "pointer",
                transition: "all 0.25s ease",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  fontFamily: "sans-serif",
  background: "#f3f5f8",
  color: "#1f2a44",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  padding: "32px",
};

const shellStyle = {
  maxWidth: "1180px",
  width: "100%",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "36px",
  alignItems: "center",
};

const loginCardStyle = {
  backgroundColor: "white",
  border: "1px solid #dbe3ef",
  borderRadius: "22px",
  padding: "34px",
  boxShadow: "0 24px 70px rgba(31,42,68,0.12)",
};

const backLinkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontSize: "16px",
  fontWeight: 700,
};

const titleStyle = {
  fontSize: "42px",
  lineHeight: "1.05",
  margin: "28px 0 14px",
  fontWeight: 800,
  color: "#1f2a44",
};

const subtitleStyle = {
  color: "#64748b",
  fontSize: "17px",
  lineHeight: "1.6",
  marginBottom: "26px",
};

const labelStyle = {
  display: "block",
  fontSize: "16px",
  fontWeight: "bold",
  color: "#334155",
  marginBottom: "6px",
};

const inputStyle = {
  display: "block",
  width: "100%",
  padding: "12px",
  marginTop: "6px",
  marginBottom: "16px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  fontSize: "17px",
  boxSizing: "border-box" as const,
};

const eyeButtonStyle = {
  position: "absolute" as const,
  right: "10px",
  top: "50%",
  transform: "translateY(-50%)",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: "18px",
};

const primaryButtonStyle = {
  width: "100%",
  backgroundColor: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "8px",
  padding: "13px 18px",
  fontSize: "17px",
  fontWeight: "bold",
  cursor: "pointer",
};

const errorStyle = {
  marginTop: "16px",
  color: "#dc2626",
  fontSize: "16px",
};

const forgotLinkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontSize: "16px",
  fontWeight: 700,
};

const heroBoxStyle = {
  position: "relative" as const,
  minHeight: "430px",
  borderRadius: "22px",
  overflow: "hidden",
  border: "1px solid #dbe3ef",
  boxShadow: "0 24px 70px rgba(31,42,68,0.18)",
  backgroundColor: "white",
};

const logoSlideStyle = {
  height: "430px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #ffffff 0%, #eef3fb 100%)",
  padding: "42px",
};

const logoImageStyle = {
  maxWidth: "82%",
  maxHeight: "240px",
  objectFit: "contain" as const,
  filter: "drop-shadow(0 18px 34px rgba(31,42,68,0.16))",
};

const captionStyle = {
  position: "absolute" as const,
  left: "24px",
  right: "24px",
  bottom: "24px",
  backgroundColor: "rgba(31,42,68,0.88)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "16px",
  padding: "18px",
  backdropFilter: "blur(10px)",
  color: "white",
};

const captionTitleStyle = {
  fontSize: "24px",
  fontWeight: 800,
  marginBottom: "6px",
};

const captionSubtitleStyle = {
  color: "#dbeafe",
  fontSize: "17px",
};

const dotsStyle = {
  display: "flex",
  gap: "7px",
  marginTop: "14px",
};

const footerStyle = {
  marginTop: "28px",
  color: "#64748b",
  fontSize: "17px",
};