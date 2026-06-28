"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, PageHeader, SectionTitle, CountCard, WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR } from "../lib/SharedUI";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { useRequireCapability } from "../lib/useRouteGuard";
import { canEditOperationsTargets, type UserCtx, type PermOverrides } from "../lib/permissions";

type Plant = { id: string; name: string; type: string; active: boolean };
type MonthlyTarget = {
  id: string;
  plant_id: string;
  plant_name: string;
  target_month: string;
  target_31: number | null;
  target_36: number | null;
  target_45: number | null;
  target_meter: number | null;
  submitted_by: string | null;
  notes: string | null;
  created_at: string;
};
type Member = { role: string };

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function formatMonthUK(m: string) { const [y, mo] = m.split("-"); return `${mo}/${y}`; }
function targetTotal(t: MonthlyTarget) { return (t.target_31 || 0) + (t.target_36 || 0) + (t.target_45 || 0) + (t.target_meter || 0); }

function getMonthStart(m: string) { return `${m}-01`; }
function getMonthEnd(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo, 0).toISOString().slice(0, 10);
}

export default function MonthlyOperationsTargetsPage() {
  const isMobile = useMobile();
  const { checking } = useRequireCapability("operations");
  const [member, setMember] = useState<Member | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [productionTargets, setProductionTargets] = useState<MonthlyTarget[]>([]);
  const [dispatchTargets, setDispatchTargets] = useState<MonthlyTarget[]>([]);
  const [targetMonth, setTargetMonth] = useState(currentMonth());
  const [showForm, setShowForm] = useState(false);

  const [plantId, setPlantId] = useState("");
  const [targetType, setTargetType] = useState<"production" | "dispatch">("production");
  const [target31, setTarget31] = useState("");
  const [target36, setTarget36] = useState("");
  const [target45, setTarget45] = useState("");
  const [targetMeter, setTargetMeter] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [bannerOpen, setBannerOpen] = useState(false);

  // Actual production/dispatch data
  const [prodActuals, setProdActuals] = useState<Record<string, number>>({});
  const [dispActuals, setDispActuals] = useState<Record<string, number>>({});

  const selectedPlant = plants.find((p) => p.id === plantId);
  const isMeter = selectedPlant?.type === "meter";
  const [canEdit, setCanEdit] = useState(false);

  async function loadInitialData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (email) {
      const { data: memberData } = await supabase.from("members").select("id, role, department, company").eq("email", email).single();
      if (memberData) {
        setMember(memberData);
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email, role: memberData.role, department: memberData.department, company: memberData.company, overrides };
        setCanEdit(canEditOperationsTargets(ctx));
      }
    }
    const { data: plantsData } = await supabase.from("plants").select("*").eq("active", true).order("name");
    if (plantsData) setPlants(plantsData);
    await loadTargets(targetMonth);
    setLoading(false);
  }

  async function loadTargets(month = targetMonth) {
    const mStart = getMonthStart(month);
    const mEnd = getMonthEnd(month);

    const [prodRes, dispRes, prodEntries, dispEntries] = await Promise.all([
      supabase.from("monthly_production_targets").select("*").eq("target_month", month).order("plant_name"),
      supabase.from("monthly_dispatch_targets").select("*").eq("target_month", month).order("plant_name"),
      supabase.from("production_entries").select("plant_id, qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", mEnd),
      supabase.from("dispatch_entries").select("plant_id, qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", mEnd),
    ]);
    setProductionTargets(prodRes.data || []);
    setDispatchTargets(dispRes.data || []);

    const pa: Record<string, number> = {};
    for (const r of (prodEntries.data || [])) {
      pa[r.plant_id] = (pa[r.plant_id] || 0) + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    }
    setProdActuals(pa);

    const da: Record<string, number> = {};
    for (const r of (dispEntries.data || [])) {
      da[r.plant_id] = (da[r.plant_id] || 0) + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    }
    setDispActuals(da);
  }

  useEffect(() => { loadInitialData(); }, []);
  useEffect(() => { loadTargets(targetMonth); }, [targetMonth]);

  function getExistingTarget() {
    const list = targetType === "production" ? productionTargets : dispatchTargets;
    return list.find((t) => t.plant_id === plantId);
  }

  useEffect(() => {
    if (!plantId) { setTarget31(""); setTarget36(""); setTarget45(""); setTargetMeter(""); setNotes(""); return; }
    const existing = getExistingTarget();
    if (existing) {
      setTarget31(String(existing.target_31 || "")); setTarget36(String(existing.target_36 || ""));
      setTarget45(String(existing.target_45 || "")); setTargetMeter(String(existing.target_meter || ""));
      setNotes(existing.notes || "");
    } else {
      setTarget31(""); setTarget36(""); setTarget45(""); setTargetMeter(""); setNotes("");
    }
  }, [plantId, targetType, productionTargets, dispatchTargets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    if (!canEdit) return;
    if (!plantId || !selectedPlant) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const table = targetType === "production" ? "monthly_production_targets" : "monthly_dispatch_targets";
    const { error } = await supabase.from(table).upsert({
      plant_id: plantId, plant_name: selectedPlant.name, target_month: targetMonth,
      target_31: Number(target31) || 0, target_36: Number(target36) || 0,
      target_45: Number(target45) || 0, target_meter: Number(targetMeter) || 0,
      submitted_by: userData.user?.email || "unknown", notes: notes || null,
    }, { onConflict: "plant_id,target_month" });
    setSaving(false);
    if (error) { setMessage("Error: " + error.message); return; }
    logAction("Created", `monthly_${targetType}_targets`, `${targetType} target for ${targetMonth}: ${selectedPlant.name}`);
    setMessage("Target saved.");
    await loadTargets(targetMonth);
  }

  const existingTarget = getExistingTarget();

  // Build progress data per plant
  const progressData = plants.map((p) => {
    const prodTarget = targetTotal(productionTargets.find((t) => t.plant_id === p.id) || { target_31: 0, target_36: 0, target_45: 0, target_meter: 0 } as MonthlyTarget);
    const dispTarget = targetTotal(dispatchTargets.find((t) => t.plant_id === p.id) || { target_31: 0, target_36: 0, target_45: 0, target_meter: 0 } as MonthlyTarget);
    const prodActual = prodActuals[p.id] || 0;
    const dispActual = dispActuals[p.id] || 0;
    const prodPct = prodTarget > 0 ? Math.round((prodActual / prodTarget) * 100) : 0;
    const dispPct = dispTarget > 0 ? Math.round((dispActual / dispTarget) * 100) : 0;
    return { plant: p, prodTarget, dispTarget, prodActual, dispActual, prodPct, dispPct };
  }).filter((d) => d.prodTarget > 0 || d.dispTarget > 0);

  const behindPlants = progressData.filter((d) => (d.prodPct < 85 && d.prodTarget > 0) || (d.dispPct < 85 && d.dispTarget > 0));

  // Chart data
  const chartData = progressData.map((d) => ({
    name: d.plant.name.replace(" Plant", ""),
    "Prod Target": d.prodTarget,
    "Prod Actual": d.prodActual,
    "Disp Target": d.dispTarget,
    "Disp Actual": d.dispActual,
  }));

  if (checking || loading) {
    return <AuthWrapper><main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}><p style={{ color: "var(--text-secondary, #64748b)" }}>Checking permissions…</p></main></AuthWrapper>;
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
            <PageHeader />
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)}
                style={{ padding: "6px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", fontSize: "16px" }} />
              {canEdit && (
                <button onClick={() => setShowForm(!showForm)} style={{
                  backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
                  width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                }} title="Set target">{showForm ? "×" : "+"}</button>
              )}
            </div>
          </div>

          {message && (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "var(--bg-card, #ffffff)", fontSize: "15px", color: "var(--text-primary, #1e293b)" }}>{message}</div>
          )}

          {/* Collapsible form */}
          {showForm && canEdit && (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "10px" }}>Set Target — {formatMonthUK(targetMonth)}</div>
              <form onSubmit={handleSubmit}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
                  <label style={lbl}>Type <select style={inp} value={targetType} onChange={(e) => setTargetType(e.target.value as "production" | "dispatch")}><option value="production">Production</option><option value="dispatch">Dispatch</option></select></label>
                  <label style={lbl}>Plant <select style={inp} value={plantId} onChange={(e) => setPlantId(e.target.value)} required><option value="">Select</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  {!isMeter ? (
                    <>
                      <label style={lbl}>31ft <input type="number" min="0" style={inp} value={target31} onChange={(e) => setTarget31(e.target.value)} placeholder="0" /></label>
                      <label style={lbl}>36ft <input type="number" min="0" style={inp} value={target36} onChange={(e) => setTarget36(e.target.value)} placeholder="0" /></label>
                      <label style={lbl}>45ft <input type="number" min="0" style={inp} value={target45} onChange={(e) => setTarget45(e.target.value)} placeholder="0" /></label>
                    </>
                  ) : (
                    <label style={lbl}>Meters <input type="number" min="0" style={inp} value={targetMeter} onChange={(e) => setTargetMeter(e.target.value)} placeholder="0" /></label>
                  )}
                  <label style={lbl}>Notes <textarea style={{ ...inp, height: "50px" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Assumptions, shutdowns…" /></label>
                </div>
                {existingTarget && <div style={{ fontSize: "15px", color: "#d97706", marginTop: "4px" }}>Existing target found — saving will update it.</div>}
                <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving…" : existingTarget ? "Update Target" : "Save Target"}</button>
              </form>
            </div>
          )}

          {/* Alert banner for plants below 85% */}
          {behindPlants.length > 0 && (
            <div style={WARNING_BANNER_STYLE}>
              <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "20px" }}>⚠</span>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{behindPlants.length} plant{behindPlants.length > 1 ? "s" : ""} below 85% achievement</div>
                    <div style={{ fontSize: "13px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>{behindPlants.map((d) => d.plant.name.replace(" Plant", "")).join(" · ")}</div>
                  </div>
                </div>
                <span style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
              </div>
              {bannerOpen && (
                <div style={WARNING_BANNER_INNER}>
                  {behindPlants.map((d) => (
                    <div key={d.plant.id} style={{ padding: "8px 16px 8px 48px", borderBottom: "1px solid var(--border-light, #f1f5f9)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{d.plant.name}</span>
                      <div style={{ display: "flex", gap: "12px", fontSize: "13px" }}>
                        {d.prodTarget > 0 && <span style={{ color: d.prodPct < 85 ? COLOURS.RED : COLOURS.GREEN, fontWeight: 700 }}>Prod: {d.prodPct}%</span>}
                        {d.dispTarget > 0 && <span style={{ color: d.dispPct < 85 ? COLOURS.RED : COLOURS.GREEN, fontWeight: 700 }}>Disp: {d.dispPct}%</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Achievement chart */}
          {chartData.length > 0 && (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "8px" }}>Target vs Actual — {formatMonthUK(targetMonth)}</div>
              <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 50)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 5, right: 10, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: COLOURS.SLATE }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: COLOURS.NAVY, fontWeight: 600 }} width={70} />
                  <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="Prod Target" fill="#cbd5e1" name="Prod Target (grey)" />
                  <Bar dataKey="Prod Actual" fill="#16a34a" name="Prod Actual (green)" />
                  <Bar dataKey="Disp Target" fill="#e2e8f0" name="Disp Target (light)" />
                  <Bar dataKey="Disp Actual" fill="#059669" name="Disp Actual (teal)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Progress bars per plant */}
          <SectionTitle title="Achievement by Plant" />
          {progressData.length === 0 ? (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)" }}>No targets set for {formatMonthUK(targetMonth)}.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
              {progressData.map((d) => {
                const prodColor = d.prodPct >= 95 ? COLOURS.GREEN : d.prodPct >= 85 ? "#d97706" : COLOURS.RED;
                const dispColor = d.dispPct >= 95 ? COLOURS.GREEN : d.dispPct >= 85 ? "#d97706" : COLOURS.RED;
                return (
                  <div key={d.plant.id} style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "12px", backgroundColor: "var(--bg-card, #ffffff)" }}>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "8px" }}>{d.plant.name}</div>
                    {d.prodTarget > 0 && (
                      <div style={{ marginBottom: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "3px" }}>
                          <span style={{ color: "var(--text-secondary, #64748b)" }}>Production</span>
                          <span style={{ fontWeight: 700, color: prodColor }}>{d.prodActual.toLocaleString()} / {d.prodTarget.toLocaleString()} ({d.prodPct}%)</span>
                        </div>
                        <div style={{ height: "10px", backgroundColor: "var(--border-light, #f1f5f9)", borderRadius: "5px" }}>
                          <div style={{ width: `${Math.min(d.prodPct, 100)}%`, height: "100%", backgroundColor: prodColor, borderRadius: "5px", transition: "width 0.3s" }} />
                        </div>
                      </div>
                    )}
                    {d.dispTarget > 0 && (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "3px" }}>
                          <span style={{ color: "var(--text-secondary, #64748b)" }}>Dispatch</span>
                          <span style={{ fontWeight: 700, color: dispColor }}>{d.dispActual.toLocaleString()} / {d.dispTarget.toLocaleString()} ({d.dispPct}%)</span>
                        </div>
                        <div style={{ height: "10px", backgroundColor: "var(--border-light, #f1f5f9)", borderRadius: "5px" }}>
                          <div style={{ width: `${Math.min(d.dispPct, 100)}%`, height: "100%", backgroundColor: dispColor, borderRadius: "5px", transition: "width 0.3s" }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Raw targets tables */}
          <SectionTitle title={`Production Targets — ${formatMonthUK(targetMonth)}`} />
          <TargetsTable targets={productionTargets} actuals={prodActuals} mobile={isMobile} />

          <SectionTitle title={`Dispatch Targets — ${formatMonthUK(targetMonth)}`} />
          <TargetsTable targets={dispatchTargets} actuals={dispActuals} mobile={isMobile} />
      </main>
    </AuthWrapper>
  );
}

function TargetsTable({ targets, actuals, mobile }: { targets: MonthlyTarget[]; actuals: Record<string, number>; mobile: boolean }) {
  if (targets.length === 0) return <p style={{ color: "var(--text-secondary, #64748b)", fontSize: "15px", marginBottom: "8px" }}>No targets set.</p>;

  return (
    <div style={{ overflowX: "auto", marginBottom: "14px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
            {["Plant", "31ft", "36ft", "45ft", "Meters", "Target", "Actual", "%"].map((h) => (
              <th key={h} style={{ textAlign: "left", borderBottom: "1px solid var(--border-color, #e2e8f0)", padding: "6px 10px", fontSize: "15px", color: "var(--text-secondary, #64748b)", fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const total = targetTotal(t);
            const actual = actuals[t.plant_id] || 0;
            const pct = total > 0 ? Math.round((actual / total) * 100) : 0;
            const pctColor = pct >= 95 ? COLOURS.GREEN : pct >= 85 ? "#d97706" : COLOURS.RED;
            return (
              <tr key={t.id}>
                <td style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{t.plant_name}</td>
                <td style={tdS}>{t.target_31 || 0}</td>
                <td style={tdS}>{t.target_36 || 0}</td>
                <td style={tdS}>{t.target_45 || 0}</td>
                <td style={tdS}>{t.target_meter || 0}</td>
                <td style={{ ...tdS, fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{total.toLocaleString()}</td>
                <td style={{ ...tdS, fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{actual.toLocaleString()}</td>
                <td style={{ ...tdS, fontWeight: 700, color: pctColor }}>{total > 0 ? `${pct}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const tdS: React.CSSProperties = { borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "16px" };
const inp: React.CSSProperties = { display: "block", width: "100%", padding: "7px 10px", marginTop: "3px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", fontSize: "15px", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #1e293b)", marginBottom: "4px" };
