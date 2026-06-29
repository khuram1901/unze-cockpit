"use client";

import { useState, useEffect } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { logAction } from "../lib/audit-log";
import { formatDateUK } from "../lib/dateUtils";
import { canAccessDailyEntry, type UserCtx, type PermOverrides } from "../lib/permissions";

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

type PastEntry = {
  id: string;
  entry_date: string;
  qty_31: number;
  qty_36: number;
  qty_45: number;
  qty_meter: number;
  type: "Production" | "Dispatch" | "Breakage";
};

const OPS_HOD_EMAIL = "nadeem.khan@unze.co.uk";

export default function ProductionForm() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState("");
  const [loadingPlants, setLoadingPlants] = useState(true);
  const [noAccess, setNoAccess] = useState(false);
  const [pastEntries, setPastEntries] = useState<PastEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

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
  const [userEmail, setUserEmail] = useState("");
  const [userIsAdmin, setUserIsAdmin] = useState(false);

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
      setUserEmail(email);
      setUserIsAdmin(role === "Admin");

      let overrides: PermOverrides | null = null;
      const p = await loadMyPermissions();
      if (p) overrides = p as PermOverrides;
      const ctx: UserCtx = { email, role, department: null, company: null, overrides };
      const hasFullAccess = canAccessDailyEntry(ctx);

      const { data: allPlants } = await supabase
        .from("plants")
        .select("*")
        .eq("active", true)
        .order("name");

      const active = allPlants || [];

      if (hasFullAccess) {
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

  async function loadHistory() {
    if (!plantId) { setPastEntries([]); return; }
    const fourteenAgo = new Date();
    fourteenAgo.setDate(fourteenAgo.getDate() - 14);
    const since = fourteenAgo.toISOString().slice(0, 10);

    const [prodRes, dispRes, brkRes] = await Promise.all([
      supabase.from("production_entries").select("id, entry_date, qty_31, qty_36, qty_45, qty_meter").eq("plant_id", plantId).gte("entry_date", since).order("entry_date", { ascending: false }),
      supabase.from("dispatch_entries").select("id, entry_date, qty_31, qty_36, qty_45, qty_meter").eq("plant_id", plantId).gte("entry_date", since).order("entry_date", { ascending: false }),
      supabase.from("breakage_entries").select("id, entry_date, qty_31, qty_36, qty_45, qty_meter").eq("plant_id", plantId).gte("entry_date", since).order("entry_date", { ascending: false }),
    ]);

    const entries: PastEntry[] = [
      ...(prodRes.data || []).map((r) => ({ ...r, type: "Production" as const })),
      ...(dispRes.data || []).map((r) => ({ ...r, type: "Dispatch" as const })),
      ...(brkRes.data || []).map((r) => ({ ...r, type: "Breakage" as const })),
    ];
    entries.sort((a, b) => b.entry_date.localeCompare(a.entry_date) || a.type.localeCompare(b.type));
    setPastEntries(entries);
  }

  useEffect(() => { loadHistory(); }, [plantId, entryDate]);

  const selectedPlant = plants.find((p) => p.id === plantId);
  const isMeter = selectedPlant?.type === "meter";

  function hasEntryFor(type: "Production" | "Dispatch" | "Breakage") {
    return pastEntries.some((e) => e.entry_date === entryDate && e.type === type);
  }

  const canDelete = userEmail === OPS_HOD_EMAIL || userIsAdmin;

  async function currentEmail() {
    const { data: userData } = await supabase.auth.getUser();
    return userData.user?.email || "unknown";
  }

  function showMsg(section: string, text: string, ok: boolean) {
    setSectionMsg({ section, text, ok });
  }

  async function deleteEntry(entry: PastEntry) {
    const table = entry.type === "Production" ? "production_entries" : entry.type === "Dispatch" ? "dispatch_entries" : "breakage_entries";
    const { error } = await supabase.from(table).delete().eq("id", entry.id);
    if (error) { showMsg("history", "Error deleting: " + error.message, false); return; }
    logAction("Deleted", table, `Deleted ${entry.type} entry for ${entry.entry_date}`);
    showMsg("history", `${entry.type} entry for ${formatDateUK(entry.entry_date)} deleted.`, true);
    loadHistory();
  }

  // ---- Production ----
  async function submitProduction(nothing = false) {
    if (!plantId) return;
    if (hasEntryFor("Production")) {
      showMsg("production", "Production already entered for this plant and date. Delete the existing entry first to re-enter.", false);
      return;
    }
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
    logAction("Created", "production_entries", `Production entry for ${entryDate}`); showMsg("production", nothing ? "Logged: nothing to report ✓" : "Production saved ✓", true);
    setProd31(""); setProd36(""); setProd45(""); setProdMeter(""); loadHistory();
  }

  // ---- Dispatch ----
  async function submitDispatch(nothing = false) {
    if (!plantId) return;
    if (hasEntryFor("Dispatch")) {
      showMsg("dispatch", "Dispatch already entered for this plant and date. Delete the existing entry first to re-enter.", false);
      return;
    }
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
    logAction("Created", "dispatch_entries", `Dispatch entry for ${entryDate}`); showMsg("dispatch", nothing ? "Logged: nothing to report ✓" : "Dispatch saved ✓", true);
    setDisp31(""); setDisp36(""); setDisp45(""); setDispMeter(""); loadHistory();
  }

  // ---- Breakage ----
  async function submitBreakage(nothing = false) {
    if (!plantId) return;
    if (hasEntryFor("Breakage")) {
      showMsg("breakage", "Breakage already entered for this plant and date. Delete the existing entry first to re-enter.", false);
      return;
    }
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
    logAction("Created", "breakage_entries", `Breakage entry for ${entryDate}`); showMsg("breakage", nothing ? "Logged: nothing to report ✓" : "Breakage saved ✓", true);
    setBrk31(""); setBrk36(""); setBrk45("");
    setReason31(""); setReason36(""); setReason45(""); setReasonOther(""); loadHistory();
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
    logAction("Created", "scrap_processed_entries", `Scrap entry for ${entryDate}`); showMsg("scrap", nothing ? "Logged: nothing to report ✓" : "Scrap saved ✓", true);
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
    logAction("Created", "machine_issues", `Machine issue: ${machineName}`); showMsg("machine", nothing ? "Logged: nothing to report ✓" : "Machine issue saved ✓", true);
    setMachineName(""); setMachineStatus("Down");
    setMachineExpectedResolution(""); setMachineDescription(""); setMachineActionTaken("");
  }

  // ---- Styles ----
  const inputStyle = {
    display: "block", width: "100%", padding: "7px 9px",
    marginTop: "3px", marginBottom: "10px", border: "1px solid var(--border-color, #e2e8f0)",
    borderRadius: "6px", fontSize: "17px",
  };
  const sectionStyle = {
    border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px",
    padding: "14px", marginBottom: "14px", backgroundColor: "var(--bg-card, #ffffff)",
  };
  const hint = { fontSize: "16px", color: "var(--text-secondary, #64748b)", marginBottom: "10px" };
  const h3 = { fontSize: "17px", fontWeight: 700 as const, color: "var(--text-primary, #1e293b)", marginBottom: "4px" };

  const submitBtn = (section: string): React.CSSProperties => ({
    backgroundColor: "var(--text-primary, #1e293b)", color: "white", border: "none", borderRadius: "6px",
    padding: "7px 14px", fontSize: "16px", cursor: "pointer", fontWeight: 700,
    opacity: savingSection === section ? 0.7 : 1,
  });
  const nothingBtn: React.CSSProperties = {
    backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px",
    padding: "7px 12px", fontSize: "16px", cursor: "pointer", fontWeight: 600,
  };
  const btnRow: React.CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" };

  function SectionMessage({ section }: { section: string }) {
    if (!sectionMsg || sectionMsg.section !== section) return null;
    return (
      <p style={{ marginTop: "8px", fontSize: "16px", fontWeight: 700, color: sectionMsg.ok ? "#16a34a" : "#dc2626" }}>
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

  if (loadingPlants) return <p style={{ color: "var(--text-secondary, #64748b)" }}>Loading your plant…</p>;

  if (noAccess) {
    return (
      <div style={{ ...sectionStyle, maxWidth: "520px" }}>
        <p style={{ color: "#dc2626", fontWeight: "bold" }}>You are not assigned to any plant yet.</p>
        <p style={{ color: "#666", fontSize: "16px" }}>
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
            <div style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)", marginBottom: "2px" }}>Plant</div>
            <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{plants[0].name}</div>
          </div>
        ) : (
          <div style={{ minWidth: "150px" }}>
            <div style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)", marginBottom: "2px" }}>Plant</div>
            <select
              style={{ ...inputStyle, marginBottom: 0, width: "auto", minWidth: "150px" }}
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
          <div style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)", marginBottom: "2px" }}>Date</div>
          <input
            type="date"
            style={{ ...inputStyle, marginBottom: 0, width: "auto" }}
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Today's status summary */}
      {plantId && (() => {
        const todayEntries = pastEntries.filter((e) => e.entry_date === entryDate);
        const hasProd = todayEntries.some((e) => e.type === "Production");
        const hasDisp = todayEntries.some((e) => e.type === "Dispatch");
        const hasBrk = todayEntries.some((e) => e.type === "Breakage");
        const allDone = hasProd && hasDisp;
        return (
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", padding: "4px 10px", borderRadius: "6px", border: `1px solid ${hasProd ? "#16a34a" : "var(--border-color, #e2e8f0)"}`, backgroundColor: hasProd ? "#dcfce7" : "var(--bg-card, #ffffff)", color: hasProd ? "#16a34a" : "var(--text-secondary, #64748b)", fontWeight: 600 }}>
              {hasProd ? "✓" : "○"} Production
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", padding: "4px 10px", borderRadius: "6px", border: `1px solid ${hasDisp ? "#16a34a" : "var(--border-color, #e2e8f0)"}`, backgroundColor: hasDisp ? "#dcfce7" : "var(--bg-card, #ffffff)", color: hasDisp ? "#16a34a" : "var(--text-secondary, #64748b)", fontWeight: 600 }}>
              {hasDisp ? "✓" : "○"} Dispatch
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", padding: "4px 10px", borderRadius: "6px", border: `1px solid ${hasBrk ? "#16a34a" : "var(--border-color, #e2e8f0)"}`, backgroundColor: hasBrk ? "#dcfce7" : "var(--bg-card, #ffffff)", color: hasBrk ? "#16a34a" : "var(--text-secondary, #64748b)", fontWeight: 600 }}>
              {hasBrk ? "✓" : "○"} Breakage
            </div>
            {allDone ? (
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#16a34a", padding: "4px 0", display: "flex", alignItems: "center" }}>All submitted for today</span>
            ) : (
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#d97706", padding: "4px 0", display: "flex", alignItems: "center" }}>
                {!hasProd && !hasDisp ? "Production and Dispatch needed" : !hasProd ? "Production needed" : "Dispatch needed"}
              </span>
            )}
          </div>
        );
      })()}

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

      {/* General notes */}
      {plantId && (
        <div style={sectionStyle}>
          <label>General notes (optional)<textarea style={{ ...inputStyle, height: "60px" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any issues, e.g. half day, machine down" /></label>
        </div>
      )}

      {/* My Past Entries */}
      {plantId && pastEntries.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary, #1e293b)", margin: 0, paddingLeft: "9px", borderLeft: "3px solid var(--text-primary, #1e293b)" }}>
              My Past Entries (Last 14 Days)
            </h2>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                backgroundColor: "var(--bg-card, #ffffff)", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px",
                padding: "6px 14px", fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #1e293b)", cursor: "pointer",
              }}
            >
              {showHistory ? "Hide" : `Show (${pastEntries.length})`}
            </button>
          </div>

          {sectionMsg?.section === "history" && (
            <div style={{ padding: "8px 12px", marginBottom: "8px", borderRadius: "6px", fontSize: "14px", fontWeight: 600, backgroundColor: sectionMsg.ok ? "#dcfce7" : "#fef2f2", color: sectionMsg.ok ? "#16a34a" : "#dc2626" }}>
              {sectionMsg.text}
            </div>
          )}
          {showHistory && (
            <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "500px" }}>
                  <thead>
                    <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
                      <th style={histTh}>Date</th>
                      <th style={histTh}>Type</th>
                      <th style={histTh}>31</th>
                      <th style={histTh}>36</th>
                      <th style={histTh}>45</th>
                      {selectedPlant?.type === "meter" && <th style={histTh}>Meter</th>}
                      <th style={histTh}>Total</th>
                      {canDelete && <th style={histTh}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pastEntries.map((e, i) => {
                      const total = (e.qty_31 || 0) + (e.qty_36 || 0) + (e.qty_45 || 0) + (e.qty_meter || 0);
                      const typeColor = e.type === "Production" ? "#16a34a" : e.type === "Dispatch" ? "#059669" : "#dc2626";
                      return (
                        <tr key={`${e.entry_date}-${e.type}-${i}`}>
                          <td style={histTd}>{formatDateUK(e.entry_date)}</td>
                          <td style={histTd}>
                            <span style={{ fontSize: "13px", fontWeight: 700, color: "white", backgroundColor: typeColor, padding: "2px 8px", borderRadius: "8px" }}>
                              {e.type}
                            </span>
                          </td>
                          <td style={histTd}>{e.qty_31 || 0}</td>
                          <td style={histTd}>{e.qty_36 || 0}</td>
                          <td style={histTd}>{e.qty_45 || 0}</td>
                          {selectedPlant?.type === "meter" && <td style={histTd}>{e.qty_meter || 0}</td>}
                          <td style={{ ...histTd, fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{total}</td>
                          {canDelete && (
                            <td style={histTd}>
                              <button onClick={() => deleteEntry(e)} style={{
                                backgroundColor: "transparent", border: "1px solid #dc2626", color: "#dc2626",
                                borderRadius: "4px", padding: "2px 8px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                              }}>×</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const histTh: React.CSSProperties = {
  textAlign: "left", borderBottom: "1px solid var(--border-color, #e2e8f0)", padding: "6px 10px",
  fontSize: "16px", color: "var(--text-secondary, #64748b)", fontWeight: 700,
};
const histTd: React.CSSProperties = {
  borderBottom: "1px solid var(--border-light, #f1f5f9)", padding: "7px 10px", fontSize: "15px",
};
