"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import { supabase } from "../lib/supabase";

type Plant = {
  id: string;
  name: string;
  type: string;
  active: boolean;
};

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

type Member = {
  role: string;
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatMonth(monthString: string) {
  const [year, month] = monthString.split("-");
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

export default function MonthlyOperationsTargetsPage() {
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

  async function loadTargets(monthToLoad = targetMonth) {
    const [productionRes, dispatchRes] = await Promise.all([
      supabase
        .from("monthly_production_targets")
        .select("*")
        .eq("target_month", monthToLoad)
        .order("plant_name", { ascending: true }),

      supabase
        .from("monthly_dispatch_targets")
        .select("*")
        .eq("target_month", monthToLoad)
        .order("plant_name", { ascending: true }),
    ]);

    setProductionTargets(productionRes.data || []);
    setDispatchTargets(dispatchRes.data || []);
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
      setTarget31("");
      setTarget36("");
      setTarget45("");
      setTargetMeter("");
      setNotes("");
      setMessage("");
      return;
    }

    const existing = getExistingTarget();

    if (existing) {
      setTarget31(String(existing.target_31 || ""));
      setTarget36(String(existing.target_36 || ""));
      setTarget45(String(existing.target_45 || ""));
      setTargetMeter(String(existing.target_meter || ""));
      setNotes(existing.notes || "");
      setMessage("Existing monthly target loaded. Saving will update it.");
    } else {
      setTarget31("");
      setTarget36("");
      setTarget45("");
      setTargetMeter("");
      setNotes("");
      setMessage("");
    }
  }, [plantId, targetType, productionTargets, dispatchTargets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!canEdit) {
      setMessage("Error: You do not have permission to add or update monthly targets.");
      return;
    }

    if (!plantId || !selectedPlant) {
      setMessage("Please select a plant.");
      return;
    }

    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    const submittedBy = userData.user?.email || "unknown";

    const payload = {
      plant_id: plantId,
      plant_name: selectedPlant.name,
      target_month: targetMonth,
      target_31: Number(target31) || 0,
      target_36: Number(target36) || 0,
      target_45: Number(target45) || 0,
      target_meter: Number(targetMeter) || 0,
      submitted_by: submittedBy,
      notes: notes || null,
    };

    const table =
      targetType === "production"
        ? "monthly_production_targets"
        : "monthly_dispatch_targets";

    const { error } = await supabase.from(table).upsert(payload, {
      onConflict: "plant_id,target_month",
    });

    setSaving(false);

    if (error) {
      setMessage("Error: " + error.message);
      return;
    }

    setMessage("✅ Monthly target saved.");
    await loadTargets(targetMonth);
  }

  const existingTarget = getExistingTarget();

  const inputStyle = {
    display: "block",
    width: "100%",
    maxWidth: "420px",
    padding: "10px",
    marginTop: "4px",
    marginBottom: "14px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "15px",
  };

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
          Loading monthly operations targets...
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <RoleGuard allowedRoles={["Admin", "Executive"]}>
          <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "8px" }}>
            Monthly Operations Targets
          </h1>

          <p style={{ color: "#666", marginBottom: "24px" }}>
            Set monthly production and dispatch targets plant-wise. These targets will feed the
            CEO Operations KPI Scorecard.
          </p>

          {!canEdit && (
            <div
              style={{
                border: "1px solid #fecaca",
                backgroundColor: "#fef2f2",
                color: "#991b1b",
                borderRadius: "8px",
                padding: "14px",
                marginBottom: "24px",
                maxWidth: "720px",
              }}
            >
              You can view monthly targets, but you cannot create or update them.
            </div>
          )}

          <section
            style={{
              border: "1px solid #e0e0e0",
              borderRadius: "10px",
              padding: "20px",
              maxWidth: "540px",
              marginBottom: "32px",
            }}
          >
            <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "14px" }}>
              Add / Update Monthly Target
            </h2>

            <form onSubmit={handleSubmit}>
              <label>
                Target month
                <input
                  type="month"
                  style={inputStyle}
                  value={targetMonth}
                  onChange={(e) => setTargetMonth(e.target.value)}
                  required
                />
              </label>

              <div style={{ marginBottom: "16px", color: "#555", fontSize: "14px" }}>
                Selected month: <strong>{formatMonth(targetMonth)}</strong>
              </div>

              <label>
                Target type
                <select
                  style={inputStyle}
                  value={targetType}
                  onChange={(e) =>
                    setTargetType(e.target.value as "production" | "dispatch")
                  }
                  required
                >
                  <option value="production">Production</option>
                  <option value="dispatch">Dispatch</option>
                </select>
              </label>

              <label>
                Plant
                <select
                  style={inputStyle}
                  value={plantId}
                  onChange={(e) => setPlantId(e.target.value)}
                  required
                >
                  <option value="">-- Select plant --</option>
                  {plants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              {existingTarget && (
                <div
                  style={{
                    border: "1px solid #fed7aa",
                    backgroundColor: "#fff7ed",
                    color: "#9a3412",
                    borderRadius: "8px",
                    padding: "10px",
                    fontSize: "14px",
                    marginBottom: "16px",
                  }}
                >
                  Existing {targetType} target found for this plant/month. Saving will update it.
                </div>
              )}

              {!isMeter ? (
                <>
                  <label>
                    31 ft monthly target
                    <input
                      type="number"
                      min="0"
                      style={inputStyle}
                      value={target31}
                      onChange={(e) => setTarget31(e.target.value)}
                      placeholder="0"
                    />
                  </label>

                  <label>
                    36 ft monthly target
                    <input
                      type="number"
                      min="0"
                      style={inputStyle}
                      value={target36}
                      onChange={(e) => setTarget36(e.target.value)}
                      placeholder="0"
                    />
                  </label>

                  <label>
                    45 ft monthly target
                    <input
                      type="number"
                      min="0"
                      style={inputStyle}
                      value={target45}
                      onChange={(e) => setTarget45(e.target.value)}
                      placeholder="0"
                    />
                  </label>
                </>
              ) : (
                <label>
                  Meters monthly target
                  <input
                    type="number"
                    min="0"
                    style={inputStyle}
                    value={targetMeter}
                    onChange={(e) => setTargetMeter(e.target.value)}
                    placeholder="0"
                  />
                </label>
              )}

              <label>
                Notes
                <textarea
                  style={{ ...inputStyle, height: "80px" }}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any assumptions, shutdowns, holidays, or special factors..."
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                style={{
                  backgroundColor: "#0070f3",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "12px 24px",
                  fontSize: "15px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                {saving
                  ? "Saving..."
                  : existingTarget
                  ? "Update Monthly Target"
                  : "Submit Monthly Target"}
              </button>

              {message && (
                <p
                  style={{
                    marginTop: "16px",
                    fontSize: "14px",
                    color: message.startsWith("Error") ? "red" : "green",
                  }}
                >
                  {message}
                </p>
              )}
            </form>
          </section>

          <section style={{ marginBottom: "36px" }}>
            <h2 style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "14px" }}>
              Production Targets — {formatMonth(targetMonth)}
            </h2>

            <TargetsTable targets={productionTargets} />
          </section>

          <section>
            <h2 style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "14px" }}>
              Dispatch Targets — {formatMonth(targetMonth)}
            </h2>

            <TargetsTable targets={dispatchTargets} />
          </section>
        </RoleGuard>
      </main>
    </AuthWrapper>
  );
}

