"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";

type Plant = {
  id: string;
  name: string;
  type: string;
  active: boolean;
};

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
  created_at: string;
};

type Member = {
  name: string;
  role: string;
};

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

  async function loadExistingTargets(currentWeekStart = weekStart) {
    const currentWeekEnd = addDays(currentWeekStart, 6);

    const { data } = await supabase
      .from("weekly_production_targets")
      .select("*")
      .eq("week_start", currentWeekStart)
      .eq("week_end", currentWeekEnd)
      .order("plant_name", { ascending: true });

    if (data) setExistingTargets(data);
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadExistingTargets(weekStart);
  }, [weekStart]);

  useEffect(() => {
    if (!plantId) {
      setTarget31("");
      setTarget36("");
      setTarget45("");
      setTargetMeter("");
      setNotes("");
      return;
    }

    const existing = existingTargets.find((t) => t.plant_id === plantId);

    if (existing) {
      setTarget31(String(existing.target_31 || ""));
      setTarget36(String(existing.target_36 || ""));
      setTarget45(String(existing.target_45 || ""));
      setTargetMeter(String(existing.target_meter || ""));
      setNotes(existing.notes || "");
      setMessage("Existing target loaded. Saving will update this target.");
    } else {
      setTarget31("");
      setTarget36("");
      setTarget45("");
      setTargetMeter("");
      setNotes("");
      setMessage("");
    }
  }, [plantId, existingTargets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!canEditTargets) {
      setMessage("Error: You do not have permission to add or update weekly targets.");
      return;
    }

    setSaving(true);
    setMessage("");

    if (!plantId || !selectedPlant) {
      setSaving(false);
      setMessage("Please select a plant.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const submittedBy = userData.user?.email || "unknown";

    const payload = {
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
    };

    const { error } = await supabase
      .from("weekly_production_targets")
      .upsert(payload, {
        onConflict: "plant_id,week_start",
      });

    setSaving(false);

    if (error) {
      setMessage("Error: " + error.message);
      return;
    }

    setMessage("✅ Weekly production target saved.");
    await loadExistingTargets(weekStart);
  }

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

  const selectedExistingTarget = existingTargets.find((t) => t.plant_id === plantId);

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
          Loading weekly targets...
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "8px" }}>
          Weekly Production Targets
        </h1>

        <p style={{ color: "#666", marginBottom: "24px" }}>
          Set weekly production commitments. Only Admin users can create or update targets.
        </p>

        {!canEditTargets && (
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
            You can view weekly targets, but you cannot create or update them.
          </div>
        )}

        {canEditTargets && (
          <form
            onSubmit={handleSubmit}
            style={{
              border: "1px solid #e0e0e0",
              borderRadius: "10px",
              padding: "20px",
              maxWidth: "520px",
              marginBottom: "32px",
            }}
          >
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

            <label>
              Week start
              <input
                type="date"
                style={inputStyle}
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                required
              />
            </label>

            <div style={{ marginBottom: "16px", color: "#555", fontSize: "14px" }}>
              Week period:{" "}
              <strong>{formatDateUK(weekStart)}</strong> to{" "}
              <strong>{formatDateUK(weekEnd)}</strong>
            </div>

            {selectedExistingTarget && (
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
                Existing target found for this plant/week. Saving will update it.
              </div>
            )}

            {!isMeter ? (
              <>
                <label>
                  31 ft weekly target
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
                  36 ft weekly target
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
                  45 ft weekly target
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
                Meters weekly target
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
                placeholder="Any assumptions, shutdowns, holidays, special orders..."
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
              {saving ? "Saving..." : selectedExistingTarget ? "Update Weekly Target" : "Submit Weekly Target"}
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
        )}

        <h2 style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "14px" }}>
          Existing Targets for Selected Week
        </h2>

        <div style={{ marginBottom: "16px", color: "#555", fontSize: "14px" }}>
          Showing week: <strong>{formatDateUK(weekStart)}</strong> to{" "}
          <strong>{formatDateUK(weekEnd)}</strong>
        </div>

        {existingTargets.length === 0 ? (
          <p style={{ color: "#666" }}>No targets set for this week yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "700px" }}>
              <thead>
                <tr style={{ backgroundColor: "#fafafa" }}>
                  <th style={tableHeaderStyle}>Plant</th>
                  <th style={tableHeaderStyle}>Week</th>
                  <th style={tableHeaderStyle}>31 ft</th>
                  <th style={tableHeaderStyle}>36 ft</th>
                  <th style={tableHeaderStyle}>45 ft</th>
                  <th style={tableHeaderStyle}>Meters</th>
                  <th style={tableHeaderStyle}>Total</th>
                </tr>
              </thead>

              <tbody>
                {existingTargets.map((t) => {
                  const total =
                    (t.target_31 || 0) +
                    (t.target_36 || 0) +
                    (t.target_45 || 0) +
                    (t.target_meter || 0);

                  return (
                    <tr key={t.id}>
                      <td style={tableCellStyle}>
                        <strong>{t.plant_name}</strong>
                      </td>
                      <td style={tableCellStyle}>
                        {formatDateUK(t.week_start)} to {formatDateUK(t.week_end)}
                      </td>
                      <td style={tableCellStyle}>{t.target_31 || 0}</td>
                      <td style={tableCellStyle}>{t.target_36 || 0}</td>
                      <td style={tableCellStyle}>{t.target_45 || 0}</td>
                      <td style={tableCellStyle}>{t.target_meter || 0}</td>
                      <td style={tableCellStyle}>
                        <strong>{total}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AuthWrapper>
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