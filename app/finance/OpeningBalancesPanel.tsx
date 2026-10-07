"use client";

/**
 * OpeningBalancesPanel — slide-in panel listing all stores with their
 * opening balance for the selected month, with inline set/edit forms.
 */

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";

interface StoreBalance {
  id: string;
  fm_code: string;
  name: string;
  balance: {
    amount: number;
    opening_date: string;
    notes: string | null;
  } | null;
}

interface Props {
  year: number;
  month: number;
  onClose: () => void;
  onSaved: () => void;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export default function OpeningBalancesPanel({ year, month, onClose, onSaved }: Props) {
  const [stores, setStores] = useState<StoreBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // store_id being edited
  const [form, setForm] = useState({ amount: "", date: "", reason: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/daily-sales/opening-balances?year=${year}&month=${month}`);
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        setError(j.error ?? "Failed to load");
        return;
      }
      const j = await res.json() as { stores: StoreBalance[] };
      setStores(j.stores ?? []);
    } finally {
      setLoading(false);
    }
  }

  function beginEdit(s: StoreBalance) {
    setEditing(s.id);
    setSaveError(null);
    if (s.balance) {
      setForm({
        amount: String(s.balance.amount),
        date: s.balance.opening_date,
        reason: "",
        notes: s.balance.notes ?? "",
      });
    } else {
      // Default date = first day of month
      const d = `${year}-${String(month).padStart(2,"0")}-01`;
      setForm({ amount: "", date: d, reason: "", notes: "" });
    }
  }

  async function save(s: StoreBalance) {
    const amountNum = parseFloat(form.amount);
    if (isNaN(amountNum)) { setSaveError("Enter a valid amount"); return; }
    if (!form.date) { setSaveError("Enter a date"); return; }
    const isEdit = !!s.balance;
    if (isEdit && !form.reason.trim()) { setSaveError("Reason is required when editing an existing balance"); return; }

    setSaving(true);
    setSaveError(null);
    try {
      const body = isEdit
        ? { store_id: s.id, amount: amountNum, opening_date: form.date, reason: form.reason, notes: form.notes || undefined }
        : { store_id: s.id, amount: amountNum, opening_date: form.date, notes: form.notes || undefined };

      const res = await apiFetch(
        "/api/daily-sales/opening-balances",
        { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        setSaveError(j.error ?? "Save failed");
        return;
      }
      setEditing(null);
      await load();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.25)", zIndex: 200,
  };
  const panel: React.CSSProperties = {
    position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "100vw",
    background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,.12)", zIndex: 201,
    display: "flex", flexDirection: "column", overflowY: "auto",
  };

  return (
    <>
      <div style={overlay} onClick={onClose} />
      <div style={panel}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #EEF0F3", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F1720" }}>Opening Balances</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
              {MONTHS[month - 1]} {year} · All stores
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#64748B", lineHeight: 1, fontFamily: "inherit" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "16px 24px", overflowY: "auto" }}>
          {loading && <div style={{ color: "#64748B", fontSize: 13 }}>Loading…</div>}
          {error && <div style={{ color: "#B3261E", fontSize: 13 }}>{error}</div>}
          {!loading && !error && stores.map((s) => {
            const isEditing = editing === s.id;
            const hasBalance = !!s.balance;

            return (
              <div key={s.id} style={{ marginBottom: 12, padding: "12px 16px", border: "1px solid #EEF0F3", borderRadius: 10, background: hasBalance ? "#F0FBF7" : "#FAFBFC" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F1720" }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>FM {s.fm_code}</div>
                  </div>
                  {hasBalance && !isEditing && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1720" }}>
                        ₨ {s.balance!.amount.toLocaleString("en-PK")}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748B" }}>{formatDateUK(s.balance!.opening_date)}</div>
                    </div>
                  )}
                  {!isEditing && (
                    <button
                      onClick={() => beginEdit(s)}
                      style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid #EEF0F3", background: "#fff", color: "#0F1720", fontFamily: "inherit", whiteSpace: "nowrap" }}
                    >
                      {hasBalance ? "Edit" : "Set"}
                    </button>
                  )}
                </div>

                {isEditing && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#64748B", display: "flex", flexDirection: "column", gap: 4 }}>
                        Amount (₨)
                        <input
                          type="number"
                          value={form.amount}
                          onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
                          style={{ padding: "7px 10px", border: "1px solid #EEF0F3", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
                          placeholder="0"
                        />
                      </label>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#64748B", display: "flex", flexDirection: "column", gap: 4 }}>
                        Opening Date
                        <input
                          type="date"
                          value={form.date}
                          onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                          style={{ padding: "7px 10px", border: "1px solid #EEF0F3", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
                        />
                      </label>
                    </div>
                    {hasBalance && (
                      <label style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: "#64748B", display: "flex", flexDirection: "column", gap: 4 }}>
                        Reason for change *
                        <input
                          type="text"
                          value={form.reason}
                          onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}
                          style={{ padding: "7px 10px", border: "1px solid #EEF0F3", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
                          placeholder="Required"
                        />
                      </label>
                    )}
                    <label style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: "#64748B", display: "flex", flexDirection: "column", gap: 4 }}>
                      Notes (optional)
                      <input
                        type="text"
                        value={form.notes}
                        onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                        style={{ padding: "7px 10px", border: "1px solid #EEF0F3", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
                        placeholder="Optional notes"
                      />
                    </label>
                    {saveError && <div style={{ marginTop: 8, fontSize: 12, color: "#B3261E" }}>{saveError}</div>}
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button
                        onClick={() => void save(s)}
                        disabled={saving}
                        style={{ flex: 1, padding: "8px 0", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: saving ? "default" : "pointer", border: "none", background: "#0F1720", color: "#fff", fontFamily: "inherit", opacity: saving ? 0.6 : 1 }}
                      >
                        {saving ? "Saving…" : hasBalance ? "Update Balance" : "Set Balance"}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        disabled={saving}
                        style={{ padding: "8px 16px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #EEF0F3", background: "#fff", color: "#64748B", fontFamily: "inherit" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