function TargetsTable({ targets }: { targets: MonthlyTarget[] }) {
  if (targets.length === 0) {
    return <p style={{ color: "#666" }}>No targets set for this month yet.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "760px" }}>
        <thead>
          <tr style={{ backgroundColor: "#fafafa" }}>
            <th style={tableHeaderStyle}>Plant</th>
            <th style={tableHeaderStyle}>31 ft</th>
            <th style={tableHeaderStyle}>36 ft</th>
            <th style={tableHeaderStyle}>45 ft</th>
            <th style={tableHeaderStyle}>Meters</th>
            <th style={tableHeaderStyle}>Total</th>
            <th style={tableHeaderStyle}>Submitted By</th>
          </tr>
        </thead>

        <tbody>
          {targets.map((t) => (
            <tr key={t.id}>
              <td style={tableCellStyle}>
                <strong>{t.plant_name}</strong>
              </td>
              <td style={tableCellStyle}>{t.target_31 || 0}</td>
              <td style={tableCellStyle}>{t.target_36 || 0}</td>
              <td style={tableCellStyle}>{t.target_45 || 0}</td>
              <td style={tableCellStyle}>{t.target_meter || 0}</td>
              <td style={tableCellStyle}>
                <strong>{targetTotal(t)}</strong>
              </td>
              <td style={tableCellStyle}>{t.submitted_by || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tableHeaderStyle = {
  textAlign: "left" as const,
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
};

const tableCellStyle = {
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
};