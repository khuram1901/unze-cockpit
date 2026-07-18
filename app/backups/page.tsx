"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII, PageHeader, useToast, primaryButtonStyle, inputStyle } from "../lib/SharedUI";
import { formatDateUK, formatDateTimeUK } from "../lib/dateUtils";
import { COMPANIES } from "../lib/constants";

const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];

type Backup = { name: string; sizeKB: number | null; createdAt: string };
type ArchivedDoc = {
  id: string; doc_type: string; company_id: string;
  position_date: string | null; original_filename: string;
  storage_path: string; source: string;
  uploaded_by: string | null; created_at: string;
};

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}` },
  });
}

function companyName(id: string) {
  return COMPANIES.find((c) => c.id === id)?.shortCode || id.slice(0, 8);
}

export default function BackupsPage() {
  const router = useRouter();
  const { show: showToast, element: toastElement } = useToast();

  const [checking, setChecking] = useState(true);
  const [authorised, setAuthorised] = useState(false);

  // ── State ──────────────────────────────────────────────────────────
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [runningBackup, setRunningBackup] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [docs, setDocs] = useState<ArchivedDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");

  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);

  // ── Auth check ─────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !ADMIN_EMAILS.includes((user.email || "").toLowerCase())) {
        router.replace("/");
        return;
      }
      setAuthorised(true);
      setChecking(false);
    });
  }, [router]);

  // ── Load on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (!authorised) return;
    loadBackups();
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorised]);

  // Reload docs when filters change
  const loadDocs = useCallback(async () => {
    setLoadingDocs(true);
    const params = new URLSearchParams();
    if (docTypeFilter) params.set("docType", docTypeFilter);
    if (companyFilter) params.set("companyId", companyFilter);
    const res = await authedFetch(`/api/admin/list-documents?${params.toString()}`);
    const json = await res.json();
    setDocs(json.documents || []);
    setLoadingDocs(false);
  }, [docTypeFilter, companyFilter]);

  useEffect(() => {
    if (!authorised) return;
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTypeFilter, companyFilter]);

  // ── Data loaders ───────────────────────────────────────────────────
  async function loadBackups() {
    setLoadingBackups(true);
    const res = await authedFetch("/api/admin/list-backups");
    const json = await res.json();
    setBackups(json.backups || []);
    setLoadingBackups(false);
  }

  // ── Actions ────────────────────────────────────────────────────────
  async function handleRunBackup() {
    const ok = await confirm("Run a backup now? This emails a snapshot and saves a copy to Storage.");
    if (!ok) return;
    setRunningBackup(true);
    setStatusMsg(null);
    try {
      const res = await authedFetch("/api/backup");
      const json = await res.json();
      if (json.ok) {
        setStatusMsg({ text: `Backup complete — ${json.tables} tables, ${json.totalRows} rows.`, ok: true });
        loadBackups();
      } else {
        setStatusMsg({ text: `Backup failed: ${json.error || "unknown error"}`, ok: false });
      }
    } catch {
      setStatusMsg({ text: "Backup request failed.", ok: false });
    }
    setRunningBackup(false);
  }

  async function handleDownloadBackup(name: string) {
    const res = await authedFetch("/api/admin/list-backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: name }),
    });
    const json = await res.json();
    if (json.url) window.open(json.url, "_blank");
    else showToast("Could not get download link", "error");
  }

  async function handleDownloadDoc(doc: ArchivedDoc) {
    const res = await authedFetch("/api/admin/list-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath: doc.storage_path }),
    });
    const json = await res.json();
    if (json.url) window.open(json.url, "_blank");
    else showToast("Could not get download link", "error");
  }

  async function handleRestore() {
    if (!restoreTarget || restoreConfirmText !== "RESTORE") return;
    setRestoring(true);
    setStatusMsg(null);
    try {
      const res = await authedFetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESTORE_FROM_BACKUP", filename: restoreTarget }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatusMsg({ text: `Restore complete — ${json.restoredTables} tables, ${json.totalRows} rows restored.`, ok: true });
      } else {
        const errored = (json.results || []).filter((r: { status: string }) => r.status.startsWith("error"));
        setStatusMsg({ text: `Restore finished with errors: ${errored.map((e: { table: string; status: string }) => `${e.table} (${e.status})`).join(", ")}`, ok: false });
      }
    } catch {
      setStatusMsg({ text: "Restore request failed.", ok: false });
    }
    setRestoring(false);
    setRestoreTarget(null);
    setRestoreConfirmText("");
  }

  if (checking) {
    return (
      <AuthWrapper>
        <div style={{ padding: "24px" }}>
          <p style={{ color: COLOURS.SLATE }}>Checking permissions…</p>
        </div>
      </AuthWrapper>
    );
  }

  if (!authorised) return null;

  const skeletonRow = (
    <div style={{ height: "44px", borderRadius: RADII.SM, backgroundColor: COLOURS.HAIRLINE, marginBottom: "8px", animation: "pulse 1.5s ease-in-out infinite" }} />
  );

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px", maxWidth: "800px" }}>
          <PageHeader />
          <h1 style={{ fontSize: "20px", fontWeight: 800, color: COLOURS.NAVY, margin: "0 0 4px" }}>Data &amp; Backups</h1>
          <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "0 0 24px" }}>
            Database snapshots and source document archive.
          </p>

          {statusMsg && (
            <div style={{
              padding: "10px 14px", borderRadius: RADII.CARD, marginBottom: "16px", fontSize: "13px",
              backgroundColor: statusMsg.ok ? "#D1FAE5" : "#FEE2E2",
              color: statusMsg.ok ? COLOURS.GREEN : COLOURS.RED,
              border: `1px solid ${statusMsg.ok ? "#9ED4A3" : "#EDB5B2"}`,
            }}>{statusMsg.text}</div>
          )}

          {/* ── Backups ── */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em" }}>💾 Database Backups</span>
            <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
            <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>{backups.length} saved</span>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
            <button onClick={handleRunBackup} disabled={runningBackup}
              style={{ ...primaryButtonStyle, opacity: runningBackup ? 0.6 : 1 }}>
              {runningBackup ? "Running…" : "Run backup now"}
            </button>
          </div>

          {loadingBackups ? (
            <div style={{ marginBottom: "20px" }}>{skeletonRow}{skeletonRow}{skeletonRow}</div>
          ) : backups.length === 0 ? (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "14px", backgroundColor: "white", color: COLOURS.SLATE, textAlign: "center", marginBottom: "20px" }}>
              No backups yet.
            </div>
          ) : (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: "white", overflow: "hidden", marginBottom: "28px" }}>
              {backups.map((b) => (
                <div key={b.name} style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{b.name}</div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>{formatDateTimeUK(b.createdAt)} · {b.sizeKB ? `${b.sizeKB} KB` : "—"}</div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => handleDownloadBackup(b.name)}
                      style={{ padding: "6px 12px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>
                      Download
                    </button>
                    <button onClick={() => setRestoreTarget(b.name)}
                      style={{ padding: "6px 12px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: "none", backgroundColor: COLOURS.RED, color: "white", cursor: "pointer" }}>
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Source Documents ── */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em" }}>📄 Source Documents</span>
            <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
            <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>{docs.length} archived</span>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
            <select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px", backgroundColor: "white", color: COLOURS.NAVY }}>
              <option value="">All document types</option>
              <option value="cash_flow">Cash flow</option>
              <option value="bank_position">Bank position</option>
            </select>
            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px", backgroundColor: "white", color: COLOURS.NAVY }}>
              <option value="">All companies</option>
              {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.shortCode}</option>)}
            </select>
          </div>

          {loadingDocs ? (
            <div>{skeletonRow}{skeletonRow}{skeletonRow}{skeletonRow}</div>
          ) : docs.length === 0 ? (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "14px", backgroundColor: "white", color: COLOURS.SLATE, textAlign: "center" }}>
              No archived source documents match this filter.
            </div>
          ) : (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: "white", overflow: "hidden" }}>
              {docs.map((d) => (
                <div key={d.id} style={{ padding: "8px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                      {d.original_filename}
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: RADII.XS, backgroundColor: "#EEF1FC", color: "#3B4CCA" }}>{companyName(d.company_id)}</span>
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>{d.doc_type === "cash_flow" ? "Cash flow" : "Bank position"}</span>
                    </div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                      {d.position_date ? formatDateUK(d.position_date) : "no date"} · {d.source} · uploaded {formatDateTimeUK(d.created_at)}
                    </div>
                  </div>
                  <button onClick={() => handleDownloadDoc(d)}
                    style={{ padding: "6px 12px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer", flexShrink: 0 }}>
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Restore modal ── */}
          {restoreTarget && (
            <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
              onClick={() => { setRestoreTarget(null); setRestoreConfirmText(""); }}>
              <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "28px", maxWidth: "440px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
                <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "10px" }}>Restore from backup</div>
                <p style={{ fontSize: "13px", color: COLOURS.SLATE, lineHeight: 1.5, margin: "0 0 14px" }}>
                  This will overwrite every matching row in <strong>{restoreTarget}</strong>. Nothing is deleted. Type <strong>RESTORE</strong> to confirm.
                </p>
                <input value={restoreConfirmText} onChange={(e) => setRestoreConfirmText(e.target.value)}
                  placeholder="RESTORE" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const, marginBottom: "16px" }} />
                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button onClick={() => { setRestoreTarget(null); setRestoreConfirmText(""); }}
                    style={{ padding: "8px 18px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button onClick={handleRestore} disabled={restoreConfirmText !== "RESTORE" || restoring}
                    style={{ padding: "8px 18px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: "none", backgroundColor: COLOURS.RED, color: "white", cursor: restoreConfirmText === "RESTORE" ? "pointer" : "not-allowed", opacity: restoreConfirmText === "RESTORE" ? 1 : 0.5 }}>
                    {restoring ? "Restoring…" : "Restore"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {toastElement}
        </main>
    </AuthWrapper>
  );
}
