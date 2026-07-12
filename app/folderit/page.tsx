"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch } from "../lib/supabase";
import { COLOURS, RADII, cardStyle, PageHeader, SectionTitle, CountCard } from "../lib/SharedUI";
import { COMPANIES } from "../lib/constants";
import { useUserCtx } from "../lib/useUserCtx";
import { isAdminTier } from "../lib/permissions";

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
};

type HrCategory = { category_name: string; file_count: number; sort_order: number };

function FileList({ items }: { items: DetailItem[] }) {
  if (!items.length) return <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Nothing here.</div>;
  return (
    <div>
      {items.map((item, i) => (
        <div key={item.item_uid} style={{
          padding: "8px 16px 8px 40px",
          borderTop: i > 0 ? `1px solid ${HAIRLINE}` : "none",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "13.5px", color: NAVY, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.name ?? "Untitled document"}
            </div>
            <div style={{ fontSize: "11.5px", color: SLATE, marginTop: "1px" }}>{item.account_name}</div>
          </div>
          {item.status && (
            <span style={{ fontSize: "10.5px", fontWeight: 600, color: AMBER, textTransform: "capitalize", flexShrink: 0 }}>
              {item.status}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// A single collapsible row: label + count on the left, chevron on the
// right, expands in place to show a FileList. Same interaction as the
// audit-record rows in AuditDashboard.tsx.
function CollapsibleRow({
  label, count, color, sub, isOpen, onToggle, items, loading,
}: {
  label: string; count: number; color: string; sub?: string;
  isOpen: boolean; onToggle: () => void; items: DetailItem[] | null; loading: boolean;
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
      const items: DetailItem[] = (json.items ?? []).map((it: { file_uid: string; name: string | null; created_at: string | null }) => ({
        section: "hr_inbox" as const,
        item_uid: it.file_uid,
        name: it.name,
        account_name: categoryName,
        status: null,
        created_at: it.created_at,
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
      const res = await authFetch("/api/folderit/details");
      const json = await res.json();
      const items: DetailItem[] = (json.items ?? []).filter((it: DetailItem) => it.section === "hr_inbox");
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
function MemberView({ hrCategories, hrInboxCount }: { hrCategories: HrCategory[]; hrInboxCount: number }) {
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
      <HrSection
        categories={hrCategories}
        hrInboxCount={hrInboxCount}
        expanded={hrExpanded}
        setExpanded={setHrExpanded}
        detailsCache={hrDetailsCache}
        setDetailsCache={setHrDetailsCache}
      />
    </>
  );
}

// ── CEO/Admin view: every company on one page ───────────────────────
function AdminView({ hrCategories, hrInboxCount }: { hrCategories: HrCategory[]; hrInboxCount: number }) {
  const [rows, setRows] = useState<{ company_uuid: string; inbox_count: number; pending_approval_count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState<string | null>(null);
  const [detailsByCompany, setDetailsByCompany] = useState<Record<string, DetailItem[]>>({});
  const [hrExpanded, setHrExpanded] = useState<string | null>(null);
  const [hrDetailsCache, setHrDetailsCache] = useState<Record<string, DetailItem[]>>({});

  useEffect(() => {
    (async () => {
      const res = await authFetch("/api/folderit/company-breakdown");
      const json = await res.json();
      setRows(json.companies ?? []);
      setLoading(false);
    })();
  }, []);

  async function toggleCompany(companyUuid: string) {
    if (expandedCompany === companyUuid) { setExpandedCompany(null); return; }
    setExpandedCompany(companyUuid);
    if (!detailsByCompany[companyUuid]) {
      setLoadingCompany(companyUuid);
      const res = await authFetch(`/api/folderit/details?company=${companyUuid}`);
      const json = await res.json();
      setDetailsByCompany((prev) => ({ ...prev, [companyUuid]: json.items ?? [] }));
      setLoadingCompany(null);
    }
  }

  if (loading) return <div style={{ color: SLATE }}>Loading…</div>;

  const totalInbox = rows.reduce((s, r) => s + r.inbox_count, 0);
  const totalApprovals = rows.reduce((s, r) => s + r.pending_approval_count, 0);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px", marginBottom: "16px" }}>
        <CountCard label="Companies tracked" value={rows.length} color={NAVY} />
        <CountCard label="Total inbox unfiled" value={totalInbox} color={BLUE} />
        <CountCard label="Total pending approvals" value={totalApprovals} color={AMBER} />
      </div>

      <SectionTitle title="By Company" />
      <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "16px" }}>
        {COMPANIES.map((company, i) => {
          const row = rows.find((r) => r.company_uuid === company.id);
          const inboxCount = row?.inbox_count ?? 0;
          const approvalCount = row?.pending_approval_count ?? 0;
          const isOpen = expandedCompany === company.id;
          const hasData = inboxCount > 0 || approvalCount > 0;
          return (
            <div key={company.id} style={{ borderTop: i > 0 ? `1px solid ${HAIRLINE}` : "none" }}>
              <div
                onClick={() => hasData && toggleCompany(company.id)}
                style={{
                  padding: "13px 16px", cursor: hasData ? "pointer" : "default", display: "flex",
                  justifyContent: "space-between", alignItems: "center", gap: "10px",
                  backgroundColor: isOpen ? CARD_ALT : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <CompanyBadge shortCode={company.shortCode} />
                  <span style={{ fontSize: "14.5px", fontWeight: 600, color: NAVY }}>{company.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "9.5px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Inbox</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: inboxCount > 0 ? BLUE : SLATE, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{inboxCount}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "9.5px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Approvals</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: approvalCount > 0 ? AMBER : SLATE, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{approvalCount}</div>
                  </div>
                  {hasData && <span style={{ fontSize: "12px", color: SLATE }}>{isOpen ? "▼" : "▶"}</span>}
                </div>
              </div>
              {isOpen && (
                loadingCompany === company.id ? (
                  <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Loading…</div>
                ) : (
                  <FileList items={detailsByCompany[company.id] ?? []} />
                )
              )}
            </div>
          );
        })}
      </div>

      <HrSection
        categories={hrCategories}
        hrInboxCount={hrInboxCount}
        expanded={hrExpanded}
        setExpanded={setHrExpanded}
        detailsCache={hrDetailsCache}
        setDetailsCache={setHrDetailsCache}
      />
    </>
  );
}

function FolderitDashboard() {
  const { ctx, loading: ctxLoading } = useUserCtx();
  const [hrCategories, setHrCategories] = useState<HrCategory[]>([]);
  const [hrInboxCount, setHrInboxCount] = useState(0);
  const [hrLoading, setHrLoading] = useState(true);

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

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <PageHeader />
      <h1 style={{ fontSize: "22px", fontWeight: 700, color: NAVY, marginBottom: "4px" }}>Folderit</h1>
      <div style={{ fontSize: "13.5px", color: SLATE, marginBottom: "20px" }}>
        Documents pending approval &amp; filing — read-only status view. Act on anything by opening Folderit directly.
      </div>

      {isAdmin ? (
        <AdminView hrCategories={hrCategories} hrInboxCount={hrInboxCount} />
      ) : (
        <MemberView hrCategories={hrCategories} hrInboxCount={hrInboxCount} />
      )}
    </div>
  );
}

export default function FolderitPage() {
  return (
    <AuthWrapper>
      <FolderitDashboard />
    </AuthWrapper>
  );
}
