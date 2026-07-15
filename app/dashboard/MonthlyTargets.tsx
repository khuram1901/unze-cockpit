"use client";

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, RADII, cardStyle } from "../lib/SharedUI";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { canEditOperationsTargets, type UserCtx, type PermOverrides } from "../lib/permissions";

const { NAVY, SLATE, HAIRLINE, TRACK, GREEN, AMBER, RED, CARD, CARD_ALT, INK_300 } = COLOURS;

type Plant = { id: string; name: string; type: string; active: boolean };
type MonthlyTarget = {
  id: string; plant_id: string; plant_name: string; target_month: string;
  target_31: number | null; target_36: number | null; target_45: number | null; target_meter: number | null;
  submitted_by: string | null; notes: string | null;
};

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function formatMonthUK(m: string) { const [y, mo] = m.split("-"); return `${mo}/${y}`; }
function targetTotal(t: MonthlyTarget | { target_31: number; target_36: number; target_45: number; target_meter: number }) { return (t.target_31 || 0) + (t.target_36 || 0) + (t.target_45 || 0) + (t.target_meter || 0); }
function getMonthStart(m: string) { return `${m}-01`; }
function getMonthEnd(m: string) { const [y, mo] = m.split("-").map(Number); return new Date(y, mo, 0).toISOString().slice(0, 10); }

