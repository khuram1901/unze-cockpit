"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS } from "../lib/SharedUI";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

type Plant = { id: string; name: string; type: string; active: boolean };
type MonthlyTarget = {
  id: string; plant_id: string; plant_name: string; target_month: string;
  target_31: number | null; target_36: number | null; target_45: number | null; target_meter: number | null;
  submitted_by: string | null; notes: string | null;
};

const NAVY = COLOURS.NAVY;
const SLATE = COLOURS.SLATE;
const BORDER = COLOURS.BORDER;

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
      const { data: m } = await supabase.from("members").select("role").eq("email", userData.user.email).single();
      if (m) setCanEdit(m.role === "Admin" || m.role === "Executive");
    }
    const { data: pd } = await supabase.from("plants").select("*").eq("active", true).order("name");
    if (pd) setPlants(pd);
    await loadTargets(targetMonth);
    setLoaded(true);
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

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
        <input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)}
          style={{ padding: "5px 8px", border: `1px solid ${BORDER}`, borderRadius: "5px", fontSize: "13px" }} />
        {canEdit && (
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: NAVY, color: "white", border: "none", borderRadius: "5px",
            padding: "5px 12px", fontSize: "13px", fontWeight: 700, cursor: "pointer",
          }}>{showForm ? "Cancel" : "+ Set Target"}</button>
        )}
      </div>

      {message && <div style={{ fontSize: "13px", fontWeight: 600, color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN, marginBottom: "8px" }}>{message}</div>}

      {showForm && canEdit && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "10px", marginBottom: "10px", backgroundColor: "#f8fafc" }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "6px" }}>
              <div><label style={lbl}>Type</label><select style={inp} value={targetType} onChange={(e) => setTargetType(e.target.value as "production" | "dispatch")}><option value="production">Production</option><option value="dispatch">Dispatch</option></select></div>
              <div><label style={lbl}>Plant</label><select style={inp} value={plantId} onChange={(e) => setPlantId(e.target.value)} required><option value="">Select</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              {!isMeter ? (
                <>
                  <div><label style={lbl}>31ft</label><input type="number" min="0" style={inp} value={target31} onChange={(e) => setTarget31(e.target.value)} placeholder="0" /></div>
                  <div><label style={lbl}>36ft</label><input type="number" min="0" style={inp} value={target36} onChange={(e) => setTarget36(e.target.value)} placeholder="0" /></div>
                  <div><label style={lbl}>45ft</label><input type="number" min="0" style={inp} value={target45} onChange={(e) => setTarget45(e.target.value)} placeholder="0" /></div>
                </>
              ) : (
                <div><label style={lbl}>Meters</label><input type="number" min="0" style={inp} value={targetMeter} onChange={(e) => setTargetMeter(e.target.value)} placeholder="0" /></div>
              )}
            </div>
            {existingTarget && <div style={{ fontSize: "12px", color: "#d97706", marginTop: "4px" }}>Existing target found — saving will update it.</div>}
            <button type="submit" disabled={saving} style={{ backgroundColor: NAVY, color: "white", border: "none", borderRadius: "5px", padding: "6px 14px", fontSize: "13px", fontWeight: 700, cursor: "pointer", marginTop: "6px" }}>{saving ? "Saving..." : existingTarget ? "Update" : "Save"}</button>
          </form>
        </div>
      )}

      {chartData.length > 0 && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "10px", backgroundColor: "white", marginBottom: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY, marginBottom: "6px" }}>Target vs Actual — {formatMonthUK(targetMonth)}</div>
          <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 40)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 5, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: SLATE }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: NAVY, fontWeight: 600 }} width={60} />
              <Tooltip formatter={(value) => Number(value).toLocaleString()} />
              <Legend iconType="square" wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="Prod Target" fill="#cbd5e1" name="Prod Target" />
              <Bar dataKey="Prod Actual" fill="#16a34a" name="Prod Actual" />
              <Bar dataKey="Disp Target" fill="#e2e8f0" name="Disp Target" />
              <Bar dataKey="Disp Actual" fill="#059669" name="Disp Actual" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {progressData.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
          {progressData.map((d) => {
            const prodColor = d.prodPct >= 95 ? COLOURS.GREEN : d.prodPct >= 85 ? "#d97706" : COLOURS.RED;
            const dispColor = d.dispPct >= 95 ? COLOURS.GREEN : d.dispPct >= 85 ? "#d97706" : COLOURS.RED;
            return (
              <div key={d.plant.id} style={{ border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "10px", backgroundColor: "white" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY, marginBottom: "6px" }}>{d.plant.name}</div>
                {d.prodTarget > 0 && (
                  <div style={{ marginBottom: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                      <span style={{ color: SLATE }}>Production</span>
                      <span style={{ fontWeight: 700, color: prodColor }}>{d.prodActual.toLocaleString()} / {d.prodTarget.toLocaleString()} ({d.prodPct}%)</span>
                    </div>
                    <div style={{ height: "8px", backgroundColor: "#f1f5f9", borderRadius: "4px" }}>
                      <div style={{ width: `${Math.min(d.prodPct, 100)}%`, height: "100%", backgroundColor: prodColor, borderRadius: "4px" }} />
                    </div>
                  </div>
                )}
                {d.dispTarget > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                      <span style={{ color: SLATE }}>Dispatch</span>
                      <span style={{ fontWeight: 700, color: dispColor }}>{d.dispActual.toLocaleString()} / {d.dispTarget.toLocaleString()} ({d.dispPct}%)</span>
                    </div>
                    <div style={{ height: "8px", backgroundColor: "#f1f5f9", borderRadius: "4px" }}>
                      <div style={{ width: `${Math.min(d.dispPct, 100)}%`, height: "100%", backgroundColor: dispColor, borderRadius: "4px" }} />
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

const inp: React.CSSProperties = { display: "block", width: "100%", padding: "5px 8px", marginTop: "2px", border: `1px solid ${BORDER}`, borderRadius: "5px", fontSize: "13px", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: "11px", fontWeight: 600, color: SLATE };
