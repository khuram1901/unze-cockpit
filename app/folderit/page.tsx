"use client";

import React, { useEffect, useState, useContext, createContext } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch } from "../lib/supabase";
import { COLOURS, RADII, SHADOWS, cardStyle, PageHeader } from "../lib/SharedUI";
import { useRequireCapability } from "../lib/useRouteGuard";
import { useMobile } from "../lib/useMobile";

const { NAVY, SLATE, HAIRLINE } = COLOURS;

const COMPANY_BADGE_STYLES: Record<string, { bg: string; text: string }> = {
  UTPL: { bg: COLOURS.INFO_SOFT,    text: COLOURS.BLUE },
  IFPL: { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN },
  BRNH: { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  HD:   { bg: "#F3EEF9",            text: "#6E45B8" },
  ALM:  { bg: COLOURS.CARD_ALT,     text: COLOURS.SLATE },
  DIR:  { bg: COLOURS.CARD_ALT,     text: COLOURS.NAVY },
  // Merged Baranh + Haute Dolci card on this page — its own badge colour
  // (distinct from both) so it reads as one company in the chart, not a
  // clash of the two it's made from.
  RST:  { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  SMI:  { bg: "#F5F3FF",            text: "#5B21B6" }, // S&M Investments — violet
  UZL:  { bg: "#FFF7ED",            text: "#C2410C" }, // Unze London — orange
};

// In-app document preview — no downloads. FolderitDashboard owns the modal
// state; this context lets deeply-nested rows open it without
// prop-drilling a setter through every intermediate component.
type PreviewTarget = { url: string; name: string | null } | null;
const PreviewContext = createContext<(target: PreviewTarget) => void>(() => {});

// Asks the backend for the actual PDF preview bytes and turns them into a
// local blob: URL. The backend proxies Folderit's preview content itself
// rather than handing back Folderit's signed link — that link carries its
// own Content-Disposition baked into the signature (set to "attachment"),
// which caused the browser to download it no matter what the frontend did
// with it. A blob: URL has no such disposition; the browser renders it
// inline in the iframe based on its Content-Type alone.
async function fetchPreviewBlobUrl(fileUid: string, accountUid?: string): Promise<string> {
  const params = new URLSearchParams({ file: fileUid });
  if (accountUid) params.set("account_uid", accountUid);
  const res = await authFetch(`/api/folderit/file-url?${params}`);
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok || contentType.includes("application/json")) {
    let message = "Couldn't preview this document.";
    try {
      const json = await res.json();
      if (json?.error) message = json.error;
    } catch {
      // no JSON body — use the default message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// In-app preview only — Folderit's /preview endpoint returns a PDF
// rendition of the document (converted server-side, regardless of the
// original file type), shown inline in an iframe with the built-in
// viewer's own toolbar/download button hidden. Nothing is saved to disk
// and no separate tab/download prompt ever opens.
function PreviewModal({ url, name, onClose }: { url: string; name: string | null; onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(15,23,32,0.72)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: COLOURS.CARD, borderRadius: RADII.CARD, width: "100%", maxWidth: "960px",
          height: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: SHADOWS.HOVER,
        }}
      >
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name ?? "Document preview"}
          </span>
          <span onClick={onClose} style={{ cursor: "pointer", fontSize: "12.5px", color: SLATE, fontWeight: 600, flexShrink: 0 }}>Close ✕</span>
        </div>
        <iframe
          src={`${url}#toolbar=0&navpanes=0`}
          title={name ?? "Document preview"}
          style={{ flex: 1, border: "none", width: "100%" }}
        />
      </div>
    </div>
  );
}

// ── Browse tab: full folder-tree file browser ──────────────────────────

type BrowseAccount = {
  account_uid: string;
  account_name: string;
  company: { id: string; name: string; short_code: string } | null;
};
type BrowseFolder = { uid: string; name: string };
type BrowseFile = { uid: string; name: string; createdAt: number | null; size: number | null };

// Same as fetchPreviewBlobUrl but passes account_uid explicitly — browse
// files aren't in the inbox/HR sync tables so the RPC lookup would 404.
async function fetchBrowsePreviewBlobUrl(fileUid: string, accountUid: string): Promise<string> {
  const res = await authFetch(
    `/api/folderit/file-url?file=${encodeURIComponent(fileUid)}&account_uid=${encodeURIComponent(accountUid)}`
  );
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok || contentType.includes("application/json")) {
    let message = "Couldn't preview this document.";
    try {
      const json = await res.json();
      if (json?.error) message = json.error;
    } catch { /* use default */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Tree node for the left-panel folder sidebar ───────────────────────────
type TreeNode = {
  folder: BrowseFolder;
  children: TreeNode[];
  depth: number;
};

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "📄";
  if (["xlsx", "xls", "csv"].includes(ext)) return "📊";
  if (["docx", "doc"].includes(ext)) return "📝";
  if (["pptx", "ppt"].includes(ext)) return "📑";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "🖼️";
  return "📎";
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileDate(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Global Folderit Search ────────────────────────────────────────────────
type SearchHit = {
  uid: string;
  name: string;
  type: string;
  account_uid: string;
  account_name: string;
  folder_uid: string | null;
  folder_name: string | null;
  created_at: string | null;
  folderit_url: string;
};

function GlobalSearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/folderit/live-search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.items ?? []);
          setOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }, 400);
  }

  return (
    <div ref={boxRef} style={{ position: "relative", marginBottom: "8px" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD,
        background: "white", padding: "0 12px", height: "40px",
        boxShadow: SHADOWS.CARD,
      }}>
        <span style={{ color: COLOURS.SLATE, fontSize: "15px" }}>🔍</span>
        <input
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search all Folderit documents…"
          style={{
            border: "none", outline: "none", flex: 1,
            fontSize: "13px", color: COLOURS.NAVY, background: "transparent",
          }}
        />
        {loading && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Searching…</span>}
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); setOpen(false); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: COLOURS.SLATE, fontSize: "16px", padding: 0 }}
          >×</button>
        )}
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "44px", left: 0, right: 0, zIndex: 100,
          background: "white", border: `1px solid ${COLOURS.BORDER}`,
          borderRadius: RADII.CARD, boxShadow: SHADOWS.DROPDOWN ?? "0 4px 16px rgba(0,0,0,0.12)",
          maxHeight: "360px", overflowY: "auto",
        }}>
          <div style={{ padding: "8px 12px 4px", fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {results.length} result{results.length !== 1 ? "s" : ""}
          </div>
          {results.map((hit) => (
            <a
              key={hit.uid}
              href={hit.folderit_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "flex-start", gap: "10px",
                padding: "8px 12px", borderTop: `1px solid ${COLOURS.BORDER}`,
                textDecoration: "none", color: "inherit",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = COLOURS.CARD_ALT ?? "#F8F9FA")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>
                {hit.type === "folder" ? "📁" : "📄"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {hit.name}
                </div>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                  {hit.account_name}{hit.folder_name ? ` › ${hit.folder_name}` : ""}
                </div>
              </div>
              <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, alignSelf: "center" }}>↗</span>
            </a>
          ))}
          {results.length === 60 && (
            <div style={{ padding: "6px 12px", fontSize: "11px", color: COLOURS.SLATE, textAlign: "center" }}>
              Showing first 60 results — refine your search for more
            </div>
          )}
        </div>
      )}

      {open && query.length >= 2 && !loading && results.length === 0 && (
        <div style={{
          position: "absolute", top: "44px", left: 0, right: 0, zIndex: 100,
          background: "white", border: `1px solid ${COLOURS.BORDER}`,
          borderRadius: RADII.CARD, boxShadow: SHADOWS.DROPDOWN ?? "0 4px 16px rgba(0,0,0,0.12)",
          padding: "16px 12px", fontSize: "13px", color: COLOURS.SLATE, textAlign: "center",
        }}>
          No documents found for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}

function BrowseView() {
  const setPreview = useContext(PreviewContext);
  const [accounts, setAccounts] = useState<BrowseAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<BrowseAccount | null>(null);
  // Left panel: folder tree (top-level folders from /access, lazily expanded)
  const [rootFolders, setRootFolders] = useState<BrowseFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Map<string, BrowseFolder[]>>(new Map());
  const [selectedFolder, setSelectedFolder] = useState<BrowseFolder | null>(null);
  // Right panel: contents of the selected folder
  const [rightFolders, setRightFolders] = useState<BrowseFolder[]>([]);
  const [rightFiles, setRightFiles] = useState<BrowseFile[]>([]);
  const [rightLoading, setRightLoading] = useState(false);
  const [rightError, setRightError] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [rootLoading, setRootLoading] = useState(false);

  useEffect(() => {
    authFetch("/api/folderit/accounts")
      .then((r) => r.json())
      .then((j) => { setAccounts(j.accounts ?? []); setAccountsLoading(false); });
  }, []);

  async function loadRootFolders(acc: BrowseAccount) {
    setRootLoading(true);
    setRootFolders([]);
    setExpandedFolders(new Map());
    setSelectedFolder(null);
    setRightFolders([]);
    setRightFiles([]);
    setRightError(null);
    try {
      const res = await authFetch(`/api/folderit/browse?account_uid=${acc.account_uid}`);
      const json = await res.json();
      setRootFolders((json.folders ?? []).sort((a: BrowseFolder, b: BrowseFolder) => a.name.localeCompare(b.name)));
    } catch {
      setRootFolders([]);
    } finally {
      setRootLoading(false);
    }
  }

  async function loadFolderContents(accountUid: string, folderUid: string) {
    setRightLoading(true);
    setRightError(null);
    setRightFolders([]);
    setRightFiles([]);
    try {
      const res = await authFetch(`/api/folderit/browse?account_uid=${accountUid}&folder_uid=${encodeURIComponent(folderUid)}`);
      const json = await res.json();
      if (!res.ok) { setRightError(json.error ?? "Failed to load folder"); return; }
      setRightFolders((json.folders ?? []).sort((a: BrowseFolder, b: BrowseFolder) => a.name.localeCompare(b.name)));
      setRightFiles((json.files ?? []).sort((a: BrowseFile, b: BrowseFile) => a.name.localeCompare(b.name)));
    } catch {
      setRightError("Network error");
    } finally {
      setRightLoading(false);
    }
  }

  async function toggleFolder(folder: BrowseFolder, accountUid: string) {
    const isExpanded = expandedFolders.has(folder.uid);
    if (isExpanded) {
      // Collapse
      const next = new Map(expandedFolders);
      next.delete(folder.uid);
      setExpandedFolders(next);
    } else {
      // Expand: fetch subfolders
      const res = await authFetch(`/api/folderit/browse?account_uid=${accountUid}&folder_uid=${encodeURIComponent(folder.uid)}`);
      const json = res.ok ? await res.json() : { folders: [] };
      const next = new Map(expandedFolders);
      next.set(folder.uid, (json.folders ?? []).sort((a: BrowseFolder, b: BrowseFolder) => a.name.localeCompare(b.name)));
      setExpandedFolders(next);
    }
  }

  function selectFolder(folder: BrowseFolder) {
    setSelectedFolder(folder);
    loadFolderContents(selectedAccount!.account_uid, folder.uid);
  }

  async function openFile(file: BrowseFile) {
    if (previewingFile) return;
    setPreviewingFile(file.uid);
    try {
      const url = await fetchBrowsePreviewBlobUrl(file.uid, selectedAccount!.account_uid);
      setPreview({ url, name: file.name });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't preview this document.");
    } finally {
      setPreviewingFile(null);
    }
  }

  // ── Cabinet selection screen ──────────────────────────────────────────────
  if (!selectedAccount) {
    const CABINET_ICONS: Record<string, string> = {
      UTPL: "🏭", IFPL: "👟", RST: "🍽️", SMI: "💼", UZL: "🇬🇧", DIR: "👨‍👩‍👧", ALM: "🌿",
    };
    return (
      <div>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY, letterSpacing: "-0.02em" }}>
            Document Cabinets
          </div>
          <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "4px" }}>
            Select a company to browse its Folderit filing cabinet
          </div>
        </div>
        {accountsLoading ? (
          <div style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Loading cabinets…</div>
        ) : accounts.length === 0 ? (
          <div style={{ color: COLOURS.SLATE, fontSize: "13px" }}>
            No Folderit accounts linked to your profile yet. The daily sync will populate this automatically.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
            {accounts.map((acc) => {
              const sc = acc.company?.short_code ?? "?";
              const badge = COMPANY_BADGE_STYLES[sc as keyof typeof COMPANY_BADGE_STYLES] ?? { bg: COLOURS.CARD_ALT, text: COLOURS.SLATE };
              const icon = CABINET_ICONS[sc] ?? "🗂️";
              return (
                <div
                  key={acc.account_uid}
                  onClick={() => { setSelectedAccount(acc); loadRootFolders(acc); }}
                  style={{
                    ...cardStyle,
                    padding: "20px",
                    cursor: "pointer",
                    border: `1px solid ${COLOURS.BORDER}`,
                    display: "flex", flexDirection: "column", gap: "12px",
                    transition: "box-shadow 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = SHADOWS.HOVER;
                    (e.currentTarget as HTMLDivElement).style.borderColor = COLOURS.NAVY + "40";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                    (e.currentTarget as HTMLDivElement).style.borderColor = COLOURS.BORDER;
                  }}
                >
                  <div style={{ fontSize: "28px" }}>{icon}</div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>
                      {acc.company?.name ?? acc.account_name}
                    </div>
                    <span style={{
                      fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
                      padding: "2px 7px", borderRadius: RADII.PILL,
                      background: badge.bg, color: badge.text,
                      border: `1px solid ${badge.text}22`,
                    }}>{sc}</span>
                  </div>
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE, display: "flex", alignItems: "center", gap: "4px", marginTop: "auto" }}>
                    <span>Open cabinet</span>
                    <span>›</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Two-panel browser ─────────────────────────────────────────────────────
  const sc = selectedAccount.company?.short_code ?? "?";
  const badge = COMPANY_BADGE_STYLES[sc as keyof typeof COMPANY_BADGE_STYLES] ?? { bg: COLOURS.CARD_ALT, text: COLOURS.SLATE };

  function renderFolderTree(folders: BrowseFolder[], depth: number): React.ReactNode {
    return folders.map((folder) => {
      const isSelected = selectedFolder?.uid === folder.uid;
      const children = expandedFolders.get(folder.uid);
      const isExpanded = children !== undefined;
      return (
        <div key={folder.uid}>
          <div
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: `7px 12px 7px ${12 + depth * 14}px`,
              cursor: "pointer", fontSize: "13px",
              background: isSelected ? COLOURS.NAVY : "transparent",
              color: isSelected ? "#fff" : COLOURS.NAVY,
              borderRadius: "4px", margin: "1px 4px",
              fontWeight: isSelected ? 600 : 400,
            }}
            onClick={() => { selectFolder(folder); if (selectedAccount) toggleFolder(folder, selectedAccount.account_uid); }}
          >
            <span style={{ fontSize: "11px", width: "12px", flexShrink: 0, color: isSelected ? "#ffffff88" : COLOURS.SLATE }}>
              {isExpanded ? "▼" : "▶"}
            </span>
            <span style={{ fontSize: "13px", flexShrink: 0 }}>📁</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
          </div>
          {isExpanded && children && children.length > 0 && (
            <div>{renderFolderTree(children, depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {/* Header bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <button
          onClick={() => { setSelectedAccount(null); setRootFolders([]); }}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: "4px 8px 4px 0",
            color: COLOURS.SLATE, fontSize: "13px", display: "flex", alignItems: "center", gap: "4px",
          }}
        >
          ‹ All Cabinets
        </button>
        <span style={{ color: COLOURS.BORDER }}>|</span>
        <span style={{
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", padding: "2px 7px",
          borderRadius: RADII.PILL, background: badge.bg, color: badge.text, border: `1px solid ${badge.text}22`,
        }}>{sc}</span>
        <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>
          {selectedAccount.company?.name ?? selectedAccount.account_name}
        </span>
      </div>

      {/* Two-panel layout */}
      <div style={{
        display: "flex", border: `1px solid ${COLOURS.BORDER}`,
        borderRadius: RADII.CARD, overflow: "hidden", minHeight: "520px",
        background: "#fff",
      }}>
        {/* Left: folder tree */}
        <div style={{
          width: "240px", flexShrink: 0, borderRight: `1px solid ${COLOURS.BORDER}`,
          background: COLOURS.CARD_ALT, overflowY: "auto", padding: "8px 0",
        }}>
          <div style={{ padding: "8px 12px 4px", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Folders
          </div>
          {rootLoading ? (
            <div style={{ padding: "12px 16px", color: COLOURS.SLATE, fontSize: "13px" }}>Loading…</div>
          ) : rootFolders.length === 0 ? (
            <div style={{ padding: "12px 16px", color: COLOURS.SLATE, fontSize: "13px" }}>No folders</div>
          ) : (
            renderFolderTree(rootFolders, 0)
          )}
        </div>

        {/* Right: file list */}
        <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          {!selectedFolder ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "10px", color: COLOURS.SLATE }}>
              <span style={{ fontSize: "32px" }}>📂</span>
              <span style={{ fontSize: "13px" }}>Select a folder on the left to view its contents</span>
            </div>
          ) : rightLoading ? (
            <div style={{ padding: "16px", color: COLOURS.SLATE, fontSize: "13px" }}>Loading…</div>
          ) : rightError ? (
            <div style={{ padding: "16px", color: COLOURS.RED, fontSize: "13px" }}>{rightError}</div>
          ) : (
            <>
              {/* Column header */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 80px 100px",
                padding: "9px 16px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                background: COLOURS.CARD_ALT,
              }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Name</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Size</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Date</span>
              </div>

              {/* Sub-folders */}
              {rightFolders.map((folder) => (
                <div
                  key={folder.uid}
                  onClick={() => { selectFolder(folder); }}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr 80px 100px",
                    padding: "10px 16px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                    cursor: "pointer", transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = COLOURS.CARD_ALT)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    <span style={{ fontSize: "15px", flexShrink: 0 }}>📁</span>
                    <span style={{ fontSize: "13px", fontWeight: 500, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
                  </div>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE, textAlign: "right" }}>—</span>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE, textAlign: "right" }}>—</span>
                </div>
              ))}

              {/* Files */}
              {rightFiles.map((file) => {
                const isPreviewing = previewingFile === file.uid;
                return (
                  <div
                    key={file.uid}
                    onClick={() => openFile(file)}
                    style={{
                      display: "grid", gridTemplateColumns: "1fr 80px 100px",
                      padding: "10px 16px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                      cursor: isPreviewing ? "wait" : "pointer",
                      opacity: isPreviewing ? 0.6 : 1, transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => !isPreviewing && (e.currentTarget.style.background = COLOURS.CARD_ALT)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      <span style={{ fontSize: "15px", flexShrink: 0 }}>{fileIcon(file.name)}</span>
                      <span style={{ fontSize: "13px", color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                      </span>
                      {isPreviewing && <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>Opening…</span>}
                    </div>
                    <span style={{ fontSize: "12px", color: COLOURS.SLATE, textAlign: "right" }}>{formatFileSize(file.size)}</span>
                    <span style={{ fontSize: "12px", color: COLOURS.SLATE, textAlign: "right" }}>{formatFileDate(file.createdAt)}</span>
                  </div>
                );
              })}

              {rightFolders.length === 0 && rightFiles.length === 0 && (
                <div style={{ padding: "32px 16px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>
                  This folder is empty.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Every fetch the initial page needs, in one place, fired in parallel on
// mount — Khuram: "Folderit is working very slow. When I go into that
// page, it takes a while for the page to load." Previously this was a
// waterfall: FolderitDashboard fetched hr-summary + summary, THEN
// (only once that resolved and AdminView/PersonalApprovalsCard mounted)
// a second round of fetches fired — company-breakdown, and a duplicate
// summary + details call that FolderitDashboard had already made once.
// Consolidating into a single Promise.all here, with the results passed
// down as props, removes both the extra round trip and the duplicate
// one. company-breakdown 403s harmlessly for non-admins (cheap role
// check, fully parallel with everything else, doesn't block anything).
// ── Overview tab — health scores + sync status ─────────────────────────────

type OverviewData = {
  accounts: { account_uid: string; account_name: string; scope: string }[];
  healthSummary: {
    company_uuid: string;
    company_name: string;
    score: number;
    total_issues: number;
    breakdown: Record<string, number>;
  }[];
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  inboxFilesTotal: number;
  issueBreakdown: Record<string, number>;
};

function HealthScoreDial({ score }: { score: number }) {
  const colour = score >= 80 ? COLOURS.GREEN : score >= 50 ? COLOURS.AMBER : COLOURS.RED;
  // Always show at least a sliver in the bar so it doesn't look broken at 0
  const barWidth = score === 0 ? 2 : Math.max(score, 5);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{
        width: "44px", height: "44px", borderRadius: "50%",
        border: `3px solid ${colour}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "13px", fontWeight: 700, color: colour, flexShrink: 0,
      }}>
        {score}
      </div>
      <div style={{
        height: "6px", flex: 1, borderRadius: "3px",
        background: COLOURS.BORDER, overflow: "hidden",
      }}>
        <div style={{ width: `${barWidth}%`, height: "100%", background: colour, borderRadius: "3px", transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

const ISSUE_LABELS: Record<string, { label: string; colour: string }> = {
  inbox_subfolder: { label: "Inbox subfolder",   colour: COLOURS.RED },
  buried_in_inbox: { label: "Buried in Inbox",   colour: COLOURS.RED },
  inbox_stale:     { label: "Stale in Inbox",    colour: COLOURS.AMBER },
  bad_filename:    { label: "Bad filename",       colour: COLOURS.SLATE },
};

type HealthNav = { company_uuid?: string; issue_type?: string };

function OverviewTab({ onGoToHealth }: { onGoToHealth: (nav?: HealthNav) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/folderit/overview")
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: SLATE, fontSize: "13px" }}>Loading overview…</div>;
  if (!data) return null;

  const totalIssues = Object.values(data.issueBreakdown).reduce((a, b) => a + b, 0);
  const avgScore = data.healthSummary.length
    ? Math.round(data.healthSummary.reduce((a, c) => a + c.score, 0) / data.healthSummary.length)
    : 100;

  const lastSync = data.lastSyncAt
    ? new Date(data.lastSyncAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Not yet run";

  return (
    <div>
      {/* Summary stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "24px" }}>
        {[
          { label: "Active Cabinets",  value: data.accounts.length,    colour: NAVY,                                                                            nav: undefined },
          { label: "Inbox Files",      value: data.inboxFilesTotal,     colour: NAVY,                                                                            nav: undefined },
          { label: "Filing Issues",    value: totalIssues,              colour: totalIssues > 0 ? COLOURS.RED : COLOURS.GREEN,                                   nav: {} as HealthNav },
          { label: "Avg Health Score", value: `${avgScore}%`,          colour: avgScore >= 80 ? COLOURS.GREEN : avgScore >= 50 ? COLOURS.AMBER : COLOURS.RED,  nav: {} as HealthNav },
        ].map(({ label, value, colour, nav }) => (
          <div
            key={label}
            onClick={nav !== undefined ? () => onGoToHealth(nav) : undefined}
            style={{
              ...cardStyle, padding: "14px 16px",
              cursor: nav !== undefined ? "pointer" : "default",
              transition: "box-shadow 0.15s",
            }}
            onMouseEnter={nav !== undefined ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.10)"; } : undefined}
            onMouseLeave={nav !== undefined ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = ""; } : undefined}
          >
            <div style={{ fontSize: "11px", color: SLATE, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: colour }}>{value}</div>
            {nav !== undefined && <div style={{ fontSize: "10px", color: SLATE, marginTop: "4px" }}>View details →</div>}
          </div>
        ))}
      </div>

      {/* Issue breakdown */}
      {totalIssues > 0 && (
        <div style={{ ...cardStyle, padding: "16px", marginBottom: "24px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: NAVY, marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Issue Breakdown</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {Object.entries(data.issueBreakdown)
              .filter(([, count]) => count > 0)
              .map(([type, count]) => {
                const meta = ISSUE_LABELS[type] ?? { label: type, colour: SLATE };
                return (
                  <div key={type} onClick={() => onGoToHealth({ issue_type: type })} style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "6px 10px", borderRadius: RADII.CARD,
                    background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.BORDER}`,
                    cursor: "pointer",
                  }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: meta.colour, display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontSize: "12px", color: NAVY }}>{meta.label}</span>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: meta.colour }}>{count}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Health scores per company */}
      {data.healthSummary.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: NAVY, marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Filing Health by Company</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
            {data.healthSummary.map((co) => (
              <div
                key={co.company_uuid}
                onClick={() => onGoToHealth({ company_uuid: co.company_uuid })}
                style={{ ...cardStyle, padding: "16px", cursor: "pointer" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.10)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: NAVY }}>{co.company_name}</span>
                  {co.total_issues > 0 ? (
                    <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.RED, background: "#FFF0F0", border: "1px solid #FFCDD2", borderRadius: RADII.PILL, padding: "2px 7px" }}>
                      {co.total_issues} issue{co.total_issues !== 1 ? "s" : ""} →
                    </span>
                  ) : (
                    <span style={{ fontSize: "11px", color: COLOURS.GREEN }}>✓ Clean</span>
                  )}
                </div>
                <HealthScoreDial score={co.score} />
                {co.total_issues > 0 && (
                  <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {Object.entries(co.breakdown).filter(([, n]) => n > 0).map(([type, n]) => {
                      const meta = ISSUE_LABELS[type] ?? { label: type, colour: SLATE };
                      return (
                        <span key={type} style={{ fontSize: "10px", color: meta.colour, background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.PILL, padding: "2px 6px" }}>
                          {n} {meta.label.toLowerCase()}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync status */}
      <div style={{ ...cardStyle, padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
          background: data.lastSyncOk === false ? COLOURS.RED : data.lastSyncOk === true ? COLOURS.GREEN : SLATE }} />
        <span style={{ fontSize: "12px", color: SLATE }}>
          Last sync: <span style={{ fontWeight: 600, color: NAVY }}>{lastSync}</span>
          {data.lastSyncOk === false && <span style={{ color: COLOURS.RED, marginLeft: "6px" }}>⚠ Errors reported</span>}
        </span>
      </div>
    </div>
  );
}

// ── Filing Health tab — full audit results table ────────────────────────────

type HealthIssue = {
  id: string;
  account_uid: string;
  company_uuid: string | null;
  company_name: string | null;
  file_uid: string | null;
  file_name: string;
  issue_type: string;
  location_path: string | null;
  days_old: number | null;
  detected_at: string;
};

function IssueTypeBadge({ type }: { type: string }) {
  const meta = ISSUE_LABELS[type] ?? { label: type, colour: SLATE };
  return (
    <span style={{
      fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: RADII.PILL,
      color: meta.colour, background: meta.colour + "18",
      border: `1px solid ${meta.colour}44`, whiteSpace: "nowrap",
    }}>
      {meta.label}
    </span>
  );
}

const FILTER_OPTIONS = [
  { value: "",               label: "All issues" },
  { value: "inbox_subfolder", label: "Inbox subfolders" },
  { value: "buried_in_inbox", label: "Buried in Inbox" },
  { value: "inbox_stale",     label: "Stale in Inbox" },
  { value: "bad_filename",    label: "Bad filenames" },
];

function FilingHealthTab({ initialCompany, initialType }: { initialCompany?: string; initialType?: string }) {
  const setPreview = useContext(PreviewContext);
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState(initialType ?? "");
  const [filterCompany, setFilterCompany] = useState(initialCompany ?? "");
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  function fetchIssues(type: string, company: string) {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (type) params.set("issue_type", type);
    if (company) params.set("company_uuid", company);
    authFetch(`/api/folderit/health?${params}`)
      .then((r) => r.json())
      .then((d) => { setIssues(d.issues ?? []); setTotal(d.total ?? 0); })
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { fetchIssues(initialType ?? "", initialCompany ?? ""); }, []);

  function handleFilter(type: string) {
    setFilterType(type);
    fetchIssues(type, filterCompany);
  }

  function clearCompany() {
    setFilterCompany("");
    fetchIssues(filterType, "");
  }

  async function handleRowClick(iss: HealthIssue) {
    // Inbox subfolders are folders, not files — can't preview
    if (iss.issue_type === "inbox_subfolder" || !iss.file_uid) return;
    if (previewingId === iss.id) return;
    setPreviewingId(iss.id);
    try {
      const url = await fetchPreviewBlobUrl(iss.file_uid!, iss.account_uid ?? undefined);
      setPreview({ url, name: iss.file_name });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't preview this document.");
    } finally {
      setPreviewingId(null);
    }
  }

  const noIssues = !loading && issues.length === 0;

  return (
    <div>
      {/* Active company filter banner */}
      {filterCompany && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px 12px", background: COLOURS.INFO_SOFT ?? "#EFF6FF", borderRadius: RADII.CARD, border: `1px solid ${COLOURS.BORDER}` }}>
          <span style={{ fontSize: "12px", color: NAVY }}>Filtered by company</span>
          <button onClick={clearCompany} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: SLATE, textDecoration: "underline", padding: 0 }}>
            Clear ×
          </button>
        </div>
      )}

      {/* Filter pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleFilter(opt.value)}
            style={{
              padding: "5px 12px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 500,
              border: `1px solid ${filterType === opt.value ? NAVY : COLOURS.BORDER}`,
              background: filterType === opt.value ? NAVY : "white",
              color: filterType === opt.value ? "white" : SLATE,
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        ))}
        {total > 0 && (
          <span style={{ fontSize: "12px", color: SLATE, alignSelf: "center", marginLeft: "4px" }}>
            {total} issue{total !== 1 ? "s" : ""} found
          </span>
        )}
      </div>

      {loading && <div style={{ color: SLATE, fontSize: "13px" }}>Loading health issues…</div>}

      {noIssues && (
        <div style={{ ...cardStyle, padding: "32px", textAlign: "center" }}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>✅</div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.GREEN, marginBottom: "4px" }}>No issues found</div>
          <div style={{ fontSize: "12px", color: SLATE }}>
            {filterType ? `No ${ISSUE_LABELS[filterType]?.label.toLowerCase() ?? filterType} issues detected.` : "All cabinets are filing correctly."}
          </div>
        </div>
      )}

      {!loading && issues.length > 0 && (
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ padding: "8px 12px", fontSize: "11px", color: SLATE, borderBottom: `1px solid ${COLOURS.BORDER}`, background: COLOURS.CARD_ALT }}>
            Click a row to preview the document, or use the <strong>↗</strong> link to open it directly in Folderit where you can move or delete it.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: COLOURS.CARD_ALT }}>
                {["Issue", "File / Folder", "Location", "Age", "Company", ""].map((h) => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: SLATE, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {issues.map((iss, i) => {
                const isFolder = iss.issue_type === "inbox_subfolder";
                const isPreviewing = previewingId === iss.id;
                // Construct the direct Folderit URL:
                //   folders → /folder/index/?uid=...
                //   files   → /file/view/?uid=...
                const folderitUrl = iss.file_uid
                  ? isFolder
                    ? `https://my.folderit.com/folder/index/?uid=${iss.file_uid}`
                    : `https://my.folderit.com/file/view/?uid=${iss.file_uid}`
                  : null;
                return (
                  <tr
                    key={iss.id}
                    onClick={() => handleRowClick(iss)}
                    title={isFolder ? "This is a folder — use ↗ to open in Folderit" : "Click to preview · use ↗ to open in Folderit"}
                    style={{
                      borderBottom: i < issues.length - 1 ? `1px solid ${COLOURS.BORDER}` : "none",
                      cursor: isFolder ? "default" : "pointer",
                      background: isPreviewing ? COLOURS.CARD_ALT : "white",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => { if (!isFolder) (e.currentTarget as HTMLElement).style.background = COLOURS.CARD_ALT; }}
                    onMouseLeave={(e) => { if (!isFolder && !isPreviewing) (e.currentTarget as HTMLElement).style.background = "white"; }}
                  >
                    <td style={{ padding: "9px 12px", verticalAlign: "middle" }}>
                      <IssueTypeBadge type={iss.issue_type} />
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: "12px", color: isFolder ? SLATE : NAVY, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {isPreviewing ? <span style={{ color: SLATE }}>Loading…</span> : iss.file_name}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: "11px", color: SLATE, maxWidth: "170px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {iss.location_path ?? "—"}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: "12px", color: iss.days_old !== null && iss.days_old > 2 ? COLOURS.AMBER : NAVY, whiteSpace: "nowrap" }}>
                      {iss.days_old !== null ? `${iss.days_old}d` : "—"}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: "11px", color: SLATE }}>
                      {iss.company_name ?? "—"}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      {folderitUrl && (
                        <a
                          href={folderitUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Open in Folderit"
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: "26px", height: "26px", borderRadius: RADII.CARD,
                            border: `1px solid ${COLOURS.BORDER}`, color: SLATE,
                            fontSize: "13px", textDecoration: "none",
                            background: "white",
                          }}
                        >
                          ↗
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > issues.length && (
            <div style={{ padding: "10px 12px", fontSize: "11px", color: SLATE, borderTop: `1px solid ${COLOURS.BORDER}`, background: COLOURS.CARD_ALT }}>
              Showing {issues.length} of {total} issues
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dashboard shell — ONE dashboard for everyone ────────────────────────────
//
// Khuram (22/07/2026): "I want everyone who has access to the relevant
// companies to see the new dashboard... delete the old dashboard
// altogether so there's no confusion." The old AdminView/MemberView inbox
// dashboard is gone. Every user gets the same three tabs; the DATA inside
// them is scoped server-side per user (own company + Access Matrix
// grants; HR grant → HR cabinet only; admin → everything). See
// lib/folderit-access.ts.

function FolderitDashboard() {
  const isMobile = useMobile();
  // Route guard — users without any Folderit grant in the Access Matrix
  // are redirected away even if they hit /folderit directly by URL.
  const { checking, ctx } = useRequireCapability("folderit");
  const [pageTab, setPageTab] = useState<"overview" | "browse" | "health">("overview");
  const [healthNav, setHealthNav] = useState<HealthNav>({});
  const [preview, setPreview] = useState<PreviewTarget>(null);

  // Blob URLs hold the whole PDF in memory — revoke the previous one the
  // moment it's replaced or the modal closes, not just on unmount.
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  if (checking || !ctx) {
    return <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden", color: SLATE }}>Loading…</main>;
  }

  // Everyone except Members gets the global search bar — Khuram: "CEO has
  // access to view pages and documents, plus managers but not members."
  const canSearch = ctx.role !== "Member" || (ctx.email || "").toLowerCase() === "khuram1901@gmail.com";

  const TABS: { key: typeof pageTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "browse",   label: "Browse Files" },
    { key: "health",   label: "Filing Health" },
  ];

  return (
    <PreviewContext.Provider value={setPreview}>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
        <PageHeader />
        <h1 style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", color: NAVY, marginTop: "8px", marginBottom: "4px" }}>Folder-it</h1>
        <div style={{ fontSize: "13px", color: SLATE, marginBottom: "16px" }}>
          Read-only view of your Folderit cabinets. To file or move documents, open Folderit directly.
        </div>

        {/* Global document search — visible on every tab, for every role
            except Member (the search API blocks Members server-side too).
            Results are scoped to the cabinets the user's matrix ticks
            allow, so Sania only ever finds UTPL documents, etc. */}
        {canSearch && (
          <div style={{ marginBottom: "16px" }}>
            <GlobalSearchBox />
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: "flex", gap: "0", borderBottom: `2px solid ${COLOURS.BORDER}`, marginBottom: "20px" }}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPageTab(key)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "8px 18px", fontSize: "13px", fontWeight: 500,
                color: pageTab === key ? COLOURS.NAVY : COLOURS.SLATE,
                borderBottom: pageTab === key ? `2px solid ${COLOURS.NAVY}` : "2px solid transparent",
                marginBottom: "-2px", transition: "color 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {pageTab === "overview" && (
          <OverviewTab
            onGoToHealth={(nav) => {
              setHealthNav(nav ?? {});
              setPageTab("health");
            }}
          />
        )}
        {pageTab === "browse" && <BrowseView />}
        {pageTab === "health" && (
          <FilingHealthTab
            key={`${healthNav.company_uuid ?? ""}-${healthNav.issue_type ?? ""}`}
            initialCompany={healthNav.company_uuid}
            initialType={healthNav.issue_type}
          />
        )}
      </main>
      {preview && <PreviewModal url={preview.url} name={preview.name} onClose={() => setPreview(null)} />}
    </PreviewContext.Provider>
  );
}

export default function FolderitPage() {
  return (
    <AuthWrapper>
      <FolderitDashboard />
    </AuthWrapper>
  );
}
