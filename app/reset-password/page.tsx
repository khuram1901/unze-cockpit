"use client";

import { useState, useEffect } from "react";
import { supabase, authFetch } from "../lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMobile } from "../lib/useMobile";

export default function ResetPasswordPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      setSessionReady(true);
      setChecking(false);
    };

    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
          if (!error) {
            window.history.replaceState(null, "", window.location.pathname);
            markReady();
          }
        });
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) markReady();
    });

    async function checkExisting() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) markReady();
    }
    checkExisting();

    const timeout = setTimeout(() => {
      if (!settled) {
        setChecking(false);
        setMessage("No valid reset link found. Please request a new password reset from the login page.");
      }
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setMessage("Error: Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setMessage("Error: Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      setMessage("Error: " + error.message);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        authFetch("/api/notifications/password-changed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email }),
        }).catch(() => {});
      }
      setMessage("Password updated successfully! Redirecting to sign in...");
      await supabase.auth.signOut();
      setTimeout(() => router.push("/login"), 2000);
    }
  }

  const inputProps = {
    style: {
      display: "block" as const, width: "100%", padding: "10px 14px",
      border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "15px",
      boxSizing: "border-box" as const, outline: "none",
      transition: "border-color 0.15s",
      backgroundColor: "#f8fafc",
    },
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.backgroundColor = "#fff"; },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.backgroundColor = "#f8fafc"; },
  };

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
        border: "1px solid #e2e8f0",
        boxShadow: "0 8px 30px rgba(15,23,42,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "28px" }}>
          <img src="/unze-logo.png" alt="Unze Group" style={{ height: "32px", objectFit: "contain" }} />
          <span style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>PulseDesk</span>
        </div>

        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>
          Set a new password
        </h1>
        <p style={{ color: "#64748b", fontSize: "14px", margin: "0 0 24px", lineHeight: 1.5 }}>
          Enter your new password below.
        </p>

        {checking ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ fontSize: "14px", color: "#64748b" }}>Verifying your reset link...</div>
          </div>
        ) : sessionReady ? (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "18px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="At least 6 characters"
                {...inputProps}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Type password again"
                {...inputProps}
              />
            </div>

            <button type="submit" disabled={loading} style={{
              width: "100%", backgroundColor: "#0f172a", color: "white",
              border: "none", borderRadius: "8px", padding: "11px 18px",
              fontSize: "15px", fontWeight: 600, cursor: loading ? "wait" : "pointer",
              transition: "background-color 0.15s",
              opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        ) : (
          <div style={{
            padding: "16px", borderRadius: "8px",
            backgroundColor: "#fef2f2", border: "1px solid #fecaca",
          }}>
            <Link href="/forgot-password" style={{ color: "#3b82f6", fontWeight: 600, fontSize: "14px", textDecoration: "none" }}>
              Request a new password reset &rarr;
            </Link>
          </div>
        )}

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
