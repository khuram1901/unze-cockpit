"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      setLoading(false);
      if (error) {
        setMessage("Error: " + error.message);
      } else {
        setMessage("Account created! You can now sign in.");
        setMode("signin");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (error) {
        setMessage("Error: " + error.message);
      } else {
        router.push("/tasks");
      }
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
    fontSize: "14px",
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
        <h1 style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "4px" }}>
          Unze Group Cockpit
        </h1>
        <p style={{ color: "#777", fontSize: "14px", marginBottom: "24px" }}>
          {mode === "signin" ? "Sign in to your account" : "Create an account"}
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: "14px" }}>
            Email
            <input
              type="email"
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label style={{ fontSize: "14px" }}>
            Password
            <input
              type="password"
              style={inputStyle}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
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
              fontSize: "15px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {loading
              ? "Please wait…"
              : mode === "signin"
              ? "Sign In"
              : "Sign Up"}
          </button>
        </form>

        {message && (
          <p
            style={{
              marginTop: "16px",
              fontSize: "14px",
              color: message.startsWith("Error") ? "red" : "green",
            }}
          >
            {message}
          </p>
        )}

        {mode === "signin" && (
          <p style={{ marginTop: "12px", fontSize: "14px", textAlign: "center" }}>
            <a href="/forgot-password" style={{ color: "#0070f3" }}>
              Forgot password?
            </a>
          </p>
        )}

        <p style={{ marginTop: "20px", fontSize: "14px", textAlign: "center" }}>
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => {
                  setMode("signup");
                  setMessage("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#0070f3",
                  cursor: "pointer",
                  fontSize: "14px",
                  textDecoration: "underline",
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => {
                  setMode("signin");
                  setMessage("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#0070f3",
                  cursor: "pointer",
                  fontSize: "14px",
                  textDecoration: "underline",
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
