"use client";

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions } from "../../../lib/supabase";
import { COMPANIES, getCompanyById } from "../../../lib/constants";
import { formatDateUK } from "../../../lib/dateUtils";
import DateInputWithCalendar from "../../../lib/DateInputWithCalendar";
import { useMobile } from "../../../lib/useMobile";
import {
  COLOURS, RADII, cardStyle, SectionTitle, StatusBadge,
  WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR,
} from "../../../lib/SharedUI";
import { logAction } from "../../../lib/audit-log";
import { canCreateAssignments, widgetVisible, type UserCtx, type PermOverrides } from "../../../lib/permissions";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import NewTaskForm from "../../../tasks/NewTaskForm";
import { useUserCtx } from "../../../lib/useUserCtx";

type Position = {
  id: string;
  position_title: string;
  department: string | null;
  date_opened: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  company_id: string | null;
};

const today = new Date().toISOString().slice(0, 10);
const STATUSES = ["Open", "Interviewing", "Offered", "Filled", "Cancelled"];
const DEPARTMENTS = ["Unze Trading Ops", "Finance", "HR", "Admin", "Legal", "Sales", "Audit"];

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, fontSize: "14px",
  boxSizing: "border-box", color: COLOURS.NAVY,
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE,
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px",
};

export default function HRRecruitment() {
  const isMobile = useMobile();
  const [items, setItems] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const { ctx: widgetCtx } = useUserCtx();
  const wv = (key: string, defaultVisible: boolean) =>
    !!widgetCtx && widgetVisible(widgetCtx, key, defaultVisible);

  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [dateOpened, setDateOpened] = useState(today);
  const [notes, setNotes] = useState("");
  const [companyId, setCompanyId] = useState("");

  async function loadData() {
    setLoading(true);
    const { data } = await supabase
      .from("recruitment_positions")
      .select("id, position_title, department, date_opened, status, notes, created_at, company_id")
      .order("created_at", { ascending: false });
    setItems(data || []);

    const { data: userData } = await supabase.auth.getUser();
    if (userData.user?.email) {
      const { data: memberData } = await supabase
        .from("members")
        .select("role, department, company")
        .eq("email", userData.user.email)
        .maybeSingle();
      if (memberData) {
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        setUserCtx({
          email: userData.user.email,
          role: memberData.role,
          department: memberData.department,
          company: memberData.company,
          overrides,
        });
      }
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  function showMsg(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 4000);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) { showMsg("Company is required."); return; }
    setSaving(true);
    const { error } = await supabase.from("recruitment_positions").insert({
      company_id: companyId, position_title: title, department: dept || null,
      date_opened: dateOpened || null, notes: notes || null, status: "Open",
    });
    setSaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "recruitment_positions", title);
    showMsg("Position added.");
    setTitle(""); setDept(""); setDateOpened(today); setNotes(""); setCompanyId("");
    setShowForm(false);
    loadData();
  }

  async function updateStatus(id: string, newStatus: string) {
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "Filled") {
      const item = items.find((i) => i.id === id);
      if (item?.date_opened) updates.time_to_hire_days = daysSince(item.date_opened);
    }
    await supabase.from("recruitment_positions").update(updates).eq("id", id);
    logAction("Updated", "recruitment_positions", `Status → ${newStatus}`, id);
    loadData();
  }

  const open      = items.filter((i) => i.status === "Open" || i.status === "Interviewing");
  const filled    = items.filter((i) => i.status === "Filled").length;
  const longOpen  = open.filter((i) => daysSince(i.date_opened) > 60);
  const offered   = items.filter((i) => i.status === "Offered").length;

  const donutData = [
    { name: "Open",         value: items.filter((i) => i.status === "Open").length,         color: COLOURS.AMBER },
    { name: "Interviewing", value: items.filter((i) => i.status === "Interviewing").length, color: COLOURS.BLUE },
    { name: "Offered",      value: offered,                                                  color: COLOURS.PURPLE },
    { name: "Filled",       value: filled,                                                   color: COLOURS.GREEN },
  ].filter((d) => d.value > 0);

  return (
    <>
      {message && (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`,
          borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px",
          backgroundColor: COLOURS.CARD, fontSize: "14px", color: COLOURS.NAVY,
        }}>
          {message}
        </div>
      )}

      {/* Alert banner */}
      {wv("dept_hr.attention_banner", true) && !loading && longOpen.length > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div
            onClick={() => setBannerOpen(!bannerOpen)}
            style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>
                  {longOpen.length} position{longOpen.length > 1 ? "s" : ""} open for 60+ days
                </div>
                <div style={{ fontSize: "12px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>
                  {longOpen.map((i) => `${i.position_title} (${daysSince(i.date_opened)}d)`).join(" · ")}
                </div>
              </div>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>
              {bannerOpen ? "▲" : "▼"}
            </span>
          </div>
          {bannerOpen && (
            <div style={WARNING_BANNER_INNER}>
              {longOpen.map((i) => (
                <div
                  key={i.id}
                  onClick={() => { setExpandedId(i.id); setBannerOpen(false); }}
                  style={{
                    padding: "8px 16px 8px 48px", borderBottom: `1px solid ${COLOURS.TRACK}`,
                    cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{i.position_title}</div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                      {i.department || "—"} · Opened: {formatDateUK(i.date_opened)}
                    </div>
                  </div>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.RED }}>
                    {daysSince(i.date_opened)}d open
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI + Donut */}
      {wv("dept_hr.kpi_charts", true) && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px" }}>
            {[
              { label: "Open Positions", value: open.length },
              { label: "Filled",         value: filled },
              { label: "Open 60+ Days",  value: longOpen.length },
              { label: "Total",          value: items.length },
            ].map(({ label, value }) => (
              <div key={label} style={{ ...cardStyle, padding: "16px 20px" }}>
                <div style={{
                  fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em",
                  textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "10px",
                }}>
                  {label}
                </div>
                <div style={{
                  fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
                  fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums", color: COLOURS.NAVY,
                }}>
                  {value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {donutData.length > 0 && (
            <div style={{
              border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
              padding: "16px 20px", backgroundColor: COLOURS.CARD,
            }}>
              <div style={{
                fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE,
                textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px",
              }}>
                Recruitment Pipeline
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                    {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value} position${Number(value) > 1 ? "s" : ""}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                {donutData.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: COLOURS.SLATE }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: d.color }} />
                    {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add button + form */}
      {wv("dept_hr.records_table", true) && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <SectionTitle title="Positions" />
            <button
              onClick={() => setShowForm(!showForm)}
              style={{
                backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none",
                borderRadius: RADII.PILL, padding: "8px 16px", fontSize: "13px",
                fontWeight: 600, cursor: "pointer",
              }}
            >
              {showForm ? "Cancel" : "+ Add"}
            </button>
          </div>

          {showForm && (
            <div style={{
              border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`,
              borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD, marginBottom: "14px",
            }}>
              <form onSubmit={handleAdd}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
                  <label style={lbl}>
                    Company
                    <select style={inp} value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
                      <option value="">Select</option>
                      {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label style={lbl}>
                    Position Title
                    <input style={inp} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Finance Manager" />
                  </label>
                  <label style={lbl}>
                    Department
                    <select style={inp} value={dept} onChange={(e) => setDept(e.target.value)} required>
                      <option value="">Select</option>
                      {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </label>
                  <label style={lbl}>
                    Date Opened
                    <DateInputWithCalendar style={inp} value={dateOpened} onChange={(e) => setDateOpened(e.target.value)} required />
                  </label>
                  <label style={{ ...lbl, gridColumn: isMobile ? undefined : "1 / -1" }}>
                    Notes
                    <textarea style={{ ...inp, height: "50px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none",
                    borderRadius: RADII.PILL, padding: "8px 20px", fontSize: "13px",
                    fontWeight: 600, cursor: "pointer", marginTop: "8px",
                  }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </form>
            </div>
          )}
        </>
      )}

      {/* Issue Task */}
      {userCtx && canCreateAssignments(userCtx) && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <button
            onClick={() => setShowTaskForm(!showTaskForm)}
            style={{
              backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none",
              borderRadius: RADII.PILL, padding: "8px 16px", fontSize: "13px",
              fontWeight: 600, cursor: "pointer",
            }}
          >
            {showTaskForm ? "Cancel" : "+ Issue Task"}
          </button>
        </div>
      )}
      {showTaskForm && (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: `3px solid ${COLOURS.NAVY}`,
          borderRadius: RADII.CARD, marginBottom: "14px", overflow: "hidden",
        }}>
          <NewTaskForm onCreated={() => { setShowTaskForm(false); loadData(); }} />
        </div>
      )}

      {/* Records */}
      {wv("dept_hr.records_table", true) && (
        loading ? (
          <p style={{ color: COLOURS.SLATE }}>Loading…</p>
        ) : items.length === 0 ? (
          <div style={{
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
            padding: "24px", backgroundColor: COLOURS.CARD, color: COLOURS.SLATE,
          }}>
            No positions yet.
          </div>
        ) : (
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden" }}>
            {items.map((item) => {
              const isOpen = expandedId === item.id;
              const days   = daysSince(item.date_opened);
              const isLong = days > 60 && item.status !== "Filled" && item.status !== "Cancelled";
              return (
                <div key={item.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  <div
                    onClick={() => setExpandedId(isOpen ? null : item.id)}
                    style={{
                      padding: "10px 16px", cursor: "pointer",
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                      backgroundColor: isLong ? COLOURS.DANGER_SOFT : isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{item.position_title}</div>
                      <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px" }}>
                        {getCompanyById(item.company_id || "")?.shortCode || "—"} · {item.department || "—"} · Opened: {formatDateUK(item.date_opened)} · {days}d
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                      <StatusBadge status={item.status} />
                      <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{isOpen ? "▼" : "▶"}</span>
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{
                      padding: "12px 16px", backgroundColor: COLOURS.CARD_ALT,
                      borderTop: `1px solid ${COLOURS.HAIRLINE}`,
                    }}>
                      {item.notes && (
                        <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginBottom: "8px" }}>Notes: {item.notes}</div>
                      )}
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Status:</span>
                        <select
                          value={item.status}
                          onChange={(e) => updateStatus(item.id, e.target.value)}
                          style={{ padding: "5px 8px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, fontSize: "14px" }}
                        >
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </>
  );
}
