"use client";
import { useEffect, useState } from "react";
import { UserCtxContext } from "../../lib/AuthWrapper";
import { useContext } from "react";
import { useRouter } from "next/navigation";

const TIMEOUT_KEY = "unze:session-timeout-ms";

const OPTIONS = [
  { label: "30 minutes", value: 30 * 60_000, description: "Recommended for shared computers" },
  { label: "1 hour",     value: 60 * 60_000, description: "Balanced security and convenience" },
  { label: "2 hours",    value: 120 * 60_000, description: "Best for dedicated personal devices" },
] as const;

const NAVY   = "#0F1720";
const SLATE  = "#64748B";
const BORDER = "#EEF0F3";
const GREEN  = "#0F7B5F";
const BG     = "#F8F9FB";

export default function SessionSettingsPage() {
  const ctx = useContext(UserCtxContext);
  const router = useRouter();
  useEffect(() => { if (ctx !== null && !ctx.userEmail) router.push("/login"); }, [ctx, router]);

  const [selected, setSelected] = useState<number>(30 * 60_000);
  const [saved, setSaved] = useState(false);

  // Load persisted value on mount
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(TIMEOUT_KEY));
      if (stored === 60 * 60_000 || stored === 120 * 60_000) {
        setSelected(stored);
      }
    } catch { /* private mode */ }
  }, []);

  function handleSelect(value: number) {
    setSelected(value);
    try { localStorage.setItem(TIMEOUT_KEY, String(value)); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 20px" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: 0, marginBottom: 6 }}>
          Session Timeout
        </h1>
        <p style={{ fontSize: 13, color: SLATE, margin: 0, lineHeight: 1.5 }}>
          You&apos;ll be signed out automatically after this period of inactivity.
          A warning will appear 60 seconds before you&apos;re logged out.
        </p>
      </div>

      {/* Options */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {OPTIONS.map(opt => {
          const active = selected === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 18px",
                borderRadius: 12,
                border: `2px solid ${active ? GREEN : BORDER}`,
                background: active ? "#F0FAF7" : "#fff",
                cursor: "pointer",
                textAlign: "left",
                minHeight: 0,
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              {/* Radio dot */}
              <div style={{
                width: 20, height: 20,
                borderRadius: "50%",
                border: `2px solid ${active ? GREEN : "#C9D0D8"}`,
                background: active ? GREEN : "#fff",
                flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {active && (
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />
                )}
              </div>
              {/* Text */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 2 }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 12, color: SLATE }}>
                  {opt.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Saved confirmation */}
      <div style={{
        height: 32,
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: saved ? 1 : 0,
        transition: "opacity 0.3s",
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: "50%",
          background: GREEN,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, color: "#fff", fontWeight: 700,
        }}>✓</div>
        <span style={{ fontSize: 13, color: GREEN, fontWeight: 600 }}>
          Saved — takes effect next time you log in
        </span>
      </div>

      {/* Info box */}
      <div style={{
        marginTop: 12,
        padding: "14px 16px",
        background: BG,
        borderRadius: 10,
        border: `1px solid ${BORDER}`,
      }}>
        <p style={{ fontSize: 12, color: SLATE, margin: 0, lineHeight: 1.6 }}>
          <strong style={{ color: NAVY }}>Note:</strong> This setting is stored on this device only.
          If you log in on another device, it will use the default (30 minutes) until you set it there too.
          The &quot;Keep me signed in&quot; option on the login page overrides this and keeps your session
          active for 30 days regardless.
        </p>
      </div>
    </div>
  );
}
