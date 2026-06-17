"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";

type Plant = { id: string; name: string; type: string; active: boolean };
type WeeklyTarget = {
  id: string;
  plant_id: string;
  plant_name: string;
  week_start: string;
  week_end: string;
  target_31: number | null;
  target_36: number | null;
  target_45: number | null;
  target_meter: number | null;
  notes: string | null;
  submitted_by: string | null;
};
type Member = { name: string; role: string };

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

function getMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}
function addDays(dateString: string, days: number) {
  const d = new Date(dateString);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatDateUK(dateString: string) {
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontSize: "13px",
        fontWeight: 700,
        color: NAVY,
        margin: "20px 0 10px",
        paddingLeft: "9px",
        borderLeft: `3px solid ${NAVY}`,
      }}
    >
      {title}
    </h2>
  );
}

export default function WeeklyProductionTargetsPage() {
  const [member, setMember] = useState<Member | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [existingTargets, setExistingTargets] = useState<WeeklyTarget[]>([]);
  const [plantId, setPlantId] = useState("");
  const [weekStart, setWeekStart] = useState(getMonday());
  const [target31, setTarget31] = useState("");
  const [target36, setTarget36] = useState("");
  const [target45, setTarget45] = useState("");
  const [targetMeter, setTargetMeter] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const weekEnd = addDays(weekStart, 6);
  const selectedPlant = plants.find((p) => p.id === plantId);
  const isMeter = selectedPlant?.type === "meter";
  const canEditTargets = member?.role === "Admin";

  async function loadInitialData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (email) {
      const { data: memberData } = await supabase
        .from("members")
        .select("name, role")
        .eq("email", email)
        .single();
      if (memberData) setMember(memberData);
    }
    const { data: plantsData } = await supabase
      .from("plants")
      .select("*")
      .eq("active", true)
      .order("name");
    if (plantsData) setPlants(plantsData);
    await loadExistingTargets(weekStart);
    setLoading(false);
  }

  async function loadExistingTargets(ws = weekStart) {
    const we = addDays(ws, 6);
    const { data } = await supabase
      .from("weekly_production_targets")
      .select("*")
      .eq("week_start", ws)
      .eq("week_end", we)
      .order("plant_name");
    setExistingTargets(data || []);
  }

  useEffect(() => { loadInitialData(); }, []);
  useEffect(() => { loadExistingTargets(weekStart); }, [weekStart]);

  useEffect(() => {
    if (!plantId) { setTarget31(""); setTarget36(""); setTarget45(""); setTargetMeter(""); setNotes(""); return; }
    const existing = existingTargets.find((t) => t.plant_id === plantId);
    if (existing) {
      setTarget31(String(existing.target_31 || ""));
      setTarget36(String(existing.target_36 || ""));
      setTarget45(String(existing.target_45 || ""));
      setTargetMeter(String(existing.target_meter || ""));
      setNotes(existing.notes || "");
      setMessage("Existing target loaded — saving will update it.");
    } else {
      setTarget31(""); setTarget36(""); setTarget45(""); setTargetMeter(""); setNotes(""); setMessage("");
    }
  }, [plantId, existingTargets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEditTargets) { setMessage("Only Admin users can update weekly targets."); return; }
    setSaving(true);
    setMessage("");
    if (!plantId || !selectedPlant) { setSaving(false); setMessage("Please select a plant."); return; }
    const { data: userData } = await supabase.auth.getUser();
    const submittedBy = userData.user?.email || "unknown";
    const { error } = await supabase.from("weekly_production_targets").upsert(
      {
        plant_id: plantId,
        plant_name: selectedPlant.name,
        week_start: weekStart,
        week_end: weekEnd,
        target_31: Number(target31) || 0,
        target_36: Number(target36) || 0,
        target_45: Number(target45) || 0,
        target_meter: Number(targetMeter) || 0,
        submitted_by: submittedBy,
        notes: notes || null,
      },
      { onConflict: "plant_id,week_start" }
    );
    setSaving(false);
    if (error) { setMessage("Error: " + error.message); return; }
    setMessage("✅ Weekly target saved.");
    await loadExistingTargets(weekStart);
  }

  const selectedExisting = existingTargets.find((t) => t.plant_id === plantId);

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "20px 24px" }}>
          <p style={{ color: SLATE, fontSize: "13px" }}>Loading weekly targets…</p>
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: NAVY, margin: 0 }}>
            Weekly Production Targets
          </h1>
          <p style={{ color: SLATE, fontSize: "12px", marginTop: "5px" }}>
            Set weekly production commitments per plant. Admin only.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 420px) 1fr",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* Form */}
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: "8px",
              padding: "16px",
              backgroundColor: "white",
            }}
          >
            <SectionTitle title="Add / Update Weekly Target" />

            {!canEditTargets && (
              <div
                style={{
                  border: `1px solid #fecaca`,
                  backgroundColor: "#fef2f2",
                  color: "#991b1b",
                  borderRadius: "6px",
                  padding: "10px 12px",
                  marginBottom: "12px",
                  fontSize: "12px",
                }}
              >
                You can view weekly targets but cannot create or update them.
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <label style={labelStyle}>
                Plant
                <select style={inputStyle} value={plantId} onChange={(e) => setPlantId(e.target.value)} required>
                  <option value="">— Select plant —</option>
                  {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>

              <label style={labelStyle}>
                Week starting
                <input type="date" style={inputStyle} value={weekStart} onChange={(e) => setWeekStart(e.target.value)} required />
                <span style={{ fontSize: "11px", color: SLATE }}>
                  {formatDateUK(weekStart)} to {formatDateUK(weekEnd)}
                </span>
              </label>

              {selectedExisting && (
                <div style={{ border: `1px solid #fed7aa`, backgroundColor: "#fff7ed", color: "#9a3412", borderRadius: "6px", padding: "8px 10px", marginBottom: "10px", fontSize: "12px" }}>
                  Existing target found — saving will update it.
                </div>
              )}

              {!isMeter ? (
                <>
                  <label style={labelStyle}>31 ft target<input type="number" min="0" style={inputStyle} value={target31} onChange={(e) => setTarget31(e.target.value)} placeholder="0" /></label>
                  <label style={labelStyle}>36 ft target<input type="number" min="0" style={inputStyle} value={target36} onChange={(e) => setTarget36(e.target.value)} placeholder="0" /></label>
                  <label style={labelStyle}>45 ft target<input type="number" min="0" style={inputStyle} value={target45} onChange={(e) => setTarget45(e.target.value)} placeholder="0" /></label>
                </>
              ) : (
                <label style={labelStyle}>Meters target<input type="number" min="0" style={inputStyle} value={targetMeter} onChange={(e) => setTargetMeter(e.target.value)} placeholder="0" /></label>
              )}

              <label style={labelStyle}>
                Notes
                <textarea style={{ ...inputStyle, height: "60px" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Assumptions, shutdowns, holidays…" />
              </label>

              <button type="submit" disabled={saving || !canEditTargets} style={btnStyle}>
                {saving ? "Saving…" : selectedExisting ? "Update Target" : "Save Target"}
              </button>

              {message && (
                <p style={{ marginTop: "10px", fontSize: "13px", fontWeight: 600, color: message.startsWith("Error") || message.startsWith("Only") ? "#dc2626" : "#16a34a" }}>
                  {message}
                </p>
              )}
            </form>
          </div>

          {/* Existing targets table */}
          <div>
            <SectionTitle title={`Targets — ${formatDateUK(weekStart)} to ${formatDateUK(weekEnd)}`} />
            {existingTargets.length === 0 ? (
              <p style={{ color: SLATE, fontSize: "13px" }}>No targets set for this week yet.</p>
            ) : (
              <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "520px" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc" }}>
                      {["Plant", "31 ft", "36 ft", "45 ft", "Meters", "Total"].map((h) => <th key={h} style={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {existingTargets.map((t) => {
                      const total = (t.target_31 || 0) + (t.target_36 || 0) + (t.target_45 || 0) + (t.target_meter || 0);
                      return (
                        <tr key={t.id}>
                          <td style={tdBold}>{t.plant_name}</td>
                          <td style={td}>{t.target_31 || 0}</td>
                          <td style={td}>{t.target_36 || 0}</td>
                          <td style={td}>{t.target_45 || 0}</td>
                          <td style={td}>{t.target_meter || 0}</td>
                          <td style={{ ...td, fontWeight: 700, color: NAVY }}>{total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </AuthWrapper>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 600, color: NAVY, marginBottom: "10px" };
const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: "7px 9px", marginTop: "3px", border: `1px solid ${BORDER}`, borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" };
const btnStyle: React.CSSProperties = { backgroundColor: NAVY, color: "white", border: "none", borderRadius: "6px", padding: "9px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", marginTop: "4px" };
const th: React.CSSProperties = { textAlign: "left", borderBottom: `1px solid ${BORDER}`, padding: "6px 10px", fontSize: "11px", color: SLATE, fontWeight: 700 };
const td: React.CSSProperties = { borderBottom: `1px solid #f1f5f9`, padding: "7px 10px", fontSize: "12px" };
const tdBold: React.CSSProperties = { ...td, fontWeight: 700, color: NAVY };
