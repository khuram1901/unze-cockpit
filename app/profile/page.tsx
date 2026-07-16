"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, authFetch } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import {
  COLOURS, RADII,
  cardStyle, inputStyle, labelStyle, primaryButtonStyle,
  PageHeader, SectionTitle, displayRole, useConfirm, SkeletonRows,
} from "../lib/SharedUI";

// ── role chip — mirrors MembersManager pattern ───────────────────
function roleChip(r: string, email?: string): React.CSSProperties {
  if (email === "k.saleem@unzegroup.com") return { backgroundColor: COLOURS.CARD_ALT, color: COLOURS.BLUE, border: `1px solid ${COLOURS.BLUE}` };
  if (r === "Admin" || r === "CEO") return { backgroundColor: COLOURS.NAVY, color: "#FFFFFF", border: `1px solid ${COLOURS.NAVY}` };
  if (r === "Executive") return { backgroundColor: "#EEE8F9", color: COLOURS.PURPLE, border: `1px solid ${COLOURS.PURPLE}` };
  if (r === "Manager")   return { backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, border: `1px solid ${COLOURS.GREEN}` };
  return { backgroundColor: COLOURS.CARD_ALT, color: COLOURS.INK_700, border: `1px solid ${COLOURS.HAIRLINE}` };
}

