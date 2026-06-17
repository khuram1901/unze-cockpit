"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import ReceivablesSection from "./ReceivablesSection";

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

  // Machine breakdown
  const [machineName, setMachineName] = useState("");
  const [machineStatus, setMachineStatus] = useState("Down");
  const [machineExpectedResolution, setMachineExpectedResolution] = useState("");
  const [machineDescription, setMachineDescription] = useState("");
  const [machineActionTaken, setMachineActionTaken] = useState("");

  const [notes, setNotes] = useState("");

  // Per-section saving + message state
  const [savingSection, setSavingSection] = useState("");
  const [sectionMsg, setSectionMsg] = useState<{ section: string; text: string; ok: boolean } | null>(null);

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

      const { data: me } = await supabase
        .from("members")
        .select("id, role")
        .eq("email", email)
        .single();

      const role = me?.role || "Member";
      const isAdminOrExec = role === "Admin" || role === "Executive";

      const { data: allPlants } = await supabase
        .from("plants")
        .select("*")
        .eq("active", true)
        .order("name");

      const active = allPlants || [];

      if (isAdminOrExec) {
        setPlants(active);
      } else if (me) {
        const { data: mp } = await supabase
          .from("member_plants")
          .select("plant_id")
          .eq("member_id", me.id);

        const assignedIds = new Set((mp || []).map((r) => r.plant_id));
        const mine = active.filter((p) => assignedIds.has(p.id));
        setPlants(mine);

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

  async function currentEmail() {
    const { data: userData } = await supabase.auth.getUser();
    return userData.user?.email || "unknown";
  }

  function showMsg(section: string, text: string, ok: boolean) {
    setSectionMsg({ section, text, ok });
  }

  // ---- Production ----
  async function submitProduction(nothing = false) {
    if (!plantId) return;
    if (!nothing && !prod31 && !prod36 && !prod45 && !prodMeter) {
      showMsg("production", "Enter a number, or use 'Nothing to report'.", false);
      return;
    }
    setSavingSection("production");
    const enteredBy = await currentEmail();
    const { error } = await supabase.from("production_entries").insert({
      plant_id: plantId, plant_name: selectedPlant?.name || "",
      entry_date: entryDate,
      qty_31: nothing ? 0 : Number(prod31) || 0,
      qty_36: nothing ? 0 : Number(prod36) || 0,
      qty_45: nothing ? 0 : Number(prod45) || 0,
      qty_meter: nothing ? 0 : Number(prodMeter) || 0,
      nothing_to_report: nothing,
      entered_by: enteredBy, notes,
    });
    setSavingSection("");
    if (error) { showMsg("production", "Error: " + error.message, false); return; }
    showMsg("production", nothing ? "Logged: nothing to report ✓" : "Production saved ✓", true);
    setProd31(""); setProd36(""); setProd45(""); setProdMeter("");
  }

  // ---- Dispatch ----
  async function submitDispatch(nothing = false) {
    if (!plantId) return;
    if (!nothing && !disp31 && !disp36 && !disp45 && !dispMeter) {
      showMsg("dispatch", "Enter a number, or use 'Nothing to report'.", false);
      return;
    }
    setSavingSection("dispatch");
    const enteredBy = await currentEmail();
    const { error } = await supabase.from("dispatch_entries").insert({
      plant_id: plantId, plant_name: selectedPlant?.name || "",
      entry_date: entryDate,
      qty_31: nothing ? 0 : Number(disp31) || 0,
      qty_36: nothing ? 0 : Number(disp36) || 0,
      qty_45: nothing ? 0 : Number(disp45) || 0,
      qty_meter: nothing ? 0 : Number(dispMeter) || 0,
      nothing_to_report: nothing,
      entered_by: enteredBy, notes,
    });
    setSavingSection("");
    if (error) { showMsg("dispatch", "Error: " + error.message, false); return; }
    showMsg("dispatch", nothing ? "Logged: nothing to report ✓" : "Dispatch saved ✓", true);
    setDisp31(""); setDisp36(""); setDisp45(""); setDispMeter("");
  }

  // ---- Breakage ----
  async function submitBreakage(nothing = false) {
    if (!plantId) return;
    if (!nothing && !brk31 && !brk36 && !brk45) {
      showMsg("breakage", "Enter a number, or use 'Nothing to report'.", false);
      return;
    }
    setSavingSection("breakage");
    const enteredBy = await currentEmail();
    const { error } = await supabase.from("breakage_entries").insert({
      plant_id: plantId, plant_name: selectedPlant?.name || "",
      entry_date: entryDate,
      qty_31: nothing ? 0 : Number(brk31) || 0,
      qty_36: nothing ? 0 : Number(brk36) || 0,
      qty_45: nothing ? 0 : Number(brk45) || 0,
      reason_31: nothing ? null : reason31 || null,
      reason_36: nothing ? null : reason36 || null,
      reason_45: nothing ? null : reason45 || null,
      reason_other: nothing ? null : reasonOther || null,
      nothing_to_report: nothing,
      entered_by: enteredBy,
    });
    setSavingSection("");
    if (error) { showMsg("breakage", "Error: " + error.message, false); return; }
    showMsg("breakage", nothing ? "Logged: nothing to report ✓" : "Breakage saved ✓", true);
    setBrk31(""); setBrk36(""); setBrk45("");
    setReason31(""); setReason36(""); setReason45(""); setReasonOther("");
  }

  // ---- Scrap ----
  async function submitScrap(nothing = false) {
    if (!plantId) return;
    if (!nothing && !scr31 && !scr36 && !scr45) {
      showMsg("scrap", "Enter a number, or use 'Nothing to report'.", false);
      return;
    }
    setSavingSection("scrap");
    const enteredBy = await currentEmail();
    const { error } = await supabase.from("scrap_processed_entries").insert({
      plant_id: plantId, plant_name: selectedPlant?.name || "",
      entry_date: entryDate,
      qty_31: nothing ? 0 : Number(scr31) || 0,
      qty_36: nothing ? 0 : Number(scr36) || 0,
      qty_45: nothing ? 0 : Number(scr45) || 0,
      nothing_to_report: nothing,
      notes, entered_by: enteredBy,
    });
    setSavingSection("");
    if (error) { showMsg("scrap", "Error: " + error.message, false); return; }
    showMsg("scrap", nothing ? "Logged: nothing to report ✓" : "Scrap saved ✓", true);
    setScr31(""); setScr36(""); setScr45("");
  }

  // ---- Machine ----
  async function submitMachine(nothing = false) {
    if (!plantId) return;
    if (!nothing && (!machineName || !machineDescription)) {
      showMsg("machine", "Enter machine name + description, or use 'Nothing to report'.", false);
      return;
    }
    setSavingSection("machine");
    const enteredBy = await currentEmail();
    const { error } = await supabase.from("machine_issues").insert({
      plant_id: plantId, plant_name: selectedPlant?.name || "",
      machine_name: nothing ? "None" : machineName,
      issue_status: nothing ? "Resolved" : machineStatus,
      expected_resolution: nothing ? null : machineExpectedResolution || null,
      issue_description: nothing ? "No machine issues today" : machineDescription,
      action_taken: nothing ? null : machineActionTaken || null,
      nothing_to_report: nothing,
      entered_by: enteredBy,
    });
    setSavingSection("");
    if (error) { showMsg("machine", "Error: " + error.message, false); return; }
    showMsg("machine", nothing ? "Logged: nothing to report ✓" : "Machine issue saved ✓", true);
    setMachineName(""); setMachineStatus("Down");
    setMachineExpectedResolution(""); setMachineDescription(""); setMachineActionTaken("");
  }

  // ---- Styles ----
  const inputStyle = {
    display: "block", width: "100%", padding: "7px 9px",
    marginTop: "3px", marginBottom: "10px", border: "1px solid #e2e8f0",
    borderRadius: "6px", fontSize: "13px",
  };
  const sectionStyle = {
    border: "1px solid #e2e8f0", borderRadius: "8px",
    padding: "14px", marginBottom: "14px", backgroundColor: "white",
  };
  const hint = { fontSize: "12px", color: "#64748b", marginBottom: "10px" };
  const h3 = { fontSize: "13px", fontWeight: 700 as const, color: "#1e293b", marginBottom: "4px" };

  const submitBtn = (section: string): React.CSSProperties => ({
    backgroundColor: "#1e293b", color: "white", border: "none", borderRadius: "6px",
    padding: "7px 14px", fontSize: "12px", cursor: "pointer", fontWeight: 700,
    opacity: savingSection === section ? 0.7 : 1,
  });
  const nothingBtn: React.CSSProperties = {
    backgroundColor: "white", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: "6px",
    padding: "7px 12px", fontSize: "12px", cursor: "pointer", fontWeight: 600,
  };
  const btnRow: React.CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" };

  function SectionMessage({ section }: { section: string }) {
    if (!sectionMsg || sectionMsg.section !== section) return null;
    return (
      <p style={{ marginTop: "8px", fontSize: "12px", fontWeight: 700, color: sectionMsg.ok ? "#16a34a" : "#c0392b" }}>
        {sectionMsg.text}
      </p>
    );
  }

  function ReasonSelect({
    value, onChange, size,
  }: {
    value: string; onChange: (v: string) => void; size: string;
  }) {
    return (
      <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">-- Reason for {size} --</option>
        {REASONS.map((r) => (<option key={r}>{r}</option>))}
      </select>
    );
  }

  if (loadingPlants) return <p style={{ color: "#64748b" }}>Loading your plant…</p>;

  if (noAccess) {
    return (
      <div style={{ ...sectionStyle, maxWidth: "520px" }}>
        <p style={{ color: "#991b1b", fontWeight: "bold" }}>You are not assigned to any plant yet.</p>
        <p style={{ color: "#666", fontSize: "14px" }}>
          Please ask an administrator to assign you to a plant on the Members page before entering data.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Plant & date */}
      <div style={{ ...sectionStyle, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "16px" }}>
        {plants.length === 1 ? (
          <div>
            <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "2px" }}>Plant</div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#1e293b" }}>{plants[0].name}</div>
          </div>
        ) : (
          <div style={{ minWidth: "200px" }}>
            <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "2px" }}>Plant</div>
            <select
              style={{ ...inputStyle, marginBottom: 0, width: "auto", minWidth: "200px" }}
              value={plantId}
              onChange={(e) => setPlantId(e.target.value)}
              required
            >
              <option value="">-- Select your plant --</option>
              {plants.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </div>
        )}
        <div>
          <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "2px" }}>Date</div>
          <input
            type="date"
            style={{ ...inputStyle, marginBottom: 0, width: "auto" }}
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "14px", alignItems: "start" }}>
        {/* Production */}
        {plantId && (
          <div style={sectionStyle}>
            <h3 style={h3}>Production today</h3>
            <p style={hint}>Count ALL poles produced, including any that broke. Required daily.</p>
            {!isMeter ? (
              <>
                <label>31 ft produced<input type="number" min="0" style={inputStyle} value={prod31} onChange={(e) => setProd31(e.target.value)} placeholder="0" /></label>
                <label>36 ft produced<input type="number" min="0" style={inputStyle} value={prod36} onChange={(e) => setProd36(e.target.value)} placeholder="0" /></label>
                <label>45 ft produced<input type="number" min="0" style={inputStyle} value={prod45} onChange={(e) => setProd45(e.target.value)} placeholder="0" /></label>
              </>
            ) : (
              <label>Single-phase meters produced<input type="number" min="0" style={inputStyle} value={prodMeter} onChange={(e) => setProdMeter(e.target.value)} placeholder="0" /></label>
            )}
            <div style={btnRow}>
              <button type="button" onClick={() => submitProduction(false)} disabled={savingSection === "production"} style={submitBtn("production")}>
                {savingSection === "production" ? "Saving…" : "Submit Production"}
              </button>
              <button type="button" onClick={() => submitProduction(true)} disabled={savingSection === "production"} style={nothingBtn}>
                Nothing to report
              </button>
            </div>
            <SectionMessage section="production" />
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
            <div style={btnRow}>
              <button type="button" onClick={() => submitBreakage(false)} disabled={savingSection === "breakage"} style={submitBtn("breakage")}>
                {savingSection === "breakage" ? "Saving…" : "Submit Breakage"}
              </button>
              <button type="button" onClick={() => submitBreakage(true)} disabled={savingSection === "breakage"} style={nothingBtn}>
                Nothing to report
              </button>
            </div>
            <SectionMessage section="breakage" />
          </div>
        )}

        {/* Dispatch */}
        {plantId && (
          <div style={sectionStyle}>
            <h3 style={h3}>Dispatch today</h3>
            <p style={hint}>Good poles sent out. Required daily.</p>
            {!isMeter ? (
              <>
                <label>31 ft dispatched<input type="number" min="0" style={inputStyle} value={disp31} onChange={(e) => setDisp31(e.target.value)} placeholder="0" /></label>
                <label>36 ft dispatched<input type="number" min="0" style={inputStyle} value={disp36} onChange={(e) => setDisp36(e.target.value)} placeholder="0" /></label>
                <label>45 ft dispatched<input type="number" min="0" style={inputStyle} value={disp45} onChange={(e) => setDisp45(e.target.value)} placeholder="0" /></label>
              </>
            ) : (
              <label>Single-phase meters dispatched<input type="number" min="0" style={inputStyle} value={dispMeter} onChange={(e) => setDispMeter(e.target.value)} placeholder="0" /></label>
            )}
            <div style={btnRow}>
              <button type="button" onClick={() => submitDispatch(false)} disabled={savingSection === "dispatch"} style={submitBtn("dispatch")}>
                {savingSection === "dispatch" ? "Saving…" : "Submit Dispatch"}
              </button>
              <button type="button" onClick={() => submitDispatch(true)} disabled={savingSection === "dispatch"} style={nothingBtn}>
                Nothing to report
              </button>
            </div>
            <SectionMessage section="dispatch" />
          </div>
        )}

        {/* Scrap */}
        {plantId && !isMeter && (
          <div style={sectionStyle}>
            <h3 style={h3}>Broken poles processed for scrap today</h3>
            <p style={hint}>Broken poles removed/processed. (Reduces broken-pole stock.)</p>
            <label>31 ft processed<input type="number" min="0" style={inputStyle} value={scr31} onChange={(e) => setScr31(e.target.value)} placeholder="0" /></label>
            <label>36 ft processed<input type="number" min="0" style={inputStyle} value={scr36} onChange={(e) => setScr36(e.target.value)} placeholder="0" /></label>
            <label>45 ft processed<input type="number" min="0" style={inputStyle} value={scr45} onChange={(e) => setScr45(e.target.value)} placeholder="0" /></label>
            <div style={btnRow}>
              <button type="button" onClick={() => submitScrap(false)} disabled={savingSection === "scrap"} style={submitBtn("scrap")}>
                {savingSection === "scrap" ? "Saving…" : "Submit Scrap"}
              </button>
              <button type="button" onClick={() => submitScrap(true)} disabled={savingSection === "scrap"} style={nothingBtn}>
                Nothing to report
              </button>
            </div>
            <SectionMessage section="scrap" />
          </div>
        )}

        {/* Machine */}
        {plantId && (
          <div style={sectionStyle}>
            <h3 style={h3}>Machine status today</h3>
            <p style={hint}>Report any machine that is down or partially working today. If everything is running normally, click "Nothing to report".</p>
            <label>Machine name<input type="text" style={inputStyle} value={machineName} onChange={(e) => setMachineName(e.target.value)} placeholder="e.g. Spinning Machine #2" /></label>
            <label>Status
              <select style={inputStyle} value={machineStatus} onChange={(e) => setMachineStatus(e.target.value)}>
                {MACHINE_STATUSES.map((s) => (<option key={s}>{s}</option>))}
              </select>
            </label>
            <label>Expected resolution<input type="text" style={inputStyle} value={machineExpectedResolution} onChange={(e) => setMachineExpectedResolution(e.target.value)} placeholder="e.g. Today 5pm / Tomorrow / Waiting for part" /></label>
            <label>Issue description<textarea style={{ ...inputStyle, height: "80px" }} value={machineDescription} onChange={(e) => setMachineDescription(e.target.value)} placeholder="What happened?" /></label>
            <label>Action taken<textarea style={{ ...inputStyle, height: "70px" }} value={machineActionTaken} onChange={(e) => setMachineActionTaken(e.target.value)} placeholder="What has been done so far?" /></label>
            <div style={btnRow}>
              <button type="button" onClick={() => submitMachine(false)} disabled={savingSection === "machine"} style={submitBtn("machine")}>
                {savingSection === "machine" ? "Saving…" : "Submit Machine Issue"}
              </button>
              <button type="button" onClick={() => submitMachine(true)} disabled={savingSection === "machine"} style={nothingBtn}>
                Nothing to report
              </button>
            </div>
            <SectionMessage section="machine" />
          </div>
        )}
      </div>

      {/* Receivables — full width below */}
      {plantId && selectedPlant && (
        <ReceivablesSection plantId={plantId} plantName={selectedPlant.name} />
      )}

      {/* General notes */}
      {plantId && (
        <div style={sectionStyle}>
          <label>General notes (optional)<textarea style={{ ...inputStyle, height: "60px" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any issues, e.g. half day, machine down" /></label>
        </div>
      )}
    </div>
  );
}
