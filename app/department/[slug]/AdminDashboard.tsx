"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { COLOURS, RADII, PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";

// ── Types ──────────────────────────────────────────────────────────────────

type PersonRow = { name: string; overdue: number; pending: number; done: number };
type ComplianceStat = { registered: number; total: number };
type PaymentRow = { entity: string; type: string; status: "paid" | "due" };

type AdminSummary = {
  tasks: {
    open: number; overdue: number; urgent: number; done_week: number;
    by_person: PersonRow[];
  };
  compliance: {
    eobi: ComplianceStat; ss: ComplianceStat;
    civil: ComplianceStat; labour_reg: ComplianceStat; labour_insp: ComplianceStat;
  };
  payments: {
    current_month: PaymentRow[];
    late_fy: number;
    missing_fy: number;
  };
  documents: {
    ntn_registered: number; ntn_pending: number; ntn_no_link: number;
    pfa_valid: number; pfa_total: number;
    medical_valid: number; training_valid: number; tourism_valid: number;
    expiring_30d: number;
  };
  fleet: {
    active_vehicles: number; fills: number; fuel_spend: number;
    avg_kpl: number; maint_jobs: number; maint_spend: number; no_entry: number;
  };
  solar: {
    active_sites: number; total_kwh: number;
    missing_data: number; best_site: string | null; lowest_site: string | null;
  };
  utilities: {
    locations_tracked: number; total_bill: number;
    missing_readings: number; highest_bill_site: string | null;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function authedFetch(url: string) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });
}

function pct(registered: number, total: number): number {
  if (!total) return 0;
  return Math.round((registered / total) * 100);
}

function fmtPKR(n: number): string {
  if (n >= 1_000_000) return `PKR ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `PKR ${Math.round(n / 1_000)}k`;
  return `PKR ${Math.round(n)}`;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children, href }: { children: React.ReactNode; href?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      margin: "20px 0 8px",
    }}>
      <p style={{
        fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: COLOURS.SLATE, margin: 0,
      }}>{children}</p>
      {href && (
        <a href={href} style={{
          fontSize: "11px", color: COLOURS.GREEN, fontWeight: 600,
          textDecoration: "none", whiteSpace: "nowrap",
        }}>View →</a>
      )}
    </div>
  );
}

function KCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ backgroundColor: COLOURS.CARD_ALT, borderRadius: RADII.SM, padding: "10px 12px" }}>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginBottom: "3px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 600, color: color || COLOURS.NAVY }}>{value}</div>
    </div>
  );
}

function Card({ children, style, href }: { children: React.ReactNode; style?: React.CSSProperties; href?: string }) {
  const inner = (
    <div style={{
      backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: RADII.CARD, padding: "12px 14px", ...style,
    }}>
      {children}
    </div>
  );
  if (!href) return inner;
  return (
    <a href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      {inner}
    </a>
  );
}

function CardTitle({ children }: { children: string }) {
  return <p style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "8px" }}>{children}</p>;
}

function Row({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "5px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
    }}>
      <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{label}</span>
      <span style={{ fontSize: "12px", fontWeight: 600, color: color || COLOURS.NAVY }}>{value}</span>
    </div>
  );
}

type PillColour = "green" | "amber" | "red" | "grey";
const PILL_STYLES: Record<PillColour, { bg: string; color: string }> = {
  green: { bg: "#E8F5F1", color: COLOURS.GREEN },
  amber: { bg: "#FEF3E2", color: COLOURS.AMBER },
  red:   { bg: "#FDECEA", color: COLOURS.RED   },
  grey:  { bg: COLOURS.CARD_ALT, color: COLOURS.SLATE },
};

function Pill({ label, colour }: { label: string; colour: PillColour }) {
  const s = PILL_STYLES[colour];
  return (
    <span style={{
      fontSize: "10px", fontWeight: 600, padding: "2px 7px",
      borderRadius: RADII.PILL, backgroundColor: s.bg, color: s.color,
      whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function ComplianceBar({ label, stat, href }: { label: string; stat: ComplianceStat; href: string }) {
  const p = pct(stat.registered, stat.total);
  const barColor = p >= 80 ? COLOURS.GREEN : p >= 50 ? COLOURS.AMBER : COLOURS.RED;
  const pillColour: PillColour = p >= 80 ? "green" : p >= 50 ? "amber" : "red";
  const pillLabel = p >= 80 ? "Good" : p >= 50 ? "Partial" : "Attention";
  return (
    <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{
        display: "grid", gridTemplateColumns: "130px 1fr 38px 76px",
        alignItems: "center", gap: "8px",
        padding: "5px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
        cursor: "pointer",
      }}>
        <span style={{ fontSize: "12px", color: COLOURS.NAVY }}>{label}</span>
        <div style={{ height: "5px", backgroundColor: COLOURS.HAIRLINE, borderRadius: "3px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${p}%`, backgroundColor: barColor, borderRadius: "3px" }} />
        </div>
        <span style={{ fontSize: "11px", fontWeight: 600, color: barColor, textAlign: "right" }}>{p}%</span>
        <Pill label={pillLabel} colour={pillColour} />
      </div>
    </a>
  );
}

