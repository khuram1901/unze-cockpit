"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";

type ExceptionRow = {
  id: string;
  department: string | null;
  exception_type: string | null;
  title: string;
  description: string | null;
  severity: string | null;
  status: string | null;
  assigned_to: string | null;
  explanation: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_assessment: string | null;
  created_at: string;
};

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";
const STATUSES = ["Open", "Submitted", "Closed"];

function formatDateUK(dateString: string | null) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontSize: "13px",
        fontWeight: 700,
        color: NAVY,
        margin: "20px 0 10px",
        paddingLeft: "9px",
        borderLeft: `3px solid ${NAVY}`,
      }}
    >
      {title}
    </h2>
  );
}

export default function ExceptionsPage() {
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadExceptions() {
    const { data, error } = await supabase
      .from("exceptions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert("Error loading exceptions: " + error.message);
    } else {
      setExceptions(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadExceptions();
  }, []);

  async function updateException(id: string, updates: Partial<ExceptionRow>) {
    const { error } = await supabase
      .from("exceptions")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
        closed_at: updates.status === "Closed" ? new Date().toISOString() : null,
      })
      .eq("id", id);

    if (error) {
      alert("Error updating exception: " + error.message);
      return;
    }
    loadExceptions();
  }

  const open = exceptions.filter((e) => e.status === "Open");
  const submitted = exceptions.filter((e) => e.status === "Submitted");
  const closed = exceptions.filter((e) => e.status === "Closed");

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: NAVY, margin: 0 }}>
            Exceptions
          </h1>
          <p style={{ color: SLATE, fontSize: "12px", marginTop: "5px" }}>
            KPI exceptions, explanations, corrective actions, and closure tracking.
          </p>
        </div>

        {/* Summary counts */}
        {!loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "8px",
              marginBottom: "20px",
            }}
          >
            <CountCard label="Open" count={open.length} color="#dc2626" />
            <CountCard label="Awaiting Review" count={submitted.length} color="#d97706" />
            <CountCard label="Closed" count={closed.length} color="#16a34a" />
            <CountCard label="Total" count={exceptions.length} color={NAVY} />
          </div>
        )}

        {loading ? (
          <p style={{ color: SLATE, fontSize: "13px" }}>Loading exceptions…</p>
        ) : exceptions.length === 0 ? (
          <div
            style={{
              border: "1px solid #bbf7d0",
              backgroundColor: "#f0fdf4",
              color: "#166534",
              borderRadius: "8px",
              padding: "12px 14px",
              fontWeight: 700,
              fontSize: "13px",
            }}
          >
            No exceptions recorded yet.
          </div>
        ) : (
          <>
            {open.length > 0 && (
              <>
                <SectionTitle title={`Open — ${open.length}`} />
                <div style={{ display: "grid", gap: "10px", marginBottom: "8px" }}>
                  {open.map((ex) => (
                    <ExceptionCard key={ex.id} ex={ex} onUpdate={updateException} />
                  ))}
                </div>
              </>
            )}
            {submitted.length > 0 && (
              <>
                <SectionTitle title={`Awaiting Review — ${submitted.length}`} />
                <div style={{ display: "grid", gap: "10px", marginBottom: "8px" }}>
                  {submitted.map((ex) => (
                    <ExceptionCard key={ex.id} ex={ex} onUpdate={updateException} />
                  ))}
                </div>
              </>
            )}
            {closed.length > 0 && (
              <>
                <SectionTitle title={`Closed — ${closed.length}`} />
                <div style={{ display: "grid", gap: "10px", marginBottom: "8px" }}>
                  {closed.map((ex) => (
                    <ExceptionCard key={ex.id} ex={ex} onUpdate={updateException} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

function CountCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderTop: `3px solid ${color}`,
        borderRadius: "7px",
        padding: "8px 10px",
        backgroundColor: "white",
      }}
    >
      <div
        style={{
          color: SLATE,
          fontSize: "11px",
          marginBottom: "2px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "19px", fontWeight: 800, color }}>{count}</div>
    </div>
  );
}

function ExceptionCard({
  ex,
  onUpdate,
}: {
  ex: ExceptionRow;
  onUpdate: (id: string, updates: Partial<ExceptionRow>) => void;
}) {
  const [status, setStatus] = useState(ex.status || "Open");
  const [explanation, setExplanation] = useState(ex.explanation || "");
  const [correctiveAction, setCorrectiveAction] = useState(ex.corrective_action || "");
  const [recoveryDate, setRecoveryDate] = useState(ex.recovery_date || "");
  const [impactAssessment, setImpactAssessment] = useState(ex.impact_assessment || "");

  const statusColor =
    status === "Closed"
      ? "#16a34a"
      : status === "Submitted"
      ? "#d97706"
      : "#dc2626";

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderTop: `3px solid ${statusColor}`,
        borderRadius: "8px",
        padding: "14px 16px",
        backgroundColor: "white",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: NAVY, marginBottom: "4px" }}>
            {ex.title}
          </div>
          <div style={{ fontSize: "12px", color: SLATE }}>
            Department: <strong>{ex.department || "—"}</strong> &nbsp;|&nbsp; Type:{" "}
            <strong>{ex.exception_type || "—"}</strong> &nbsp;|&nbsp; Owner:{" "}
            <strong>{ex.assigned_to || "—"}</strong>
          </div>
          {ex.description && (
            <div style={{ fontSize: "12px", color: SLATE, marginTop: "6px" }}>
              {ex.description}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "10px",
              color: "white",
              backgroundColor: statusColor,
              whiteSpace: "nowrap",
            }}
          >
            {status}
          </span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              onUpdate(ex.id, { status: e.target.value });
            }}
            style={{
              padding: "5px 7px",
              border: `1px solid ${BORDER}`,
              borderRadius: "6px",
              fontSize: "12px",
              backgroundColor: "white",
              color: NAVY,
            }}
          >
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {status === "Open" && (
        <div
          style={{
            marginTop: "14px",
            borderTop: `1px solid ${BORDER}`,
            paddingTop: "14px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "12px",
            }}
          >
            <label style={labelStyle}>
              Explanation
              <textarea
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder="Explain what happened…"
                style={{ ...inputStyle, height: "72px" }}
              />
            </label>
            <label style={labelStyle}>
              Corrective Action
              <textarea
                value={correctiveAction}
                onChange={(e) => setCorrectiveAction(e.target.value)}
                placeholder="What action has been or will be taken?"
                style={{ ...inputStyle, height: "72px" }}
              />
            </label>
            <label style={labelStyle}>
              Expected Recovery Date
              <input
                type="date"
                value={recoveryDate}
                onChange={(e) => setRecoveryDate(e.target.value)}
                style={inputStyle}
              />
              {recoveryDate && (
                <span style={{ fontSize: "11px", color: SLATE }}>
                  {recoveryDate.split("-").reverse().join("/")}
                </span>
              )}
            </label>
            <label style={labelStyle}>
              Impact Assessment
              <select
                value={impactAssessment}
                onChange={(e) => setImpactAssessment(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Select impact —</option>
                <option>No expected impact</option>
                <option>At risk but recoverable</option>
                <option>Likely to miss target</option>
                <option>Already recovered</option>
              </select>
            </label>
          </div>

          <button
            onClick={() =>
              onUpdate(ex.id, {
                explanation,
                corrective_action: correctiveAction,
                recovery_date: recoveryDate || null,
                impact_assessment: impactAssessment || null,
                status: "Submitted",
              })
            }
            style={{
              marginTop: "10px",
              backgroundColor: "#16a34a",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "8px 18px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Submit Explanation
          </button>
        </div>
      )}

      {(status === "Submitted" || status === "Closed") && (
        <div
          style={{
            marginTop: "12px",
            borderTop: `1px solid ${BORDER}`,
            paddingTop: "12px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "10px",
            fontSize: "12px",
          }}
        >
          <div>
            <div style={{ color: SLATE, fontSize: "11px", marginBottom: "2px" }}>Explanation</div>
            <div style={{ color: NAVY }}>{ex.explanation || "—"}</div>
          </div>
          <div>
            <div style={{ color: SLATE, fontSize: "11px", marginBottom: "2px" }}>Corrective Action</div>
            <div style={{ color: NAVY }}>{ex.corrective_action || "—"}</div>
          </div>
          <div>
            <div style={{ color: SLATE, fontSize: "11px", marginBottom: "2px" }}>Recovery Date</div>
            <div style={{ color: NAVY }}>{ex.recovery_date ? ex.recovery_date.split("-").reverse().join("/") : "—"}</div>
          </div>
          <div>
            <div style={{ color: SLATE, fontSize: "11px", marginBottom: "2px" }}>Impact</div>
            <div style={{ color: NAVY }}>{ex.impact_assessment || "—"}</div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 600,
  color: NAVY,
  marginBottom: "0",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  fontSize: "13px",
  boxSizing: "border-box",
};
