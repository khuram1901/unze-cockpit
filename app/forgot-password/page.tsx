"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import Link from "next/link";
import { useMobile } from "../lib/useMobile";
import { COLOURS } from "../lib/SharedUI";

export default function ForgotPasswordPage() {
  const isMobile = useMobile();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      await res.json();
      setMessage("If that email exists, a password reset link has been sent. Check your inbox (including spam folder).");
    } catch {
      setMessage("Error sending reset email. Please try again.");
    }

    setLoading(false);
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "sans-serif",
      backgroundColor: "#f4f6f9",
      padding: isMobile ? "16px" : "32px",
    }}>
      <div style={{
        width: "100%", maxWidth: "420px",
        backgroundColor: "#ffffff",
        padding: isMobile ? "28px 24px" : "40px 36px",
        borderRadius: "16px",
        border: `1px solid ${COLOURS.HAIRLINE}`,
        boxShadow: "0 8px 30px rgba(15,23,42,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "28px" }}>
          <img src="/unze-logo.png" alt="Unze Group" style={{ height: "32px", objectFit: "contain" }} />
          <span style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>PulseDesk</span>
        </div>

        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>
          Reset your password
        </h1>
        <p style={{ color: COLOURS.SLATE, fontSize: "14px", margin: "0 0 24px", lineHeight: 1.5 }}>
          Enter your email and we&apos;ll send you a reset link.
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
                border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "15px",
                boxSizing: "border-box", outline: "none",
                transition: "border-color 0.15s",
                backgroundColor: "#f8fafc",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.backgroundColor = "#fff"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = COLOURS.HAIRLINE; e.currentTarget.style.backgroundColor = "#f8fafc"; }}
            />
          </div>

          <button type="submit" disabled={loading} style={{
            width: "100%", backgroundColor: "#0f172a", color: "white",
            border: "none", borderRadius: "8px", padding: "11px 18px",
            fontSize: "15px", fontWeight: 600, cursor: loading ? "wait" : "pointer",
            transition: "background-color 0.15s",
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        {message && (
          <div style={{
            marginTop: "16px", padding: "10px 14px",
            borderRadius: "8px", fontSize: "13px", fontWeight: 500,
            backgroundColor: message.startsWith("Error") ? "#fef2f2" : "#f0fdf4",
            color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN,
            border: `1px solid ${message.startsWith("Error") ? "#fecaca" : "#bbf7d0"}`,
          }}>
            {message}
          </div>
        )}

        <div style={{ marginTop: "20px", textAlign: "center" }}>
          <Link href="/login" style={{ fontSize: "13px", color: "#3b82f6", textDecoration: "none", fontWeight: 500 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", marginRight: "4px" }}>
              <path d="M10 12L6 8l4-4" />
            </svg>
            Back to sign in
          </Link>
        </div>
      </div>

      <div style={{ marginTop: "24px", color: "#94a3b8", fontSize: "12px" }}>
        &copy; Unze Group 1989&ndash;2026 &middot; v3.0 &middot; All Rights Reserved
      </div>
    </main>
  );
}
