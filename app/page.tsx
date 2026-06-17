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
    image: "/hero-store.jpg",
    title: "Unze London",
    subtitle: "A growing national retail presence",
  },
  {
    image: "/hero-hospitality.jpg",
    title: "Hospitality Division",
    subtitle: "Restaurants, desserts and premium experiences",
  },
  {
    image: "/hero-manufacturing-poles.jpg",
    title: "Manufacturing Division",
    subtitle: "Concrete poles, production and dispatch control",
  },
  {
    image: "/hero-manufacturing-yard.jpg",
    title: "Operations Command",
    subtitle: "One cockpit for visibility and accountability",
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
    <main
      style={{
        minHeight: "100vh",
        fontFamily: "sans-serif",
        background: "linear-gradient(135deg, #1B5556 0%, #2C7A7B 55%, #0f172a 100%)",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
      }}
    >
      <section
        style={{
          maxWidth: "1180px",
          width: "100%",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "36px",
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              backgroundColor: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "999px",
              padding: "8px 14px",
              marginBottom: "24px",
              fontSize: "14px",
            }}
          >
            <span>●</span>
            CEO Operating System
          </div>

          <h1
            style={{
              fontSize: "56px",
              lineHeight: "1.05",
              margin: "0 0 18px",
              fontWeight: 800,
            }}
          >
            Unze Group Cockpit
          </h1>

          <p
            style={{
              fontSize: "19px",
              lineHeight: "1.6",
              color: "#dbeafe",
              maxWidth: "620px",
              marginBottom: "28px",
            }}
          >
            One command centre for operations, exceptions, tasks, meetings,
            finance, and executive decisions.
          </p>

          <Link
            href="/login"
            style={{
              backgroundColor: "white",
              color: "#1B5556",
              textDecoration: "none",
              padding: "14px 24px",
              borderRadius: "8px",
              fontWeight: 800,
              fontSize: "15px",
              display: "inline-block",
            }}
          >
            Enter Cockpit
          </Link>
        </div>

        <div
          style={{
            position: "relative",
            minHeight: "430px",
            borderRadius: "26px",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.24)",
            boxShadow: "0 24px 70px rgba(0,0,0,0.32)",
            backgroundColor: "rgba(255,255,255,0.12)",
          }}
        >
          {slide.type === "logo" ? (
            <div
              style={{
                height: "430px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  "radial-gradient(circle at center, rgba(255,255,255,0.18), rgba(27,85,86,0.92))",
                padding: "42px",
              }}
            >
              <img
                src={slide.image}
                alt={slide.title}
                style={{
                  maxWidth: "82%",
                  maxHeight: "240px",
                  objectFit: "contain",
                  filter: "drop-shadow(0 18px 34px rgba(0,0,0,0.35))",
                }}
              />
            </div>
          ) : (
            <div
              style={{
                height: "430px",
                backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.55)), url('${slide.image}')`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          )}

          <div
            style={{
              position: "absolute",
              left: "24px",
              right: "24px",
              bottom: "24px",
              backgroundColor: "rgba(15,23,42,0.72)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: "16px",
              padding: "18px",
              backdropFilter: "blur(10px)",
            }}
          >
            <div
              style={{
                fontSize: "24px",
                fontWeight: 800,
                marginBottom: "6px",
              }}
            >
              {slide.title}
            </div>

            <div style={{ color: "#dbeafe", fontSize: "15px" }}>
              {slide.subtitle}
            </div>

            <div
              style={{
                display: "flex",
                gap: "7px",
                marginTop: "14px",
              }}
            >
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
                    backgroundColor:
                      active === index ? "white" : "rgba(255,255,255,0.45)",
                    cursor: "pointer",
                    transition: "all 0.25s ease",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}