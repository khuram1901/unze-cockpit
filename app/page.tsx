import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        fontFamily: "sans-serif",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #2563eb 100%)",
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
          <div style={{ fontSize: "14px", opacity: 0.85, marginBottom: "18px" }}>
            Unze Group · CEO Operating System
          </div>

          <h1 style={{ fontSize: "56px", lineHeight: "1.05", margin: "0 0 18px", fontWeight: 800 }}>
            Unze Group Cockpit
          </h1>

          <p style={{ fontSize: "19px", lineHeight: "1.6", color: "#dbeafe", maxWidth: "620px", marginBottom: "28px" }}>
            One command center for operations, exceptions, tasks, meetings, finance, and executive decisions.
          </p>

          <Link
            href="/login"
            style={{
              backgroundColor: "white",
              color: "#1e293b",
              textDecoration: "none",
              padding: "14px 24px",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "15px",
              display: "inline-block",
            }}
          >
            Enter Cockpit
          </Link>
        </div>

        <div
          style={{
            borderRadius: "24px",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.22)",
            boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
            backgroundColor: "rgba(255,255,255,0.12)",
            minHeight: "420px",
            backgroundImage: "url('/login-hero.png')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      </section>
    </main>
  );
}