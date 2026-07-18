"use client";

import { useState, useEffect } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { logAction } from "../lib/audit-log";
import { formatDateUK, todayPakistanISO } from "../lib/dateUtils";
import { canAccessDailyEntry, type UserCtx, type PermOverrides } from "../lib/permissions";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import { COLOURS, RADII, cardStyle, labelStyle, inputStyle as sharedInputStyle, primaryButtonStyle } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";

type Plant = {
  id: string;
  name: string;
  type: string;
  active: boolean;
};

type PO = {
  id: string;
  customer_name: string;
  po_number: string;
  po_label: string | null;
  ordered_31: number; ordered_36: number; ordered_45: number; ordered_meter: number;
  is_system_unallocated: boolean;
};

type LetterLookup = {
  id: string;
  letter_number: string;
  expiry_date: string | null;
  po_id: string;
  contractor_id: string;
  po_number: string;
  customer_name: string;
  contractor_name: string;
  qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
  remaining_31: number; remaining_36: number; remaining_40: number; remaining_45: number; remaining_meter: number;
};

function isLetterExpired(letter: LetterLookup): boolean {
  if (!letter.expiry_date) return false;
  // Found during the 15 Jul 2026 audit: this used to compare against
  // UTC "today" (new Date().toISOString()), so for ~5 hours after local
  // midnight a letter that's technically expired locally still showed
  // as valid. Now compares against Pakistan local "today" instead.
  return letter.expiry_date < todayPakistanISO();
}

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
  type: "Production" | "Dispatch" | "Breakage" | "Scrap";
};

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" } });
}

