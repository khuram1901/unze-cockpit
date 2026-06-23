"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";
import { downloadCSV } from "../lib/exportUtils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

type Budget = {
  id: string;
  department: string;
  budget_month: string;
  category: string;
  budgeted_amount: number;
  actual_amount: number;
  notes: string | null;
};

const DEPARTMENTS = ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit", "Unze Trading Ops"];

export default function DepartmentBudgetsPage() {
  const isMobile = useMobile();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

  const [dept, setDept] = useState("");
  const [category, setCategory] = useState("");
  const [budgeted, setBudgeted] = useState("");
  const [actual, setActual] = useState("");
  const [notes, setNotes] = useState("");

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from("department_budgets").select("*").eq("budget_month", selectedMonth).order("department");
    setBudgets(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [selectedMonth]);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("department_budgets").upsert({
      department: dept, budget_month: selectedMonth, category,
      budgeted_amount: Number(budgeted) || 0, actual_amount: Number(actual) || 0,
      notes: notes || null,
    }, { onConflict: "department,budget_month,category" });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "department_budgets", `${dept} ${category} ${selectedMonth}`);
    showMsg("Budget saved.");
    setCategory(""); setBudgeted(""); setActual(""); setNotes("");
    loadData();
  }

  async function updateActual(id: string, value: number) {
    await supabase.from("department_budgets").update({ actual_amount: value }).eq("id", id);
    loadData();
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this budget entry?")) return;
    await supabase.from("department_budgets").delete().eq("id", id);
    loadData();
  }

  // Group by department
  const deptGroups = new Map<string, Budget[]>();
  for (const b of budgets) {
    if (!deptGroups.has(b.department)) deptGroups.set(b.department, []);
    deptGroups.get(b.department)!.push(b);
  }

  const totalBudgeted = budgets.reduce((s, b) => s + b.budgeted_amount, 0);
  const totalActual = budgets.reduce((s, b) => s + b.actual_amount, 0);
  const variance = totalBudgeted - totalActual;

  // Chart data
  const chartData = Array.from(deptGroups.entries()).map(([d, items]) => ({
    dept: d.length > 12 ? d.slice(0, 10) + "…" : d,
    Budgeted: items.reduce((s, i) => s + i.budgeted_amount, 0),
    Actual: items.reduce((s, i) => s + i.actual_amount, 0),
  }));

  return (
    <AuthWrapper>
      <RoleGuard allowedRoles={["Admin", "Executive"]}>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
            <PageHeader title="Department Budgets" subtitle="Track budgeted vs actual spending per department" />
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "14px" }} />
              <button onClick={() => setShowForm(!showForm)} style={{
                backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
                width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
              }} title="Add budget entry">{showForm ? "×" : "+"}</button>
            </div>
          </div>

          {message && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>{message}</div>
          )}

          {showForm && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>Add Budget Entry — {selectedMonth}</div>
              <form onSubmit={handleAdd}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: "8px" }}>
                  <label style={lbl}>Department <select style={inp} value={dept} onChange={(e) => setDept(e.target.value)} required><option value="">Select</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>
                  <label style={lbl}>Category <input style={inp} value={category} onChange={(e) => setCategory(e.target.value)} required placeholder="e.g. Salaries, Travel, Software" /></label>
                  <label style={lbl}>Budgeted (PKR) <input type="number" style={inp} value={budgeted} onChange={(e) => setBudgeted(e.target.value)} required placeholder="0" /></label>
                  <label style={lbl}>Actual (PKR) <input type="number" style={inp} value={actual} onChange={(e) => setActual(e.target.value)} placeholder="0" /></label>
                  <label style={lbl}>Notes <input style={inp} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
                </div>
                <button type="submit" disabled={saving} style={{ backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 700, cursor: "pointer", marginTop: "8px" }}>{saving ? "Saving..." : "Save"}</button>
              </form>
            </div>
          )}

          {!loading && (
            <>
              <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
                <CountCard label="Total Budgeted" value={Math.round(totalBudgeted)} color={COLOURS.BLUE} />
                <CountCard label="Total Actual" value={Math.round(totalActual)} color={totalActual > totalBudgeted ? COLOURS.RED : COLOURS.GREEN} />
                <CountCard label="Variance" value={Math.round(variance)} color={variance >= 0 ? COLOURS.GREEN : COLOURS.RED} />
              </div>

              {chartData.length > 0 && (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>Budget vs Actual by Department</div>
                    <button onClick={() => {
                      const headers = ["Department", "Category", "Budgeted", "Actual", "Variance", "Notes"];
                      const rows = budgets.map((b) => [b.department, b.category, String(b.budgeted_amount), String(b.actual_amount), String(b.budgeted_amount - b.actual_amount), b.notes || ""]);
                      downloadCSV(`dept-budgets-${selectedMonth}.csv`, headers, rows);
                    }} style={{ backgroundColor: "white", color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "4px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Export CSV</button>
                  </div>
                  <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 40)}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 5, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: COLOURS.SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                      <YAxis dataKey="dept" type="category" tick={{ fontSize: 12, fill: COLOURS.NAVY, fontWeight: 600 }} width={90} />
                      <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                      <Legend iconType="square" wrapperStyle={{ fontSize: "12px" }} />
                      <Bar dataKey="Budgeted" fill="#cbd5e1" name="Budgeted (grey)" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Actual" fill={totalActual > totalBudgeted ? COLOURS.RED : COLOURS.GREEN} name={`Actual (${totalActual > totalBudgeted ? "over" : "under"})`} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}

          {/* Department breakdown */}
          {!loading && Array.from(deptGroups.entries()).map(([deptName, items]) => {
            const dBudgeted = items.reduce((s, i) => s + i.budgeted_amount, 0);
            const dActual = items.reduce((s, i) => s + i.actual_amount, 0);
            const over = dActual > dBudgeted;
            return (
              <div key={deptName} style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${over ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "10px" }}>
                <div style={{ padding: "8px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{deptName}</span>
                  <div style={{ fontSize: "12px", display: "flex", gap: "10px" }}>
                    <span style={{ color: COLOURS.SLATE }}>Budget: PKR {dBudgeted.toLocaleString()}</span>
                    <span style={{ fontWeight: 700, color: over ? COLOURS.RED : COLOURS.GREEN }}>Actual: PKR {dActual.toLocaleString()}</span>
                  </div>
                </div>
                {items.map((b) => {
                  const itemOver = b.actual_amount > b.budgeted_amount;
                  return (
                    <div key={b.id} style={{ padding: "7px 14px", borderBottom: `1px solid ${COLOURS.LIGHT}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{b.category}</span>
                        {b.notes && <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "6px" }}>({b.notes})</span>}
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", flexShrink: 0 }}>
                        <span style={{ color: COLOURS.SLATE }}>PKR {b.budgeted_amount.toLocaleString()}</span>
                        <span style={{ fontWeight: 700, color: itemOver ? COLOURS.RED : COLOURS.GREEN }}>PKR {b.actual_amount.toLocaleString()}</span>
                        <input type="number" defaultValue={b.actual_amount} onBlur={(e) => { const v = Number(e.target.value); if (v !== b.actual_amount) updateActual(b.id, v); }}
                          style={{ width: "90px", padding: "3px 6px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "4px", fontSize: "12px" }} title="Update actual amount" />
                        <button onClick={() => deleteEntry(b.id)} style={{ background: "transparent", border: "none", color: COLOURS.RED, fontSize: "14px", cursor: "pointer" }} title="Delete">×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {!loading && budgets.length === 0 && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", color: COLOURS.SLATE, textAlign: "center" }}>No budget entries for {selectedMonth}.</div>
          )}
        </main>
      </RoleGuard>
    </AuthWrapper>
  );
}

const inp: React.CSSProperties = { display: "block", width: "100%", padding: "7px 10px", marginTop: "3px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" };
