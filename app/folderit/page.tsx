"use client";

import React, { useEffect, useState, useContext, createContext } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch } from "../lib/supabase";
import { COLOURS, RADII, SHADOWS, cardStyle, PageHeader, SectionTitle } from "../lib/SharedUI";
import { COMPANIES, ALM_COMPANY_ID, DIR_COMPANY_ID, SMI_COMPANY_ID, UZL_COMPANY_ID } from "../lib/constants"; // DIR_COMPANY_ID used in exclusion filter below
import { useUserCtx } from "../lib/useUserCtx";
import { useMobile } from "../lib/useMobile";
import { isAdminTier, canViewFolderitHr } from "../lib/permissions";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LabelList } from "recharts";

// Baranh and Haute Dolci share the same Folderit account (Restaurants) —
// the Folderit page shows them as one merged "Restaurant" card. They
// remain two separate companies everywhere else in the app (separate
// cash/budgets, per the project's multi-company rule).
const BRNH_ID = "6401ba75-f297-4617-84c1-305bcaf35a50";
const HD_ID = "16a92b7f-b3fa-4271-819b-c6befb534f12";
const RESTAURANT_GROUP_KEY = "restaurants";

// Khuram: "lets remove the company Almahar from this card for now" —
// hidden from the Folderit page only; Almahar stays in COMPANIES and
// everywhere else in the app.
// Khuram: "can we rename just on the card on this page from Directors
// to Family Documents. so its consistent with folder it" — that's what
// the Directors account is actually called inside Folderit itself;
// display-only rename, doesn't touch the company's real name anywhere
// else in the app.
const FOLDERIT_DISPLAY_COMPANIES: { id: string; shortCode: string; name: string }[] = [
  ...COMPANIES.filter((c) => c.id !== BRNH_ID && c.id !== HD_ID && c.id !== ALM_COMPANY_ID && c.id !== DIR_COMPANY_ID).map((c) => ({
    id: c.id,
    shortCode: c.shortCode,
    name: c.name,
  })),
  { id: RESTAURANT_GROUP_KEY, shortCode: "RST", name: "Restaurant" },
];

function severityColor(days: number): string {
  if (days >= 7) return COLOURS.RED;
  if (days >= 3) return COLOURS.AMBER;
  if (days > 0) return COLOURS.SLATE;
  return COLOURS.GREEN;
}

const { NAVY, SLATE, HAIRLINE, AMBER, BLUE, GREEN, CARD_ALT } = COLOURS;

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

function CompanyBadge({ shortCode }: { shortCode: string }) {
  const s = COMPANY_BADGE_STYLES[shortCode] || { bg: COLOURS.CARD_ALT, text: COLOURS.SLATE };
  return (
    <span style={{
      fontSize: "10px", fontWeight: 600, padding: "2px 6px",
      borderRadius: RADII.PILL, backgroundColor: s.bg, color: s.text,
      border: `1px solid ${s.text}22`, whiteSpace: "nowrap",
    }}>
      {shortCode}
    </span>
  );
}

type DetailItem = {
  section: "approval" | "company_inbox" | "hr_inbox";
  item_uid: string;
  // The actual Folderit file id — always the right id to ask for a
  // preview. For approvals, item_uid is the INVITE's own id (kept for
  // uniqueness when the same file has more than one pending invite), so
  // it can't be used to look up the file directly. Falls back to
  // item_uid when absent (company inbox / HR rows already use the file's
  // own uid as item_uid, so there's nothing to distinguish there).
  file_uid?: string | null;
  name: string | null;
  account_name: string;
  status: string | null;
  created_at: string | null;
  days_pending: number | null;
  // "/"-joined Folderit subfolder breadcrumb (e.g. "01-Archive/2019"), only
  // populated for HR category file lists. Null/undefined means the file
  // sits directly in the category's root folder — or that this item type
  // doesn't have folders at all (approvals, company inbox).
  folder_path?: string | null;
};

