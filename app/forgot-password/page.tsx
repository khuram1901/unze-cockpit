"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      setMessage("Error: " + error.message);
    } else {
      setMessage(
        "If that email exists, a password reset link has been sent. Check your inbox."
      );
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
          Reset your password
        </h1>
        <p style={{ color: "#777", fontSize: "16px", marginBottom: "24px" }}>
          Enter your email and we&apos;ll send you a reset link.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: "16px" }}>
            Email
            <input
              type="email"
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              backgroundColor: "#0070f3",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "12px",
              fontSize: "17px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>

        {message && (
          <p
            style={{
              marginTop: "16px",
              fontSize: "16px",
              color: message.startsWith("Error") ? "red" : "green",
            }}
          >
            {message}
          </p>
        )}

        <p style={{ marginTop: "20px", fontSize: "16px", textAlign: "center" }}>
          <a href="/login" style={{ color: "#0070f3" }}>
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}
