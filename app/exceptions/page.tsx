"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { useRequireCapability } from "../lib/useRouteGuard";
import {
  COLOURS,
  PageHeader,
  SectionTitle,
  CountCard,
  StatusBadge,
  tableHeaderStyle as th,
  tableCellStyle as td,
  tableCellBoldStyle as tdBold,
  useToast,
} from "../lib/SharedUI";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";

// This page reads from the `tasks` table — filtered to escalation tasks only.
// The exception engine in the Executive dashboard auto-creates a task whenever
// a KPI goes red. This page is the consolidated view of those tasks.

type EscalationTask = {
  id: string;
  task_type: string | null;
  description: string;
  project: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_date: string | null;
  assigned_to: string | null;
  assigned_to_department: string | null;
  status: string;
  reply_text: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_on_monthly_target: string | null;
  source_type: string | null;
  source_label: string | null;
  exception_type: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const ESCALATION_SOURCES = ["kpi_escalation", "receivable_escalation"];

function exceptionTypeLabel(t: string | null): string {
  if (!t) return "Unknown";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function sourceLabel(s: string | null): string {
  if (s === "kpi_escalation") return "KPI";
  if (s === "receivable_escalation") return "Receivable";
  return "Other";
}

export default function ExceptionsPage() {
  const { checking } = useRequireCapability("exceptions");
  const isMobile = useMobile();
  const toast = useToast();
  const [escalations, setEscalations] = useState<EscalationTask[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .in("source_type", ESCALATION_SOURCES)
      .order("created_at", { ascending: false });
    if (error) {
      toast.show("Error loading exceptions: " + error.message, "error");
    } else {
      setEscalations(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const waitingReply = escalations.filter((e) => e.status === "Waiting Reply");
  const submitted = escalations.filter((e) => e.status === "Submitted");
  const closed = escalations.filter(
    (e) => e.status === "Completed" || e.status === "Cancelled"
  );
  const totalOpen = waitingReply.length + submitted.length;

  if (checking) return <AuthWrapper><main style={{ padding: "20px 24px" }}><p style={{ color: "var(--text-secondary, #64748b)" }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
      {toast.element}
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
        <PageHeader />

        {!loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
              gap: "8px",
              marginBottom: "14px",
            }}
          >
            <CountCard label="Waiting Reply" value={waitingReply.length} color={COLOURS.RED} />
            <CountCard label="Awaiting Review" value={submitted.length} color={COLOURS.AMBER} />
            <CountCard label="Closed" value={closed.length} color={COLOURS.GREEN} />
            <CountCard label="Total Open" value={totalOpen} color={COLOURS.NAVY} />
          </div>
        )}

        {loading ? (
          <p style={{ color: "var(--text-secondary, #64748b)", fontSize: "17px" }}>Loading exceptions…</p>
        ) : escalations.length === 0 ? (
          <div
            style={{
              border: "1px solid #bbf7d0",
              backgroundColor: "#f0fdf4",
              color: "#166534",
              borderRadius: "8px",
              padding: "12px 14px",
              fontWeight: 700,
              fontSize: "17px",
            }}
          >
            No exceptions raised. All tracked KPIs and receivables are within tolerance.
          </div>
        ) : (
          <>
            {waitingReply.length > 0 && (
              <>
                <SectionTitle title={`Waiting Reply — ${waitingReply.length}`} />
                <EscalationTable rows={waitingReply} mobile={isMobile} />
              </>
            )}
            {submitted.length > 0 && (
              <>
                <SectionTitle title={`Awaiting Review — ${submitted.length}`} />
                <EscalationTable rows={submitted} mobile={isMobile} />
              </>
            )}
            {closed.length > 0 && (
              <>
                <SectionTitle title={`Closed — ${closed.length}`} />
                <EscalationTable rows={closed} mobile={isMobile} />
              </>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

function EscalationTable({ rows, mobile }: { rows: EscalationTask[]; mobile: boolean }) {
  if (mobile) {
    return (
      <div style={{ marginBottom: "8px" }}>
        {rows.map((row) => (
          <div key={row.id} style={{
            border: `1px solid ${COLOURS.BORDER}`,
            borderLeft: `3px solid ${row.status === "Waiting Reply" ? COLOURS.RED : COLOURS.AMBER}`,
            borderRadius: "6px",
            padding: "10px 12px",
            backgroundColor: "var(--bg-card, #ffffff)",
            marginBottom: "6px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" }}>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary, #1e293b)", minWidth: 0, flex: 1 }}>
                {row.description}
              </div>
              <StatusBadge status={row.status} />
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px", fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>
              <span style={{
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: "8px",
                backgroundColor: row.source_type === "kpi_escalation" ? "#dbeafe" : "#fef3c7",
                color: row.source_type === "kpi_escalation" ? "#1e40af" : "#92400e",
              }}>
                {sourceLabel(row.source_type)}
              </span>
              <span>{exceptionTypeLabel(row.exception_type)}</span>
              <span>→ {row.assigned_to || "—"}</span>
              <span>Due: {formatDateUK(row.due_date)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        overflowX: "auto",
        border: `1px solid ${COLOURS.BORDER}`,
        borderRadius: "8px",
        backgroundColor: "var(--bg-card, #ffffff)",
        marginBottom: "8px",
      }}
    >
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
        <thead>
          <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
            <th style={th}>Source</th>
            <th style={th}>Type</th>
            <th style={th}>Description</th>
            <th style={th}>Owner</th>
            <th style={th}>Due</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={td}>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: "10px",
                    backgroundColor:
                      row.source_type === "kpi_escalation" ? "#dbeafe" : "#fef3c7",
                    color:
                      row.source_type === "kpi_escalation" ? "#1e40af" : "#92400e",
                  }}
                >
                  {sourceLabel(row.source_type)}
                </span>
              </td>
              <td style={tdBold}>{exceptionTypeLabel(row.exception_type)}</td>
              <td style={{ ...td, maxWidth: "320px", color: "var(--text-primary, #1e293b)" }}>
                {row.description}
              </td>
              <td style={td}>{row.assigned_to || "—"}</td>
              <td style={td}>{formatDateUK(row.due_date)}</td>
              <td style={td}>
                <StatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
