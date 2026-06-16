"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

type Plant = {
  id: string;
  name: string;
  type: string;
  active: boolean;
};

const REASONS = [
  "Cracked in curing",
  "Mould/casting defect",
  "Spun process fault",
  "Handling/loading damage",
  "Transport damage",
  "Storage/stacking damage",
  "Wire/material defect",
  "Other",
];

const MACHINE_STATUSES = ["Down", "Partially Working", "Resolved"];

export default function ProductionForm() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState("");
  const [loadingPlants, setLoadingPlants] = useState(true);
  const [noAccess, setNoAccess] = useState(false);

  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));

  // Production
  const [prod31, setProd31] = useState("");
  const [prod36, setProd36] = useState("");
  const [prod45, setProd45] = useState("");
  const [prodMeter, setProdMeter] = useState("");

  // Dispatch
  const [disp31, setDisp31] = useState("");
  const [disp36, setDisp36] = useState("");
  const [disp45, setDisp45] = useState("");
  const [dispMeter, setDispMeter] = useState("");

  // Breakage
  const [brk31, setBrk31] = useState("");
  const [brk36, setBrk36] = useState("");
  const [brk45, setBrk45] = useState("");
  const [reason31, setReason31] = useState("");
  const [reason36, setReason36] = useState("");
  const [reason45, setReason45] = useState("");
  const [reasonOther, setReasonOther] = useState("");

  // Scrap processed
  const [scr31, setScr31] = useState("");
  const [scr36, setScr36] = useState("");
  const [scr45, setScr45] = useState("");

  const [notes, setNotes] = useState("");

  // Machine breakdown
  const [machineName, setMachineName] = useState("");
  const [machineStatus, setMachineStatus] = useState("Down");
  const [machineExpectedResolution, setMachineExpectedResolution] = useState("");
  const [machineDescription, setMachineDescription] = useState("");
  const [machineActionTaken, setMachineActionTaken] = useState("");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      setLoadingPlants(true);

      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;

      if (!email) {
        setLoadingPlants(false);
        setNoAccess(true);
        return;
      }

      // Find the member record for the current user
      const { data: me } = await supabase
        .from("members")
        .select("id, role")
        .eq("email", email)
        .single();

      const role = me?.role || "Member";
      const isAdminOrExec = role === "Admin" || role === "Executive";

      // Load all active plants
      const { data: allPlants } = await supabase
        .from("plants")
        .select("*")
        .eq("active", true)
        .order("name");

      const active = allPlants || [];

      if (isAdminOrExec) {
        // Admin / Executive can enter for any plant
        setPlants(active);
      } else if (me) {
        // Members / Managers only see plants assigned to them
        const { data: mp } = await supabase
          .from("member_plants")
          .select("plant_id")
          .eq("member_id", me.id);

        const assignedIds = new Set((mp || []).map((r) => r.plant_id));
        const mine = active.filter((p) => assignedIds.has(p.id));
        setPlants(mine);

        // If exactly one plant, auto-select it
        if (mine.length === 1) setPlantId(mine[0].id);
        if (mine.length === 0) setNoAccess(true);
      } else {
        setNoAccess(true);
      }

      setLoadingPlants(false);
    }

    load();
  }, []);

  const selectedPlant = plants.find((p) => p.id === plantId);
  const isMeter = selectedPlant?.type === "meter";

  function resetAll() {
    setProd31(""); setProd36(""); setProd45(""); setProdMeter("");
    setDisp31(""); setDisp36(""); setDisp45(""); setDispMeter("");
    setBrk31(""); setBrk36(""); setBrk45("");
    setReason31(""); setReason36(""); setReason45(""); setReasonOther("");
    setScr31(""); setScr36(""); setScr45("");
    setNotes("");
    setMachineName(""); setMachineStatus("Down");
    setMachineExpectedResolution(""); setMachineDescription(""); setMachineActionTaken("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const enteredBy = userData.user?.email || "unknown";

    const hasProduction = prod31 || prod36 || prod45 || prodMeter;
    const hasDispatch = disp31 || disp36 || disp45 || dispMeter;
    const hasBreakage = brk31 || brk36 || brk45;
    const hasScrap = scr31 || scr36 || scr45;
    const hasMachine = machineName && machineDescription;

    let err = "";

    if (hasProduction) {
      const { error } = await supabase.from("production_entries").insert({
        plant_id: plantId, plant_name: selectedPlant?.name || "",
        entry_date: entryDate,
        qty_31: Number(prod31) || 0, qty_36: Number(prod36) || 0,
        qty_45: Number(prod45) || 0, qty_meter: Number(prodMeter) || 0,
        entered_by: enteredBy, notes,
      });
      if (error) err = error.message;
    }

    if (hasDispatch && !err) {
      const { error } = await supabase.from("dispatch_entries").insert({
        plant_id: plantId, plant_name: selectedPlant?.name || "",
        entry_date: entryDate,
        qty_31: Number(disp31) || 0, qty_36: Number(disp36) || 0,
        qty_45: Number(disp45) || 0, qty_meter: Number(dispMeter) || 0,
        entered_by: enteredBy, notes,
      });
      if (error) err = error.message;
    }

    if (hasBreakage && !err) {
      const { error } = await supabase.from("breakage_entries").insert({
        plant_id: plantId, plant_name: selectedPlant?.name || "",
        entry_date: entryDate,
        qty_31: Number(brk31) || 0, qty_36: Number(brk36) || 0,
        qty_45: Number(brk45) || 0,
        reason_31: reason31 || null,
        reason_36: reason36 || null,
        reason_45: reason45 || null,
        reason_other: reasonOther || null,
        entered_by: enteredBy,
      });
      if (error) err = error.message;
    }

    if (hasScrap && !err) {
      const { error } = await supabase.from("scrap_processed_entries").insert({
        plant_id: plantId, plant_name: selectedPlant?.name || "",
        entry_date: entryDate,
        qty_31: Number(scr31) || 0, qty_36: Number(scr36) || 0,
        qty_45: Number(scr45) || 0,
        notes, entered_by: enteredBy,
      });
      if (error) err = error.message;
    }

    if (hasMachine && !err) {
      const { error } = await supabase.from("machine_issues").insert({
        plant_id: plantId, plant_name: selectedPlant?.name || "",
        machine_name: machineName,
        issue_status: machineStatus,
        expected_resolution: machineExpectedResolution || null,
        issue_description: machineDescription,
        action_taken: machineActionTaken || null,
        entered_by: enteredBy,
      });
      if (error) err = error.message;
    }

    setSaving(false);

    if (err) { setMessage("Error: " + err); return; }

    if (!hasProduction && !hasDispatch && !hasBreakage && !hasScrap && !hasMachine) {
      setMessage("Please enter at least one number or a machine issue before submitting.");
      return;
    }

    setMessage("Daily entry submitted. Thank you!");
    resetAll();
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

  const hint = { fontSize: "13px", color: "#888", marginBottom: "14px" };
  const h3 = { fontSize: "16px", fontWeight: "bold" as const, marginBottom: "4px" };

  function ReasonSelect({
    value, onChange, size,
  }: {
    value: string; onChange: (v: string) => void; size: string;
  }) {
    return (
      <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">-- Reason for {size} --</option>
        {REASONS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
    );
  }

  if (loadingPlants) return <p>Loading your plant…</p>;

  if (noAccess) {
    return (
      <div style={{ ...sectionStyle, maxWidth: "520px" }}>
        <p style={{ color: "#991b1b", fontWeight: "bold" }}>
          You are not assigned to any plant yet.
        </p>
        <p style={{ color: "#666", fontSize: "14px" }}>
          Please ask an administrator to assign you to a plant on the Members page before entering
          data.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: "360px" }}>
      {/* Plant & date */}
      <div style={sectionStyle}>
        {plants.length === 1 ? (
          <div style={{ marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", color: "#888" }}>Plant</div>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>{plants[0].name}</div>
          </div>
        ) : (
          <label>Plant
            <select style={inputStyle} value={plantId}
              onChange={(e) => setPlantId(e.target.value)} required>
              <option value="">-- Select your plant --</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}

        <label>Date
          <input type="date" style={inputStyle} value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)} required />
        </label>
      </div>

      {/* Production */}
      {plantId && (
        <div style={sectionStyle}>
          <h3 style={h3}>Production today</h3>
          <p style={hint}>Count ALL poles produced, including any that broke. Leave blank if none.</p>
          {!isMeter ? (
            <>
              <label>31 ft produced<input type="number" min="0" style={inputStyle} value={prod31} onChange={(e) => setProd31(e.target.value)} placeholder="0" /></label>
              <label>36 ft produced<input type="number" min="0" style={inputStyle} value={prod36} onChange={(e) => setProd36(e.target.value)} placeholder="0" /></label>
              <label>45 ft produced<input type="number" min="0" style={inputStyle} value={prod45} onChange={(e) => setProd45(e.target.value)} placeholder="0" /></label>
            </>
          ) : (
            <label>Single-phase meters produced<input type="number" min="0" style={inputStyle} value={prodMeter} onChange={(e) => setProdMeter(e.target.value)} placeholder="0" /></label>
          )}
        </div>
      )}

      {/* Breakage */}
      {plantId && !isMeter && (
        <div style={sectionStyle}>
          <h3 style={h3}>Breakage today</h3>
          <p style={hint}>Of the production above, how many broke? Pick a reason for each size that broke.</p>

          <label>31 ft broken<input type="number" min="0" style={inputStyle} value={brk31} onChange={(e) => setBrk31(e.target.value)} placeholder="0" /></label>
          {Number(brk31) > 0 && <ReasonSelect value={reason31} onChange={setReason31} size="31 ft" />}

          <label>36 ft broken<input type="number" min="0" style={inputStyle} value={brk36} onChange={(e) => setBrk36(e.target.value)} placeholder="0" /></label>
          {Number(brk36) > 0 && <ReasonSelect value={reason36} onChange={setReason36} size="36 ft" />}

          <label>45 ft broken<input type="number" min="0" style={inputStyle} value={brk45} onChange={(e) => setBrk45(e.target.value)} placeholder="0" /></label>
          {Number(brk45) > 0 && <ReasonSelect value={reason45} onChange={setReason45} size="45 ft" />}

          {(reason31 === "Other" || reason36 === "Other" || reason45 === "Other") && (
            <label>Other — please specify<input type="text" style={inputStyle} value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="Describe the other reason" /></label>
          )}
        </div>
      )}

      {/* Dispatch */}
      {plantId && (
        <div style={sectionStyle}>
          <h3 style={h3}>Dispatch today</h3>
          <p style={hint}>Good poles sent out. Leave blank if nothing dispatched.</p>
          {!isMeter ? (
            <>
              <label>31 ft dispatched<input type="number" min="0" style={inputStyle} value={disp31} onChange={(e) => setDisp31(e.target.value)} placeholder="0" /></label>
              <label>36 ft dispatched<input type="number" min="0" style={inputStyle} value={disp36} onChange={(e) => setDisp36(e.target.value)} placeholder="0" /></label>
              <label>45 ft dispatched<input type="number" min="0" style={inputStyle} value={disp45} onChange={(e) => setDisp45(e.target.value)} placeholder="0" /></label>
            </>
          ) : (
            <label>Single-phase meters dispatched<input type="number" min="0" style={inputStyle} value={dispMeter} onChange={(e) => setDispMeter(e.target.value)} placeholder="0" /></label>
          )}
        </div>
      )}

      {/* Scrap processed */}
      {plantId && !isMeter && (
        <div style={sectionStyle}>
          <h3 style={h3}>Broken poles processed for scrap today</h3>
          <p style={hint}>Broken poles removed/processed. (Reduces broken-pole stock.)</p>
          <label>31 ft processed<input type="number" min="0" style={inputStyle} value={scr31} onChange={(e) => setScr31(e.target.value)} placeholder="0" /></label>
          <label>36 ft processed<input type="number" min="0" style={inputStyle} value={scr36} onChange={(e) => setScr36(e.target.value)} placeholder="0" /></label>
          <label>45 ft processed<input type="number" min="0" style={inputStyle} value={scr45} onChange={(e) => setScr45(e.target.value)} placeholder="0" /></label>
        </div>
      )}

      {/* Machine breakdown */}
      {plantId && (
        <div style={sectionStyle}>
          <h3 style={h3}>Machine breakdown (optional)</h3>
          <p style={hint}>Report a machine that is down, partially working, or resolved. Leave blank if none.</p>

          <label>Machine name<input type="text" style={inputStyle} value={machineName} onChange={(e) => setMachineName(e.target.value)} placeholder="e.g. Spinning Machine #2" /></label>

          <label>Status
            <select style={inputStyle} value={machineStatus} onChange={(e) => setMachineStatus(e.target.value)}>
              {MACHINE_STATUSES.map((s) => (<option key={s}>{s}</option>))}
            </select>
          </label>

          <label>Expected resolution<input type="text" style={inputStyle} value={machineExpectedResolution} onChange={(e) => setMachineExpectedResolution(e.target.value)} placeholder="e.g. Today 5pm / Tomorrow / Waiting for part" /></label>

          <label>Issue description<textarea style={{ ...inputStyle, height: "80px" }} value={machineDescription} onChange={(e) => setMachineDescription(e.target.value)} placeholder="What happened?" /></label>

          <label>Action taken<textarea style={{ ...inputStyle, height: "70px" }} value={machineActionTaken} onChange={(e) => setMachineActionTaken(e.target.value)} placeholder="What has been done so far?" /></label>

          <p style={{ fontSize: "12px", color: "#999" }}>
            To submit a machine issue, fill in at least the machine name and issue description.
          </p>
        </div>
      )}

      {/* General notes */}
      {plantId && (
        <div style={sectionStyle}>
          <label>General notes (optional)<textarea style={{ ...inputStyle, height: "60px" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any issues, e.g. half day, machine down" /></label>
        </div>
      )}

      <button type="submit" disabled={saving || !plantId}
        style={{ backgroundColor: "#0070f3", color: "white", border: "none", borderRadius: "6px", padding: "12px 24px", fontSize: "15px", cursor: "pointer", fontWeight: "bold" }}>
        {saving ? "Submitting…" : "Submit Daily Entry"}
      </button>

      {message && (
        <p style={{ marginTop: "16px", fontSize: "14px", color: message.startsWith("Error") ? "red" : "green" }}>{message}</p>
      )}
    </form>
  );
}
