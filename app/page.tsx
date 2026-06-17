"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

export default function HomePage() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, 16000);

    return () => clearInterval(timer);
  }, []);

  const slide = slides[active];

  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <div>
          <div style={pillStyle}>● CEO Operating System</div>

          <h1 style={titleStyle}>Unze Group Command Centre</h1>

          <p style={subtitleStyle}>
            Operations • Finance • Manufacturing • Retail • Hospitality
          </p>

          <p style={bodyTextStyle}>
            One command centre for performance visibility, exception management,
            tasks, meetings, finance, and executive decisions.
          </p>

          <Link href="/login" style={primaryButtonStyle}>
            Enter Cockpit
          </Link>
        </div>

        <HeroCarousel
          slide={slide}
          active={active}
          setActive={setActive}
        />
      </section>

      <div style={footerStyle}>© Unze Group 1989–2026 · Cockpit v1.0</div>
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

const pillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  backgroundColor: "#ffffff",
  border: "1px solid #dbe3ef",
  borderRadius: "999px",
  padding: "8px 14px",
  marginBottom: "24px",
  fontSize: "14px",
  color: "#2563eb",
  fontWeight: 700,
};

const titleStyle = {
  fontSize: "56px",
  lineHeight: "1.05",
  margin: "0 0 18px",
  fontWeight: 800,
  color: "#1f2a44",
};

const subtitleStyle = {
  fontSize: "18px",
  fontWeight: 700,
  color: "#2563eb",
  marginBottom: "18px",
};

const bodyTextStyle = {
  fontSize: "18px",
  lineHeight: "1.6",
  color: "#64748b",
  maxWidth: "620px",
  marginBottom: "28px",
};

const primaryButtonStyle = {
  backgroundColor: "#2563eb",
  color: "white",
  textDecoration: "none",
  padding: "14px 24px",
  borderRadius: "8px",
  fontWeight: 800,
  fontSize: "15px",
  display: "inline-block",
  boxShadow: "0 10px 28px rgba(37,99,235,0.28)",
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
  fontSize: "15px",
};

const dotsStyle = {
  display: "flex",
  gap: "7px",
  marginTop: "14px",
};

const footerStyle = {
  marginTop: "28px",
  color: "#64748b",
  fontSize: "13px",
};