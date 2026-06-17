"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";

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

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function formatMonthUK(m: string) {
  const [year, month] = m.split("-");
  return `${month}/${year}`;
}
function targetTotal(t: MonthlyTarget) {
  return (
    (t.target_31 || 0) +
    (t.target_36 || 0) +
    (t.target_45 || 0) +
    (t.target_meter || 0)
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontSize: "15px",
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

export default function MonthlyOperationsTargetsPage() {
  const isMobile = useMobile();
  const [member, setMember] = useState<Member | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [productionTargets, setProductionTargets] = useState<MonthlyTarget[]>([]);
  const [dispatchTargets, setDispatchTargets] = useState<MonthlyTarget[]>([]);
  const [targetMonth, setTargetMonth] = useState(currentMonth());

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

  const selectedPlant = plants.find((p) => p.id === plantId);
  const isMeter = selectedPlant?.type === "meter";
  const canEdit = member?.role === "Admin" || member?.role === "Executive";

  async function loadInitialData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (email) {
      const { data: memberData } = await supabase
        .from("members")
        .select("role")
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
    await loadTargets(targetMonth);
    setLoading(false);
  }

  async function loadTargets(month = targetMonth) {
    const [prodRes, dispRes] = await Promise.all([
      supabase
        .from("monthly_production_targets")
        .select("*")
        .eq("target_month", month)
        .order("plant_name"),
      supabase
        .from("monthly_dispatch_targets")
        .select("*")
        .eq("target_month", month)
        .order("plant_name"),
    ]);
    setProductionTargets(prodRes.data || []);
    setDispatchTargets(dispRes.data || []);
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadTargets(targetMonth);
  }, [targetMonth]);

  function getExistingTarget() {
    const list = targetType === "production" ? productionTargets : dispatchTargets;
    return list.find((t) => t.plant_id === plantId);
  }

  useEffect(() => {
    if (!plantId) {
      setTarget31(""); setTarget36(""); setTarget45(""); setTargetMeter(""); setNotes(""); setMessage("");
      return;
    }
    const existing = getExistingTarget();
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
  }, [plantId, targetType, productionTargets, dispatchTargets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    if (!canEdit) { setMessage("You do not have permission to set monthly targets."); return; }
    if (!plantId || !selectedPlant) { setMessage("Please select a plant."); return; }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const submittedBy = userData.user?.email || "unknown";
    const table = targetType === "production" ? "monthly_production_targets" : "monthly_dispatch_targets";
    const { error } = await supabase.from(table).upsert(
      {
        plant_id: plantId,
        plant_name: selectedPlant.name,
        target_month: targetMonth,
        target_31: Number(target31) || 0,
        target_36: Number(target36) || 0,
        target_45: Number(target45) || 0,
        target_meter: Number(targetMeter) || 0,
        submitted_by: submittedBy,
        notes: notes || null,
      },
      { onConflict: "plant_id,target_month" }
    );
    setSaving(false);
    if (error) { setMessage("Error: " + error.message); return; }
    setMessage("✅ Monthly target saved.");
    await loadTargets(targetMonth);
  }

  const existingTarget = getExistingTarget();

  const mainPadding = isMobile ? "12px 14px" : "20px 24px";

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: mainPadding }}>
          <p style={{ color: SLATE, fontSize: "15px" }}>Loading monthly targets…</p>
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: mainPadding, maxWidth: "100vw", overflowX: "hidden" }}>
        <RoleGuard allowedRoles={["Admin", "Executive"]}>
          <div style={{ marginBottom: "16px" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: NAVY, margin: 0 }}>
              Monthly Operations Targets
            </h1>
            <p style={{ color: SLATE, fontSize: "14px", marginTop: "5px" }}>
              Set monthly production and dispatch targets per plant. These feed the KPI scorecard.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "minmax(280px, 440px) 1fr",
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
              <SectionTitle title="Add / Update Target" />

              {!canEdit && (
                <div
                  style={{
                    border: `1px solid #fecaca`,
                    backgroundColor: "#fef2f2",
                    color: "#991b1b",
                    borderRadius: "6px",
                    padding: "10px 12px",
                    marginBottom: "12px",
                    fontSize: "14px",
                  }}
                >
                  You can view targets but cannot create or update them.
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <label style={labelStyle}>
                  Target month
                  <input
                    type="month"
                    style={inputStyle}
                    value={targetMonth}
                    onChange={(e) => setTargetMonth(e.target.value)}
                    required
                  />
                  <span style={{ fontSize: "13px", color: SLATE }}>
                    {formatMonthUK(targetMonth)}
                  </span>
                </label>

                <label style={labelStyle}>
                  Target type
                  <select
                    style={inputStyle}
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value as "production" | "dispatch")}
                  >
                    <option value="production">Production</option>
                    <option value="dispatch">Dispatch</option>
                  </select>
                </label>

                <label style={labelStyle}>
                  Plant
                  <select
                    style={inputStyle}
                    value={plantId}
                    onChange={(e) => setPlantId(e.target.value)}
                    required
                  >
                    <option value="">— Select plant —</option>
                    {plants.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>

                {existingTarget && (
                  <div
                    style={{
                      border: `1px solid #fed7aa`,
                      backgroundColor: "#fff7ed",
                      color: "#9a3412",
                      borderRadius: "6px",
                      padding: "8px 10px",
                      marginBottom: "10px",
                      fontSize: "14px",
                    }}
                  >
                    Existing {targetType} target found — saving will update it.
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
                  <textarea
                    style={{ ...inputStyle, height: "64px" }}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Assumptions, shutdowns, holidays…"
                  />
                </label>

                <button type="submit" disabled={saving || !canEdit} style={btnStyle}>
                  {saving ? "Saving…" : existingTarget ? "Update Target" : "Save Target"}
                </button>

                {message && (
                  <p
                    style={{
                      marginTop: "10px",
                      fontSize: "15px",
                      fontWeight: 600,
                      color: message.startsWith("Error") ? "#dc2626" : message.startsWith("You") ? "#d97706" : "#16a34a",
                    }}
                  >
                    {message}
                  </p>
                )}
              </form>
            </div>

            {/* Tables */}
            <div>
              <SectionTitle title={`Production Targets — ${formatMonthUK(targetMonth)}`} />
              <TargetsTable targets={productionTargets} mobile={isMobile} />

              <SectionTitle title={`Dispatch Targets — ${formatMonthUK(targetMonth)}`} />
              <TargetsTable targets={dispatchTargets} mobile={isMobile} />
            </div>
          </div>
        </RoleGuard>
      </main>
    </AuthWrapper>
  );
}

function TargetsTable({ targets, mobile }: { targets: MonthlyTarget[]; mobile: boolean }) {
  if (targets.length === 0) {
    return (
      <p style={{ color: SLATE, fontSize: "15px", marginBottom: "8px" }}>
        No targets set for this month yet.
      </p>
    );
  }

  if (mobile) {
    return (
      <div style={{ marginBottom: "8px" }}>
        {targets.map((t) => (
          <div key={t.id} style={{
            border: `1px solid ${BORDER}`,
            borderRadius: "8px",
            padding: "10px 12px",
            backgroundColor: "white",
            marginBottom: "6px",
          }}>
            <div style={{ fontWeight: 700, fontSize: "15px", color: NAVY }}>{t.plant_name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px", marginTop: "6px", fontSize: "13px" }}>
              {(t.target_31 || 0) > 0 && <span>31ft: <strong>{t.target_31}</strong></span>}
              {(t.target_36 || 0) > 0 && <span>36ft: <strong>{t.target_36}</strong></span>}
              {(t.target_45 || 0) > 0 && <span>45ft: <strong>{t.target_45}</strong></span>}
              {(t.target_meter || 0) > 0 && <span>Meters: <strong>{t.target_meter}</strong></span>}
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: NAVY, marginTop: "4px" }}>
              Total: {targetTotal(t).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        overflowX: "auto",
        marginBottom: "8px",
        border: `1px solid ${BORDER}`,
        borderRadius: "8px",
        backgroundColor: "white",
      }}
    >
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
        <thead>
          <tr style={{ backgroundColor: "#f8fafc" }}>
            {["Plant", "31 ft", "36 ft", "45 ft", "Meters", "Total"].map((h) => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => (
            <tr key={t.id}>
              <td style={tdBold}>{t.plant_name}</td>
              <td style={td}>{t.target_31 || 0}</td>
              <td style={td}>{t.target_36 || 0}</td>
              <td style={td}>{t.target_45 || 0}</td>
              <td style={td}>{t.target_meter || 0}</td>
              <td style={{ ...td, fontWeight: 700, color: NAVY }}>{targetTotal(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "14px",
  fontWeight: 600,
  color: NAVY,
  marginBottom: "10px",
};
const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  fontSize: "15px",
  boxSizing: "border-box",
};
const btnStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "9px 18px",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
  marginTop: "4px",
};
const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "6px 10px",
  fontSize: "13px",
  color: SLATE,
  fontWeight: 700,
};
const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "7px 10px",
  fontSize: "14px",
};
const tdBold: React.CSSProperties = { ...td, fontWeight: 700, color: NAVY };
