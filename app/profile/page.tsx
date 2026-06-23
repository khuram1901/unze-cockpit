"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, PageHeader, SectionTitle } from "../lib/SharedUI";

export default function ProfilePage() {
  const isMobile = useMobile();
  const [email, setEmail] = useState("");
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [message, setMessage] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  // Change password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    checkMFA();
  }, []);

  async function checkMFA() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setEmail(user?.email || "");

    const { data } = await supabase.auth.mfa.listFactors();
    const totpFactors = data?.totp || [];
    const verified = totpFactors.filter((f) => f.status === "verified");
    setMfaEnabled(verified.length > 0);
    if (verified.length > 0) {
      setFactorId(verified[0].id);
    }
    setLoading(false);
  }

  async function startEnroll() {
    setEnrolling(true);
    setMessage("");
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Cockpit Authenticator",
    });

    if (error) {
      setMessage("Error: " + error.message);
      setEnrolling(false);
      return;
    }

    setQrCode(data.totp.qr_code);
    setFactorId(data.id);
  }

  async function verifyEnroll() {
    if (!factorId || !verifyCode) return;
    setMessage("");

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });

    if (challengeError) {
      setMessage("Error: " + challengeError.message);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: verifyCode,
    });

    if (verifyError) {
      setMessage("Error: Invalid code. Please try again.");
      return;
    }

    logAction("Updated", "auth", "Enabled 2FA (TOTP)");
    setMessage("2FA enabled successfully.");
    setQrCode(null);
    setVerifyCode("");
    setEnrolling(false);
    setMfaEnabled(true);
  }

  async function disableMFA() {
    if (!factorId) return;
    if (!confirm("Are you sure you want to disable 2FA? Your account will be less secure.")) return;

    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      setMessage("Error: " + error.message);
      return;
    }

    logAction("Updated", "auth", "Disabled 2FA (TOTP)");
    setMessage("2FA disabled.");
    setMfaEnabled(false);
    setFactorId(null);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw.length < 6) { setMessage("Error: Password must be at least 6 characters."); return; }
    if (newPw !== confirmPw) { setMessage("Error: Passwords do not match."); return; }

    setChangingPw(true);
    setMessage("");

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage("Error: " + (data.error || "Failed to change password."));
        setChangingPw(false);
        return;
      }

      logAction("Updated", "auth", "Changed password");
      setMessage("Password changed successfully.");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch {
      setMessage("Error: Network error.");
    }
    setChangingPw(false);
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader title="My Profile" subtitle="Account security settings" />

        {message && (
          <div style={{
            border: `1px solid ${COLOURS.BORDER}`,
            borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
            borderRadius: "6px",
            padding: "10px 14px",
            marginBottom: "14px",
            backgroundColor: "white",
            fontSize: "16px",
            color: COLOURS.NAVY,
          }}>
            {message}
          </div>
        )}

        {loading ? (
          <p style={{ color: COLOURS.SLATE }}>Loading...</p>
        ) : (
          <>
            <div style={{
              border: `1px solid ${COLOURS.BORDER}`,
              borderRadius: "8px",
              padding: "16px",
              backgroundColor: "white",
              marginBottom: "16px",
            }}>
              <div style={{ fontSize: "16px", color: COLOURS.SLATE, marginBottom: "4px" }}>Email</div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: COLOURS.NAVY }}>{email}</div>
            </div>

            <SectionTitle title="Two-Factor Authentication (2FA)" />
            <div style={{
              border: `1px solid ${COLOURS.BORDER}`,
              borderRadius: "8px",
              padding: "16px",
              backgroundColor: "white",
            }}>
              {mfaEnabled ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                    <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: COLOURS.GREEN, display: "inline-block" }} />
                    <span style={{ fontSize: "17px", fontWeight: 700, color: COLOURS.GREEN }}>2FA is enabled</span>
                  </div>
                  <p style={{ fontSize: "15px", color: COLOURS.SLATE, marginBottom: "12px" }}>
                    Your account is protected with TOTP authentication. You will be asked for a code from your authenticator app when signing in.
                  </p>
                  <button
                    onClick={disableMFA}
                    style={{
                      backgroundColor: "white",
                      color: COLOURS.RED,
                      border: `1px solid ${COLOURS.RED}`,
                      borderRadius: "6px",
                      padding: "8px 16px",
                      fontSize: "15px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Disable 2FA
                  </button>
                </>
              ) : !enrolling ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                    <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: COLOURS.AMBER, display: "inline-block" }} />
                    <span style={{ fontSize: "17px", fontWeight: 700, color: COLOURS.AMBER }}>2FA is not enabled</span>
                  </div>
                  <p style={{ fontSize: "15px", color: COLOURS.SLATE, marginBottom: "12px" }}>
                    Add an extra layer of security to your account. You will need an authenticator app like Google Authenticator or Authy.
                  </p>
                  <button
                    onClick={startEnroll}
                    style={{
                      backgroundColor: COLOURS.NAVY,
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      padding: "10px 20px",
                      fontSize: "16px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Enable 2FA
                  </button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px" }}>
                    Step 1: Scan this QR code with your authenticator app
                  </p>
                  {qrCode && (
                    <div style={{ textAlign: "center", marginBottom: "16px" }}>
                      <img src={qrCode} alt="2FA QR Code" style={{ maxWidth: "200px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "8px" }} />
                    </div>
                  )}
                  <p style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>
                    Step 2: Enter the 6-digit code from your app
                  </p>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="text"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                      style={{
                        padding: "10px 14px",
                        border: `1px solid ${COLOURS.BORDER}`,
                        borderRadius: "6px",
                        fontSize: "20px",
                        fontWeight: 700,
                        letterSpacing: "8px",
                        textAlign: "center",
                        width: "160px",
                      }}
                    />
                    <button
                      onClick={verifyEnroll}
                      disabled={verifyCode.length !== 6}
                      style={{
                        backgroundColor: COLOURS.NAVY,
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        padding: "10px 20px",
                        fontSize: "16px",
                        fontWeight: 700,
                        cursor: verifyCode.length === 6 ? "pointer" : "not-allowed",
                        opacity: verifyCode.length === 6 ? 1 : 0.5,
                      }}
                    >
                      Verify & Enable
                    </button>
                  </div>
                  <button
                    onClick={() => { setEnrolling(false); setQrCode(null); setVerifyCode(""); }}
                    style={{ marginTop: "12px", background: "transparent", border: "none", color: COLOURS.SLATE, fontSize: "15px", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            <SectionTitle title="Change Password" />
            <div style={{
              border: `1px solid ${COLOURS.BORDER}`,
              borderRadius: "8px",
              padding: "16px",
              backgroundColor: "white",
            }}>
              <p style={{ fontSize: "14px", color: COLOURS.SLATE, marginBottom: "12px" }}>
                Enter your current password and choose a new one. Minimum 6 characters.
              </p>
              <form onSubmit={changePassword}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                  <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>
                    Current Password
                    <input
                      type="password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      required
                      placeholder="Enter current password"
                      style={{
                        display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
                        border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
                      }}
                    />
                  </label>
                  <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>
                    New Password
                    <input
                      type="password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      required
                      minLength={6}
                      placeholder="Min 6 characters"
                      style={{
                        display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
                        border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
                      }}
                    />
                  </label>
                  <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>
                    Confirm New Password
                    <input
                      type="password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      required
                      minLength={6}
                      placeholder="Repeat new password"
                      style={{
                        display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
                        border: `1px solid ${newPw && confirmPw && newPw !== confirmPw ? COLOURS.RED : COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
                      }}
                    />
                  </label>
                </div>
                {newPw && confirmPw && newPw !== confirmPw && (
                  <div style={{ fontSize: "13px", color: COLOURS.RED, marginBottom: "8px" }}>Passwords do not match</div>
                )}
                <button
                  type="submit"
                  disabled={changingPw || !currentPw || newPw.length < 6 || newPw !== confirmPw}
                  style={{
                    backgroundColor: COLOURS.NAVY,
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 18px",
                    fontSize: "15px",
                    fontWeight: 700,
                    cursor: changingPw || !currentPw || newPw.length < 6 || newPw !== confirmPw ? "not-allowed" : "pointer",
                    opacity: changingPw || !currentPw || newPw.length < 6 || newPw !== confirmPw ? 0.5 : 1,
                  }}
                >
                  {changingPw ? "Changing..." : "Change Password"}
                </button>
              </form>
            </div>
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
