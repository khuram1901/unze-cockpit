"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { useRequireCapability } from "../lib/useRouteGuard";
import { supabase } from "../lib/supabase";
import { formatDateTimeUK, formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, SkeletonRows, useConfirm, primaryButtonStyle } from "../lib/SharedUI";
import { COMPANIES } from "../lib/constants";

type Backup = { name: string; sizeKB: number | null; createdAt: string };
type ArchivedDoc = {
  id: string;
  doc_type: string;
  company_id: string;
  position_date: string | null;
  original_filename: string;
  storage_path: string;
  source: string;
  uploaded_by: string | null;
  created_at: string;
};

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}` },
  });
}

export default function AdminDataPage() {
  const { checking } = useRequireCapability("system_backups");
  const isMobile = useMobile();
  const { confirm, element: confirmElement } = useConfirm();

  const [backups, setBackups] = useState<Backup[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [docs, setDocs] = useState<ArchivedDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");

  const [runningBackup, setRunningBackup] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!checking) {
      loadBackups();
      loadDocs();
    }
  }, [checking]);

  useEffect(() => {
    if (!checking) loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTypeFilter, companyFilter]);

  async function loadBackups() {
    setLoadingBackups(true);
    const res = await authedFetch("/api/admin/list-backups");
    const json = await res.json();
    setBackups(json.backups || []);
    setLoadingBackups(false);
  }

  async function loadDocs() {
    setLoadingDocs(true);
    const params = new URLSearchParams();
    if (docTypeFilter) params.set("docType", docTypeFilter);
    if (companyFilter) params.set("companyId", companyFilter);
    const res = await authedFetch(`/api/admin/list-documents?${params.toString()}`);
    const json = await res.json();
    setDocs(json.documents || []);
    setLoadingDocs(false);
  }

  async function handleDownloadBackup(name: string) {
    const res = await authedFetch("/api/admin/list-backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: name }),
    });
    const json = await res.json();
    if (json.url) window.open(json.url, "_blank");
  }

  async function handleDownloadDoc(doc: ArchivedDoc) {
    const res = await authedFetch("/api/admin/list-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath: doc.storage_path }),
    });
    const json = await res.json();
    if (json.url) window.open(json.url, "_blank");
  }

  async function handleRunBackup() {
    const ok = await confirm("Run a backup now? This emails a snapshot and saves a copy to Storage. It does not affect live data.");
    if (!ok) return;
    setRunningBackup(true);
    setStatusMsg(null);
    try {
      const res = await authedFetch("/api/backup");
      const json = await res.json();
      if (json.ok) {
        setStatusMsg({ text: `Backup complete — ${json.tables} tables, ${json.totalRows} rows. Storage: ${json.storageBackup}.`, ok: true });
        loadBackups();
      } else {
        setStatusMsg({ text: `Backup failed: ${json.error || "unknown error"}. ${json.storageBackup ? `Storage: ${json.storageBackup}.` : ""}`, ok: false });
      }
    } catch {
      setStatusMsg({ text: "Backup request failed.", ok: false });
    }
    setRunningBackup(false);
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
        setStatusMsg({ text: `Restore finished with ${json.errorTables} error(s): ${errored.map((e: { table: string; status: string }) => `${e.table} (${e.status})`).join(", ")}`, ok: false });
      }
    } catch {
      setStatusMsg({ text: "Restore request failed.", ok: false });
    }
    setRestoring(false);
    setRestoreTarget(null);
    setRestoreConfirmText("");
  }

  function companyName(id: string) {
    return COMPANIES.find((c) => c.id === id)?.shortCode || id.slice(0, 8);
  }

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: "var(--text-secondary, #64748b)" }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary, #1e293b)", margin: "0 0 4px" }}>Data & Backups</h1>
        <p style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)", margin: "0 0 18px" }}>
          Source documents, nightly backups, and disaster recovery. Restores never delete data — they overwrite matching rows and leave the rest untouched.
        </p>

        {statusMsg && (
          <div style={{
            padding: "10px 14px", borderRadius: "8px", marginBottom: "16px", fontSize: "14px",
            backgroundColor: statusMsg.ok ? "#dcfce7" : "#fee2e2",
            color: statusMsg.ok ? "#16a34a" : "#dc2626",
          }}>{statusMsg.text}</div>
        )}

        {/* ── Backups ── */}
        <SectionTitle title="Backups" />
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
          <button onClick={handleRunBackup} disabled={runningBackup} style={{ ...primaryButtonStyle, opacity: runningBackup ? 0.6 : 1 }}>
            {runningBackup ? "Running…" : "Run backup now"}
          </button>
        </div>

        {loadingDocs && loadingBackups ? null : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
            <CountCard label="Backups stored" value={backups.length} color={COLOURS.BLUE} />
            <CountCard label="Source PDFs archived" value={docs.length} color={COLOURS.NAVY} />
          </div>
        )}

        {loadingBackups ? <SkeletonRows count={3} height="40px" /> : backups.length === 0 ? (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)", textAlign: "center", marginBottom: "20px" }}>
            No backups yet.
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden", marginBottom: "20px" }}>
            {backups.map((b) => (
              <div key={b.name} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-light, #f1f5f9)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{b.name}</div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>
                    {formatDateTimeUK(b.createdAt)} · {b.sizeKB ? `${b.sizeKB} KB` : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => handleDownloadBackup(b.name)} style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.BORDER}`, backgroundColor: "var(--bg-card, #fff)", color: COLOURS.NAVY, cursor: "pointer" }}>
                    Download
                  </button>
                  <button onClick={() => setRestoreTarget(b.name)} style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "none", backgroundColor: COLOURS.RED, color: "white", cursor: "pointer" }}>
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Source documents ── */}
        <SectionTitle title="Source Documents" />
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
          <select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: "6px", border: `1px solid ${COLOURS.BORDER}`, fontSize: "14px" }}>
            <option value="">All document types</option>
            <option value="cash_flow">Cash flow</option>
            <option value="bank_position">Bank position</option>
          </select>
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: "6px", border: `1px solid ${COLOURS.BORDER}`, fontSize: "14px" }}>
            <option value="">All companies</option>
            {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.shortCode}</option>)}
          </select>
        </div>

        {loadingDocs ? <SkeletonRows count={4} height="40px" /> : docs.length === 0 ? (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)", textAlign: "center" }}>
            No archived source documents match this filter.
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden" }}>
            {docs.map((d) => (
              <div key={d.id} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-light, #f1f5f9)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #1e293b)", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                    {d.original_filename}
                    <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 7px", borderRadius: "6px", backgroundColor: "#eff6ff", color: COLOURS.BLUE }}>{companyName(d.company_id)}</span>
                    <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 7px", borderRadius: "6px", backgroundColor: "#f1f5f9", color: COLOURS.SLATE }}>{d.doc_type === "cash_flow" ? "Cash flow" : "Bank position"}</span>
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>
                    {d.position_date ? formatDateUK(d.position_date) : "no date"} · {d.source} · uploaded {formatDateTimeUK(d.created_at)}
                  </div>
                </div>
                <button onClick={() => handleDownloadDoc(d)} style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.BORDER}`, backgroundColor: "var(--bg-card, #fff)", color: COLOURS.NAVY, cursor: "pointer", flexShrink: 0 }}>
                  Download
                </button>
              </div>
            ))}
          </div>
        )}

        {restoreTarget && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
          }} onClick={() => { setRestoreTarget(null); setRestoreConfirmText(""); }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              backgroundColor: "var(--bg-card, #ffffff)", borderRadius: "14px", padding: "28px",
              maxWidth: "440px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)",
            }}>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "10px" }}>Restore from backup</div>
              <p style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)", lineHeight: 1.5, margin: "0 0 14px" }}>
                This will overwrite every matching row across all tables in <strong>{restoreTarget}</strong> with the backup&apos;s version.
                Rows added since this backup are left alone — nothing is deleted. Type <strong>RESTORE</strong> to confirm.
              </p>
              <input
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder="RESTORE"
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: `1px solid ${COLOURS.BORDER}`, fontSize: "14px", marginBottom: "16px", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <button onClick={() => { setRestoreTarget(null); setRestoreConfirmText(""); }} style={{ padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, border: `1px solid ${COLOURS.BORDER}`, backgroundColor: "var(--bg-card, #fff)", color: COLOURS.NAVY, cursor: "pointer" }}>
                  Cancel
                </button>
                <button
                  onClick={handleRestore}
                  disabled={restoreConfirmText !== "RESTORE" || restoring}
                  style={{ padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, border: "none", backgroundColor: COLOURS.RED, color: "white", cursor: restoreConfirmText === "RESTORE" ? "pointer" : "not-allowed", opacity: restoreConfirmText === "RESTORE" ? 1 : 0.5 }}
                >
                  {restoring ? "Restoring…" : "Restore"}
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmElement}
      </main>
    </AuthWrapper>
  );
}
