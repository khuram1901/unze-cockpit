"use client";

import { useEffect, useState, useContext, createContext } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch } from "../lib/supabase";
import { COLOURS, RADII, SHADOWS, cardStyle, PageHeader, SectionTitle, WARNING_BANNER_STYLE, WARNING_TITLE_COLOR } from "../lib/SharedUI";
import { COMPANIES } from "../lib/constants";
import { useUserCtx } from "../lib/useUserCtx";
import { isAdminTier, canViewFolderitHr } from "../lib/permissions";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

// Baranh and Haute Dolci share the same Folderit account (Restaurants) —
// the Folderit page shows them as one merged "Restaurant" card. They
// remain two separate companies everywhere else in the app (separate
// cash/budgets, per the project's multi-company rule).
const BRNH_ID = "6401ba75-f297-4617-84c1-305bcaf35a50";
const HD_ID = "16a92b7f-b3fa-4271-819b-c6befb534f12";
const RESTAURANT_GROUP_KEY = "restaurants";

const FOLDERIT_DISPLAY_COMPANIES: { id: string; shortCode: string; name: string }[] = [
  ...COMPANIES.filter((c) => c.id !== BRNH_ID && c.id !== HD_ID).map((c) => ({ id: c.id, shortCode: c.shortCode, name: c.name })),
  { id: RESTAURANT_GROUP_KEY, shortCode: "RST", name: "Restaurant" },
];

function displayGroupFor(realCompanyUuid: string): string {
  return realCompanyUuid === BRNH_ID || realCompanyUuid === HD_ID ? RESTAURANT_GROUP_KEY : realCompanyUuid;
}

function severityColor(days: number): string {
  if (days >= 7) return COLOURS.RED;
  if (days >= 3) return COLOURS.AMBER;
  if (days > 0) return COLOURS.SLATE;
  return COLOURS.GREEN;
}

const { NAVY, SLATE, HAIRLINE, AMBER, BLUE, GREEN, CARD_ALT } = COLOURS;

