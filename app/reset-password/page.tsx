"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const router = useRouter();
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

    // If URL has hash tokens (Supabase redirect), manually set the session
    // This handles cases where the auto-detect misses the hash fragment
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

    // Listen for auth state changes — Supabase fires this when it processes the URL token
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) markReady();
    });

    // Also check if there's already a session (e.g. user is already logged in)
    async function checkExisting() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) markReady();
    }
    checkExisting();

    // Fallback timeout — if no session after 8 seconds, show error
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
      // Send password change confirmation email
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        fetch("/api/notifications/password-changed", {
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

  const inputStyle = {
    display: "block",
    width: "100%",
    padding: "10px",
    marginTop: "4px",
    marginBottom: "16px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "16px",
    boxSizing: "border-box" as const,
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
        backgroundColor: "#f5f5f5",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          backgroundColor: "white",
          padding: "32px",
          borderRadius: "12px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ fontSize: "26px", fontWeight: "bold", marginBottom: "4px" }}>
          Set a New Password
        </h1>
        <p style={{ color: "#777", fontSize: "16px", marginBottom: "24px" }}>
          Enter your new password below.
        </p>

        {checking ? (
          <p style={{ color: "#666", fontSize: "16px" }}>Verifying your reset link...</p>
        ) : sessionReady ? (
          <form onSubmit={handleSubmit}>
            <label style={{ fontSize: "16px", fontWeight: 600 }}>
              New password
              <input
                type="password"
                style={inputStyle}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="At least 6 characters"
              />
            </label>

            <label style={{ fontSize: "16px", fontWeight: 600 }}>
              Confirm password
              <input
                type="password"
                style={inputStyle}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Type password again"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                backgroundColor: "#1e293b",
                color: "white",
                border: "none",
                borderRadius: "6px",
                padding: "12px",
                fontSize: "17px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        ) : (
          <div>
            <a href="/forgot-password" style={{ color: "#2563eb", fontWeight: 600, fontSize: "16px" }}>
              Request a new password reset →
            </a>
          </div>
        )}

        {message && (
          <p
            style={{
              marginTop: "16px",
              fontSize: "16px",
              color: message.startsWith("Error") ? "red" : "green",
              fontWeight: 600,
            }}
          >
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