export default function MonthlyTargets() {
  const isMobile = useMobile();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [productionTargets, setProductionTargets] = useState<MonthlyTarget[]>([]);
  const [dispatchTargets, setDispatchTargets] = useState<MonthlyTarget[]>([]);
  const [targetMonth, setTargetMonth] = useState(currentMonth());
  const [showForm, setShowForm] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const [plantId, setPlantId] = useState("");
  const [targetType, setTargetType] = useState<"production" | "dispatch">("production");
  const [target31, setTarget31] = useState("");
  const [target36, setTarget36] = useState("");
  const [target45, setTarget45] = useState("");
  const [targetMeter, setTargetMeter] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [prodActuals, setProdActuals] = useState<Record<string, number>>({});
  const [dispActuals, setDispActuals] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  const selectedPlant = plants.find((p) => p.id === plantId);
  const isMeter = selectedPlant?.type === "meter";

  async function loadData() {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user?.email) {
      const { data: m } = await supabase.from("members").select("id, role, department, company").eq("email", userData.user.email).single();
      if (m) {
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email: userData.user.email, role: m.role, department: m.department, company: m.company, overrides };
        setCanEdit(canEditOperationsTargets(ctx));
      }
    }
    const { data: pd } = await supabase.from("plants").select("id, name, type, active").eq("active", true).order("name");
    if (pd) setPlants(pd);
    await loadTargets(targetMonth);
    setLoaded(true);
  }

  async function loadTargets(month = targetMonth) {
    const mStart = getMonthStart(month);
    const mEnd = getMonthEnd(month);
    const [prodRes, dispRes, prodEntries, dispEntries] = await Promise.all([
      supabase.from("monthly_production_targets").select("id, plant_id, plant_name, target_month, target_31, target_36, target_45, target_meter, submitted_by, notes").eq("target_month", month).order("plant_name"),
      supabase.from("monthly_dispatch_targets").select("id, plant_id, plant_name, target_month, target_31, target_36, target_45, target_meter, submitted_by, notes").eq("target_month", month).order("plant_name"),
      supabase.from("production_entries").select("plant_id, qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", mEnd),
      supabase.from("dispatch_entries").select("plant_id, qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", mEnd),
    ]);
    setProductionTargets(prodRes.data || []);
    setDispatchTargets(dispRes.data || []);
    const pa: Record<string, number> = {};
    for (const r of (prodEntries.data || [])) pa[r.plant_id] = (pa[r.plant_id] || 0) + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    setProdActuals(pa);
    const da: Record<string, number> = {};
    for (const r of (dispEntries.data || [])) da[r.plant_id] = (da[r.plant_id] || 0) + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    setDispActuals(da);
  }

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (loaded) loadTargets(targetMonth); }, [targetMonth]);

  useEffect(() => {
    if (!plantId) { setTarget31(""); setTarget36(""); setTarget45(""); setTargetMeter(""); setNotes(""); return; }
    const list = targetType === "production" ? productionTargets : dispatchTargets;
    const existing = list.find((t) => t.plant_id === plantId);
    if (existing) { setTarget31(String(existing.target_31 || "")); setTarget36(String(existing.target_36 || "")); setTarget45(String(existing.target_45 || "")); setTargetMeter(String(existing.target_meter || "")); setNotes(existing.notes || ""); }
    else { setTarget31(""); setTarget36(""); setTarget45(""); setTargetMeter(""); setNotes(""); }
  }, [plantId, targetType, productionTargets, dispatchTargets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !plantId || !selectedPlant) return;
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
    setMessage("Target saved."); setTimeout(() => setMessage(""), 3000);
    await loadTargets(targetMonth);
  }

  const existingTarget = (() => { const list = targetType === "production" ? productionTargets : dispatchTargets; return list.find((t) => t.plant_id === plantId); })();

  const progressData = plants.map((p) => {
    const prodTarget = targetTotal(productionTargets.find((t) => t.plant_id === p.id) || { target_31: 0, target_36: 0, target_45: 0, target_meter: 0 });
    const dispTarget = targetTotal(dispatchTargets.find((t) => t.plant_id === p.id) || { target_31: 0, target_36: 0, target_45: 0, target_meter: 0 });
    const prodActual = prodActuals[p.id] || 0; const dispActual = dispActuals[p.id] || 0;
    const prodPct = prodTarget > 0 ? Math.round((prodActual / prodTarget) * 100) : 0;
    const dispPct = dispTarget > 0 ? Math.round((dispActual / dispTarget) * 100) : 0;
    return { plant: p, prodTarget, dispTarget, prodActual, dispActual, prodPct, dispPct };
  }).filter((d) => d.prodTarget > 0 || d.dispTarget > 0);

  const chartData = progressData.map((d) => ({
    name: d.plant.name.replace(" Plant", ""),
    "Prod Target": d.prodTarget, "Prod Actual": d.prodActual,
    "Disp Target": d.dispTarget, "Disp Actual": d.dispActual,
  }));

  if (!loaded) return null;

  const kickerStyle: React.CSSProperties = {
    fontFamily: "var(--font-sans, Inter, sans-serif)",
    fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em",
    textTransform: "uppercase", color: SLATE, marginBottom: "6px",
  };

  return (
    <div>
      {/* Month picker + set target button */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        <input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)}
          style={{ padding: "7px 10px", border: `1px solid ${HAIRLINE}`, borderRadius: RADII.SM, fontSize: "13px", color: NAVY, background: CARD, fontFamily: "var(--font-sans, Inter, sans-serif)" }} />
        {canEdit && (
          <button onClick={() => setShowForm(!showForm)} style={{
            background: NAVY, color: "#fff", border: "none", borderRadius: RADII.PILL,
            padding: "7px 16px", fontSize: "12px", fontWeight: 500, cursor: "pointer",
            fontFamily: "var(--font-sans, Inter, sans-serif)",
          }}>{showForm ? "Cancel" : "+ Set Target"}</button>
        )}
      </div>

      {message && (
        <div style={{
          fontSize: "13px", fontWeight: 600, marginBottom: "12px",
          color: message.startsWith("Error") ? RED : GREEN,
        }}>{message}</div>
      )}

      {showForm && canEdit && (
        <div style={{ ...cardStyle, background: CARD_ALT, padding: "16px 20px", marginBottom: "16px" }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px" }}>
              <div>
                <label style={kickerStyle as React.CSSProperties}>Type</label>
                <select style={inp} value={targetType} onChange={(e) => setTargetType(e.target.value as "production" | "dispatch")}>
                  <option value="production">Production</option>
                  <option value="dispatch">Dispatch</option>
                </select>
              </div>
              <div>
                <label style={kickerStyle as React.CSSProperties}>Plant</label>
                <select style={inp} value={plantId} onChange={(e) => setPlantId(e.target.value)} required>
                  <option value="">Select plant</option>
                  {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {!isMeter ? (
                <>
                  <div><label style={kickerStyle as React.CSSProperties}>31ft</label><input type="number" min="0" style={inp} value={target31} onChange={(e) => setTarget31(e.target.value)} placeholder="0" /></div>
                  <div><label style={kickerStyle as React.CSSProperties}>36ft</label><input type="number" min="0" style={inp} value={target36} onChange={(e) => setTarget36(e.target.value)} placeholder="0" /></div>
                  <div><label style={kickerStyle as React.CSSProperties}>45ft</label><input type="number" min="0" style={inp} value={target45} onChange={(e) => setTarget45(e.target.value)} placeholder="0" /></div>
                </>
              ) : (
                <div><label style={kickerStyle as React.CSSProperties}>Metres</label><input type="number" min="0" style={inp} value={targetMeter} onChange={(e) => setTargetMeter(e.target.value)} placeholder="0" /></div>
              )}
            </div>
            {existingTarget && (
              <div style={{ fontSize: "12px", color: AMBER, marginTop: "8px", fontWeight: 500 }}>
                Existing target found — saving will update it.
              </div>
            )}
            <button type="submit" disabled={saving} style={{
              background: NAVY, color: "#fff", border: "none", borderRadius: RADII.PILL,
              padding: "8px 20px", fontSize: "12px", fontWeight: 500, cursor: "pointer",
              marginTop: "12px", fontFamily: "var(--font-sans, Inter, sans-serif)",
            }}>
              {saving ? "Saving…" : existingTarget ? "Update" : "Save"}
            </button>
          </form>
        </div>
      )}

      {chartData.length > 0 && (
        <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: "16px" }}>
          <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "15px", fontWeight: 600, color: NAVY, marginBottom: "14px" }}>
            Target vs Actual — {formatMonthUK(targetMonth)}
          </div>
          <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 40)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 5, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: SLATE, fontFamily: "var(--font-mono)" }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: NAVY, fontWeight: 500 }} width={60} />
              <Tooltip formatter={(value) => Number(value).toLocaleString()} />
              <Legend iconType="square" wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="Prod Target" fill={INK_300}  name="Prod Target" />
              <Bar dataKey="Prod Actual" fill={GREEN}    name="Prod Actual" />
              <Bar dataKey="Disp Target" fill={HAIRLINE} name="Disp Target" />
              <Bar dataKey="Disp Actual" fill={COLOURS.TEAL} name="Disp Actual" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {progressData.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
          {progressData.map((d) => {
            const prodColor = d.prodPct >= 95 ? GREEN : d.prodPct >= 85 ? AMBER : RED;
            const dispColor = d.dispPct >= 95 ? GREEN : d.dispPct >= 85 ? AMBER : RED;
            return (
              <div key={d.plant.id} style={{ ...cardStyle, padding: "16px 20px" }}>
                <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "14px", fontWeight: 600, color: NAVY, marginBottom: "12px" }}>
                  {d.plant.name}
                </div>
                {d.prodTarget > 0 && (
                  <div style={{ marginBottom: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={kickerStyle as React.CSSProperties}>Production</span>
                      <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", fontWeight: 600, color: prodColor }}>
                        {d.prodActual.toLocaleString()} / {d.prodTarget.toLocaleString()} ({d.prodPct}%)
                      </span>
                    </div>
                    <div style={{ height: "6px", background: TRACK, borderRadius: "999px", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(d.prodPct, 100)}%`, height: "100%", background: prodColor, borderRadius: "999px", transition: "width 0.3s" }} />
                    </div>
                  </div>
                )}
                {d.dispTarget > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={kickerStyle as React.CSSProperties}>Dispatch</span>
                      <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", fontWeight: 600, color: dispColor }}>
                        {d.dispActual.toLocaleString()} / {d.dispTarget.toLocaleString()} ({d.dispPct}%)
                      </span>
                    </div>
                    <div style={{ height: "6px", background: TRACK, borderRadius: "999px", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(d.dispPct, 100)}%`, height: "100%", background: dispColor, borderRadius: "999px", transition: "width 0.3s" }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: "13px", color: SLATE }}>No targets set for {formatMonthUK(targetMonth)}.</div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "4px",
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
  fontSize: "13px", boxSizing: "border-box", background: COLOURS.CARD,
  color: COLOURS.NAVY, fontFamily: "var(--font-sans, Inter, sans-serif)",
};
