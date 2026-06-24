"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COMPANIES, getCompanyByName } from "../lib/constants";
import { COLOURS, PageHeader, SectionTitle } from "../lib/SharedUI";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";
import { logAction } from "../lib/audit-log";
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

const COMMON_CATEGORIES = ["Salaries", "Utilities", "Rent", "Travel", "Software", "Maintenance", "Raw Materials", "Freight", "Insurance", "Marketing", "Professional Fees", "Miscellaneous"];

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
    ["═══════════════════════════"],
    ["CATEGORIES (copy one per row)"],
    ["═══════════════════════════"],
    ...COMMON_CATEGORIES.map((c) => [c]),
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
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
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
        .select("role, department, company")
        .eq("email", user.email)
        .single();

      if (!member) { setLoading(false); return; }

      setIsAdmin(member.role === "Admin" || member.role === "Executive");

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
      const res = await fetch("/api/finance/bulk-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok) {
        const details = (data.results || []).map((r: { filename: string; status: string; date?: string; company?: string }) =>
          `${(r.company || "?").padEnd(10)} ${r.date || "?"} ${r.status} — ${r.filename}`
        ).join("\n");
        setBulkMsg(`Done: ${data.saved} saved, ${data.errors} errors out of ${data.total} files.`);
        if (data.results) alert("Upload Results:\n\n" + details);
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
    if (!confirm("Delete this budget entry?")) return;
    await supabase.from("department_budgets").delete().eq("id", id);
    loadBudgets();
  }

  const validDepts = deptsForCompany(budgetCompany);

  const budgetGroups = new Map<string, Budget[]>();
  for (const b of budgets) { if (!budgetGroups.has(b.department)) budgetGroups.set(b.department, []); budgetGroups.get(b.department)!.push(b); }
  const totalBudgeted = budgets.reduce((s, b) => s + b.budgeted_amount, 0);
  const totalActual = budgets.reduce((s, b) => s + b.actual_amount, 0);
  const variance = totalBudgeted - totalActual;

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "20px 24px" }}>
          <p style={{ color: COLOURS.SLATE }}>Loading...</p>
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader title="Finance" subtitle="Cash position, daily banking, forecasting, and budgets" />

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
                    border: `1px solid ${COLOURS.BORDER}`,
                    borderTop: `3px solid ${COLOURS.NAVY}`,
                    borderRadius: "8px",
                    padding: "16px",
                    backgroundColor: "white",
                    cursor: "pointer",
                    transition: "box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 2px 10px rgba(0,0,0,0.1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none"; }}
                >
                  <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>
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
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", maxWidth: "600px" }}>
                  <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "10px" }}>
                    Select multiple cash flow PDFs — system auto-detects which company each PDF belongs to (Imperial vs Unze Trading) and saves to the correct account.
                  </p>
                  <form onSubmit={handleBulkUpload}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <input type="file" accept=".pdf" multiple style={{ fontSize: "14px" }} />
                      <button type="submit" disabled={uploading} style={{
                        backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
                        padding: "7px 14px", fontSize: "14px", fontWeight: 700, cursor: "pointer",
                        opacity: uploading ? 0.5 : 1,
                      }}>{uploading ? "Uploading..." : "Upload All"}</button>
                    </div>
                  </form>
                  {bulkMsg && (
                    <div style={{ marginTop: "10px", fontSize: "14px", fontWeight: 600, color: bulkMsg.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN }}>{bulkMsg}</div>
                  )}
                </div>
              </>
            )}

            {/* Department Budgets */}
            <div style={{ marginTop: "20px" }}>
              <div onClick={() => { setShowBudgets(!showBudgets); if (!showBudgets) loadBudgets(); }} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
                border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "12px 16px",
                backgroundColor: showBudgets ? COLOURS.NAVY : "white", maxWidth: "600px",
              }}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: showBudgets ? "white" : COLOURS.NAVY }}>Department Budgets</div>
                  <div style={{ fontSize: "12px", color: showBudgets ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>Budgeted vs actual spending per department, per company</div>
                </div>
                <span style={{ color: showBudgets ? "white" : COLOURS.SLATE, fontSize: "14px" }}>{showBudgets ? "▲" : "▼"}</span>
              </div>

              {showBudgets && (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", backgroundColor: "white", padding: "14px", maxWidth: "600px" }}>
                  {/* Company + Month selector */}
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
                    <select value={budgetCompany} onChange={(e) => { setBudgetCompany(e.target.value); setBdDept(""); loadBudgets(e.target.value); }}
                      style={{ padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "5px", fontSize: "13px", fontWeight: 600 }}>
                      {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.shortCode}</option>)}
                    </select>
                    <input type="month" value={budgetMonth} onChange={(e) => { setBudgetMonth(e.target.value); loadBudgets(undefined, e.target.value); }}
                      style={{ padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "5px", fontSize: "13px" }} />
                    <button onClick={() => setShowBudgetForm(!showBudgetForm)} style={{
                      backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "5px",
                      padding: "5px 12px", fontSize: "13px", fontWeight: 700, cursor: "pointer",
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
                          if (!cat || !COMMON_CATEGORIES.includes(cat)) { errors.push(`Row ${line}: Invalid category "${cat || "(empty)"}". Must be one of: ${COMMON_CATEGORIES.join(", ")}`); continue; }
                          validRows.push({ company: targetCompany, dept, cat, budgeted: Number(row["Budgeted"]) || 0, actual: Number(row["Actual"]) || 0, notes: row["Notes"]?.trim() || "" });
                        }

                        if (errors.length > 0) {
                          alert(`Upload rejected — please fix and re-upload:\n\n${errors.slice(0, 15).join("\n")}${errors.length > 15 ? `\n\n...and ${errors.length - 15} more errors` : ""}`);
                          return;
                        }

                        if (validRows.length === 0) { alert("No valid data rows found in the file."); return; }

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
                      backgroundColor: "white", color: COLOURS.NAVY, border: `1px solid ${COLOURS.BORDER}`,
                      borderRadius: "6px", padding: "6px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                    }} title="Download Excel template with instructions">Template</button>
                  </div>

                  {bdMsg && (
                    <div style={{ fontSize: "13px", fontWeight: 600, color: bdMsg.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN, marginBottom: "8px" }}>{bdMsg}</div>
                  )}

                  {/* Add form */}
                  {showBudgetForm && (
                    <form onSubmit={handleAddBudget} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "10px", marginBottom: "12px", backgroundColor: "#f8fafc" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                        <div><label style={lbl}>Department</label>
                          <select style={inp} value={bdDept} onChange={(e) => setBdDept(e.target.value)} required>
                            <option value="">Select</option>{validDepts.map((d) => <option key={d}>{d}</option>)}
                          </select>
                        </div>
                        <div><label style={lbl}>Category</label>
                          <select style={inp} value={bdCategory} onChange={(e) => setBdCategory(e.target.value)} required>
                            <option value="">Select</option>
                            {COMMON_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                            <option value="__custom">Other (type below)</option>
                          </select>
                          {bdCategory === "__custom" && (
                            <input style={{ ...inp, marginTop: "4px" }} value="" onChange={(e) => setBdCategory(e.target.value)} placeholder="Type custom category" autoFocus />
                          )}
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
                      <button type="submit" disabled={bdSaving || bdCategory === "__custom"} style={{
                        backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "5px",
                        padding: "6px 14px", fontSize: "13px", fontWeight: 700, cursor: "pointer", marginTop: "8px",
                        opacity: bdSaving || bdCategory === "__custom" ? 0.5 : 1,
                      }}>{bdSaving ? "Saving..." : "Save"}</button>
                    </form>
                  )}

                  {/* Company codes reference */}
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginBottom: "8px" }}>
                    {COMPANIES.map((c) => <span key={c.id} style={{ marginRight: "10px" }}><strong>{c.shortCode}</strong> = {c.name}</span>)}
                  </div>

                  {/* Summary cards */}
                  {budgets.length > 0 && (
                    <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                      <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.BLUE}`, borderRadius: "6px", padding: "6px 12px", backgroundColor: "white" }}>
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Budgeted</div>
                        <div style={{ fontSize: "15px", fontWeight: 800, color: COLOURS.BLUE }}>PKR {totalBudgeted.toLocaleString()}</div>
                      </div>
                      <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${totalActual > totalBudgeted ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", padding: "6px 12px", backgroundColor: "white" }}>
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Actual</div>
                        <div style={{ fontSize: "15px", fontWeight: 800, color: totalActual > totalBudgeted ? COLOURS.RED : COLOURS.GREEN }}>PKR {totalActual.toLocaleString()}</div>
                      </div>
                      <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${variance >= 0 ? COLOURS.GREEN : COLOURS.RED}`, borderRadius: "6px", padding: "6px 12px", backgroundColor: "white" }}>
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Variance</div>
                        <div style={{ fontSize: "15px", fontWeight: 800, color: variance >= 0 ? COLOURS.GREEN : COLOURS.RED }}>PKR {variance.toLocaleString()}</div>
                      </div>
                    </div>
                  )}

                  {/* Budget entries by department */}
                  {Array.from(budgetGroups.entries()).map(([deptName, items]) => {
                    const dB = items.reduce((s, i) => s + i.budgeted_amount, 0);
                    const dA = items.reduce((s, i) => s + i.actual_amount, 0);
                    const over = dA > dB;
                    return (
                      <div key={deptName} style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${over ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: "6px", overflow: "hidden", marginBottom: "8px" }}>
                        <div style={{ padding: "6px 12px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>{deptName}</span>
                          <div style={{ fontSize: "11px", display: "flex", gap: "8px" }}>
                            <span style={{ color: COLOURS.SLATE }}>Budget: PKR {dB.toLocaleString()}</span>
                            <span style={{ fontWeight: 700, color: over ? COLOURS.RED : COLOURS.GREEN }}>Actual: PKR {dA.toLocaleString()}</span>
                          </div>
                        </div>
                        {items.map((b) => (
                          <div key={b.id} style={{ padding: "5px 12px", borderBottom: `1px solid #f1f5f9`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{b.category}</span>
                              {b.notes && <span style={{ fontSize: "11px", color: COLOURS.SLATE, marginLeft: "4px" }}>({b.notes})</span>}
                            </div>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", flexShrink: 0 }}>
                              <span style={{ color: COLOURS.SLATE }}>PKR {b.budgeted_amount.toLocaleString()}</span>
                              <input type="number" defaultValue={b.actual_amount} onBlur={(e) => { const v = Number(e.target.value); if (v !== b.actual_amount) updateBudgetActual(b.id, v); }}
                                style={{ width: "80px", padding: "2px 5px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "3px", fontSize: "12px" }} title="Update actual" />
                              {isAdmin && <button onClick={() => deleteBudgetEntry(b.id)} style={{ background: "transparent", border: "none", color: COLOURS.RED, fontSize: "14px", cursor: "pointer" }} title="Delete">×</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {budgets.length === 0 && (
                    <div style={{ padding: "12px", color: COLOURS.SLATE, textAlign: "center", fontSize: "14px" }}>No budget entries for {companyShortName(budgetCompany)} — {budgetMonth}.</div>
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

const inp: React.CSSProperties = { display: "block", width: "100%", padding: "5px 8px", marginTop: "2px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "5px", fontSize: "13px", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE };
