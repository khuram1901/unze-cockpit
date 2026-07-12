"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch } from "../lib/supabase";
import { COLOURS, cardStyle, SHADOWS, PageHeader, SectionTitle } from "../lib/SharedUI";

const { NAVY, SLATE, GREEN, AMBER, BLUE, HAIRLINE } = COLOURS;

type Summary = {
  pending_approval_count: number;
  company_inbox_count: number;
  hr_inbox_count: number;
};

type DetailItem = {
  section: "approval" | "company_inbox" | "hr_inbox";
  item_uid: string;
  name: string | null;
  account_name: string;
  status: string | null;
  created_at: string | null;
};

function StatCard({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div style={{ ...cardStyle, boxShadow: SHADOWS.ELEVATED, padding: "18px 20px", flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: SLATE, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ fontSize: "32px", fontWeight: 700, color, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", marginTop: "4px" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "12px", color: SLATE, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function DetailList({ title, items, emptyLabel }: { title: string; items: DetailItem[]; emptyLabel: string }) {
  return (
    <div style={{ marginTop: "24px" }}>
      <SectionTitle title={title} />
      {items.length === 0 ? (
        <div style={{ padding: "16px", color: SLATE, fontSize: "14px" }}>{emptyLabel}</div>
      ) : (
        <div style={{ ...cardStyle, boxShadow: SHADOWS.ELEVATED, overflow: "hidden" }}>
          {items.map((item, i) => (
            <div
              key={item.item_uid}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: i < items.length - 1 ? `1px solid ${HAIRLINE}` : "none",
              }}
            >
              <div>
                <div style={{ fontSize: "14px", color: NAVY, fontWeight: 500 }}>{item.name ?? "Untitled document"}</div>
                <div style={{ fontSize: "12px", color: SLATE }}>{item.account_name}</div>
              </div>
              {item.status && (
                <div style={{ fontSize: "12px", fontWeight: 600, color: AMBER, textTransform: "capitalize" }}>
                  {item.status}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FolderitDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [details, setDetails] = useState<DetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [summaryRes, detailsRes] = await Promise.all([
          authFetch("/api/folderit/summary"),
          authFetch("/api/folderit/details"),
        ]);
        if (!summaryRes.ok) throw new Error("Failed to load Folderit summary");
        if (!detailsRes.ok) throw new Error("Failed to load Folderit details");
        setSummary(await summaryRes.json());
        const detailsJson = await detailsRes.json();
        setDetails(detailsJson.items ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load Folderit data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const approvals = details.filter((d) => d.section === "approval");
  const companyInbox = details.filter((d) => d.section === "company_inbox");
  const hrInbox = details.filter((d) => d.section === "hr_inbox");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <PageHeader />
      <h1 style={{ fontSize: "22px", fontWeight: 700, color: NAVY, marginBottom: "4px" }}>Folderit</h1>
      <div style={{ fontSize: "14px", color: SLATE, marginBottom: "20px" }}>
        Documents pending approval &amp; filing — read-only status view. Act on anything by opening Folderit directly.
      </div>

      {loading && <div style={{ color: SLATE }}>Loading…</div>}
      {err && <div style={{ color: COLOURS.RED }}>{err}</div>}

      {summary && (
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <StatCard label="Pending my approval" value={summary.pending_approval_count} color={AMBER} />
          <StatCard label="Company inbox unfiled" value={summary.company_inbox_count} color={BLUE} />
          <StatCard label="HR inbox unfiled" value={summary.hr_inbox_count} color={GREEN} sub="Visible to everyone" />
        </div>
      )}

      <DetailList title="Pending my approval" items={approvals} emptyLabel="Nothing waiting on you — nice." />
      <DetailList title="Company inbox — not yet filed" items={companyInbox} emptyLabel="Inbox is clear." />
      <DetailList title="HR inbox — not yet filed" items={hrInbox} emptyLabel="HR inbox is clear." />
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
