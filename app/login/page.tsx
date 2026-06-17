"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

type MemberProfile = {
  role: string | null;
  department: string | null;
};

function getLandingRoute(profile: MemberProfile | null, email: string) {
  if (email.toLowerCase() === "khuram1901@gmail.com") return "/executive";

  const role = profile?.role || "Member";
  const department = profile?.department || "";

  if (role === "Admin" || role === "Executive") return "/executive";

  if (
    role === "Manager" &&
    ["Operations", "Production", "Unze Pole Production", "Manufacturing"].includes(department)
  ) {
    return "/dashboard";
  }

  if (role === "Manager" && department === "Finance") return "/finance";

  if (role === "Manager") return "/dashboard";

  return "/tasks";
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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

  return (
    <main
      style={{
        minHeight: "100vh",
        fontFamily: "sans-serif",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #2563eb 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "28px",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "980px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "28px",
          alignItems: "center",
        }}
      >
        <div style={{ color: "white" }}>
          <Link href="/" style={{ color: "white", textDecoration: "none", fontSize: "14px" }}>
            ← Back to Home
          </Link>

          <h1 style={{ fontSize: "48px", lineHeight: "1.05", margin: "28px 0 14px", fontWeight: 800 }}>
            Unze Group Cockpit
          </h1>

          <p style={{ color: "#dbeafe", fontSize: "18px", lineHeight: "1.6" }}>
            Sign in to access your role-based dashboard, tasks, exceptions, meeting requests, and management cockpit.
          </p>
        </div>

        <div
          style={{
            backgroundColor: "white",
            borderRadius: "22px",
            padding: "34px",
            boxShadow: "0 24px 70px rgba(0,0,0,0.25)",
          }}
        >
          <h2 style={{ fontSize: "30px", fontWeight: "bold", margin: "0 0 8px", color: "#111827" }}>
            Sign in
          </h2>

          <p style={{ color: "#64748b", marginBottom: "26px" }}>
            Enter your details to continue.
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
                  style={{ ...inputStyle, marginTop: 0, marginBottom: 0, paddingRight: "48px" }}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: "18px",
                  }}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                backgroundColor: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "13px 18px",
                fontSize: "15px",
                fontWeight: "bold",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Please wait..." : "Sign In"}
            </button>
          </form>

          {message && (
            <p style={{ marginTop: "16px", color: "#dc2626", fontSize: "14px" }}>
              {message}
            </p>
          )}

          <div style={{ marginTop: "18px", textAlign: "center" }}>
            <Link href="/forgot-password" style={{ color: "#2563eb", textDecoration: "none", fontSize: "14px" }}>
              Forgot password?
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

const labelStyle = {
  display: "block",
  fontSize: "14px",
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
  fontSize: "15px",
  boxSizing: "border-box" as const,
};