const COMPANY_BADGE_STYLES: Record<string, { bg: string; text: string }> = {
  UTPL: { bg: "#EEF1FC", text: COLOURS.BLUE },
  IFPL: { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN },
  BRNH: { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  HD: { bg: "#F3EEF9", text: "#6E45B8" },
  ALM: { bg: COLOURS.CARD_ALT, text: COLOURS.SLATE },
  DIR: { bg: COLOURS.CARD_ALT, text: COLOURS.NAVY },
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
  const color = days >= 7 ? COLOURS.RED : days >= 3 ? AMBER : SLATE;
  return (
    <span style={{ fontSize: "10.5px", fontWeight: 600, color, flexShrink: 0 }}>
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
async function fetchPreviewBlobUrl(fileUid: string): Promise<string> {
  const res = await authFetch(`/api/folderit/file-url?file=${encodeURIComponent(fileUid)}`);
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
      const url = await fetchPreviewBlobUrl(item.item_uid);
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
        <div style={{ fontSize: "13.5px", color: BLUE, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline", textDecorationColor: "transparent" }}>
          {item.name ?? "Untitled document"}
        </div>
        <div style={{ fontSize: "11.5px", color: SLATE, marginTop: "1px" }}>{item.account_name}</div>
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
        <span style={{ fontSize: "12px", fontWeight: 700, color: NAVY }}>📁 {node.name}</span>
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
          <div style={{ fontSize: "14.5px", fontWeight: 600, color: NAVY }}>{label}</div>
          {sub && <div style={{ fontSize: "11.5px", color: SLATE, marginTop: "1px" }}>{sub}</div>}
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

// ── Member view: just my own numbers, collapsible ──────────────────
function MemberView({ hrCategories, hrInboxCount, hasHrAccess }: { hrCategories: HrCategory[]; hrInboxCount: number; hasHrAccess: boolean }) {
  const [summary, setSummary] = useState<{ pending_approval_count: number; company_inbox_count: number } | null>(null);
  const [details, setDetails] = useState<DetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hrExpanded, setHrExpanded] = useState<string | null>(null);
  const [hrDetailsCache, setHrDetailsCache] = useState<Record<string, DetailItem[]>>({});

  useEffect(() => {
    (async () => {
      const [summaryRes, detailsRes] = await Promise.all([
        authFetch("/api/folderit/summary"),
        authFetch("/api/folderit/details"),
      ]);
      setSummary(await summaryRes.json());
      const detailsJson = await detailsRes.json();
      setDetails(detailsJson.items ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={{ color: SLATE }}>Loading…</div>;

  const approvals = details.filter((d) => d.section === "approval");
  const companyInbox = details.filter((d) => d.section === "company_inbox");

  return (
    <>
      <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "16px" }}>
        <CollapsibleRow
          label="Pending my approval"
          count={summary?.pending_approval_count ?? 0}
          color={AMBER}
          isOpen={expanded === "approval"}
          onToggle={() => setExpanded(expanded === "approval" ? null : "approval")}
          items={approvals}
          loading={false}
        />
        <CollapsibleRow
          label="Company inbox — not yet filed"
          count={summary?.company_inbox_count ?? 0}
          color={BLUE}
          isOpen={expanded === "inbox"}
          onToggle={() => setExpanded(expanded === "inbox" ? null : "inbox")}
          items={companyInbox}
          loading={false}
        />
      </div>
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
// of AdminView; MemberView has its own equivalent row inline since it also
// needs the company inbox row right alongside it.
function PersonalApprovalsCard() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<DetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      const [summaryRes, detailsRes] = await Promise.all([
        authFetch("/api/folderit/summary"),
        authFetch("/api/folderit/details"),
      ]);
      const summaryJson = await summaryRes.json();
      setCount(summaryJson.pending_approval_count ?? 0);
      const detailsJson = await detailsRes.json();
      setItems((detailsJson.items ?? []).filter((d: DetailItem) => d.section === "approval"));
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "16px" }}>
      <CollapsibleRow
        label="Pending my approval"
        count={count}
        color={AMBER}
        isOpen={expanded}
        onToggle={() => setExpanded(!expanded)}
        items={items}
        loading={loading}
      />
    </div>
  );
}

// ── CEO/Admin view: every company on one page ───────────────────────
type CompanyBreakdownRow = {
  group_key: string;
  inbox_count: number;
  inbox_oldest_days: number | null;
};

type OverdueItem = {
  section: "company_inbox";
  item_uid: string;
  name: string | null;
  account_name: string;
  company_uuid: string;
  days_pending: number;
};

function AdminView({ hrCategories, hrInboxCount, hasHrAccess }: { hrCategories: HrCategory[]; hrInboxCount: number; hasHrAccess: boolean }) {
  const [rows, setRows] = useState<CompanyBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState<string | null>(null);
  const [detailsByCompany, setDetailsByCompany] = useState<Record<string, DetailItem[]>>({});
  const [hrExpanded, setHrExpanded] = useState<string | null>(null);
  const [hrDetailsCache, setHrDetailsCache] = useState<Record<string, DetailItem[]>>({});
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([]);
  const [bannerOpen, setBannerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [breakdownRes, overdueRes] = await Promise.all([
        authFetch("/api/folderit/company-breakdown"),
        authFetch("/api/folderit/overdue"),
      ]);
      const breakdownJson = await breakdownRes.json();
      setRows(breakdownJson.companies ?? []);
      const overdueJson = await overdueRes.json();
      setOverdueItems(overdueJson.items ?? []);
      setLoading(false);
    })();
  }, []);

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

  if (loading) return <div style={{ color: SLATE }}>Loading…</div>;

  return (
    <>
      {overdueItems.length > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div
            onClick={() => setBannerOpen(!bannerOpen)}
            style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>
                  {overdueItems.length} document{overdueItems.length > 1 ? "s" : ""} sitting 7+ days, not yet filed
                </div>
                <div style={{ fontSize: "12px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>
                  {overdueItems.slice(0, 3).map((it) => `${it.name ?? "Untitled"} (${it.days_pending}d)`).join(" · ")}
                </div>
              </div>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={{ borderTop: "1px solid #F1D9A9", backgroundColor: COLOURS.CARD }}>
              {overdueItems.map((it) => {
                const company = COMPANIES.find((c) => c.id === it.company_uuid);
                return (
                  <div
                    key={`${it.section}:${it.item_uid}`}
                    onClick={() => { openCompany(displayGroupFor(it.company_uuid)); setBannerOpen(false); }}
                    style={{ padding: "8px 16px 8px 48px", borderBottom: `1px solid ${HAIRLINE}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.name ?? "Untitled document"}
                      </div>
                      <div style={{ fontSize: "11.5px", color: SLATE, marginTop: "1px", display: "flex", alignItems: "center", gap: "6px" }}>
                        {company && <CompanyBadge shortCode={company.shortCode} />}
                        {it.account_name} · inbox
                      </div>
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.RED, flexShrink: 0 }}>{it.days_pending}d</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <PersonalApprovalsCard />

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
                  <span style={{ fontSize: "14px", fontWeight: 700, color: NAVY }}>{company.name}</span>
                </div>
                {hasData && <span style={{ fontSize: "12px", color: SLATE }}>{isSelected ? "▼" : "▶"}</span>}
              </div>
              <div>
                <div style={{ fontSize: "9.5px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Inbox — not yet filed</div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: inboxCount > 0 ? BLUE : SLATE, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{inboxCount}</div>
                {inboxOldestDays !== null && inboxCount > 0 && (
                  <div style={{ fontSize: "10px", fontWeight: 600, color: inboxOldestDays >= 7 ? COLOURS.RED : SLATE }}>oldest {inboxOldestDays}d</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {expandedCompany && (
        <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "16px", padding: 0 }}>
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: CARD_ALT }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: NAVY }}>
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
              <div style={{ padding: "10px 16px 4px 16px", fontSize: "10.5px", fontWeight: 600, color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Inbox — not yet filed
              </div>
              <FileList items={detailsByCompany[expandedCompany] ?? []} />
            </>
          )}
        </div>
      )}

      {(() => {
        const chartData = FOLDERIT_DISPLAY_COMPANIES.map((company) => {
          const row = rows.find((r) => r.group_key === company.id);
          const days = row?.inbox_oldest_days ?? 0;
          return { name: company.shortCode, days };
        });
        return (
          <div style={{ ...cardStyle, padding: "22px 24px", marginBottom: "16px" }}>
            <div style={{ fontSize: "15px", fontWeight: 600, color: NAVY, marginBottom: "14px" }}>Document aging by company</div>
            <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 34)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.TRACK} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: SLATE }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: NAVY }} width={48} />
                <Tooltip formatter={(value) => [`${value} days`, "Oldest outstanding"]} />
                <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={severityColor(d.days)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize: "11px", color: SLATE, marginTop: "10px" }}>
              Longest a document has sat unfiled or unapproved, per company. Red = 7+ days, amber = 3-6 days.
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

function FolderitDashboard() {
  const { ctx, loading: ctxLoading } = useUserCtx();
  const [hrCategories, setHrCategories] = useState<HrCategory[]>([]);
  const [hrInboxCount, setHrInboxCount] = useState(0);
  const [hrLoading, setHrLoading] = useState(true);
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
      const [hrRes, summaryRes] = await Promise.all([
        authFetch("/api/folderit/hr-summary"),
        authFetch("/api/folderit/summary"),
      ]);
      const hrJson = await hrRes.json();
      setHrCategories((hrJson.categories ?? []).sort((a: HrCategory, b: HrCategory) => a.sort_order - b.sort_order));
      const summaryJson = await summaryRes.json();
      setHrInboxCount(summaryJson.hr_inbox_count ?? 0);
      setHrLoading(false);
    })();
  }, []);

  if (ctxLoading || hrLoading || !ctx) {
    return <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px", color: SLATE }}>Loading…</div>;
  }

  const isAdmin = isAdminTier(ctx);
  const hasHrAccess = canViewFolderitHr(ctx);

  return (
    <PreviewContext.Provider value={setPreview}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
        <PageHeader />
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: NAVY, marginBottom: "4px" }}>Folderit</h1>
        <div style={{ fontSize: "13.5px", color: SLATE, marginBottom: "20px" }}>
          Documents pending approval &amp; filing — read-only status view. Act on anything by opening Folderit directly.
        </div>

        {isAdmin ? (
          <AdminView hrCategories={hrCategories} hrInboxCount={hrInboxCount} hasHrAccess={hasHrAccess} />
        ) : (
          <MemberView hrCategories={hrCategories} hrInboxCount={hrInboxCount} hasHrAccess={hasHrAccess} />
        )}
      </div>
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
