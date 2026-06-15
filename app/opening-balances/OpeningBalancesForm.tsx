"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

type Plant = { id: string; name: string; type: string };

export default function OpeningBalancesForm() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState("");
  const [asOfDate, setAsOfDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  // Good pole opening
  const [g31, setG31] = useState("");
  const [g36, setG36] = useState("");
  const [g45, setG45] = useState("");
  // Broken pole opening
  const [b31, setB31] = useState("");
  const [b36, setB36] = useState("");
  const [b45, setB45] = useState("");

  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data: me } = await supabase
          .from("members")
          .select("role")
          .eq("email", userData.user.email)
          .single();
        setIsAdmin(me?.role === "Admin");
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

    // Good pole opening balance
    const { error: e1 } = await supabase.from("opening_balances").insert({
      plant_id: plantId,
      plant_name: selectedPlant?.name || "",
      bal_31: Number(g31) || 0,
      bal_36: Number(g36) || 0,
      bal_45: Number(g45) || 0,
      as_of_date: asOfDate,
      set_by: setBy,
    });

    // Broken pole opening balance
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

    setMessage("✅ Opening balances saved for " + selectedPlant?.name);
    setG31(""); setG36(""); setG45("");
    setB31(""); setB36(""); setB45("");
  }

  const inputStyle = {
    display: "block", width: "100%", maxWidth: "300px", padding: "10px",
    marginTop: "4px", marginBottom: "14px", border: "1px solid #ccc",
    borderRadius: "6px", fontSize: "15px",
  };
  const sectionStyle = {
    border: "1px solid #e0e0e0", borderRadius: "8px",
    padding: "20px", marginBottom: "20px",
  };
  const h3 = { fontSize: "16px", fontWeight: "bold" as const, marginBottom: "12px" };

  if (!isAdmin) {
    return (
      <p style={{ color: "#c0392b" }}>
        Only Admins can set opening balances.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: "360px" }}>
      <div style={sectionStyle}>
        <label>Plant
          <select style={inputStyle} value={plantId}
            onChange={(e) => setPlantId(e.target.value)} required>
            <option value="">-- Select plant --</option>
            {plants.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>As of date
          <input type="date" style={inputStyle} value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)} required />
        </label>
      </div>

      {plantId && (
        <>
          <div style={sectionStyle}>
            <h3 style={h3}>Good pole opening stock</h3>
            <label>31 ft<input type="number" min="0" style={inputStyle} value={g31} onChange={(e) => setG31(e.target.value)} placeholder="0" /></label>
            <label>36 ft<input type="number" min="0" style={inputStyle} value={g36} onChange={(e) => setG36(e.target.value)} placeholder="0" /></label>
            <label>45 ft<input type="number" min="0" style={inputStyle} value={g45} onChange={(e) => setG45(e.target.value)} placeholder="0" /></label>
          </div>

          <div style={sectionStyle}>
            <h3 style={h3}>Broken pole opening stock</h3>
            <label>31 ft<input type="number" min="0" style={inputStyle} value={b31} onChange={(e) => setB31(e.target.value)} placeholder="0" /></label>
            <label>36 ft<input type="number" min="0" style={inputStyle} value={b36} onChange={(e) => setB36(e.target.value)} placeholder="0" /></label>
            <label>45 ft<input type="number" min="0" style={inputStyle} value={b45} onChange={(e) => setB45(e.target.value)} placeholder="0" /></label>
          </div>
        </>
      )}

      <button type="submit" disabled={saving || !plantId}
        style={{ backgroundColor: "#0070f3", color: "white", border: "none", borderRadius: "6px", padding: "12px 24px", fontSize: "15px", cursor: "pointer", fontWeight: "bold" }}>
        {saving ? "Saving…" : "Save Opening Balances"}
      </button>

      {message && (
        <p style={{ marginTop: "16px", fontSize: "14px", color: message.startsWith("Error") ? "red" : "green" }}>{message}</p>
      )}
    </form>
  );
}
