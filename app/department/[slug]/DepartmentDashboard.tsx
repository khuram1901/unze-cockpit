"use client";

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions } from "../../lib/supabase";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";
import {
  COLOURS,
  RADII,
  SectionTitle,
  PageHeader,
  CountCard,
  StatusBadge,
} from "../../lib/SharedUI";
import { DepartmentConfig } from "../../lib/department-config";
import { logAction } from "../../lib/audit-log";
import { canSeeAllTasks, canCreateAssignments, widgetVisible, type UserCtx, type PermOverrides } from "../../lib/permissions";
import NewTaskForm from "../../tasks/NewTaskForm";
import { useUserCtx } from "../../lib/useUserCtx";

type UserTask = {
  id: string;
  description: string;
  due_date: string | null;
  priority: string | null;
  status: string;
};

export default function DepartmentDashboard({ config }: { config: DepartmentConfig }) {
  const isMobile = useMobile();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [kpiCounts, setKpiCounts] = useState<Record<string, number>>({});
  const [myTasks, setMyTasks] = useState<UserTask[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { ctx: widgetCtx } = useUserCtx();
  const wv = (key: string, defaultVisible: boolean) => !!widgetCtx && widgetVisible(widgetCtx, key, defaultVisible);

  async function loadData() {
    setLoading(true);
    setMyTasks([]);
    // Row-level display columns only — the KPI tiles above the table come
    // from get_department_kpi_counts (migration 130), not from these rows.
    const displayColumns = Array.from(new Set(["id", config.statusField, ...config.columns.map((c) => c.key)])).join(", ");
    let query = supabase
      .from(config.table)
      .select(displayColumns)
      .order("created_at", { ascending: false });

    if (config.table === "tasks") {
      query = query.eq("assigned_to_department", config.departmentName);
    } else {
      query = query.eq("company_id", UTPL_COMPANY_ID);
    }

    const [{ data }, { data: countsData }] = await Promise.all([
      query,
      supabase.rpc("get_department_kpi_counts", {
        p_slug: config.slug,
        p_department_name: config.departmentName,
        p_company_id: UTPL_COMPANY_ID,
        p_today: new Date().toISOString().slice(0, 10),
      }),
    ]);
    setRows((data as unknown as Record<string, unknown>[]) || []);
    setKpiCounts((countsData as Record<string, number>) || {});

    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      const { data: member } = await supabase
        .from("members").select("id, first_name, last_name, name, role, department, company")
        .eq("email", user.email).maybeSingle();
      if (member) {
        setUserRole(member.role);
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email: user.email, role: member.role, department: member.department, company: member.company, overrides };
        setUserCtx(ctx);
        if (!canSeeAllTasks(ctx)) {
          const userName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || user.email;
          const { data: tasks } = await supabase
            .from("tasks")
            .select("id, description, due_date, priority, status")
            .eq("assigned_to", userName)
            .not("status", "in", '("Completed","Cancelled")')
            .order("due_date", { ascending: true })
            .limit(10);
          setMyTasks(tasks || []);
        }
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [config.slug]);

  function showMsg(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 4000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const record: Record<string, unknown> = { company_id: UTPL_COMPANY_ID };

    for (const field of config.formFields) {
      const val = formData[field.key] || "";
      if (field.type === "number") {
        record[field.key] = val ? Number(val) : 0;
      } else {
        record[field.key] = val || null;
      }
    }

    if (config.statusField && config.statusOptions.length > 0) {
      record[config.statusField] = config.statusOptions[0];
    }

    const { error } = await supabase.from(config.table).insert(record);
    setSaving(false);

    if (error) {
      showMsg("Error: " + error.message);
      return;
    }

    const firstField = config.formFields[0];
    logAction("Created", config.table, formData[firstField.key] || "New record");
    showMsg("Record added successfully.");
    setFormData({});
    setShowForm(false);
    loadData();
  }

  async function updateStatus(id: string, newStatus: string) {
    await supabase
      .from(config.table)
      .update({ [config.statusField]: newStatus })
      .eq("id", id);
    logAction("Updated status", config.table, `Changed to: ${newStatus}`, id);
    loadData();
  }

  function formatValue(key: string, value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (key.includes("date") || key.includes("deadline")) return formatDateUK(String(value));
    if (key.includes("exposure") || key.includes("amount") || key.includes("budget")) {
      return Number(value).toLocaleString();
    }
    return String(value);
  }

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      <PageHeader />

      {message && (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
          borderRadius: RADII.SM,
          padding: "10px 14px",
          marginBottom: "14px",
          backgroundColor: COLOURS.CARD,
          fontSize: "15px",
          color: COLOURS.NAVY,
        }}>
          {message}
        </div>
      )}

      {/* KPI Cards */}
      {wv("dept_it.kpi_charts", true) && !loading && (
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "8px",
          marginBottom: "16px",
        }}>
          {config.kpis.map((kpi) => (
            <CountCard
              key={kpi.id}
              label={kpi.label}
              value={kpiCounts[kpi.id] || 0}
              color={kpi.color}
            />
          ))}
        </div>
      )}

      {/* Your Tasks */}
      {!loading && myTasks.length > 0 && (
        <>
          <SectionTitle title={`Your Tasks (${myTasks.length})`} />
          <div style={{
            border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.CARD,
            backgroundColor: COLOURS.CARD,
            overflow: "hidden",
            marginBottom: "14px",
            maxWidth: isMobile ? "100%" : "500px",
          }}>
            {myTasks.map((t) => {
              const overdue = t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== "Completed";
              return (
                <div key={t.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, padding: "7px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", backgroundColor: overdue ? COLOURS.DANGER_SOFT : undefined }}>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.description}
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                    {t.due_date && (
                      <span style={{ fontSize: "15px", color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 700 : 400 }}>
                        {formatDateUK(t.due_date)}
                      </span>
                    )}
                    <StatusBadge status={t.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Issue Task — available on every department dashboard, regardless of its primary table */}
      {userCtx && canCreateAssignments(userCtx) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <SectionTitle title="Tasks" />
          <button
            onClick={() => setShowTaskForm(!showTaskForm)}
            style={{
              backgroundColor: COLOURS.NAVY,
              color: COLOURS.CARD,
              border: "none",
              borderRadius: RADII.PILL,
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showTaskForm ? "Cancel" : "+ Issue Task"}
          </button>
        </div>
      )}

      {showTaskForm && (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderTop: `3px solid ${COLOURS.NAVY}`,
          borderRadius: RADII.CARD,
          marginBottom: "14px",
          overflow: "hidden",
        }}>
          <NewTaskForm onCreated={() => { setShowTaskForm(false); loadData(); }} />
        </div>
      )}

      {/* Add Record Button + Form — for the department's own primary table */}
      {wv("dept_it.records_table", true) && (
      <>
      {config.table !== "tasks" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <SectionTitle title="Records" />
          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              backgroundColor: COLOURS.NAVY,
              color: COLOURS.CARD,
              border: "none",
              borderRadius: RADII.PILL,
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showForm ? "Cancel" : "+ Add"}
          </button>
        </div>
      )}

      {showForm && config.table !== "tasks" && (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.CARD,
          padding: "24px",
          backgroundColor: COLOURS.CARD,
          marginBottom: "14px",
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "10px",
            }}>
              {config.formFields.map((field) => (
                <label key={field.key} style={{
                  display: "block",
                  fontSize: "10.5px",
                  fontWeight: 500,
                  color: COLOURS.SLATE,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: "4px",
                }}>
                  {field.label}
                  {field.type === "select" ? (
                    <select
                      value={formData[field.key] || ""}
                      onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                      style={inputStyle}
                    >
                      <option value="">— Select —</option>
                      {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      value={formData[field.key] || ""}
                      onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      style={{ ...inputStyle, height: "60px", resize: "vertical" }}
                    />
                  ) : (
                    <input
                      type={field.type}
                      value={formData[field.key] || ""}
                      onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      required={field.required}
                      style={inputStyle}
                    />
                  )}
                </label>
              ))}
            </div>
            <button type="submit" disabled={saving} style={{
              backgroundColor: COLOURS.NAVY,
              color: COLOURS.CARD,
              border: "none",
              borderRadius: RADII.PILL,
              padding: "10px 20px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              marginTop: "10px",
            }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
      )}

      {/* Data Table / Cards */}
      {loading ? (
        <p style={{ color: COLOURS.SLATE, fontSize: "15px" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.CARD,
          padding: "24px",
          backgroundColor: COLOURS.CARD,
          color: COLOURS.SLATE,
          fontSize: "15px",
        }}>
          No records yet. Click &ldquo;+ Add&rdquo; to create the first one.
        </div>
      ) : isMobile ? (
        <div>
          {rows.map((row) => (
            <div key={row.id as string} style={{
              border: `1px solid ${COLOURS.HAIRLINE}`,
              borderRadius: RADII.CARD,
              padding: "16px 18px",
              backgroundColor: COLOURS.CARD,
              marginBottom: "8px",
            }}>
              {config.columns.map((col) => (
                <div key={col.key} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "3px 0",
                  fontSize: "14px",
                }}>
                  <span style={{ color: COLOURS.SLATE }}>{col.label}</span>
                  <span style={{ fontWeight: col.bold ? 600 : 400, color: col.bold ? COLOURS.NAVY : undefined }}>
                    {col.key === config.statusField ? (
                      <StatusBadge status={String(row[col.key] || "")} />
                    ) : (
                      formatValue(col.key, row[col.key])
                    )}
                  </span>
                </div>
              ))}
              {config.statusOptions.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <select
                    value={String(row[config.statusField] || "")}
                    onChange={(e) => updateStatus(row.id as string, e.target.value)}
                    style={{
                      padding: "5px 8px",
                      border: `1px solid ${COLOURS.HAIRLINE}`,
                      borderRadius: RADII.SM,
                      fontSize: "14px",
                      width: "100%",
                    }}
                  >
                    {config.statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          overflowX: "auto",
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.CARD,
          backgroundColor: COLOURS.CARD,
        }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ backgroundColor: COLOURS.CARD_ALT }}>
                {config.columns.map((col) => (
                  <th key={col.key} style={thStyle}>{col.label}</th>
                ))}
                {config.statusOptions.length > 0 && <th style={thStyle}>Update</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id as string}>
                  {config.columns.map((col) => (
                    <td key={col.key} style={{
                      ...tdStyle,
                      fontWeight: col.bold ? 600 : 400,
                      color: col.bold ? COLOURS.NAVY : undefined,
                    }}>
                      {col.key === config.statusField ? (
                        <StatusBadge status={String(row[col.key] || "")} />
                      ) : (
                        formatValue(col.key, row[col.key])
                      )}
                    </td>
                  ))}
                  {config.statusOptions.length > 0 && (
                    <td style={tdStyle}>
                      <select
                        value={String(row[config.statusField] || "")}
                        onChange={(e) => updateStatus(row.id as string, e.target.value)}
                        style={{
                          padding: "5px 8px",
                          border: `1px solid ${COLOURS.HAIRLINE}`,
                          borderRadius: RADII.SM,
                          fontSize: "14px",
                        }}
                      >
                        {config.statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: "6px",
  border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.SM,
  fontSize: "14px",
  boxSizing: "border-box",
  color: COLOURS.NAVY,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  padding: "8px 14px",
  fontSize: "10.5px",
  color: COLOURS.SLATE,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const tdStyle: React.CSSProperties = {
  borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  padding: "10px 14px",
  fontSize: "14px",
};