function SkeletonBlock({ height = "80px" }: { height?: string }) {
  return (
    <div style={{
      height, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD_ALT,
      marginBottom: "8px",
    }} />
  );
}

// ── Main component ─────────────────────────────────────────────────────────

const ADMIN_OPS = "/admin";

export default function AdminDashboard() {
  const router = useRouter();
  const isMobile = useMobile();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authedFetch("/api/admin/summary");
        const json = await res.json();
        if (json.error) { setError(json.error); return; }
        setSummary(json.data as AdminSummary);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grid4: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
    gap: "8px", marginBottom: "8px",
  };
  const grid2: React.CSSProperties = {
    display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
    gap: "8px", marginBottom: "8px",
  };
  const twoCol: React.CSSProperties = {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px",
  };
  const lastRow: React.CSSProperties = {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "5px 0",
  };

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "760px", overflowX: "hidden" }}>
      <PageHeader />

      {loading && (
        <div style={{ marginTop: "12px" }}>
          <SkeletonBlock height="64px" />
          <SkeletonBlock height="120px" />
          <SkeletonBlock height="160px" />
          <SkeletonBlock height="120px" />
        </div>
      )}

      {error && (
        <div style={{
          padding: "12px 16px", borderRadius: RADII.CARD, marginTop: "12px",
          backgroundColor: "#FDECEA", color: COLOURS.RED, fontSize: "13px",
        }}>
          Could not load summary: {error}
        </div>
      )}

      {!loading && !error && summary && (() => {
        const { tasks, compliance, payments, documents, fleet, solar, utilities } = summary;

        const payStatus = (entity: string, type: string): "paid" | "due" => {
          const row = payments.current_month?.find(
            (r) => r.entity === entity && r.type === type
          );
          return row?.status ?? "due";
        };
        const payPill = (entity: string, type: string) => {
          const s = payStatus(entity, type);
          return <Pill label={s === "paid" ? "Paid" : "Due"} colour={s === "paid" ? "green" : "amber"} />;
        };

        return (
          <>
            {/* ── TASKS ── */}
            <SectionLabel href="/tasks">Tasks</SectionLabel>
            <div style={grid4}>
              <KCard label="Open"           value={tasks.open} />
              <KCard label="Overdue"        value={tasks.overdue}    color={tasks.overdue    > 0 ? COLOURS.RED   : COLOURS.NAVY} />
              <KCard label="Urgent / high"  value={tasks.urgent}     color={tasks.urgent     > 0 ? COLOURS.AMBER : COLOURS.NAVY} />
              <KCard label="Done this week" value={tasks.done_week}  color={tasks.done_week  > 0 ? COLOURS.GREEN : COLOURS.NAVY} />
            </div>

            {tasks.by_person && tasks.by_person.length > 0 && (
              <Card href="/tasks" style={{ marginBottom: "8px" }}>
                <CardTitle>By person — Admin team</CardTitle>
                {tasks.by_person.map((p, i) => {
                  const isLast = i === tasks.by_person.length - 1;
                  return (
                    <div key={p.name} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "6px 0",
                      borderBottom: isLast ? "none" : `1px solid ${COLOURS.HAIRLINE}`,
                    }}>
                      <span style={{ fontSize: "13px", color: COLOURS.NAVY, fontWeight: 500 }}>{p.name}</span>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {p.overdue > 0 && (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: RADII.PILL, backgroundColor: "#FDECEA", color: COLOURS.RED }}>
                            {p.overdue} overdue
                          </span>
                        )}
                        {p.pending > 0 && (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: RADII.PILL, backgroundColor: "#FEF3E2", color: COLOURS.AMBER }}>
                            {p.pending} pending
                          </span>
                        )}
                        {p.done > 0 && (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: RADII.PILL, backgroundColor: "#E8F5F1", color: COLOURS.GREEN }}>
                            {p.done} done
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}

            {/* ── COMPLIANCE ── */}
            <SectionLabel href={`${ADMIN_OPS}?tab=registrations`}>Compliance health</SectionLabel>
            <Card style={{ marginBottom: "8px" }}>
              <ComplianceBar label="EOBI registration" stat={compliance.eobi}       href={`${ADMIN_OPS}?tab=registrations`} />
              <ComplianceBar label="Social Security"   stat={compliance.ss}         href={`${ADMIN_OPS}?tab=registrations`} />
              <ComplianceBar label="Civil Defence"     stat={compliance.civil}      href={`${ADMIN_OPS}?tab=compliance`} />
              <ComplianceBar label="Labour reg."       stat={compliance.labour_reg} href={`${ADMIN_OPS}?tab=compliance`} />
              {(() => {
                const p2 = pct(compliance.labour_insp.registered, compliance.labour_insp.total);
                const bc = p2 >= 80 ? COLOURS.GREEN : p2 >= 50 ? COLOURS.AMBER : COLOURS.RED;
                const pc: PillColour = p2 >= 80 ? "green" : p2 >= 50 ? "amber" : "red";
                return (
                  <a href={`${ADMIN_OPS}?tab=compliance`} style={{ textDecoration: "none", color: "inherit" }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "130px 1fr 38px 76px",
                      alignItems: "center", gap: "8px", padding: "5px 0", cursor: "pointer",
                    }}>
                      <span style={{ fontSize: "12px", color: COLOURS.NAVY }}>Labour inspection</span>
                      <div style={{ height: "5px", backgroundColor: COLOURS.HAIRLINE, borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${p2}%`, backgroundColor: bc, borderRadius: "3px" }} />
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: bc, textAlign: "right" }}>{p2}%</span>
                      <Pill label={p2 >= 80 ? "Good" : p2 >= 50 ? "Partial" : "Attention"} colour={pc} />
                    </div>
                  </a>
                );
              })()}
            </Card>

            {/* ── PAYMENTS ── */}
            <SectionLabel href={`${ADMIN_OPS}?tab=payments`}>Statutory payments — {monthLabel}</SectionLabel>
            <div style={grid2}>
              <Card href={`${ADMIN_OPS}?tab=payments`}>
                <CardTitle>EOBI</CardTitle>
                <Row label="IFPL"   value={payPill("IFPL",   "EOBI")} />
                <Row label="UTPL"   value={payPill("UTPL",   "EOBI")} />
                <Row label="Baranh" value={payPill("Baranh", "EOBI")} />
                <div style={lastRow}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>HD</span>
                  {payPill("HD", "EOBI")}
                </div>
              </Card>
              <Card href={`${ADMIN_OPS}?tab=payments`}>
                <CardTitle>Social Security</CardTitle>
                <Row label="IFPL"   value={payPill("IFPL",   "Social Security")} />
                <Row label="UTPL"   value={payPill("UTPL",   "Social Security")} />
                <Row label="Baranh" value={payPill("Baranh", "Social Security")} />
                <div style={lastRow}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>HD</span>
                  {payPill("HD", "Social Security")}
                </div>
              </Card>
            </div>
            <Card href={`${ADMIN_OPS}?tab=payments`} style={{ marginBottom: "8px" }}>
              <CardTitle>Payment history this FY</CardTitle>
              <Row label="Late payments (any entity)" value={payments.late_fy}    color={payments.late_fy    > 0 ? COLOURS.AMBER : COLOURS.GREEN} />
              <div style={lastRow}>
                <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Missing months</span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: payments.missing_fy > 0 ? COLOURS.RED : COLOURS.GREEN }}>
                  {payments.missing_fy}
                </span>
              </div>
            </Card>

            {/* ── DOCUMENTS ── */}
            <SectionLabel href={`${ADMIN_OPS}?tab=documents`}>Documents</SectionLabel>
            <div style={grid2}>
              <Card href={`${ADMIN_OPS}?tab=documents`}>
                <CardTitle>NTN certificates</CardTitle>
                <Row label="Registered"    value={documents.ntn_registered} color={COLOURS.GREEN} />
                <Row label="Pending"       value={documents.ntn_pending}    color={documents.ntn_pending > 0 ? COLOURS.AMBER : COLOURS.GREEN} />
                <div style={lastRow}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>No Folderit link</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: documents.ntn_no_link > 0 ? COLOURS.RED : COLOURS.GREEN }}>
                    {documents.ntn_no_link}
                  </span>
                </div>
              </Card>
              <Card href={`${ADMIN_OPS}?tab=documents`}>
                <CardTitle>Restaurant licences</CardTitle>
                <Row label="PFA valid"        value={`${documents.pfa_valid} / ${documents.pfa_total}`}     color={documents.pfa_valid     === documents.pfa_total ? COLOURS.GREEN : COLOURS.AMBER} />
                <Row label="Medical certs"    value={`${documents.medical_valid} / ${documents.pfa_total}`}  color={documents.medical_valid  === documents.pfa_total ? COLOURS.GREEN : COLOURS.AMBER} />
                <Row label="Tourism licences" value={`${documents.tourism_valid} / ${documents.pfa_total}`}  color={documents.tourism_valid  === documents.pfa_total ? COLOURS.GREEN : COLOURS.AMBER} />
                <div style={lastRow}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Expiring in 30 days</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: documents.expiring_30d > 0 ? COLOURS.RED : COLOURS.GREEN }}>
                    {documents.expiring_30d}
                  </span>
                </div>
              </Card>
            </div>

            {/* ── FLEET ── */}
            <SectionLabel href={`${ADMIN_OPS}?tab=operations`}>Fleet — {monthLabel}</SectionLabel>
            <Card href={`${ADMIN_OPS}?tab=operations`} style={{ marginBottom: "8px" }}>
              <div style={twoCol}>
                <div>
                  <Row label="Active vehicles" value={fleet.active_vehicles} />
                  <Row label="Total fills"     value={fleet.fills} />
                  <Row label="Fuel spend"      value={fmtPKR(fleet.fuel_spend)} />
                </div>
                <div>
                  <Row label="Avg km / litre"   value={fleet.avg_kpl > 0 ? `${fleet.avg_kpl}` : "—"} />
                  <Row label="Maintenance jobs" value={fleet.maint_jobs} />
                  <Row label="Maint. spend"     value={fmtPKR(fleet.maint_spend)} />
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, marginTop: "8px", paddingTop: "8px" }}>
                <div style={lastRow}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Vehicles with no entry this month</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: fleet.no_entry > 0 ? COLOURS.AMBER : COLOURS.GREEN }}>
                    {fleet.no_entry}
                  </span>
                </div>
              </div>
            </Card>

            {/* ── SOLAR ── */}
            <SectionLabel href={`${ADMIN_OPS}?tab=operations`}>Solar — {monthLabel}</SectionLabel>
            <Card href={`${ADMIN_OPS}?tab=operations`} style={{ marginBottom: "8px" }}>
              <div style={twoCol}>
                <div>
                  <Row label="Active sites"     value={solar.active_sites} />
                  <Row label="Total generation" value={`${Number(solar.total_kwh).toLocaleString()} kWh`} />
                </div>
                <div>
                  <Row label="Sites missing data" value={solar.missing_data} color={solar.missing_data > 0 ? COLOURS.AMBER : COLOURS.GREEN} />
                  <Row label="Best performer"     value={solar.best_site   || "—"} />
                </div>
              </div>
              {solar.lowest_site && solar.lowest_site !== solar.best_site && (
                <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, marginTop: "8px", paddingTop: "8px" }}>
                  <div style={lastRow}>
                    <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Lowest this month</span>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{solar.lowest_site}</span>
                  </div>
                </div>
              )}
            </Card>

            {/* ── UTILITIES ── */}
            <SectionLabel href={`${ADMIN_OPS}?tab=operations`}>Utilities — {monthLabel}</SectionLabel>
            <Card href={`${ADMIN_OPS}?tab=operations`} style={{ marginBottom: "8px" }}>
              <div style={twoCol}>
                <div>
                  <Row label="Locations tracked" value={utilities.locations_tracked} />
                  <Row label="Total est. bill"   value={fmtPKR(utilities.total_bill)} />
                </div>
                <div>
                  <Row label="Readings missing"  value={utilities.missing_readings}       color={utilities.missing_readings > 0 ? COLOURS.AMBER : COLOURS.GREEN} />
                  <Row label="Highest bill site" value={utilities.highest_bill_site || "—"} />
                </div>
              </div>
            </Card>
          </>
        );
      })()}
    </main>
  );
}