function AgeTag({ days }: { days: number | null }) {
  if (days === null) return null;
  // Same red/amber/green scale as everywhere else on this page
  // (severityColor) — one vocabulary for "how long has this sat here",
  // whether it's a file row, a company card, or the aging chart.
  return (
    <span style={{ fontSize: "10.5px", fontWeight: 600, color: severityColor(days), flexShrink: 0 }}>
      {days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`}
    </span>
  );
}

type HrCategory = { category_name: string; file_count: number; sort_order: number };

// In-app document preview — no downloads. FolderitDashboard owns the modal
// state; this context lets FileRow (nested many levels deep, inside
// CollapsibleRow/FileList/FolderNodeRow) open it without prop-drilling a
// setter through every intermediate component.
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

function FileRow({ item, showTopBorder, indentPx = 40 }: { item: DetailItem; showTopBorder: boolean; indentPx?: number }) {
  const setPreview = useContext(PreviewContext);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const url = await fetchPreviewBlobUrl(item.file_uid ?? item.item_uid);
      setPreview({ url, name: item.name });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't preview this document.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      onClick={handleClick}
      style={{
        padding: `8px 16px 8px ${indentPx}px`,
        borderTop: showTopBorder ? `1px solid ${HAIRLINE}` : "none",
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
        cursor: "pointer", opacity: loading ? 0.6 : 1,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "14px", color: BLUE, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline", textDecorationColor: "transparent" }}>
          {item.name ?? "Untitled document"}
        </div>
        <div style={{ fontSize: "13px", color: SLATE, marginTop: "1px" }}>{item.account_name}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        <AgeTag days={item.days_pending} />
        {item.status && (
          <span style={{ fontSize: "10.5px", fontWeight: 600, color: AMBER, textTransform: "capitalize" }}>
            {item.status}
          </span>
        )}
      </div>
    </div>
  );
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

function FileList({ items }: { items: DetailItem[] }) {
  if (!items.length) return <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Nothing here.</div>;
  return (
    <div>
      {items.map((item, i) => (
        <FileRow key={item.item_uid} item={item} showTopBorder={i > 0} />
      ))}
    </div>
  );
}

// ── HR category files: a real nested folder tree, matching Folderit's own
// structure, instead of one flat pile or a single-level grouped list. ──
type FolderNode = {
  name: string;
  path: string;
  files: DetailItem[];
  children: Map<string, FolderNode>;
};

function buildFolderTree(items: DetailItem[]): FolderNode {
  const root: FolderNode = { name: "", path: "", files: [], children: new Map() };
  for (const item of items) {
    if (!item.folder_path) {
      root.files.push(item);
      continue;
    }
    const segments = item.folder_path.split("/");
    let node = root;
    let pathSoFar = "";
    for (const seg of segments) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, path: pathSoFar, files: [], children: new Map() };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.files.push(item);
  }
  return root;
}

function FolderNodeRow({ node, depth }: { node: FolderNode; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const childFolders = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
  const baseIndent = 40 + depth * 16;

  return (
    <div>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: `7px 16px 7px ${baseIndent}px`, cursor: "pointer",
          display: "flex", alignItems: "center", gap: "6px",
          borderTop: `1px solid ${HAIRLINE}`, backgroundColor: CARD_ALT,
        }}
      >
        <span style={{ fontSize: "10px", color: SLATE, width: "10px" }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: NAVY }}>📁 {node.name}</span>
      </div>
      {open && (
        <div>
          {node.files.map((item, i) => (
            <FileRow key={item.item_uid} item={item} showTopBorder={i > 0} indentPx={baseIndent + 16} />
          ))}
          {childFolders.map((child) => (
            <FolderNodeRow key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function HrCategoryFileList({ items }: { items: DetailItem[] }) {
  if (!items.length) return <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Nothing here.</div>;

  const hasFolders = items.some((it) => it.folder_path);
  if (!hasFolders) return <FileList items={items} />;

  const root = buildFolderTree(items);
  const topFolders = Array.from(root.children.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      {root.files.map((item, i) => (
        <FileRow key={item.item_uid} item={item} showTopBorder={i > 0} />
      ))}
      {topFolders.map((node) => (
        <FolderNodeRow key={node.path} node={node} depth={0} />
      ))}
    </div>
  );
}

// A single collapsible row: label + count on the left, chevron on the
// right, expands in place to show a FileList. Same interaction as the
// audit-record rows in AuditDashboard.tsx.
function CollapsibleRow({
  label, count, color, sub, isOpen, onToggle, items, loading, asFolderTree,
}: {
  label: string; count: number; color: string; sub?: string;
  isOpen: boolean; onToggle: () => void; items: DetailItem[] | null; loading: boolean;
  asFolderTree?: boolean;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <div
        onClick={onToggle}
        style={{
          padding: "13px 16px", cursor: "pointer", display: "flex",
          justifyContent: "space-between", alignItems: "center", gap: "8px",
          backgroundColor: isOpen ? CARD_ALT : "transparent",
        }}
      >
        <div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: NAVY }}>{label}</div>
          {sub && <div style={{ fontSize: "13px", color: SLATE, marginTop: "1px" }}>{sub}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{
            fontSize: "13px", fontWeight: 700, color: count > 0 ? color : SLATE,
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          }}>{count}</span>
          {count > 0 && <span style={{ fontSize: "12px", color: SLATE }}>{isOpen ? "▼" : "▶"}</span>}
        </div>
      </div>
      {isOpen && count > 0 && (
        loading || !items ? (
          <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Loading…</div>
        ) : asFolderTree ? (
          <HrCategoryFileList items={items} />
        ) : (
          <FileList items={items} />
        )
      )}
    </div>
  );
}

// Compact stat card — Khuram: "pending approval card is too long... i just
// dont want this size as its taking space." Same shape as the "By
// Company" grid cards below (uppercase label, big Inter Tight number),
// so a click toggles a DetailPanel underneath instead of the row itself
// expanding full-width.
function StatCard({
  label, count, color, isOpen, onToggle, sub,
}: {
  label: string; count: number; color: string; isOpen: boolean; onToggle: () => void; sub?: string;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        ...cardStyle,
        padding: "14px 16px",
        cursor: "pointer",
        border: isOpen ? `1.5px solid ${NAVY}` : `1px solid ${HAIRLINE}`,
        boxShadow: isOpen ? SHADOWS.HOVER : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ fontFamily: "var(--font-sans, Inter, sans-serif)", fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        {count > 0 && <span style={{ fontSize: "12px", color: SLATE, flexShrink: 0 }}>{isOpen ? "▼" : "▶"}</span>}
      </div>
      <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: count > 0 ? color : SLATE, marginTop: "8px" }}>{count}</div>
      {sub && <div style={{ fontSize: "12px", color: SLATE, marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

// The expandable content a StatCard opens into — same header-bar +
// FileList shape already used for the "By Company" drill-down panel.
function DetailPanel({
  title, items, loading, onClose, asFolderTree,
}: {
  title: string; items: DetailItem[]; loading: boolean; onClose: () => void; asFolderTree?: boolean;
}) {
  return (
    <div style={{ ...cardStyle, overflow: "hidden", marginTop: "-4px", marginBottom: "16px", padding: 0 }}>
      <div style={{ padding: "13px 16px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: CARD_ALT }}>
        <span style={{ fontSize: "15px", fontWeight: 600, color: NAVY }}>{title}</span>
        <span onClick={onClose} style={{ cursor: "pointer", fontSize: "12px", color: SLATE }}>Close ✕</span>
      </div>
      {loading ? (
        <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Nothing here.</div>
      ) : asFolderTree ? (
        <HrCategoryFileList items={items} />
      ) : (
        <FileList items={items} />
      )}
    </div>
  );
}

type FolderitSearchResult = { file_uid: string; name: string | null; source: "inbox" | "hr"; location: string | null; created_at: string | null };

// Page-level search box, visible to everyone — Khuram: "one place to log
// in, and you can search the entire Folder-it and get me that document."
// Hits /api/folderit/search, which merges two independently-scoped
// halves: every company's unfiled inbox (scoped to the caller's own
// company unless they're admin/CEO) and HR documents (only included at
// all if the caller has HR access — the endpoint returns them silently
// omitted otherwise, same as everywhere else HR is gated). Debounced
// client-side so it doesn't fire on every keystroke.
function FolderitSearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FolderitSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();

    // All state updates happen inside this callback (never synchronously
    // in the effect body) — both to satisfy the "no setState directly in
    // an effect" lint rule and, more importantly, to guard against a slow
    // request resolving after the user has already typed something else
    // or the component unmounted.
    const handle = setTimeout(async () => {
      if (q.length < 2) {
        if (!cancelled) { setResults([]); setSearching(false); setSearchError(null); }
        return;
      }
      if (!cancelled) { setSearching(true); setSearchError(null); }
      try {
        const res = await authFetch(`/api/folderit/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (cancelled) return;
        // Previously any server error (500, auth failure, RPC error) fell
        // through to "No documents match" — indistinguishable from a
        // genuine empty result. Surface it instead so a real failure
        // doesn't look like the document simply isn't there.
        if (!res.ok || json.error) {
          setResults([]);
          setSearchError(typeof json.error === "string" ? json.error : `Search failed (${res.status}).`);
        } else {
          setResults(json.items ?? []);
          setSearchError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setResults([]);
          setSearchError(e instanceof Error ? e.message : "Search failed — check your connection.");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, q.length < 2 ? 0 : 300);

    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

  const trimmed = query.trim();

  return (
    <div style={{ marginBottom: "20px" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search documents by name — inbox and HR…"
        style={{
          width: "100%", padding: "10px 12px", fontSize: "13px", borderRadius: RADII.CARD,
          border: `1px solid ${HAIRLINE}`, color: NAVY, outline: "none", boxSizing: "border-box",
          backgroundColor: COLOURS.CARD,
        }}
      />
      {trimmed.length >= 2 && (
        <div style={{ ...cardStyle, marginTop: "8px", overflow: "hidden" }}>
          {searching ? (
            <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Searching…</div>
          ) : searchError ? (
            <div style={{ padding: "12px 16px", color: COLOURS.RED, fontSize: "13px" }}>
              Search failed: {searchError} — try again in a moment.
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>No documents match &quot;{trimmed}&quot;.</div>
          ) : (
            results.map((r, i) => (
              <FileRow
                key={r.file_uid}
                item={{
                  section: r.source === "hr" ? "hr_inbox" : "company_inbox",
                  item_uid: r.file_uid,
                  name: r.name,
                  account_name: r.location ?? "",
                  status: null,
                  created_at: r.created_at,
                  days_pending: null,
                }}
                showTopBorder={i > 0}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function HrSection({
  categories, hrInboxCount, expanded, setExpanded, detailsCache, setDetailsCache,
}: {
  categories: HrCategory[];
  hrInboxCount: number;
  expanded: string | null;
  setExpanded: (v: string | null) => void;
  detailsCache: Record<string, DetailItem[]>;
  setDetailsCache: (updater: (prev: Record<string, DetailItem[]>) => Record<string, DetailItem[]>) => void;
}) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  async function toggleCategory(categoryName: string) {
    const key = `cat:${categoryName}`;
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!detailsCache[key]) {
      setLoadingKey(key);
      const res = await authFetch(`/api/folderit/details?category=${encodeURIComponent(categoryName)}`);
      const json = await res.json();
      const items: DetailItem[] = (json.items ?? []).map((it: { file_uid: string; name: string | null; created_at: string | null; folder_path: string | null }) => ({
        section: "hr_inbox" as const,
        item_uid: it.file_uid,
        name: it.name,
        account_name: categoryName,
        status: null,
        created_at: it.created_at,
        days_pending: null,
        folder_path: it.folder_path,
      }));
      setDetailsCache((prev) => ({ ...prev, [key]: items }));
      setLoadingKey(null);
    }
  }

  async function toggleInbox() {
    const key = "hr:inbox";
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!detailsCache[key]) {
      setLoadingKey(key);
      const res = await authFetch("/api/folderit/hr-inbox");
      const json = await res.json();
      const items: DetailItem[] = (json.items ?? []).map((it: { file_uid: string; name: string | null; account_name: string; created_at: string | null }) => ({
        section: "hr_inbox" as const,
        item_uid: it.file_uid,
        name: it.name,
        account_name: it.account_name,
        status: null,
        created_at: it.created_at,
        days_pending: null,
      }));
      setDetailsCache((prev) => ({ ...prev, [key]: items }));
      setLoadingKey(null);
    }
  }

  return (
    <div style={{ marginTop: "24px" }}>
      <SectionTitle title="HR" />
      <div style={{ ...cardStyle, overflow: "hidden" }}>
        {categories.map((cat) => (
          <CollapsibleRow
            key={cat.category_name}
            label={cat.category_name}
            count={cat.file_count}
            color={GREEN}
            isOpen={expanded === `cat:${cat.category_name}`}
            onToggle={() => toggleCategory(cat.category_name)}
            items={detailsCache[`cat:${cat.category_name}`] ?? null}
            loading={loadingKey === `cat:${cat.category_name}`}
            asFolderTree
          />
        ))}
        <CollapsibleRow
          label="Inbox — not yet filed"
          count={hrInboxCount}
          color={BLUE}
          sub="Visible to everyone"
          isOpen={expanded === "hr:inbox"}
          onToggle={toggleInbox}
          items={detailsCache["hr:inbox"] ?? null}
          loading={loadingKey === "hr:inbox"}
        />
      </div>
    </div>
  );
}

// ── Member view: just my own numbers, as two compact stat cards ────
// Khuram: "every manager should be able to see their company only on
// their dashboard showing them their approval outstanding, plus the
// number of documents which arent filed and they can also see the
// documents by clicking the preview button." Both counts are already
// scoped server-side to the caller's own company (see
// /api/folderit/summary + /api/folderit/details) — this just shows
// which company that is, and keeps the click-to-preview behaviour.
//
// No fetching happens in here — approvalCount/approvalItems/inboxCount/
// inboxItems all come from the single parallel fetch in
// FolderitDashboard, so switching views doesn't trigger yet another
// round trip. See Khuram: "Folderit is working very slow... takes a
// while for the page to load."
function MemberView({
  hrCategories, hrInboxCount, hasHrAccess, companyName, approvalCount, approvalItems, inboxCount, inboxItems,
}: {
  hrCategories: HrCategory[]; hrInboxCount: number; hasHrAccess: boolean; companyName?: string | null;
  approvalCount: number; approvalItems: DetailItem[]; inboxCount: number; inboxItems: DetailItem[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hrExpanded, setHrExpanded] = useState<string | null>(null);
  const [hrDetailsCache, setHrDetailsCache] = useState<Record<string, DetailItem[]>>({});

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px", marginBottom: "12px" }}>
        <StatCard
          label="Pending my approval"
          count={approvalCount}
          color={AMBER}
          isOpen={expanded === "approval"}
          onToggle={() => setExpanded(expanded === "approval" ? null : "approval")}
        />
        <StatCard
          label="Not yet filed"
          count={inboxCount}
          color={BLUE}
          sub={companyName ?? undefined}
          isOpen={expanded === "inbox"}
          onToggle={() => setExpanded(expanded === "inbox" ? null : "inbox")}
        />
      </div>
      {expanded === "approval" && (
        <DetailPanel title="Pending my approval" items={approvalItems} loading={false} onClose={() => setExpanded(null)} />
      )}
      {expanded === "inbox" && (
        <DetailPanel title={companyName ? `Not yet filed — ${companyName}` : "Not yet filed"} items={inboxItems} loading={false} onClose={() => setExpanded(null)} />
      )}
      {hasHrAccess && (
        <HrSection
          categories={hrCategories}
          hrInboxCount={hrInboxCount}
          expanded={hrExpanded}
          setExpanded={setHrExpanded}
          detailsCache={hrDetailsCache}
          setDetailsCache={setHrDetailsCache}
        />
      )}
    </>
  );
}

// Approvals are always personal — even the CEO/Admin only ever sees their
// own outstanding approvals here, never everyone else's. Reused at the top
// of AdminView; MemberView has its own equivalent card inline since it also
// needs the company inbox card right alongside it. Data comes in as props
// from FolderitDashboard's single parallel fetch — no fetching in here.
function PersonalApprovalsCard({ count, items }: { count: number; items: DetailItem[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 220px))", gap: "12px", marginBottom: "12px" }}>
        <StatCard
          label="Pending my approval"
          count={count}
          color={AMBER}
          isOpen={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      </div>
      {expanded && (
        <DetailPanel title="Pending my approval" items={items} loading={false} onClose={() => setExpanded(false)} />
      )}
    </div>
  );
}

// ── CEO/Admin view: every company on one page ───────────────────────
type CompanyBreakdownRow = {
  group_key: string;
  inbox_count: number;
  inbox_oldest_days: number | null;
};

function AdminView({
  hrCategories, hrInboxCount, hasHrAccess, approvalCount, approvalItems, companyBreakdown,
}: {
  hrCategories: HrCategory[]; hrInboxCount: number; hasHrAccess: boolean;
  approvalCount: number; approvalItems: DetailItem[]; companyBreakdown: CompanyBreakdownRow[];
}) {
  const rows = companyBreakdown;
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState<string | null>(null);
  const [detailsByCompany, setDetailsByCompany] = useState<Record<string, DetailItem[]>>({});
  const [hrExpanded, setHrExpanded] = useState<string | null>(null);
  const [hrDetailsCache, setHrDetailsCache] = useState<Record<string, DetailItem[]>>({});

  async function openCompany(groupKey: string) {
    setExpandedCompany(groupKey);
    if (!detailsByCompany[groupKey]) {
      setLoadingCompany(groupKey);
      if (groupKey === RESTAURANT_GROUP_KEY) {
        // Merged card — fetch both real companies behind it and combine.
        const [resA, resB] = await Promise.all([
          authFetch(`/api/folderit/details?company=${BRNH_ID}`),
          authFetch(`/api/folderit/details?company=${HD_ID}`),
        ]);
        const [jsonA, jsonB] = await Promise.all([resA.json(), resB.json()]);
        setDetailsByCompany((prev) => ({ ...prev, [groupKey]: [...(jsonA.items ?? []), ...(jsonB.items ?? [])] }));
      } else {
        const res = await authFetch(`/api/folderit/details?company=${groupKey}`);
        const json = await res.json();
        setDetailsByCompany((prev) => ({ ...prev, [groupKey]: json.items ?? [] }));
      }
      setLoadingCompany(null);
    }
  }

  async function toggleCompany(groupKey: string) {
    if (expandedCompany === groupKey) { setExpandedCompany(null); return; }
    await openCompany(groupKey);
  }

  return (
    <>
      <PersonalApprovalsCard count={approvalCount} items={approvalItems} />

      <SectionTitle title="By Company" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px", marginBottom: "16px" }}>
        {FOLDERIT_DISPLAY_COMPANIES.map((company) => {
          const row = rows.find((r) => r.group_key === company.id);
          const inboxCount = row?.inbox_count ?? 0;
          const inboxOldestDays = row?.inbox_oldest_days ?? null;
          const isSelected = expandedCompany === company.id;
          const hasData = inboxCount > 0;
          return (
            <div
              key={company.id}
              onClick={() => hasData && toggleCompany(company.id)}
              style={{
                ...cardStyle,
                padding: "16px 18px",
                cursor: hasData ? "pointer" : "default",
                border: isSelected ? `1.5px solid ${NAVY}` : `1px solid ${HAIRLINE}`,
                boxShadow: isSelected ? SHADOWS.HOVER : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <CompanyBadge shortCode={company.shortCode} />
                  <span style={{ fontSize: "15px", fontWeight: 600, color: NAVY }}>{company.name}</span>
                </div>
                {hasData && <span style={{ fontSize: "12px", color: SLATE }}>{isSelected ? "▼" : "▶"}</span>}
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-sans, Inter, sans-serif)", fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Inbox — not yet filed</div>
                <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: inboxCount > 0 ? BLUE : SLATE }}>{inboxCount}</div>
                {inboxOldestDays !== null && inboxCount > 0 && (
                  <div style={{ fontSize: "12px", fontWeight: 600, color: severityColor(inboxOldestDays), marginTop: "2px" }}>oldest {inboxOldestDays}d</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {expandedCompany && (
        <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "16px", padding: 0 }}>
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: CARD_ALT }}>
            <span style={{ fontSize: "15px", fontWeight: 600, color: NAVY }}>
              {FOLDERIT_DISPLAY_COMPANIES.find((c) => c.id === expandedCompany)?.name}
            </span>
            <span onClick={() => setExpandedCompany(null)} style={{ cursor: "pointer", fontSize: "12px", color: SLATE }}>Close ✕</span>
          </div>
          {loadingCompany === expandedCompany ? (
            <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Loading…</div>
          ) : (detailsByCompany[expandedCompany] ?? []).length === 0 ? (
            <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Nothing here.</div>
          ) : (
            <>
              <div style={{ padding: "10px 16px 4px 16px", fontSize: "11px", fontWeight: 600, color: COLOURS.INK_700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Inbox — not yet filed
              </div>
              <FileList items={detailsByCompany[expandedCompany] ?? []} />
            </>
          )}
        </div>
      )}

      {(() => {
        // Bars coloured to match each company's own badge colour (same
        // one used on its card above), not by severity — Khuram: "can we
        // change the colours of the bar chart matching the colours of
        // the company, Please ensure all companies are in different
        // colours so its consistent" / "match the names on bar charts,
        // as well please" — the y-axis label is now the same name shown
        // on that company's card (e.g. "Family Documents", not "DIR"),
        // not just its short code.
        const chartData = FOLDERIT_DISPLAY_COMPANIES.map((company) => {
          const row = rows.find((r) => r.group_key === company.id);
          const days = row?.inbox_oldest_days ?? 0;
          const colour = COMPANY_BADGE_STYLES[company.shortCode]?.text ?? SLATE;
          return { name: company.name, shortCode: company.shortCode, days, colour };
        });
        return (
          <div style={{ ...cardStyle, padding: "22px 24px", marginBottom: "16px" }}>
            <div style={{ fontFamily: "var(--font-sans, Inter, sans-serif)", fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px" }}>Document Aging by Company</div>
            <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 34)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 36, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.TRACK} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: SLATE }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: NAVY }} width={150} />
                <Tooltip formatter={(value) => [`${value} days`, "Oldest outstanding"]} />
                <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.colour} />)}
                  <LabelList dataKey="days" position="right" formatter={(v) => `${v}d`} style={{ fontSize: "11px", fontWeight: 600, fill: NAVY }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize: "11px", color: SLATE, marginTop: "10px" }}>
              Longest a document has sat unfiled or unapproved, per company. Bar colour matches each company&apos;s badge above.
            </div>
          </div>
        );
      })()}

      {hasHrAccess && (
        <HrSection
          categories={hrCategories}
          hrInboxCount={hrInboxCount}
          expanded={hrExpanded}
          setExpanded={setHrExpanded}
          detailsCache={hrDetailsCache}
          setDetailsCache={setHrDetailsCache}
        />
      )}
    </>
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
          No documents found for "{query}"
        </div>
      )}
    </div>
  );
}

function BrowseView() {
  const setPreview = useContext(PreviewContext);
  const { ctx: browseCtx } = useUserCtx();
  const browseRole = browseCtx?.role ?? null;
  const canSearch = browseRole === "Admin" || browseRole === "CEO" || browseRole === "Manager" || browseRole === "Executive" || browseCtx?.email === "khuram1901@gmail.com";
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
        {canSearch && <GlobalSearchBox />}
        <div style={{ marginBottom: "20px", marginTop: canSearch ? "20px" : "0" }}>
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

function OverviewTab({ isAdmin, onGoToHealth }: { isAdmin: boolean; onGoToHealth: (nav?: HealthNav) => void }) {
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

// ── Four-tab dashboard shell ────────────────────────────────────────────────

function FolderitDashboard() {
  const isMobile = useMobile();
  const { ctx, loading: ctxLoading } = useUserCtx();
  const [pageTab, setPageTab] = useState<"overview" | "browse" | "health">("overview");
  const [healthNav, setHealthNav] = useState<HealthNav>({});
  const [hrCategories, setHrCategories] = useState<HrCategory[]>([]);
  const [summary, setSummary] = useState<{ pending_approval_count: number; company_inbox_count: number; hr_inbox_count: number } | null>(null);
  const [approvalItems, setApprovalItems] = useState<DetailItem[]>([]);
  const [memberInboxItems, setMemberInboxItems] = useState<DetailItem[]>([]);
  const [companyBreakdown, setCompanyBreakdown] = useState<CompanyBreakdownRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewTarget>(null);

  // Blob URLs hold the whole PDF in memory — revoke the previous one the
  // moment it's replaced or the modal closes, not just on unmount.
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  useEffect(() => {
    (async () => {
      const [hrRes, summaryRes, detailsRes, breakdownRes] = await Promise.all([
        authFetch("/api/folderit/hr-summary"),
        authFetch("/api/folderit/summary"),
        authFetch("/api/folderit/details"),
        authFetch("/api/folderit/company-breakdown"),
      ]);
      const hrJson = await hrRes.json();
      setHrCategories((hrJson.categories ?? []).sort((a: HrCategory, b: HrCategory) => a.sort_order - b.sort_order));
      setSummary(await summaryRes.json());
      const detailsJson = await detailsRes.json();
      const items: DetailItem[] = detailsJson.items ?? [];
      setApprovalItems(items.filter((d) => d.section === "approval"));
      setMemberInboxItems(items.filter((d) => d.section === "company_inbox"));
      if (breakdownRes.ok) {
        const breakdownJson = await breakdownRes.json();
        setCompanyBreakdown(breakdownJson.companies ?? []);
      }
      setDataLoading(false);
    })();
  }, []);

  if (ctxLoading || dataLoading || !ctx) {
    return <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden", color: SLATE }}>Loading…</main>;
  }

  const isAdmin = isAdminTier(ctx);
  const hasHrAccess = canViewFolderitHr(ctx);
  const hrInboxCount = summary?.hr_inbox_count ?? 0;

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
            isAdmin={isAdmin}
            onGoToHealth={(nav) => {
              setHealthNav(nav ?? {});
              setPageTab("health");
            }}
          />
        )}
        {pageTab === "browse"   && <BrowseView />}
        {pageTab === "health"   && (
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