export default function ProductionForm() {
  const isMobile = useMobile();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState("");
  const [loadingPlants, setLoadingPlants] = useState(true);
  const [noAccess, setNoAccess] = useState(false);
  const [pastEntries, setPastEntries] = useState<PastEntry[]>([]);
  type FormTab = "production" | "dispatch" | "breakage" | "scrap" | "machine";
  const [activeForm, setActiveForm] = useState<FormTab>("production");

  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));

  // Production
  const [prod31, setProd31] = useState("");
  const [prod36, setProd36] = useState("");
  const [prod45, setProd45] = useState("");
  const [prodMeter, setProdMeter] = useState("");

  // PO allocation for production
  const [plantPOs, setPlantPOs] = useState<PO[]>([]);
  const [selectedPOId, setSelectedPOId] = useState("");
  const [loadingPOs, setLoadingPOs] = useState(false);

  // Dispatch — authority letter mode
  const [availableLetters, setAvailableLetters] = useState<LetterLookup[]>([]);
  const [loadingLetters, setLoadingLetters] = useState(false);
  const [selectedLetterId, setSelectedLetterId] = useState("");
  const [letterLookup, setLetterLookup] = useState<LetterLookup | null>(null);
  const [disp31, setDisp31] = useState("");
  const [disp36, setDisp36] = useState("");
  const [disp45, setDisp45] = useState("");
  const [dispMeter, setDispMeter] = useState("");
  const [releasedBy, setReleasedBy] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");

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
  const [userIsOpsManager, setUserIsOpsManager] = useState(false);

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
        .select("id, role, department")
        .eq("email", email)
        .single();

      const role = me?.role || "Member";
      const department = me?.department || null;
      setUserEmail(email);
      setUserIsAdmin(role === "Admin" || role === "CEO");
      setUserIsOpsManager(role === "Manager" && department === "Unze Trading Ops");

      let overrides: PermOverrides | null = null;
      const p = await loadMyPermissions();
      if (p) overrides = p as PermOverrides;
      const ctx: UserCtx = { email, role, department, company: null, overrides };
      const hasFullAccess = canAccessDailyEntry(ctx);

      const { data: allPlants } = await supabase
        .from("plants")
        .select("id, name, type, active")
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

  // Load POs for the selected plant
  useEffect(() => {
    async function loadPOs() {
      if (!plantId) { setPlantPOs([]); setSelectedPOId(""); return; }
      setLoadingPOs(true);
      try {
        const res = await authedFetch(`/api/stock/purchase-orders?plantId=${plantId}`);
        const json = await res.json();
        const list: PO[] = json.purchaseOrders || [];
        setPlantPOs(list);
        // Default to system unallocated PO
        const unallocated = list.find((p) => p.is_system_unallocated);
        setSelectedPOId(unallocated?.id || (list[0]?.id || ""));
      } catch {
        setPlantPOs([]);
      } finally {
        setLoadingPOs(false);
      }
    }
    loadPOs();
  }, [plantId]);

  // Load available authority letters when plant changes
  useEffect(() => {
    if (!plantId) { setAvailableLetters([]); setSelectedLetterId(""); setLetterLookup(null); return; }
    setLoadingLetters(true);
    setSelectedLetterId("");
    setLetterLookup(null);
    authedFetch(`/api/stock/authority-letters?plantId=${plantId}&listAll=true`)
      .then((r) => r.json())
      .then((json) => {
        const today = todayPakistanISO();
        const active = (json.letters || []).filter((l: LetterLookup) => {
          const hasBalance = (l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter) > 0;
          const notExpired = !l.expiry_date || l.expiry_date >= today;
          return hasBalance && notExpired;
        });
        setAvailableLetters(active);
      })
      .catch(() => setAvailableLetters([]))
      .finally(() => setLoadingLetters(false));
  }, [plantId]);

  async function loadHistory() {
    if (!plantId) { setPastEntries([]); return; }
    const fourteenAgo = new Date();
    fourteenAgo.setDate(fourteenAgo.getDate() - 14);
    const since = fourteenAgo.toISOString().slice(0, 10);

    const [prodRes, dispRes, brkRes, scrapRes] = await Promise.all([
      supabase.from("production_entries").select("id, entry_date, qty_31, qty_36, qty_45, qty_meter").eq("plant_id", plantId).gte("entry_date", since).order("entry_date", { ascending: false }),
      supabase.from("dispatch_entries").select("id, entry_date, qty_31, qty_36, qty_45, qty_meter").eq("plant_id", plantId).gte("entry_date", since).order("entry_date", { ascending: false }),
      supabase.from("breakage_entries").select("id, entry_date, qty_31, qty_36, qty_45, qty_meter").eq("plant_id", plantId).gte("entry_date", since).order("entry_date", { ascending: false }),
      // scrap_processed_entries has no qty_meter column — default to 0
      // so it fits the shared PastEntry shape used for the duplicate check.
      supabase.from("scrap_processed_entries").select("id, entry_date, qty_31, qty_36, qty_45").eq("plant_id", plantId).gte("entry_date", since).order("entry_date", { ascending: false }),
    ]);

    const entries: PastEntry[] = [
      ...(prodRes.data || []).map((r) => ({ ...r, type: "Production" as const })),
      ...(dispRes.data || []).map((r) => ({ ...r, type: "Dispatch" as const })),
      ...(brkRes.data || []).map((r) => ({ ...r, type: "Breakage" as const })),
      ...(scrapRes.data || []).map((r) => ({ ...r, qty_meter: 0, type: "Scrap" as const })),
    ];
    entries.sort((a, b) => b.entry_date.localeCompare(a.entry_date) || a.type.localeCompare(b.type));
    setPastEntries(entries);
  }

  useEffect(() => { loadHistory(); }, [plantId, entryDate]);

  const selectedPlant = plants.find((p) => p.id === plantId);
  const isMeter = selectedPlant?.type === "meter";

  function hasEntryFor(type: "Production" | "Dispatch" | "Breakage" | "Scrap") {
    return pastEntries.some((e) => e.entry_date === entryDate && e.type === type);
  }

  const canDelete = userIsAdmin || userIsOpsManager;

  async function currentEmail() {
    const { data: userData } = await supabase.auth.getUser();
    return userData.user?.email || "unknown";
  }

  function showMsg(section: string, text: string, ok: boolean) {
    setSectionMsg({ section, text, ok });
  }

  async function deleteEntry(entry: PastEntry) {
    const table = entry.type === "Production" ? "production_entries"
      : entry.type === "Dispatch" ? "dispatch_entries"
      : entry.type === "Scrap" ? "scrap_processed_entries"
      : "breakage_entries";
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

    const qty31 = nothing ? 0 : Number(prod31) || 0;
    const qty36 = nothing ? 0 : Number(prod36) || 0;
    const qty45 = nothing ? 0 : Number(prod45) || 0;
    const qtyMeter = nothing ? 0 : Number(prodMeter) || 0;

    const { data: entryData, error } = await supabase.from("production_entries").insert({
      plant_id: plantId, plant_name: selectedPlant?.name || "",
      entry_date: entryDate,
      qty_31: qty31, qty_36: qty36, qty_45: qty45, qty_meter: qtyMeter,
      nothing_to_report: nothing,
      entered_by: enteredBy, notes,
    }).select("id").single();

    if (error) {
      setSavingSection("");
      const dup = error.code === "23505";
      showMsg("production", dup ? "Production already entered for this plant and date. Delete the existing entry first to re-enter." : "Error: " + error.message, false);
      if (dup) loadHistory();
      return;
    }

    // Submit PO allocation if a PO is selected and there are quantities
    if (!nothing && entryData?.id && selectedPOId && (qty31 + qty36 + qty45 + qtyMeter > 0)) {
      const allocRes = await authedFetch("/api/stock/production-allocations", {
        method: "POST",
        body: JSON.stringify({
          entry_id: entryData.id,
          allocations: [{
            po_id: selectedPOId,
            qty_31: qty31, qty_36: qty36, qty_45: qty45, qty_meter: qtyMeter,
          }],
        }),
      });
      const allocJson = await allocRes.json();
      if (allocJson.error) {
        setSavingSection("");
        showMsg("production", `Production saved but PO allocation failed: ${allocJson.error}`, false);
        setProd31(""); setProd36(""); setProd45(""); setProdMeter("");
        logAction("Created", "production_entries", `Production entry for ${entryDate}`);
        loadHistory();
        return;
      }
    }

    setSavingSection("");
    logAction("Created", "production_entries", `Production entry for ${entryDate}`);
    showMsg("production", nothing ? "Logged: nothing to report ✓" : "Production saved ✓", true);
    setProd31(""); setProd36(""); setProd45(""); setProdMeter("");
    loadHistory();
  }

  // ---- Dispatch (authority letter mode) ----
  async function submitDispatch(nothing = false) {
    if (!plantId) return;
    if (hasEntryFor("Dispatch")) {
      showMsg("dispatch", "Dispatch already entered for this plant and date. Delete the existing entry first to re-enter.", false);
      return;
    }

    if (nothing && availableLetters.length > 0) {
      const confirmed = window.confirm(
        `There are ${availableLetters.length} active authority letter(s) with remaining balance for this plant.\n\nAre you sure nothing was dispatched today?\n\nClick OK to confirm no dispatch, or Cancel to record a dispatch.`
      );
      if (!confirmed) return;
    }

    const qty31 = nothing ? 0 : Number(disp31) || 0;
    const qty36 = nothing ? 0 : Number(disp36) || 0;
    const qty45 = nothing ? 0 : Number(disp45) || 0;
    const qtyMeter = nothing ? 0 : Number(dispMeter) || 0;

    if (!nothing && qty31 + qty36 + qty45 + qtyMeter === 0) {
      showMsg("dispatch", "Enter a quantity, or use 'Nothing to report'.", false);
      return;
    }
    if (!nothing && !letterLookup) {
      showMsg("dispatch", "Find an authority letter first by entering the letter number.", false);
      return;
    }
    if (!nothing && letterLookup && isLetterExpired(letterLookup)) {
      showMsg("dispatch", "Cannot dispatch: this authority letter has expired.", false);
      return;
    }
    if (!nothing && letterLookup) {
      const overages: string[] = [];
      if (qty31 > (letterLookup.remaining_31 ?? 0))
        overages.push(`31ft (entered ${qty31}, only ${letterLookup.remaining_31} remaining)`);
      if (qty36 > (letterLookup.remaining_36 ?? 0))
        overages.push(`36ft (entered ${qty36}, only ${letterLookup.remaining_36} remaining)`);
      if (qty45 > (letterLookup.remaining_45 ?? 0))
        overages.push(`45ft (entered ${qty45}, only ${letterLookup.remaining_45} remaining)`);
      if (qtyMeter > (letterLookup.remaining_meter ?? 0))
        overages.push(`Meters (entered ${qtyMeter}, only ${letterLookup.remaining_meter} remaining)`);
      if (overages.length > 0) {
        showMsg("dispatch", `Dispatch exceeds authority letter balance:\n${overages.join("\n")}\n\nDispatch has NOT been saved.`, false);
        return;
      }
    }
    if (!nothing && !releasedBy.trim()) {
      showMsg("dispatch", "Enter the name of who released/approved the dispatch.", false);
      return;
    }

    setSavingSection("dispatch");
    const enteredBy = await currentEmail();

    // Save to dispatch_entries (legacy — keeps existing dashboard working)
    const { data: dispRow, error: dispError } = await supabase.from("dispatch_entries").insert({
      plant_id: plantId, plant_name: selectedPlant?.name || "",
      entry_date: entryDate,
      qty_31: qty31, qty_36: qty36, qty_45: qty45, qty_meter: qtyMeter,
      nothing_to_report: nothing,
      entered_by: enteredBy, notes,
    }).select("id").single();

    if (dispError) {
      setSavingSection("");
      const dup = dispError.code === "23505";
      showMsg("dispatch", dup ? "Dispatch already entered for this plant and date." : "Error: " + dispError.message, false);
      if (dup) loadHistory();
      return;
    }

    // Save to dispatch_records (stock system) if not "nothing"
    if (!nothing && letterLookup) {
      const recRes = await authedFetch("/api/stock/dispatch-records", {
        method: "POST",
        body: JSON.stringify({
          authority_letter_id: letterLookup.id,
          dispatch_date: entryDate,
          qty_31: qty31, qty_36: qty36, qty_45: qty45, qty_meter: qtyMeter,
          released_by: releasedBy.trim(),
          vehicle_number: vehicleNumber.trim() || null,
          notes: notes || null,
        }),
      });
      const recJson = await recRes.json();
      if (recJson.error) {
        // Found during the 15 Jul 2026 full-app audit: this used to leave
        // the dispatch_entries row committed even when the stock-system
        // write failed, silently putting the legacy dashboard and the
        // stock system out of sync with no way to tell later. Now rolls
        // back the dispatch_entries row too, so a failed dispatch is
        // fully undone rather than half-saved — the user sees a clear
        // "nothing was saved" message and can just retry the whole thing.
        if (dispRow?.id) await supabase.from("dispatch_entries").delete().eq("id", dispRow.id);
        setSavingSection("");
        showMsg("dispatch", `Dispatch record failed, so nothing was saved: ${recJson.error}. Please try again.`, false);
        loadHistory();
        return;
      }
    }

    setSavingSection("");
    logAction("Created", "dispatch_entries", `Dispatch entry for ${entryDate}`);
    showMsg("dispatch", nothing ? "Logged: nothing to report ✓" : "Dispatch saved ✓", true);
    setDisp31(""); setDisp36(""); setDisp45(""); setDispMeter("");
    setSelectedLetterId(""); setLetterLookup(null);
    setReleasedBy(""); setVehicleNumber("");
    loadHistory();
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
    if (error) {
      const dup = error.code === "23505";
      showMsg("breakage", dup ? "Breakage already entered for this plant and date. Delete the existing entry first to re-enter." : "Error: " + error.message, false);
      if (dup) loadHistory();
      return;
    }
    logAction("Created", "breakage_entries", `Breakage entry for ${entryDate}`); showMsg("breakage", nothing ? "Logged: nothing to report ✓" : "Breakage saved ✓", true);
    setBrk31(""); setBrk36(""); setBrk45("");
    setReason31(""); setReason36(""); setReason45(""); setReasonOther(""); loadHistory();
  }

  // ---- Scrap ----
  async function submitScrap(nothing = false) {
    if (!plantId) return;
    // Found during the 15 Jul 2026 audit: unlike production/dispatch/
    // breakage, scrap had no duplicate-submission guard at all — the
    // same plant/day could be submitted twice, silently double-counting
    // scrap. Matches the same client-side pre-check the other three use.
    if (hasEntryFor("Scrap")) {
      showMsg("scrap", "Scrap already entered for this plant and date. Delete the existing entry first to re-enter.", false);
      return;
    }
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
    if (error) {
      // Belt-and-braces: migration 125 adds a UNIQUE(plant_id, entry_date)
      // constraint at the database level too, same as the other three
      // entry types, in case two submissions race each other.
      const dup = error.code === "23505";
      showMsg("scrap", dup ? "Scrap already entered for this plant and date. Delete the existing entry first to re-enter." : "Error: " + error.message, false);
      if (dup) loadHistory();
      return;
    }
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
  const inputStyle: React.CSSProperties = {
    ...sharedInputStyle,
    padding: "11px 12px",
    fontSize: "15px",
    marginBottom: "10px",
  };
  const sectionStyle: React.CSSProperties = {
    ...cardStyle,
    borderRadius: RADII.CARD,
    padding: "20px 22px",
    marginBottom: "14px",
  };
  const hint: React.CSSProperties = { fontSize: "13px", color: COLOURS.SLATE, marginBottom: "10px", lineHeight: "1.4" };
  const h3: React.CSSProperties = { fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" };

  const submitBtn = (section: string): React.CSSProperties => ({
    ...primaryButtonStyle,
    padding: "10px 18px",
    fontSize: "13px",
    opacity: savingSection === section ? 0.7 : 1,
  });
  const nothingBtn: React.CSSProperties = {
    backgroundColor: COLOURS.CARD,
    color: COLOURS.SLATE,
    border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.PILL,
    padding: "10px 14px",
    fontSize: "13px",
    cursor: "pointer",
    fontWeight: 500,
  };
  const btnRow: React.CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" };

  function SectionMessage({ section }: { section: string }) {
    if (!sectionMsg || sectionMsg.section !== section) return null;
    return (
      <p style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, color: sectionMsg.ok ? COLOURS.GREEN : COLOURS.RED }}>
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

  if (loadingPlants) return <p style={{ color: COLOURS.SLATE }}>Loading your plant…</p>;

  if (noAccess) {
    return (
      <div style={{ ...sectionStyle, maxWidth: "520px" }}>
        <p style={{ color: COLOURS.RED, fontWeight: 600 }}>You are not assigned to any plant yet.</p>
        <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>
          Please ask an administrator to assign you to a plant on the Members page before entering data.
        </p>
      </div>
    );
  }

  const systemPO = plantPOs.find((p) => p.is_system_unallocated);
  const customerPOs = plantPOs.filter((p) => !p.is_system_unallocated);
  const dispatchHasQty = Number(disp31) + Number(disp36) + Number(disp45) + Number(dispMeter) > 0;

  const FORMS: { id: FormTab; label: string; emoji: string }[] = [
    { id: "production", label: "Production", emoji: "⚙️" },
    { id: "dispatch",   label: "Dispatch",   emoji: "🚛" },
    { id: "breakage",   label: "Breakage",   emoji: "⚠️" },
    { id: "scrap",      label: "Scrap",      emoji: "♻️" },
    { id: "machine",    label: "Machine",    emoji: "🔧" },
  ];

  const tabBtnSt = (id: FormTab): React.CSSProperties => ({
    flex: 1, padding: "10px 4px", borderRadius: RADII.CARD,
    fontSize: "11.5px", fontWeight: 700, cursor: "pointer",
    border: `2px solid ${activeForm === id ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: activeForm === id ? COLOURS.NAVY : "white",
    color: activeForm === id ? "white" : COLOURS.SLATE,
    textAlign: "center" as const, transition: "all 0.15s",
  });

  function RecentEntries({ type }: { type: "Production" | "Dispatch" | "Breakage" | "Scrap" }) {
    const rows = pastEntries.filter((e) => e.type === type).slice(0, 6);
    if (rows.length === 0) return null;
    const accentColor = type === "Production" ? COLOURS.GREEN : type === "Dispatch" ? COLOURS.BLUE : COLOURS.RED;
    const todayStr = new Date().toISOString().slice(0, 10);
    return (
      <div style={{ marginTop: "16px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "8px" }}>
          Recent {type.toLowerCase()} entries
        </div>
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white" }}>
          {rows.map((r, i) => {
            const total = (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
            const isToday = r.entry_date === todayStr;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: i < rows.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none", gap: "8px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>
                    {formatDateUK(r.entry_date)}
                    {isToday && <span style={{ marginLeft: "6px", fontSize: "11px", color: COLOURS.BLUE }}>Today</span>}
                  </div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                    {!isMeter
                      ? ([r.qty_31 > 0 && `${r.qty_31}×31ft`, r.qty_36 > 0 && `${r.qty_36}×36ft`, r.qty_45 > 0 && `${r.qty_45}×45ft`].filter(Boolean).join(" · ") || "Nothing to report")
                      : (r.qty_meter > 0 ? `${r.qty_meter} meters` : "Nothing to report")
                    }
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: accentColor, fontVariantNumeric: "tabular-nums" }}>{total}</span>
                  {canDelete && (
                    <button onClick={() => deleteEntry(r)} style={{ backgroundColor: "transparent", border: `1px solid ${COLOURS.RED}`, color: COLOURS.RED, borderRadius: RADII.XS, padding: "2px 8px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>×</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {sectionMsg?.section === "history" && (
          <p style={{ marginTop: "6px", fontSize: "13px", fontWeight: 600, color: sectionMsg.ok ? COLOURS.GREEN : COLOURS.RED }}>{sectionMsg.text}</p>
        )}
      </div>
    );
  }

  const maxW = isMobile ? "100%" : "540px";

  return (
    <div style={{ maxWidth: maxW, margin: "0 auto" }}>

      {/* ── Plant & date ── */}
      <div style={{ ...sectionStyle, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "16px", marginBottom: "20px" }}>
        {plants.length === 1 ? (
          <div>
            <div style={{ ...labelStyle }}>Plant</div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{plants[0].name}</div>
          </div>
        ) : (
          <div style={{ minWidth: "150px" }}>
            <label style={labelStyle}>Plant
              <select style={{ ...inputStyle, marginBottom: 0, width: "auto", minWidth: "150px" }} value={plantId} onChange={(e) => setPlantId(e.target.value)} required>
                <option value="">-- Select your plant --</option>
                {plants.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </label>
          </div>
        )}
        <div>
          <label style={labelStyle}>Date
            <DateInputWithCalendar style={{ ...inputStyle, marginBottom: 0, width: "auto" }} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </label>
        </div>
      </div>

      {/* ── Today's status summary ── */}
      {plantId && (() => {
        const todayEntries = pastEntries.filter((e) => e.entry_date === entryDate);
        const hasProd = todayEntries.some((e) => e.type === "Production");
        const hasDisp = todayEntries.some((e) => e.type === "Dispatch");
        const hasBrk  = todayEntries.some((e) => e.type === "Breakage");
        const allDone = hasProd && hasDisp;
        return (
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
            {[
              { label: "Production", done: hasProd },
              { label: "Dispatch",   done: hasDisp },
              { label: "Breakage",   done: hasBrk  },
            ].map(({ label, done }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 500, padding: "6px 12px", borderRadius: RADII.PILL, border: `1px solid ${done ? COLOURS.GREEN : COLOURS.HAIRLINE}`, backgroundColor: done ? COLOURS.SUCCESS_SOFT : COLOURS.CARD, color: done ? COLOURS.GREEN : COLOURS.SLATE }}>
                {done ? "✓" : "○"} {label}
              </div>
            ))}
            {allDone ? (
              <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.GREEN, padding: "6px 0", display: "flex", alignItems: "center" }}>All submitted for today</span>
            ) : (
              <span style={{ fontSize: "12px", fontWeight: 500, color: COLOURS.AMBER, padding: "6px 0", display: "flex", alignItems: "center" }}>
                {!hasProd && !hasDisp ? "Production and Dispatch needed" : !hasProd ? "Production needed" : "Dispatch needed"}
              </span>
            )}
          </div>
        );
      })()}

      {/* ── Section tabs ── */}
      {plantId && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {FORMS.map((f) => (
            <button key={f.id} onClick={() => setActiveForm(f.id)} style={tabBtnSt(f.id)}>
              <div style={{ fontSize: "18px", marginBottom: "2px" }}>{f.emoji}</div>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* ── PRODUCTION ── */}
      {activeForm === "production" && plantId && (
        <>
          <div style={sectionStyle}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 4px" }}>⚙️ Production today</h2>
            <p style={hint}>Count ALL poles produced, including any that broke. Required daily.</p>
            {!isMeter ? (
              <>
                <label style={labelStyle}>31 ft produced<input type="number" min="0" style={inputStyle} value={prod31} onChange={(e) => setProd31(e.target.value)} placeholder="0" /></label>
                <label style={labelStyle}>36 ft produced<input type="number" min="0" style={inputStyle} value={prod36} onChange={(e) => setProd36(e.target.value)} placeholder="0" /></label>
                <label style={labelStyle}>45 ft produced<input type="number" min="0" style={inputStyle} value={prod45} onChange={(e) => setProd45(e.target.value)} placeholder="0" /></label>
              </>
            ) : (
              <label style={labelStyle}>Single-phase meters produced<input type="number" min="0" style={inputStyle} value={prodMeter} onChange={(e) => setProdMeter(e.target.value)} placeholder="0" /></label>
            )}
            {plantPOs.length > 0 && (
              <div style={{ marginTop: "4px" }}>
                <label style={labelStyle}>Which PO is this production for?
                  {loadingPOs ? (
                    <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "4px" }}>Loading POs…</p>
                  ) : (
                    <select value={selectedPOId} onChange={(e) => setSelectedPOId(e.target.value)} style={{ ...inputStyle, marginTop: "6px" }}>
                      {customerPOs.map((po) => (
                        <option key={po.id} value={po.id}>{po.customer_name} — PO #{po.po_number}{po.po_label ? ` (${po.po_label})` : ""}</option>
                      ))}
                      {systemPO && <option key={systemPO.id} value={systemPO.id}>Unallocated (Unze stock)</option>}
                    </select>
                  )}
                </label>
              </div>
            )}
            <label style={labelStyle}>Notes (optional)
              <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" as const }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any issues, e.g. half day, machine down" />
            </label>
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
          <RecentEntries type="Production" />
        </>
      )}

      {/* ── DISPATCH ── */}
      {activeForm === "dispatch" && plantId && (
        <>
          <div style={sectionStyle}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 4px" }}>🚛 Dispatch today</h2>
            <p style={hint}>Select an authority letter to see the contractor and remaining balance.</p>
            <label style={labelStyle}>
              Authority letter
              {loadingLetters ? (
                <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>Loading letters for this plant…</p>
              ) : availableLetters.length === 0 ? (
                <div style={{ backgroundColor: COLOURS.WARNING_SOFT, border: `1px solid ${COLOURS.AMBER}`, borderRadius: RADII.SM, padding: "8px 12px", fontSize: "12px", color: COLOURS.AMBER, fontWeight: 500, marginTop: "4px" }}>
                  No active authority letters with remaining balance for this plant. Add letters in Stock → Manage POs.
                </div>
              ) : (
                <select style={inputStyle} value={selectedLetterId} onChange={(e) => { setSelectedLetterId(e.target.value); const letter = availableLetters.find((l) => l.id === e.target.value); setLetterLookup(letter || null); }}>
                  <option value="">— Select authority letter —</option>
                  {availableLetters.map((l) => (
                    <option key={l.id} value={l.id}>
                      #{l.letter_number} · {l.customer_name} · {[l.remaining_31 > 0 && `${l.remaining_31}×31ft`, l.remaining_36 > 0 && `${l.remaining_36}×36ft`, l.remaining_45 > 0 && `${l.remaining_45}×45ft`, l.remaining_meter > 0 && `${l.remaining_meter}×Mtr`].filter(Boolean).join(", ")} remaining{l.expiry_date ? ` · exp ${l.expiry_date}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {letterLookup && (
              <>
                <div style={{ border: `1px solid ${isLetterExpired(letterLookup) ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: RADII.CARD, padding: "12px 14px", backgroundColor: isLetterExpired(letterLookup) ? COLOURS.DANGER_SOFT : COLOURS.SUCCESS_SOFT, marginBottom: "10px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: isLetterExpired(letterLookup) ? COLOURS.RED : COLOURS.GREEN, marginBottom: "4px" }}>
                    {isLetterExpired(letterLookup) ? "Letter found — EXPIRED" : "Letter found ✓"}
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: COLOURS.NAVY }}>{letterLookup.customer_name} — PO #{letterLookup.po_number}</div>
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>Contractor: {letterLookup.contractor_name}</div>
                  <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {[
                      { size: "31ft", authorized: letterLookup.qty_31, remaining: letterLookup.remaining_31 },
                      { size: "36ft", authorized: letterLookup.qty_36, remaining: letterLookup.remaining_36 },
                      { size: "40ft", authorized: letterLookup.qty_40 || 0, remaining: letterLookup.remaining_40 || 0 },
                      { size: "45ft", authorized: letterLookup.qty_45, remaining: letterLookup.remaining_45 },
                      { size: "Mtr",  authorized: letterLookup.qty_meter, remaining: letterLookup.remaining_meter },
                    ].filter((s) => s.authorized > 0).map((s) => (
                      <div key={s.size} style={{ padding: "6px 10px", borderRadius: RADII.SM, backgroundColor: s.remaining > 0 ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT, border: `1px solid ${s.remaining > 0 ? COLOURS.GREEN : COLOURS.RED}` }}>
                        <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{s.size}</div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: s.remaining > 0 ? COLOURS.GREEN : COLOURS.RED, fontVariantNumeric: "tabular-nums" }}>{s.remaining} left</div>
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>of {s.authorized}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {isLetterExpired(letterLookup) && (
                  <div style={{ backgroundColor: COLOURS.DANGER_SOFT, border: `1px solid ${COLOURS.RED}`, borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "10px", display: "flex", alignItems: "flex-start", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.RED }}>EXPIRED — dispatch not allowed.</span>
                    <span style={{ fontSize: "12px", color: COLOURS.RED }}>This letter expired on {formatDateUK(letterLookup.expiry_date!)}. No further dispatches can be made against it.</span>
                  </div>
                )}
              </>
            )}
            {(letterLookup || availableLetters.length === 0) && (
              <>
                {!isMeter ? (
                  <>
                    <label>31 ft dispatched<input type="number" min="0" style={{ ...inputStyle, border: letterLookup && Number(disp31) > (letterLookup.remaining_31 ?? Infinity) ? `1.5px solid ${COLOURS.RED}` : `1px solid ${COLOURS.HAIRLINE}`, opacity: letterLookup && isLetterExpired(letterLookup) ? 0.4 : 1, cursor: letterLookup && isLetterExpired(letterLookup) ? "not-allowed" : "auto", backgroundColor: letterLookup && isLetterExpired(letterLookup) ? COLOURS.CARD_ALT : undefined }} disabled={!!(letterLookup && isLetterExpired(letterLookup))} value={disp31} onChange={(e) => setDisp31(e.target.value)} placeholder="0" /></label>
                    <label>36 ft dispatched<input type="number" min="0" style={{ ...inputStyle, border: letterLookup && Number(disp36) > (letterLookup.remaining_36 ?? Infinity) ? `1.5px solid ${COLOURS.RED}` : `1px solid ${COLOURS.HAIRLINE}`, opacity: letterLookup && isLetterExpired(letterLookup) ? 0.4 : 1, cursor: letterLookup && isLetterExpired(letterLookup) ? "not-allowed" : "auto", backgroundColor: letterLookup && isLetterExpired(letterLookup) ? COLOURS.CARD_ALT : undefined }} disabled={!!(letterLookup && isLetterExpired(letterLookup))} value={disp36} onChange={(e) => setDisp36(e.target.value)} placeholder="0" /></label>
                    <label>45 ft dispatched<input type="number" min="0" style={{ ...inputStyle, border: letterLookup && Number(disp45) > (letterLookup.remaining_45 ?? Infinity) ? `1.5px solid ${COLOURS.RED}` : `1px solid ${COLOURS.HAIRLINE}`, opacity: letterLookup && isLetterExpired(letterLookup) ? 0.4 : 1, cursor: letterLookup && isLetterExpired(letterLookup) ? "not-allowed" : "auto", backgroundColor: letterLookup && isLetterExpired(letterLookup) ? COLOURS.CARD_ALT : undefined }} disabled={!!(letterLookup && isLetterExpired(letterLookup))} value={disp45} onChange={(e) => setDisp45(e.target.value)} placeholder="0" /></label>
                  </>
                ) : (
                  <label>Single-phase meters dispatched<input type="number" min="0" style={{ ...inputStyle, border: letterLookup && Number(dispMeter) > (letterLookup.remaining_meter ?? Infinity) ? `1.5px solid ${COLOURS.RED}` : `1px solid ${COLOURS.HAIRLINE}`, opacity: letterLookup && isLetterExpired(letterLookup) ? 0.4 : 1, cursor: letterLookup && isLetterExpired(letterLookup) ? "not-allowed" : "auto", backgroundColor: letterLookup && isLetterExpired(letterLookup) ? COLOURS.CARD_ALT : undefined }} disabled={!!(letterLookup && isLetterExpired(letterLookup))} value={dispMeter} onChange={(e) => setDispMeter(e.target.value)} placeholder="0" /></label>
                )}
              </>
            )}
            {letterLookup && dispatchHasQty && !isLetterExpired(letterLookup) && (
              <>
                <label style={labelStyle}>Released by *<input type="text" style={inputStyle} value={releasedBy} onChange={(e) => setReleasedBy(e.target.value)} placeholder="Name of person who released from store" /></label>
                <label style={labelStyle}>Vehicle number (optional)<input type="text" style={inputStyle} value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="e.g. ABX-123" /></label>
              </>
            )}
            {availableLetters.length === 0 && plantId && (
              <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "8px", fontStyle: "italic" }}>No active authority letters — only "Nothing to report" can be recorded for this plant today.</p>
            )}
            <label style={labelStyle}>Notes (optional)
              <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" as const }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about this dispatch" />
            </label>
            <div style={btnRow}>
              <button type="button" onClick={() => submitDispatch(false)} disabled={savingSection === "dispatch" || !letterLookup || !!(letterLookup && isLetterExpired(letterLookup))} style={{ ...submitBtn("dispatch"), opacity: (!letterLookup || (letterLookup && isLetterExpired(letterLookup))) ? 0.4 : savingSection === "dispatch" ? 0.7 : 1, cursor: (!letterLookup || (letterLookup && isLetterExpired(letterLookup))) ? "not-allowed" : "pointer" }}>
                {savingSection === "dispatch" ? "Saving…" : "Submit Dispatch"}
              </button>
              <button type="button" onClick={() => submitDispatch(true)} disabled={savingSection === "dispatch"} style={nothingBtn}>Nothing to report</button>
            </div>
            <SectionMessage section="dispatch" />
          </div>
          <RecentEntries type="Dispatch" />
        </>
      )}

      {/* ── BREAKAGE ── */}
      {activeForm === "breakage" && plantId && !isMeter && (
        <>
          <div style={sectionStyle}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 4px" }}>⚠️ Breakage today</h2>
            <p style={hint}>Of the production above, how many broke? Pick a reason for each size that broke.</p>
            <label style={labelStyle}>31 ft broken<input type="number" min="0" style={inputStyle} value={brk31} onChange={(e) => setBrk31(e.target.value)} placeholder="0" /></label>
            {Number(brk31) > 0 && <ReasonSelect value={reason31} onChange={setReason31} size="31 ft" />}
            <label style={labelStyle}>36 ft broken<input type="number" min="0" style={inputStyle} value={brk36} onChange={(e) => setBrk36(e.target.value)} placeholder="0" /></label>
            {Number(brk36) > 0 && <ReasonSelect value={reason36} onChange={setReason36} size="36 ft" />}
            <label style={labelStyle}>45 ft broken<input type="number" min="0" style={inputStyle} value={brk45} onChange={(e) => setBrk45(e.target.value)} placeholder="0" /></label>
            {Number(brk45) > 0 && <ReasonSelect value={reason45} onChange={setReason45} size="45 ft" />}
            {(reason31 === "Other" || reason36 === "Other" || reason45 === "Other") && (
              <label style={labelStyle}>Other — please specify<input type="text" style={inputStyle} value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="Describe the other reason" /></label>
            )}
            <div style={btnRow}>
              <button type="button" onClick={() => submitBreakage(false)} disabled={savingSection === "breakage"} style={submitBtn("breakage")}>
                {savingSection === "breakage" ? "Saving…" : "Submit Breakage"}
              </button>
              <button type="button" onClick={() => submitBreakage(true)} disabled={savingSection === "breakage"} style={nothingBtn}>Nothing to report</button>
            </div>
            <SectionMessage section="breakage" />
          </div>
          <RecentEntries type="Breakage" />
        </>
      )}

      {/* ── SCRAP ── */}
      {activeForm === "scrap" && plantId && !isMeter && (
        <>
          <div style={sectionStyle}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 4px" }}>♻️ Scrap processed today</h2>
            <p style={hint}>Broken poles removed/processed. (Reduces broken-pole stock.)</p>
            <label style={labelStyle}>31 ft processed<input type="number" min="0" style={inputStyle} value={scr31} onChange={(e) => setScr31(e.target.value)} placeholder="0" /></label>
            <label style={labelStyle}>36 ft processed<input type="number" min="0" style={inputStyle} value={scr36} onChange={(e) => setScr36(e.target.value)} placeholder="0" /></label>
            <label style={labelStyle}>45 ft processed<input type="number" min="0" style={inputStyle} value={scr45} onChange={(e) => setScr45(e.target.value)} placeholder="0" /></label>
            <label style={labelStyle}>Notes (optional)
              <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" as const }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about scrap processing" />
            </label>
            <div style={btnRow}>
              <button type="button" onClick={() => submitScrap(false)} disabled={savingSection === "scrap"} style={submitBtn("scrap")}>
                {savingSection === "scrap" ? "Saving…" : "Submit Scrap"}
              </button>
              <button type="button" onClick={() => submitScrap(true)} disabled={savingSection === "scrap"} style={nothingBtn}>Nothing to report</button>
            </div>
            <SectionMessage section="scrap" />
          </div>
          <RecentEntries type="Scrap" />
        </>
      )}

      {/* ── MACHINE ── */}
      {activeForm === "machine" && plantId && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 4px" }}>🔧 Machine status today</h2>
          <p style={hint}>Report any machine that is down or partially working today. If everything is running normally, click "Nothing to report".</p>
          <label style={labelStyle}>Machine name<input type="text" style={inputStyle} value={machineName} onChange={(e) => setMachineName(e.target.value)} placeholder="e.g. Spinning Machine #2" /></label>
          <label style={labelStyle}>Status
            <select style={inputStyle} value={machineStatus} onChange={(e) => setMachineStatus(e.target.value)}>
              {MACHINE_STATUSES.map((s) => (<option key={s}>{s}</option>))}
            </select>
          </label>
          <label style={labelStyle}>Expected resolution<input type="text" style={inputStyle} value={machineExpectedResolution} onChange={(e) => setMachineExpectedResolution(e.target.value)} placeholder="e.g. Today 5pm / Tomorrow / Waiting for part" /></label>
          <label style={labelStyle}>Issue description<textarea style={{ ...inputStyle, height: "80px", resize: "vertical" as const }} value={machineDescription} onChange={(e) => setMachineDescription(e.target.value)} placeholder="What happened?" /></label>
          <label style={labelStyle}>Action taken<textarea style={{ ...inputStyle, height: "70px", resize: "vertical" as const }} value={machineActionTaken} onChange={(e) => setMachineActionTaken(e.target.value)} placeholder="What has been done so far?" /></label>
          <div style={btnRow}>
            <button type="button" onClick={() => submitMachine(false)} disabled={savingSection === "machine"} style={submitBtn("machine")}>
              {savingSection === "machine" ? "Saving…" : "Submit Machine Issue"}
            </button>
            <button type="button" onClick={() => submitMachine(true)} disabled={savingSection === "machine"} style={nothingBtn}>Nothing to report</button>
          </div>
          <SectionMessage section="machine" />
        </div>
      )}

    </div>
  );
}
