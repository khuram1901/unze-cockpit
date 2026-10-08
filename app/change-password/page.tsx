"use client";

/**
 * /change-password
 *
 * Forced password-change screen for store users whose account has
 * app_metadata.must_change_password = true.
 *
 * Shown automatically when the middleware detects must_change_password on any
 * /api/* call. The /daily-sales page also checks app_metadata on boot and
 * redirects here if needed.
 *
 * Flow:
 *   1. User enters their initial password and a new password.
 *   2. POST /api/auth/change-password (which clears must_change_password server-side).
 *   3. Re-sign-in with the new password to get a fresh JWT (without the flag).
 *   4. Redirect to /daily-sales.
 *
 * This page is intentionally minimal — no nav, no sidebar.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from the current password.");
      return;
    }

    setLoading(true);
    try {
      // Get current session for the API call
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Session expired. Please sign in again.");
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: session.user.email,
          currentPassword,
          newPassword,
        }),
      });

      const json = await res.json() as { success?: boolean; error?: string };

      if (!res.ok) {
        setError(json.error ?? "Failed to update password.");
        return;
      }

      // Re-sign-in to get a fresh JWT without must_change_password
      await supabase.auth.signOut();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: session.user.email!,
        password: newPassword,
      });

      if (signInError) {
        setError("Password updated but sign-in failed. Please sign in again.");
        router.replace("/login");
        return;
      }

      // Fresh JWT — redirect to daily-sales
      router.replace("/daily-sales");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f4f6f9",
      padding: "20px",
    }}>
      <div style={{
        background: "#ffffff",
        borderRadius: "12px",
        padding: "32px 28px",
        width: "100%",
        maxWidth: "380px",
        boxShadow: "0 2px 12px rgba(15,23,32,0.10)",
      }}>
        {/* Logo / branding */}
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{
            width: "48px",
            height: "48px",
            background: "#0F1720",
            borderRadius: "10px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "12px",
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="#ffffff" strokeWidth="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#ffffff" strokeWidth="2"/>
            </svg>
          </div>
          <h1 style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#0F1720",
            margin: 0,
          }}>
            Set your password
          </h1>
          <p style={{
            fontSize: "13px",
            color: "#64748B",
            margin: "6px 0 0",
            lineHeight: "1.4",
          }}>
            Your account requires a password change before you can continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              color: "#0F1720",
              marginBottom: "5px",
            }}>
              Current password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #EEF0F3",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#0F1720",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>

          <div>
            <label style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              color: "#0F1720",
              marginBottom: "5px",
            }}>
              New password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #EEF0F3",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#0F1720",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <p style={{ fontSize: "11px", color: "#64748B", margin: "4px 0 0" }}>
              Minimum 8 characters
            </p>
          </div>

          <div>
            <label style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              color: "#0F1720",
              marginBottom: "5px",
            }}>
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #EEF0F3",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#0F1720",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>

          {error && (
            <div style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: "8px",
              padding: "10px 12px",
              fontSize: "13px",
              color: "#B3261E",
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? "#64748B" : "#0F1720",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "12px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              marginTop: "4px",
            }}
          >
            {loading ? "Updating…" : "Set new password"}
          </button>
        </form>
      </div>
    </main>
  );
}
