"use client";

import { useState, useEffect } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { logAction } from "../lib/audit-log";
import { COLOURS, SectionTitle } from "../lib/SharedUI";
import { canEditFinance, type UserCtx, type PermOverrides } from "../lib/permissions";

type Plant = { id: string; name: string; type: string };

const { NAVY, SLATE, BORDER } = COLOURS;

export default function OpeningBalancesForm() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState("");
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));

  const [g31, setG31] = useState("");
  const [g36, setG36] = useState("");
  const [g45, setG45] = useState("");
  const [b31, setB31] = useState("");
  const [b36, setB36] = useState("");
  const [b45, setB45] = useState("");

  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data: me } = await supabase
          .from("members")
          .select("id, role, department, company")
          .eq("email", userData.user.email)
          .single();
        if (me) {
          let overrides: PermOverrides | null = null;
          const p = await loadMyPermissions();
          if (p) overrides = p as PermOverrides;
          const ctx: UserCtx = { email: userData.user.email, role: me.role, department: me.department, company: me.company, overrides };
          setCanEdit(canEditFinance(ctx));
        }
      }
      const { data } = await supabase
        .from("plants")
        .select("id, name, type")
        .eq("active", true)
        .order("name");
      if (data) setPlants(data);
    }
    load();
  }, []);

  const selectedPlant = plants.find((p) => p.id === plantId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const setBy = userData.user?.email || "unknown";

    const { error: e1 } = await supabase.from("opening_balances").insert({
      plant_id: plantId,
      plant_name: selectedPlant?.name || "",
      bal_31: Number(g31) || 0,
      bal_36: Number(g36) || 0,
      bal_45: Number(g45) || 0,
      as_of_date: asOfDate,
      set_by: setBy,
    });

    const { error: e2 } = await supabase.from("broken_opening_balances").insert({
      plant_id: plantId,
      plant_name: selectedPlant?.name || "",
      bal_31: Number(b31) || 0,
      bal_36: Number(b36) || 0,
      bal_45: Number(b45) || 0,
      as_of_date: asOfDate,
      set_by: setBy,
    });

    setSaving(false);

    if (e1 || e2) {
      setMessage("Error: " + (e1?.message || e2?.message));
      return;
    }

    logAction("Created", "opening_balances", `Opening balances for ${selectedPlant?.name}`);
    setMessage("✅ Opening balances saved for " + selectedPlant?.name);
    setG31(""); setG36(""); setG45("");
    setB31(""); setB36(""); setB45("");
  }

  if (!canEdit) {
    return (
      <p style={{ color: "#dc2626", fontSize: "17px" }}>
        You don&apos;t have permission to set opening balances.
      </p>
    );
  }

  const asOfDateUK = asOfDate
    ? asOfDate.split("-").reverse().join("/")
    : "";

  return (
    <div style={{ maxWidth: "480px" }}>
      <form onSubmit={handleSubmit}>
        {/* Plant + date */}
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: "8px",
            padding: "16px",
            backgroundColor: "var(--bg-card, #ffffff)",
            marginBottom: "12px",
          }}
        >
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

          <label style={labelStyle}>
            As of date
            <input
              type="date"
              style={inputStyle}
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              required
            />
            {asOfDate && (
              <span style={{ fontSize: "15px", color: SLATE }}>{asOfDateUK}</span>
            )}
          </label>
        </div>

        {plantId && (
          <>
            {/* Good stock */}
            <div
              style={{
                border: `1px solid ${BORDER}`,
                borderTop: `3px solid #16a34a`,
                borderRadius: "8px",
                padding: "16px",
                backgroundColor: "var(--bg-card, #ffffff)",
                marginBottom: "12px",
              }}
            >
              <SectionTitle title="Good pole opening stock" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "10px" }}>
                <label style={labelStyle}>
                  31 ft
                  <input type="number" min="0" style={inputStyle} value={g31} onChange={(e) => setG31(e.target.value)} placeholder="0" />
                </label>
                <label style={labelStyle}>
                  36 ft
                  <input type="number" min="0" style={inputStyle} value={g36} onChange={(e) => setG36(e.target.value)} placeholder="0" />
                </label>
                <label style={labelStyle}>
                  45 ft
                  <input type="number" min="0" style={inputStyle} value={g45} onChange={(e) => setG45(e.target.value)} placeholder="0" />
                </label>
              </div>
            </div>

            {/* Broken stock */}
            <div
              style={{
                border: `1px solid ${BORDER}`,
                borderTop: `3px solid #d97706`,
                borderRadius: "8px",
                padding: "16px",
                backgroundColor: "var(--bg-card, #ffffff)",
                marginBottom: "16px",
              }}
            >
              <SectionTitle title="Broken pole opening stock" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "10px" }}>
                <label style={labelStyle}>
                  31 ft
                  <input type="number" min="0" style={inputStyle} value={b31} onChange={(e) => setB31(e.target.value)} placeholder="0" />
                </label>
                <label style={labelStyle}>
                  36 ft
                  <input type="number" min="0" style={inputStyle} value={b36} onChange={(e) => setB36(e.target.value)} placeholder="0" />
                </label>
                <label style={labelStyle}>
                  45 ft
                  <input type="number" min="0" style={inputStyle} value={b45} onChange={(e) => setB45(e.target.value)} placeholder="0" />
                </label>
              </div>
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={saving || !plantId}
          style={{
            backgroundColor: NAVY,
            color: "white",
            border: "none",
            borderRadius: "6px",
            padding: "9px 20px",
            fontSize: "17px",
            fontWeight: 700,
            cursor: saving || !plantId ? "not-allowed" : "pointer",
            opacity: !plantId ? 0.5 : 1,
          }}
        >
          {saving ? "Saving…" : "Save Opening Balances"}
        </button>

        {message && (
          <p
            style={{
              marginTop: "12px",
              fontSize: "17px",
              fontWeight: 600,
              color: message.startsWith("Error") ? "#dc2626" : "#16a34a",
            }}
          >
            {message}
          </p>
        )}
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "16px",
  fontWeight: 600,
  color: NAVY,
  marginBottom: "0",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  fontSize: "17px",
  boxSizing: "border-box",
};