// ── avatar initials ──────────────────────────────────────────────
function avatarInitials(email: string): string {
  if (email === "k.saleem@unzegroup.com") return "KS";
  const parts = email.split("@")[0].split(/[._-]/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function ProfilePage() {
  const isMobile = useMobile();
  const dlg = useConfirm();
  const [email, setEmail] = useState("");
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [message, setMessage] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [userRole, setUserRole] = useState("");

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState({
    notif_task_assigned: true,
    notif_task_overdue: true,
    notif_escalations: true,
    notif_meetings: true,
    notif_daily_digest: true,
  });
  const [savingNotif, setSavingNotif] = useState(false);

  // Push notifications
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

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

    // Load MFA
    const { data } = await supabase.auth.mfa.listFactors();
    const totpFactors = data?.totp || [];
    const verified = totpFactors.filter((f) => f.status === "verified");
    setMfaEnabled(verified.length > 0);
    if (verified.length > 0) setFactorId(verified[0].id);

    // Load notification preferences
    if (user?.email) {
      const { data: member } = await supabase.from("members")
        .select("role, notif_task_assigned, notif_task_overdue, notif_escalations, notif_meetings, notif_daily_digest")
        .eq("email", user.email).maybeSingle();
      if (member) {
        setUserRole(member.role || "");
        setNotifPrefs({
          notif_task_assigned: member.notif_task_assigned ?? true,
          notif_task_overdue: member.notif_task_overdue ?? true,
          notif_escalations: member.notif_escalations ?? true,
          notif_meetings: member.notif_meetings ?? true,
          notif_daily_digest: member.notif_daily_digest ?? true,
        });
      }
    }
    // Check push notification status
    if (typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window) {
      setPushSupported(true);
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setPushEnabled(!!sub);
      } catch {
        setPushEnabled(false);
      }
    }

    setLoading(false);
  }

  async function enablePush() {
    setPushLoading(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Error: Notification permission denied. Please allow notifications in your browser settings.");
        setPushLoading(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setMessage("Error: Push notifications are not configured on this server.");
        setPushLoading(false);
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });

      const res = await authFetch("/api/notifications/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, subscription: sub.toJSON() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessage("Error: " + (data.error || "Failed to save subscription."));
        setPushLoading(false);
        return;
      }

      logAction("Updated", "push", "Enabled push notifications");
      setMessage("Push notifications enabled on this device.");
      setPushEnabled(true);
    } catch (err) {
      setMessage("Error: " + (err instanceof Error ? err.message : "Failed to enable push notifications."));
    }
    setPushLoading(false);
  }

  async function disablePush() {
    setPushLoading(true);
    setMessage("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();

      await authFetch("/api/notifications/push-subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      logAction("Updated", "push", "Disabled push notifications");
      setMessage("Push notifications disabled.");
      setPushEnabled(false);
    } catch (err) {
      setMessage("Error: " + (err instanceof Error ? err.message : "Failed to disable push notifications."));
    }
    setPushLoading(false);
  }

  async function startEnroll() {
    setEnrolling(true);
    setMessage("");
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Unze Group Dashboard Authenticator",
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
    if (!await dlg.confirm("Are you sure you want to disable 2FA? Your account will be less secure.", true)) return;

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

  // ── derived display values ───────────────────────────────────────
  const displayName = email === "k.saleem@unzegroup.com" ? "Khuram Saleem" : email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const roleLabel = displayRole(userRole, email) || userRole || "Member";
  const initials = avatarInitials(email);

  return (
    <AuthWrapper>
      {dlg.element}
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: 760, minWidth: 0 }}>
        <PageHeader />

        {/* Feedback message */}
        {message && (
          <div style={{
            ...cardStyle,
            padding: "10px 16px",
            marginBottom: "16px",
            borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
            fontSize: "13px",
            color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN,
          }}>
            {message}
          </div>
        )}

        {loading ? (
          <SkeletonRows count={3} height="56px" />
        ) : (
          <>
            {/* ── Profile header card ─────────────────────────────── */}
            <div style={{
              ...cardStyle,
              display: "flex",
              alignItems: "center",
              gap: "20px",
              marginBottom: "20px",
              flexWrap: isMobile ? "wrap" : "nowrap",
            }}>
              {/* Gradient avatar */}
              <div style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #3B4CCA, #6E7AE0)",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontSize: "22px",
                fontWeight: 600,
                fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                flexShrink: 0,
              }}>
                {initials}
              </div>

              {/* Name + role + email */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                  fontSize: "24px",
                  fontWeight: 600,
                  letterSpacing: "-0.015em",
                  color: COLOURS.NAVY,
                  lineHeight: 1.2,
                }}>
                  {displayName}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "6px", flexWrap: "wrap" }}>
                  <span style={{
                    ...roleChip(userRole, email),
                    fontSize: "11px",
                    fontWeight: 500,
                    padding: "3px 10px",
                    borderRadius: RADII.PILL,
                    display: "inline-block",
                  }}>
                    {roleLabel}
                  </span>
                  <span style={{
                    fontSize: "12px",
                    color: COLOURS.SLATE,
                    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  }}>
                    {email}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Jump links (tab strip) ───────────────────────────── */}
            <div style={{
              display: "flex",
              gap: "6px",
              marginBottom: "20px",
              flexWrap: "wrap",
              backgroundColor: COLOURS.CARD_ALT,
              border: `1px solid ${COLOURS.HAIRLINE}`,
              borderRadius: RADII.PILL,
              padding: "4px",
              width: "fit-content",
            }}>
              {[
                { id: "2fa", label: "2FA" },
                { id: "password", label: "Password" },
                { id: "notifications", label: "Notifications" },
                ...(pushSupported ? [{ id: "push", label: "Push" }] : []),
              ].map((s) => (
                <a key={s.id} href={`#${s.id}`} style={{
                  padding: "5px 14px",
                  borderRadius: RADII.PILL,
                  fontSize: "12px",
                  fontWeight: 500,
                  color: COLOURS.INK_700,
                  textDecoration: "none",
                  backgroundColor: "transparent",
                  transition: "background 120ms",
                }}>
                  {s.label}
                </a>
              ))}
            </div>

            {/* ── Email card ───────────────────────────────────────── */}
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={{ ...settingCardHead }}>
                <div style={settingCardTitle}>
                  <span style={iconMark}>✉</span>
                  Email address
                </div>
              </div>
              <div style={{ ...labelStyle, marginBottom: "6px" }}>Primary email (used to sign in)</div>
              <div style={{
                ...inputStyle,
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: "13px",
                color: COLOURS.NAVY,
                cursor: "default",
              }}>
                {email}
              </div>
              <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginTop: "6px", lineHeight: 1.5 }}>
                Contact your Unze Group administrator to change this address.
              </div>
            </div>

            {/* ── 2FA ─────────────────────────────────────────────── */}
            <div id="2fa">
              <SectionTitle title="Two-Factor Authentication (2FA)" />
            </div>
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={settingCardHead}>
                <div style={settingCardTitle}>
                  <span style={iconMark}>🛡</span>
                  Two-Factor Authentication
                </div>
                <span style={{
                  ...statusPill,
                  ...(mfaEnabled
                    ? { backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN }
                    : { backgroundColor: COLOURS.WARNING_SOFT, color: COLOURS.AMBER }),
                }}>
                  {mfaEnabled ? "Enabled" : "Not enabled"}
                </span>
              </div>

              {mfaEnabled ? (
                <>
                  <div style={{ fontSize: "13.5px", fontWeight: 500, color: COLOURS.NAVY, marginBottom: "4px" }}>
                    Your account is protected with TOTP authentication.
                  </div>
                  <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "16px", lineHeight: 1.5 }}>
                    You will be asked for a code from your authenticator app when signing in.
                  </p>
                  <button
                    onClick={disableMFA}
                    style={{
                      ...primaryButtonStyle,
                      backgroundColor: COLOURS.CARD,
                      color: COLOURS.RED,
                      border: `1px solid ${COLOURS.RED}`,
                    }}
                  >
                    Disable 2FA
                  </button>
                </>
              ) : !enrolling ? (
                <>
                  <div style={{ fontSize: "13.5px", fontWeight: 500, color: COLOURS.NAVY, marginBottom: "4px" }}>
                    Add an extra layer of security to your account.
                  </div>
                  <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "16px", lineHeight: 1.5 }}>
                    You will need an authenticator app like Google Authenticator or Authy. Recommended for all admin-role users.
                  </p>
                  <button onClick={startEnroll} style={primaryButtonStyle}>
                    Enable 2FA
                  </button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "12px" }}>
                    Step 1: Scan this QR code with your authenticator app
                  </p>
                  {qrCode && (
                    <div style={{ textAlign: "center", marginBottom: "16px" }}>
                      <img
                        src={qrCode}
                        alt="2FA QR Code"
                        style={{
                          maxWidth: "200px",
                          border: `1px solid ${COLOURS.HAIRLINE}`,
                          borderRadius: RADII.CARD,
                          padding: "8px",
                        }}
                      />
                    </div>
                  )}
                  <p style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "8px" }}>
                    Step 2: Enter the 6-digit code from your app
                  </p>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                      style={{
                        ...inputStyle,
                        fontSize: "20px",
                        fontWeight: 700,
                        letterSpacing: "8px",
                        textAlign: "center",
                        width: "100%",
                        maxWidth: "160px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    />
                    <button
                      onClick={verifyEnroll}
                      disabled={verifyCode.length !== 6}
                      style={{
                        ...primaryButtonStyle,
                        opacity: verifyCode.length === 6 ? 1 : 0.5,
                        cursor: verifyCode.length === 6 ? "pointer" : "not-allowed",
                      }}
                    >
                      Verify &amp; Enable
                    </button>
                  </div>
                  <button
                    onClick={() => { setEnrolling(false); setQrCode(null); setVerifyCode(""); }}
                    style={{
                      marginTop: "12px",
                      background: "transparent",
                      border: "none",
                      color: COLOURS.SLATE,
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {/* ── Change Password ──────────────────────────────────── */}
            <div id="password">
              <SectionTitle title="Change Password" />
            </div>
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={settingCardHead}>
                <div style={settingCardTitle}>
                  <span style={iconMark}>🔒</span>
                  Change password
                </div>
              </div>
              <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "16px", lineHeight: 1.5 }}>
                Enter your current password and choose a new one. Minimum 6 characters.
              </p>
              <form onSubmit={changePassword}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                  gap: "12px",
                  marginBottom: "12px",
                }}>
                  <label style={{ display: "block" }}>
                    <span style={labelStyle}>Current password</span>
                    <input
                      type="password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      required
                      placeholder="Enter current password"
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={labelStyle}>New password</span>
                    <input
                      type="password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      required
                      minLength={6}
                      placeholder="Minimum 6 characters"
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={labelStyle}>Confirm new password</span>
                    <input
                      type="password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      required
                      minLength={6}
                      placeholder="Repeat new password"
                      style={{
                        ...inputStyle,
                        border: `1px solid ${newPw && confirmPw && newPw !== confirmPw ? COLOURS.RED : COLOURS.HAIRLINE}`,
                      }}
                    />
                  </label>
                </div>
                {newPw && confirmPw && newPw !== confirmPw && (
                  <div style={{ fontSize: "12px", color: COLOURS.RED, marginBottom: "10px" }}>Passwords do not match</div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, lineHeight: 1.4 }}>
                    Passwords are hashed with argon2 and never stored in plain text.
                  </div>
                  <button
                    type="submit"
                    disabled={changingPw || !currentPw || newPw.length < 6 || newPw !== confirmPw}
                    style={{
                      ...primaryButtonStyle,
                      opacity: changingPw || !currentPw || newPw.length < 6 || newPw !== confirmPw ? 0.5 : 1,
                      cursor: changingPw || !currentPw || newPw.length < 6 || newPw !== confirmPw ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                      marginLeft: "16px",
                    }}
                  >
                    {changingPw ? "Changing..." : "Change password"}
                  </button>
                </div>
              </form>
            </div>

            {/* ── Notification Preferences ─────────────────────────── */}
            <div id="notifications">
              <SectionTitle title="Notification Preferences" />
            </div>
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={settingCardHead}>
                <div style={settingCardTitle}>
                  <span style={iconMark}>🔔</span>
                  Notification preferences
                </div>
                <div style={{ fontSize: "11.5px", color: COLOURS.SLATE }}>
                  {userRole !== "Admin" && userRole !== "CEO" ? "At least one must stay on." : "Admin can disable all."}
                </div>
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: "10px",
              }}>
                {([
                  { key: "notif_task_assigned" as const, label: "Task assigned to me", desc: "When someone assigns you a new task" },
                  { key: "notif_task_overdue" as const, label: "Overdue task reminders", desc: "When your tasks pass their due date" },
                  { key: "notif_escalations" as const, label: "Escalations", desc: "KPI and receivable escalation alerts" },
                  { key: "notif_meetings" as const, label: "Meeting notifications", desc: "Meeting minutes and approvals" },
                  { key: "notif_daily_digest" as const, label: "Daily digest", desc: "Morning summary email" },
                ]).map((pref) => {
                  const isOn = notifPrefs[pref.key];
                  const otherOn = Object.entries(notifPrefs).filter(([k]) => k !== pref.key).some(([, v]) => v);
                  const canTurnOff = userRole === "Admin" || userRole === "CEO" || otherOn;
                  return (
                    <label key={pref.key} style={{
                      display: "flex",
                      gap: "12px",
                      alignItems: "flex-start",
                      padding: "14px 16px",
                      border: `1px solid ${COLOURS.HAIRLINE}`,
                      borderRadius: RADII.CARD,
                      cursor: canTurnOff || !isOn ? "pointer" : "not-allowed",
                      backgroundColor: isOn ? COLOURS.CARD : COLOURS.CARD_ALT,
                      opacity: canTurnOff || !isOn ? 1 : 0.6,
                    }}>
                      {/* Checkbox */}
                      <div style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "6px",
                        backgroundColor: isOn ? COLOURS.NAVY : COLOURS.CARD,
                        border: `1.5px solid ${isOn ? COLOURS.NAVY : COLOURS.INK_300}`,
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        marginTop: "1px",
                      }}>
                        {isOn && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                        <input
                          type="checkbox"
                          checked={isOn}
                          disabled={!canTurnOff && isOn}
                          onChange={async () => {
                            if (!canTurnOff && isOn) return;
                            const updated = { ...notifPrefs, [pref.key]: !isOn };
                            setNotifPrefs(updated);
                            setSavingNotif(true);
                            await supabase.from("members").update({ [pref.key]: !isOn }).eq("email", email);
                            logAction("Updated", "members", `Notification: ${pref.key} = ${!isOn}`);
                            setSavingNotif(false);
                          }}
                          style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                        />
                      </div>
                      {/* Labels */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 500, color: COLOURS.NAVY }}>{pref.label}</div>
                        <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginTop: "2px" }}>{pref.desc}</div>
                      </div>
                      {/* Toggle */}
                      <div
                        onClick={(e) => {
                          e.preventDefault();
                          if (!canTurnOff && isOn) return;
                          const updated = { ...notifPrefs, [pref.key]: !isOn };
                          setNotifPrefs(updated);
                          setSavingNotif(true);
                          supabase.from("members").update({ [pref.key]: !isOn }).eq("email", email).then(() => {
                            logAction("Updated", "members", `Notification: ${pref.key} = ${!isOn}`);
                            setSavingNotif(false);
                          });
                        }}
                        style={{
                          width: "40px",
                          height: "22px",
                          borderRadius: "999px",
                          backgroundColor: isOn ? COLOURS.NAVY : COLOURS.INK_300,
                          position: "relative",
                          flexShrink: 0,
                          cursor: canTurnOff || !isOn ? "pointer" : "not-allowed",
                          transition: "background 120ms",
                        }}
                      >
                        <div style={{
                          position: "absolute",
                          top: "2px",
                          left: isOn ? "20px" : "2px",
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          backgroundColor: COLOURS.CARD,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                          transition: "left 120ms",
                        }} />
                      </div>
                    </label>
                  );
                })}
              </div>
              {savingNotif && (
                <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "10px" }}>Saving...</div>
              )}
            </div>

            {/* ── Push Notifications ───────────────────────────────── */}
            {pushSupported && (
              <>
                <div id="push">
                  <SectionTitle title="Push Notifications" />
                </div>
                <div style={{ ...cardStyle, marginBottom: "16px" }}>
                  <div style={settingCardHead}>
                    <div style={settingCardTitle}>
                      <span style={iconMark}>🔔</span>
                      Push notifications
                    </div>
                    <span style={{
                      ...statusPill,
                      ...(pushEnabled
                        ? { backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN }
                        : { backgroundColor: COLOURS.WARNING_SOFT, color: COLOURS.AMBER }),
                    }}>
                      {pushEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px" }}>
                    <div>
                      <div style={{ fontSize: "13.5px", fontWeight: 500, color: COLOURS.NAVY, marginBottom: "4px" }}>
                        {pushEnabled ? "Receive instant alerts on this device" : "Receive instant alerts on this device"}
                      </div>
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, lineHeight: 1.5 }}>
                        {pushEnabled
                          ? "You will receive push notifications for tasks, escalations and other alerts."
                          : "Even when the browser is in the background. Only used for urgent alerts, never marketing."}
                      </div>
                    </div>
                    {pushEnabled ? (
                      <button
                        onClick={disablePush}
                        disabled={pushLoading}
                        style={{
                          ...primaryButtonStyle,
                          backgroundColor: COLOURS.CARD,
                          color: COLOURS.RED,
                          border: `1px solid ${COLOURS.RED}`,
                          opacity: pushLoading ? 0.5 : 1,
                          cursor: pushLoading ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {pushLoading ? "Disabling..." : "Disable push"}
                      </button>
                    ) : (
                      <button
                        onClick={enablePush}
                        disabled={pushLoading}
                        style={{
                          ...primaryButtonStyle,
                          opacity: pushLoading ? 0.5 : 1,
                          cursor: pushLoading ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {pushLoading ? "Enabling..." : "Enable push"}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

// ── Local style constants ────────────────────────────────────────

const settingCardHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "16px",
  paddingBottom: "16px",
  borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
};

const settingCardTitle: React.CSSProperties = {
  fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
  fontSize: "15px",
  fontWeight: 600,
  letterSpacing: "-0.005em",
  color: COLOURS.NAVY,
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const iconMark: React.CSSProperties = {
  width: "30px",
  height: "30px",
  borderRadius: "8px",
  backgroundColor: COLOURS.CARD_ALT,
  border: `1px solid ${COLOURS.HAIRLINE}`,
  display: "inline-grid",
  placeItems: "center",
  color: COLOURS.INK_700,
  fontSize: "13px",
  flexShrink: 0,
};

const statusPill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "3px 10px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 500,
};
