"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions, authFetch } from "../lib/supabase";
import { COMPANIES, getCompanyByName } from "../lib/constants";
import { COLOURS, PageHeader, SectionTitle, useToast, useConfirm, SkeletonRows } from "../lib/SharedUI";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";
import { logAction } from "../lib/audit-log";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";
import { canEditFinance, isAdminTier, type UserCtx, type PermOverrides } from "../lib/permissions";
import * as XLSX from "xlsx";

type Budget = {
  id: string;
  company_id: string | null;
  department: string;
  budget_month: string;
  category: string;
  budgeted_amount: number;
  actual_amount: number;
  notes: string | null;
};

const COMPANY_DEPARTMENTS: Record<string, string[]> = {
  "15884c2d-48a4-4d43-be90-0ef6e130790c": ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit", "Unze Trading Ops"],
  "77921705-8a15-4406-847a-b234f84b5ec3": ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit"],
};

function deptsForCompany(companyId: string): string[] {
  return COMPANY_DEPARTMENTS[companyId] || ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit"];
}

const COMPANY_CATEGORIES: Record<string, string[]> = {
  "15884c2d-48a4-4d43-be90-0ef6e130790c": ["Salaries", "Rent/Utilities", "Admin", "Welfare", "Freight", "Travel"],
  "77921705-8a15-4406-847a-b234f84b5ec3": ["Salaries", "Rent/Utilities", "Admin", "Marketing", "Freight", "Travel"],
};

function catsForCompany(companyId: string): string[] {
  return COMPANY_CATEGORIES[companyId] || ["Salaries", "Rent/Utilities", "Admin", "Freight", "Travel"];
}

const ALL_CATEGORIES = [...new Set(Object.values(COMPANY_CATEGORIES).flat())];

