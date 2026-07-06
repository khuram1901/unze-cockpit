"use client";

import { useState, useEffect } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { logAction } from "../lib/audit-log";
import { COLOURS, RADII, cardStyle, labelStyle, inputStyle as sharedInputStyle, primaryButtonStyle, SectionTitle } from "../lib/SharedUI";
import { canEditFinance, type UserCtx, type PermOverrides } from "../lib/permissions";
import DateInput from "../lib/DateInput";

type Plant = { id: string; name: string; type: string };
type PO = { id: string; customer_name: string; po_number: string; po_label: string; is_system_unallocated: boolean };
type AllocRow = { po_id: string; qty_31: string; qty_36: string; qty_40: string; qty_45: string; qty_meter: string };

const inputStyle: React.CSSProperties = {
  ...sharedInputStyle,
  marginTop: "4px",
  marginBottom: "8px",
};

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

  // PO allocation state
  const [pos, setPos] = useState<PO[]>([]);
  const [allocRows, setAllocRows] = useState<AllocRow[]>([]);
  const [allocSaving, setAllocSaving] = useState(false);
  const [allocMessage, setAllocMessage] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        setUserEmail(userData.user.email || "");
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

  // Load POs + existing allocations whenever plant changes
  useEffect(() => {
    if (!plantId) { setPos([]); setAllocRows([]); return; }
    async function loadPOs() {
      const [{ data: poData }, { data: existing }] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("id, customer_name, po_number, po_label, is_system_unallocated")
          .eq("plant_id", plantId)
          .eq("status", "Active")
          .order("is_system_unallocated", { ascending: true })
          .order("customer_name"),
        supabase
          .from("opening_stock_allocations")
          .select("po_id, qty_31, qty_36, qty_45, qty_meter")
          .eq("plant_id", plantId),
      ]);
      const poList = (poData || []) as PO[];
      setPos(poList);
      const existingMap = new Map((existing || []).map((r: { po_id: string; qty_31: number; qty_36: number; qty_45: number; qty_meter: number }) => [r.po_id, r]));
      setAllocRows(poList.map((po) => {
        const ex = existingMap.get(po.id);
        return {
          po_id: po.id,
          qty_31:    ex ? String(ex.qty_31)    : "",
          qty_36:    ex ? String(ex.qty_36)    : "",
          qty_40:    ex ? String((ex as unknown as Record<string,number>).qty_40 || "") : "",
          qty_45:    ex ? String(ex.qty_45)    : "",
          qty_meter: ex ? String(ex.qty_meter) : "",
        };
      }));
    }
    loadPOs();
  }, [plantId]);

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
    setMessage("Opening balances saved for " + selectedPlant?.name);
    setG31(""); setG36(""); setG45("");
    setB31(""); setB36(""); setB45("");
  }

  function updateAlloc(poId: string, field: keyof Omit<AllocRow, "po_id">, value: string) {
    setAllocRows((prev) => prev.map((r) => r.po_id === poId ? { ...r, [field]: value } : r));
  }

  async function handleAllocSave() {
    setAllocSaving(true);
    setAllocMessage("");

    const rows = allocRows
      .filter((r) => Number(r.qty_31) > 0 || Number(r.qty_36) > 0 || Number(r.qty_45) > 0 || Number(r.qty_meter) > 0);

    if (rows.length === 0) {
      setAllocMessage("No quantities entered — nothing saved.");
      setAllocSaving(false);
      return;
    }

    const upsertData = rows.map((r) => ({
      plant_id:  plantId,
      po_id:     r.po_id,
      as_of_date: asOfDate,
      qty_31:    Number(r.qty_31)    || 0,
      qty_36:    Number(r.qty_36)    || 0,
      qty_40:    Number(r.qty_40)    || 0,
      qty_45:    Number(r.qty_45)    || 0,
      qty_meter: Number(r.qty_meter) || 0,
      set_by:    userEmail,
    }));

    const { error } = await supabase
      .from("opening_stock_allocations")
      .upsert(upsertData, { onConflict: "plant_id,po_id" });

    setAllocSaving(false);

    if (error) {
      setAllocMessage("Error: " + error.message);
      return;
    }

    logAction("Created", "opening_stock_allocations", `PO stock allocations for ${selectedPlant?.name}`);
    setAllocMessage("PO stock allocations saved for " + selectedPlant?.name);
  }

  if (!canEdit) {
    return (
      <p style={{ color: COLOURS.RED, fontSize: "14px" }}>
        You don&apos;t have permission to set opening balances.
      </p>
    );
  }

  const asOfDateUK = asOfDate ? asOfDate.split("-").reverse().join("/") : "";

  // Totals for the allocation validation banner
  const totalGood = (Number(g31) || 0) + (Number(g36) || 0) + (Number(g45) || 0);
  const totalAllocated = allocRows.reduce(
    (s, r) => s + (Number(r.qty_31) || 0) + (Number(r.qty_36) || 0) + (Number(r.qty_40) || 0) + (Number(r.qty_45) || 0) + (Number(r.qty_meter) || 0), 0
  );
  const allocDiff = totalGood - totalAllocated;

  return (
    <div style={{ maxWidth: "600px" }}>
      {/* ── Section 1: Plant-level opening stock ── */}
      <form onSubmit={handleSubmit}>
        <div style={{ ...cardStyle, marginBottom: "12px" }}>
          <label style={labelStyle}>
            Plant
            <select style={inputStyle} value={plantId} onChange={(e) => setPlantId(e.target.value)} required>
              <option value="">— Select plant —</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            As of date
            <DateInput style={inputStyle} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} required />
            {asOfDate && <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", display: "block" }}>{asOfDateUK}</span>}
          </label>
        </div>

        {plantId && (
          <>
            {/* Good stock — left green rule */}
            <div style={{ ...cardStyle, borderLeft: `3px solid ${COLOURS.GREEN}`, marginBottom: "12px" }}>
              <SectionTitle title="Good pole opening stock" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "10px", marginTop: "12px" }}>
                <label style={labelStyle}>31 ft<input type="number" min="0" style={inputStyle} value={g31} onChange={(e) => setG31(e.target.value)} placeholder="0" /></label>
                <label style={labelStyle}>36 ft<input type="number" min="0" style={inputStyle} value={g36} onChange={(e) => setG36(e.target.value)} placeholder="0" /></label>
                <label style={labelStyle}>45 ft<input type="number" min="0" style={inputStyle} value={g45} onChange={(e) => setG45(e.target.value)} placeholder="0" /></label>
              </div>
            </div>

            {/* Broken stock — left amber rule */}
            <div style={{ ...cardStyle, borderLeft: `3px solid ${COLOURS.AMBER}`, marginBottom: "16px" }}>
              <SectionTitle title="Broken pole opening stock" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "10px", marginTop: "12px" }}>
                <label style={labelStyle}>31 ft<input type="number" min="0" style={inputStyle} value={b31} onChange={(e) => setB31(e.target.value)} placeholder="0" /></label>
                <label style={labelStyle}>36 ft<input type="number" min="0" style={inputStyle} value={b36} onChange={(e) => setB36(e.target.value)} placeholder="0" /></label>
                <label style={labelStyle}>45 ft<input type="number" min="0" style={inputStyle} value={b45} onChange={(e) => setB45(e.target.value)} placeholder="0" /></label>
              </div>
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={saving || !plantId}
          style={{ ...primaryButtonStyle, opacity: !plantId ? 0.5 : saving ? 0.7 : 1, cursor: saving || !plantId ? "not-allowed" : "pointer" }}
        >
          {saving ? "Saving…" : "Save Opening Balances"}
        </button>

        {message && (
          <p style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN }}>
            {message}
          </p>
        )}
      </form>

      {/* ── Section 2: Allocate opening stock to POs ── */}
      {plantId && pos.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <div style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, marginBottom: "16px", paddingBottom: "8px" }}>
            <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Allocate Opening Stock to POs</div>
            <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "4px" }}>
              Split the good-pole opening stock across your active POs so the Stock page shows correct per-PO balances.
              Enter how many poles of each size belong to each PO.
            </div>
          </div>

          {/* Validation banner — only shown once user has entered a plant-level total */}
          {totalGood > 0 && (
            <div style={{
              padding: "10px 14px", borderRadius: RADII.SM, marginBottom: "14px", fontSize: "13px", fontWeight: 600,
              backgroundColor: allocDiff === 0 ? COLOURS.SUCCESS_SOFT : allocDiff < 0 ? COLOURS.DANGER_SOFT : COLOURS.WARNING_SOFT,
              color: allocDiff === 0 ? COLOURS.GREEN : allocDiff < 0 ? COLOURS.RED : COLOURS.AMBER,
              border: `1px solid ${allocDiff === 0 ? COLOURS.GREEN : allocDiff < 0 ? COLOURS.RED : COLOURS.AMBER}`,
            }}>
              {allocDiff === 0
                ? `All ${totalGood.toLocaleString()} poles allocated — totals match.`
                : allocDiff > 0
                ? `${allocDiff.toLocaleString()} poles not yet allocated (plant total: ${totalGood.toLocaleString()}, allocated: ${totalAllocated.toLocaleString()})`
                : `Over-allocated by ${Math.abs(allocDiff).toLocaleString()} poles — reduce quantities below.`
              }
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {pos.map((po) => {
              const row = allocRows.find((r) => r.po_id === po.id);
              if (!row) return null;
              const poTotal = (Number(row.qty_31) || 0) + (Number(row.qty_36) || 0) + (Number(row.qty_45) || 0) + (Number(row.qty_meter) || 0);
              return (
                <div key={po.id} style={{ ...cardStyle, borderLeft: `3px solid ${po.is_system_unallocated ? COLOURS.AMBER : COLOURS.NAVY}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px", flexWrap: "wrap", gap: "4px" }}>
                    <div>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>
                        {po.is_system_unallocated ? "Unze Unallocated Stock" : `${po.customer_name} — PO #${po.po_number}`}
                      </span>
                      {po.po_label && !po.is_system_unallocated && (
                        <span style={{ marginLeft: "8px", fontSize: "11px", padding: "2px 8px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.INK_700, fontWeight: 600, border: `1px solid ${COLOURS.HAIRLINE}` }}>
                          {po.po_label}
                        </span>
                      )}
                    </div>
                    {poTotal > 0 && (
                      <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, fontFamily: "var(--font-mono)" }}>{poTotal.toLocaleString()} poles</span>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                    {(["qty_31", "qty_36", "qty_40", "qty_45", "qty_meter"] as const).map((field) => (
                      <label key={field} style={labelStyle}>
                        {field === "qty_31" ? "31 ft" : field === "qty_36" ? "36 ft" : field === "qty_40" ? "40 ft" : field === "qty_45" ? "45 ft" : "Meter"}
                        <input
                          type="number" min="0" placeholder="0"
                          value={row[field]}
                          onChange={(e) => updateAlloc(po.id, field, e.target.value)}
                          style={inputStyle}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <button
              onClick={handleAllocSave}
              disabled={allocSaving}
              style={{ ...primaryButtonStyle, opacity: allocSaving ? 0.7 : 1, cursor: allocSaving ? "not-allowed" : "pointer" }}
            >
              {allocSaving ? "Saving…" : "Save PO Allocations"}
            </button>
            {allocMessage && (
              <span style={{ fontSize: "13px", fontWeight: 600, color: allocMessage.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN }}>
                {allocMessage}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
