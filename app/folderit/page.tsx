"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch } from "../lib/supabase";
import { COLOURS, RADII, cardStyle, PageHeader, SectionTitle, WARNING_BANNER_STYLE, WARNING_TITLE_COLOR } from "../lib/SharedUI";
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
  days_pending: number | null;
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
            <AgeTag days={item.days_pending} />
            {item.status && (
              <span style={{ fontSize: "10.5px", fontWeight: 600, color: AMBER, textTransform: "capitalize" }}>
                {item.status}
              </span>
            )}
          </div>
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
        days_pending: null,
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
type CompanyBreakdownRow = {
  company_uuid: string;
  inbox_count: number;
  inbox_oldest_days: number | null;
  pending_approval_count: number;
  approval_oldest_days: number | null;
};

type OverdueItem = {
  section: "approval" | "company_inbox";
  item_uid: string;
  name: string | null;
  account_name: string;
  company_uuid: string;
  days_pending: number;
};

function AdminView({ hrCategories, hrInboxCount }: { hrCategories: HrCategory[]; hrInboxCount: number }) {
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

  async function openCompany(companyUuid: string) {
    setExpandedCompany(companyUuid);
    if (!detailsByCompany[companyUuid]) {
      setLoadingCompany(companyUuid);
      const res = await authFetch(`/api/folderit/details?company=${companyUuid}`);
      const json = await res.json();
      setDetailsByCompany((prev) => ({ ...prev, [companyUuid]: json.items ?? [] }));
      setLoadingCompany(null);
    }
  }

  async function toggleCompany(companyUuid: string) {
    if (expandedCompany === companyUuid) { setExpandedCompany(null); return; }
    await openCompany(companyUuid);
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
                  {overdueItems.length} document{overdueItems.length > 1 ? "s" : ""} sitting 7+ days, not yet filed or approved
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
                    onClick={() => { openCompany(it.company_uuid); setBannerOpen(false); }}
                    style={{ padding: "8px 16px 8px 48px", borderBottom: `1px solid ${HAIRLINE}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.name ?? "Untitled document"}
                      </div>
                      <div style={{ fontSize: "11.5px", color: SLATE, marginTop: "1px", display: "flex", alignItems: "center", gap: "6px" }}>
                        {company && <CompanyBadge shortCode={company.shortCode} />}
                        {it.account_name} · {it.section === "approval" ? "pending approval" : "inbox"}
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

      <SectionTitle title="By Company" />
      <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "16px" }}>
        {COMPANIES.map((company, i) => {
          const row = rows.find((r) => r.company_uuid === company.id);
          const inboxCount = row?.inbox_count ?? 0;
          const inboxOldestDays = row?.inbox_oldest_days ?? null;
          const approvalCount = row?.pending_approval_count ?? 0;
          const approvalOldestDays = row?.approval_oldest_days ?? null;
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
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{
                    textAlign: "right", padding: "4px 10px", borderRadius: RADII.SM,
                    backgroundColor: inboxCount > 0 ? "#EEF1FC" : "transparent", minWidth: "72px",
                  }}>
                    <div style={{ fontSize: "9.5px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Inbox</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: inboxCount > 0 ? BLUE : SLATE, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{inboxCount}</div>
                    {inboxOldestDays !== null && inboxCount > 0 && (
                      <div style={{ fontSize: "9.5px", fontWeight: 600, marginTop: "1px", color: inboxOldestDays >= 7 ? COLOURS.RED : SLATE }}>
                        oldest {inboxOldestDays}d
                      </div>
                    )}
                  </div>
                  <div style={{
                    textAlign: "right", padding: "4px 10px", borderRadius: RADII.SM,
                    backgroundColor: approvalCount > 0 ? COLOURS.WARNING_SOFT : "transparent", minWidth: "72px",
                  }}>
                    <div style={{ fontSize: "9.5px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Approvals</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: approvalCount > 0 ? AMBER : SLATE, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{approvalCount}</div>
                    {approvalOldestDays !== null && approvalCount > 0 && (
                      <div style={{ fontSize: "9.5px", fontWeight: 600, marginTop: "1px", color: approvalOldestDays >= 7 ? COLOURS.RED : SLATE }}>
                        oldest {approvalOldestDays}d
                      </div>
                    )}
                  </div>
                  {hasData && <span style={{ fontSize: "12px", color: SLATE }}>{isOpen ? "▼" : "▶"}</span>}
                </div>
              </div>
              {isOpen && (
                loadingCompany === company.id ? (
                  <div style={{ padding: "12px 16px", color: SLATE, fontSize: "13px" }}>Loading…</div>
                ) : (
                  <div style={{ backgroundColor: CARD_ALT }}>
                    {approvalCount > 0 && (
                      <>
                        <div style={{ padding: "8px 16px 4px 40px", fontSize: "10.5px", fontWeight: 600, color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Pending approval
                        </div>
                        <FileList items={(detailsByCompany[company.id] ?? []).filter((it) => it.section === "approval")} />
                      </>
                    )}
                    {inboxCount > 0 && (
                      <>
                        <div style={{ padding: "8px 16px 4px 40px", fontSize: "10.5px", fontWeight: 600, color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Inbox — not yet filed
                        </div>
                        <FileList items={(detailsByCompany[company.id] ?? []).filter((it) => it.section === "company_inbox")} />
                      </>
                    )}
                  </div>
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