function downloadBudgetTemplate() {
  const wb = XLSX.utils.book_new();

  const dataRows = [
    ["Company", "Department", "Category", "Budgeted", "Actual", "Notes"],
    ["UTPL", "Finance", "Salaries", 0, 0, ""],
    ["IFPL", "Finance", "Salaries", 0, 0, ""],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(dataRows);
  ws1["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Budget Data");

  const notesRows = [
    ["INSTRUCTIONS"],
    [""],
    ["Copy and paste values from the lists below into the Budget Data sheet."],
    ["All values must match exactly — incorrect entries will be rejected."],
    [""],
    ["═══════════════════════════════"],
    ["COMPANY CODES (copy one per row)"],
    ["═══════════════════════════════"],
    ["UTPL"],
    ["IFPL"],
    [""],
    ["UTPL = Unze Trading PVT Limited"],
    ["IFPL = Imperial Footwear PVT Limited"],
    [""],
    ["═══════════════════════════════════"],
    ["DEPARTMENTS — UTPL (copy one per row)"],
    ["═══════════════════════════════════"],
    ...COMPANY_DEPARTMENTS["15884c2d-48a4-4d43-be90-0ef6e130790c"].map((d) => [d]),
    [""],
    ["═══════════════════════════════════"],
    ["DEPARTMENTS — IFPL (copy one per row)"],
    ["═══════════════════════════════════"],
    ...COMPANY_DEPARTMENTS["77921705-8a15-4406-847a-b234f84b5ec3"].map((d) => [d]),
    [""],
    ["══════════════════════════════════"],
    ["CATEGORIES — UTPL (copy one per row)"],
    ["══════════════════════════════════"],
    ...COMPANY_CATEGORIES["15884c2d-48a4-4d43-be90-0ef6e130790c"].map((c) => [c]),
    [""],
    ["══════════════════════════════════"],
    ["CATEGORIES — IFPL (copy one per row)"],
    ["══════════════════════════════════"],
    ...COMPANY_CATEGORIES["77921705-8a15-4406-847a-b234f84b5ec3"].map((c) => [c]),
    [""],
    ["═══════════════"],
    ["HOW TO USE"],
    ["═══════════════"],
    ["1. Go to the 'Budget Data' sheet"],
    ["2. Each row = one department + category entry"],
    ["3. Copy Company, Department, and Category from this sheet"],
    ["4. Enter Budgeted and Actual amounts in PKR"],
    ["5. Delete the example rows and add your own"],
    ["6. Save and upload on the Finance page"],
    [""],
    ["Duplicate rows (same company + department + category) update existing entries."],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(notesRows);
  ws2["!cols"] = [{ wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Instructions");

  XLSX.writeFile(wb, "dept-budget-template.xlsx");
}

function companyShortName(companyId: string): string {
  const c = COMPANIES.find((x) => x.id === companyId);
  return c?.shortCode || "?";
}

export default function FinancePage() {
  const router = useRouter();
  const isMobile = useMobile();
  const { checking } = useRequireCapability("finance");
  const toast = useToast();
  const dlg = useConfirm();
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  const [showBudgets, setShowBudgets] = useState(false);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetMonth, setBudgetMonth] = useState(new Date().toISOString().slice(0, 7));
  const [budgetCompany, setBudgetCompany] = useState(COMPANIES[0]?.id || "");
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [bdDept, setBdDept] = useState("");
  const [bdCategory, setBdCategory] = useState("");
  const [bdBudgeted, setBdBudgeted] = useState("");
  const [bdActual, setBdActual] = useState("");
  const [bdNotes, setBdNotes] = useState("");
  const [bdSaving, setBdSaving] = useState(false);
  const [bdMsg, setBdMsg] = useState("");

  useEffect(() => {
    async function checkAndRedirect() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) { setLoading(false); return; }

      const { data: member } = await supabase
        .from("members")
        .select("id, role, department, company")
        .eq("email", user.email)
        .single();

      if (!member) { setLoading(false); return; }

      let overrides: PermOverrides | null = null;
      const p = await loadMyPermissions();
      if (p) overrides = p as PermOverrides;
      const ctx: UserCtx = { email: user.email, role: member.role, department: member.department, company: member.company, overrides };
      setIsAdmin(isAdminTier(ctx));
      setCanEdit(canEditFinance(ctx));

      if (member.role === "Manager" && member.department === "Finance" && member.company) {
        const config = getCompanyByName(member.company);
        if (config) {
          router.replace(`/finance/${config.slug}`);
          return;
        }
      }

      setShowPicker(true);
      setLoading(false);
    }

    checkAndRedirect();
  }, [router]);

  async function loadBudgets(cId?: string, month?: string) {
    const c = cId || budgetCompany;
    const m = month || budgetMonth;
    const { data } = await supabase.from("department_budgets").select("*").eq("company_id", c).eq("budget_month", m).order("department");
    setBudgets(data || []);
  }

  async function handleBulkUpload(e: React.FormEvent) {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).querySelector('input[type="file"]') as HTMLInputElement;
    const files = input?.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setBulkMsg(`Uploading ${files.length} file(s)...`);
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append("files", files[i]);
    try {
      const res = await authFetch("/api/finance/bulk-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok) {
        const details = (data.results || []).map((r: { filename: string; status: string; date?: string; company?: string }) =>
          `${(r.company || "?").padEnd(10)} ${r.date || "?"} ${r.status} — ${r.filename}`
        ).join("\n");
        setBulkMsg(`Done: ${data.saved} saved, ${data.errors} errors out of ${data.total} files.`);
        if (data.results) toast.show("Upload: " + details, "success");
        input.value = "";
      } else {
        setBulkMsg("Error: " + (data.error || "Upload failed"));
      }
    } catch { setBulkMsg("Error: Network error"); }
    setUploading(false);
  }

  async function handleAddBudget(e: React.FormEvent) {
    e.preventDefault();
    setBdSaving(true);
    const { error } = await supabase.from("department_budgets").upsert({
      company_id: budgetCompany, department: bdDept, budget_month: budgetMonth, category: bdCategory,
      budgeted_amount: Number(bdBudgeted) || 0, actual_amount: Number(bdActual) || 0, notes: bdNotes || null,
    }, { onConflict: "company_id,department,budget_month,category" });
    setBdSaving(false);
    if (error) { setBdMsg("Error: " + error.message); return; }
    logAction("Created", "department_budgets", `${bdDept} ${bdCategory} ${budgetMonth}`);
    setBdCategory(""); setBdBudgeted(""); setBdActual(""); setBdNotes("");
    loadBudgets();
  }

  async function updateBudgetActual(id: string, value: number) {
    await supabase.from("department_budgets").update({ actual_amount: value }).eq("id", id);
    loadBudgets();
  }

  async function deleteBudgetEntry(id: string) {
    if (!await dlg.confirm("Delete this budget entry?", true)) return;
    await supabase.from("department_budgets").delete().eq("id", id);
    loadBudgets();
  }

  const validDepts = deptsForCompany(budgetCompany);
  const validCats = catsForCompany(budgetCompany);

  const budgetGroups = new Map<string, Budget[]>();
  for (const b of budgets) { if (!budgetGroups.has(b.department)) budgetGroups.set(b.department, []); budgetGroups.get(b.department)!.push(b); }
  const totalBudgeted = budgets.reduce((s, b) => s + b.budgeted_amount, 0);
  const totalActual = budgets.reduce((s, b) => s + b.actual_amount, 0);
  const variance = totalBudgeted - totalActual;

  if (checking) return null;

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "14px 18px", maxWidth: "100%", minWidth: 0 }}>
          <SkeletonRows count={3} height="60px" />
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      {toast.element}
      {dlg.element}
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />

        {showPicker && (
          <>
            <SectionTitle title="Select Company" />
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "14px",
              maxWidth: "600px",
              marginBottom: "20px",
            }}>
              {COMPANIES.map((c) => (
                <a
                  key={c.slug}
                  href={`/finance/${c.slug}`}
                  style={{
                    textDecoration: "none",
                    border: `1px solid ${COLOURS.HAIRLINE}`,
                    borderRadius: "14px",
                    padding: "20px",
                    backgroundColor: COLOURS.CARD,
                    cursor: "pointer",
                    display: "block",
                  }}
                >
                  <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                    View cash position, daily entries &amp; forecasts
                  </div>
                </a>
              ))}
            </div>

            {isAdmin && (
              <>
                <SectionTitle title="Bulk Upload Cash Flow PDFs" />
                <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "14px", padding: "24px", backgroundColor: COLOURS.CARD, maxWidth: "600px" }}>
                  <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "14px", lineHeight: 1.5 }}>
                    Select multiple cash flow PDFs — system auto-detects which company each PDF belongs to (Imperial vs Unze Trading) and saves to the correct account.
                  </p>
                  <form onSubmit={handleBulkUpload}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <input type="file" accept=".pdf" multiple style={{ fontSize: "13px" }} />
                      <button type="submit" disabled={uploading} style={{
                        backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "999px",
                        padding: "7px 18px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                        opacity: uploading ? 0.5 : 1,
                      }}>{uploading ? "Uploading..." : "Upload All"}</button>
                    </div>
                  </form>
                  {bulkMsg && (
                    <div style={{ marginTop: "10px", fontSize: "13px", fontWeight: 600, color: bulkMsg.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN }}>{bulkMsg}</div>
                  )}
                </div>
              </>
            )}

            {/* Department Budgets */}
            <div style={{ marginTop: "20px", maxWidth: "600px" }}>
              <div onClick={() => { setShowBudgets(!showBudgets); if (!showBudgets) loadBudgets(); }} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: showBudgets ? "14px 14px 0 0" : "14px",
                padding: "16px 20px",
                backgroundColor: showBudgets ? COLOURS.NAVY : COLOURS.CARD,
              }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: showBudgets ? "white" : COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Department Budgets</div>
                  <div style={{ fontSize: "12px", color: showBudgets ? "rgba(255,255,255,0.6)" : COLOURS.SLATE, marginTop: "2px" }}>Budgeted vs actual spending per department, per company</div>
                </div>
                <span style={{ color: showBudgets ? "rgba(255,255,255,0.7)" : COLOURS.SLATE, fontSize: "12px" }}>{showBudgets ? "▲" : "▼"}</span>
              </div>

              {showBudgets && (
                <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: "none", borderRadius: "0 0 14px 14px", backgroundColor: COLOURS.CARD, padding: "20px" }}>
                  {/* Company + Month selector */}
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
                    <select value={budgetCompany} onChange={(e) => { setBudgetCompany(e.target.value); setBdDept(""); loadBudgets(e.target.value); }}
                      style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", fontSize: "13px" }}>
                      {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.shortCode}</option>)}
                    </select>
                    <input type="month" value={budgetMonth} onChange={(e) => { setBudgetMonth(e.target.value); loadBudgets(undefined, e.target.value); }}
                      style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", fontSize: "13px" }} />
                    <button onClick={() => setShowBudgetForm(!showBudgetForm)} style={{
                      backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "999px",
                      padding: "6px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                    }}>{showBudgetForm ? "Cancel" : "+ Add"}</button>
                    <ImportExportButtons
                      onExport={() => {
                        const headers = ["Company", "Department", "Category", "Budgeted", "Actual", "Notes"];
                        const rows = budgets.map((b) => [companyShortName(budgetCompany), b.department, b.category, String(b.budgeted_amount), String(b.actual_amount), b.notes || ""]);
                        downloadCSV(`dept-budgets-${companyShortName(budgetCompany)}-${budgetMonth}.csv`, headers, rows);
                      }}
                      onImport={async (rows) => {
                        const errors: string[] = [];
                        const validRows: { company: string; dept: string; cat: string; budgeted: number; actual: number; notes: string }[] = [];
                        const validCompanyCodes = COMPANIES.map((c) => c.shortCode);

                        for (let i = 0; i < rows.length; i++) {
                          const row = rows[i];
                          const line = i + 2;
                          const cId = row["Company"]?.trim();
                          const dept = row["Department"]?.trim();
                          const cat = row["Category"]?.trim();
                          if (!cId && !dept && !cat) continue;
                          if (!cId || !validCompanyCodes.includes(cId)) { errors.push(`Row ${line}: Invalid company "${cId || "(empty)"}". Must be ${validCompanyCodes.join(" or ")}`); continue; }
                          const targetCompany = COMPANIES.find((c) => c.shortCode === cId)!.id;
                          const targetDepts = deptsForCompany(targetCompany);
                          if (!dept || !targetDepts.includes(dept)) { errors.push(`Row ${line}: Invalid department "${dept || "(empty)"}" for ${cId}. Must be one of: ${targetDepts.join(", ")}`); continue; }
                          const validCats = catsForCompany(targetCompany);
                          if (!cat || !validCats.includes(cat)) { errors.push(`Row ${line}: Invalid category "${cat || "(empty)"}" for ${cId}. Must be one of: ${validCats.join(", ")}`); continue; }
                          validRows.push({ company: targetCompany, dept, cat, budgeted: Number(row["Budgeted"]) || 0, actual: Number(row["Actual"]) || 0, notes: row["Notes"]?.trim() || "" });
                        }

                        if (errors.length > 0) {
                          toast.show(`Upload rejected — ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` ...and ${errors.length - 5} more` : ""}`, "error");
                          return;
                        }

                        if (validRows.length === 0) { toast.show("No valid data rows found in the file.", "error"); return; }

                        for (const r of validRows) {
                          await supabase.from("department_budgets").upsert({
                            company_id: r.company, department: r.dept, budget_month: budgetMonth, category: r.cat,
                            budgeted_amount: r.budgeted, actual_amount: r.actual, notes: r.notes || null,
                          }, { onConflict: "company_id,department,budget_month,category" });
                        }
                        setBdMsg(`Imported ${validRows.length} budget entries.`);
                        setTimeout(() => setBdMsg(""), 4000);
                        loadBudgets();
                      }}
                      templateHeaders={["Company", "Department", "Category", "Budgeted", "Actual", "Notes"]}
                      templateFilename="dept-budget-import-template.csv"
                      exportLabel="Export"
                      importLabel="Import"
                    />
                    <button onClick={downloadBudgetTemplate} style={{
                      backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, border: `1px solid ${COLOURS.HAIRLINE}`,
                      borderRadius: "999px", padding: "6px 14px", fontSize: "12px", fontWeight: 500, cursor: "pointer",
                    }} title="Download Excel template with instructions">Template</button>
                  </div>

                  {bdMsg && (
                    <div style={{ fontSize: "13px", fontWeight: 600, color: bdMsg.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN, marginBottom: "10px" }}>{bdMsg}</div>
                  )}

                  {/* Add form */}
                  {showBudgetForm && (
                    <form onSubmit={handleAddBudget} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px", marginBottom: "14px", backgroundColor: COLOURS.CARD_ALT }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
                        <div><label style={lbl}>Department</label>
                          <select style={inp} value={bdDept} onChange={(e) => setBdDept(e.target.value)} required>
                            <option value="">Select</option>{validDepts.map((d) => <option key={d}>{d}</option>)}
                          </select>
                        </div>
                        <div><label style={lbl}>Category</label>
                          <select style={inp} value={bdCategory} onChange={(e) => setBdCategory(e.target.value)} required>
                            <option value="">Select</option>
                            {validCats.map((c) => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                        <div><label style={lbl}>Budgeted (PKR)</label>
                          <input type="number" style={inp} value={bdBudgeted} onChange={(e) => setBdBudgeted(e.target.value)} required placeholder="0" />
                        </div>
                        <div><label style={lbl}>Actual (PKR)</label>
                          <input type="number" style={inp} value={bdActual} onChange={(e) => setBdActual(e.target.value)} placeholder="0" />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Notes</label>
                          <input style={inp} value={bdNotes} onChange={(e) => setBdNotes(e.target.value)} placeholder="Optional" />
                        </div>
                      </div>
                      <button type="submit" disabled={bdSaving} style={{
                        backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "999px",
                        padding: "7px 18px", fontSize: "13px", fontWeight: 600, cursor: "pointer", marginTop: "10px",
                        opacity: bdSaving ? 0.5 : 1,
                      }}>{bdSaving ? "Saving..." : "Save"}</button>
                    </form>
                  )}

                  {/* Company codes reference */}
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginBottom: "10px" }}>
                    {COMPANIES.map((c) => <span key={c.id} style={{ marginRight: "12px" }}><strong>{c.shortCode}</strong> = {c.name}</span>)}
                  </div>

                  {/* Summary cards */}
                  {budgets.length > 0 && (
                    <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
                      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "8px 14px", backgroundColor: COLOURS.CARD_ALT }}>
                        <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Budgeted</div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.BLUE, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontVariantNumeric: "tabular-nums" }}>PKR {totalBudgeted.toLocaleString()}</div>
                      </div>
                      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "8px 14px", backgroundColor: COLOURS.CARD_ALT }}>
                        <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Actual</div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: totalActual > totalBudgeted ? COLOURS.RED : COLOURS.GREEN, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontVariantNumeric: "tabular-nums" }}>PKR {totalActual.toLocaleString()}</div>
                      </div>
                      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "8px 14px", backgroundColor: COLOURS.CARD_ALT }}>
                        <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Variance</div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: variance >= 0 ? COLOURS.GREEN : COLOURS.RED, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontVariantNumeric: "tabular-nums" }}>PKR {variance.toLocaleString()}</div>
                      </div>
                    </div>
                  )}

                  {/* Budget entries by department */}
                  {Array.from(budgetGroups.entries()).map(([deptName, items]) => {
                    const dB = items.reduce((s, i) => s + i.budgeted_amount, 0);
                    const dA = items.reduce((s, i) => s + i.actual_amount, 0);
                    const over = dA > dB;
                    return (
                      <div key={deptName} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", marginBottom: "8px" }}>
                        <div style={{ padding: "8px 14px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{deptName}</span>
                          <div style={{ fontSize: "11px", display: "flex", gap: "8px" }}>
                            <span style={{ color: COLOURS.SLATE }}>Budget: PKR {dB.toLocaleString()}</span>
                            <span style={{ fontWeight: 600, color: over ? COLOURS.RED : COLOURS.GREEN }}>Actual: PKR {dA.toLocaleString()}</span>
                          </div>
                        </div>
                        {items.map((b) => (
                          <div key={b.id} style={{ padding: "6px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: "13px", fontWeight: 500, color: COLOURS.NAVY }}>{b.category}</span>
                              {b.notes && <span style={{ fontSize: "11px", color: COLOURS.SLATE, marginLeft: "4px" }}>({b.notes})</span>}
                            </div>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", flexShrink: 0, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>
                              <span style={{ color: COLOURS.SLATE }}>PKR {b.budgeted_amount.toLocaleString()}</span>
                              <input type="number" defaultValue={b.actual_amount} onBlur={(e) => { const v = Number(e.target.value); if (v !== b.actual_amount) updateBudgetActual(b.id, v); }}
                                style={{ width: "80px", padding: "3px 6px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12px" }} title="Update actual" />
                              {canEdit && <button onClick={() => deleteBudgetEntry(b.id)} style={{ background: "transparent", border: "none", color: COLOURS.RED, fontSize: "14px", cursor: "pointer" }} title="Delete">×</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {budgets.length === 0 && (
                    <div style={{ padding: "14px", color: COLOURS.SLATE, textAlign: "center", fontSize: "13px" }}>No budget entries for {companyShortName(budgetCompany)} — {budgetMonth}.</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

const inp: React.CSSProperties = { display: "block", width: "100%", padding: "7px 10px", marginTop: "4px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", fontSize: "13px", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" } as React.CSSProperties;
