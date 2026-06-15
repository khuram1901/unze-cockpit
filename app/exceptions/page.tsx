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

const STATUSES = ["Open", "Submitted", "Closed"];

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

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
          Loading exceptions...
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "8px" }}>
          Exceptions
        </h1>

        <p style={{ color: "#666", marginBottom: "24px" }}>
          KPI exceptions, explanations, corrective actions, and closure tracking.
        </p>

        <div style={{ display: "grid", gap: "14px" }}>
          {exceptions.length === 0 ? (
            <p style={{ color: "#666" }}>No exceptions yet.</p>
          ) : (
            exceptions.map((ex) => (
              <ExceptionCard
                key={ex.id}
                ex={ex}
                onUpdate={updateException}
              />
            ))
          )}
        </div>
      </main>
    </AuthWrapper>
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
        border: "1px solid #e0e0e0",
        borderTop: `4px solid ${statusColor}`,
        borderRadius: "10px",
        padding: "18px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <strong style={{ fontSize: "17px" }}>{ex.title}</strong>

          <div style={{ marginTop: "6px", color: "#555", fontSize: "14px" }}>
            Department: <strong>{ex.department || "—"}</strong> | Type:{" "}
            <strong>{ex.exception_type || "—"}</strong> | Owner:{" "}
            <strong>{ex.assigned_to || "—"}</strong>
          </div>

          {ex.description && (
            <div style={{ marginTop: "8px", color: "#555", fontSize: "14px" }}>
              {ex.description}
            </div>
          )}
        </div>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            onUpdate(ex.id, { status: e.target.value });
          }}
          style={{
            height: "fit-content",
            padding: "6px",
            border: "1px solid #ccc",
            borderRadius: "6px",
            fontWeight: "bold",
            color: statusColor,
          }}
        >
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      {status === "Open" && (
        <div style={{ marginTop: "16px" }}>
          <FieldLabel label="Explanation">
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Explain what happened..."
              style={{ ...fieldStyle, height: "80px" }}
            />
          </FieldLabel>

          <FieldLabel label="Corrective Action">
            <textarea
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              placeholder="What action has been taken or will be taken?"
              style={{ ...fieldStyle, height: "80px" }}
            />
          </FieldLabel>

          <FieldLabel label="Expected Recovery Date">
            <input
              type="date"
              value={recoveryDate}
              onChange={(e) => setRecoveryDate(e.target.value)}
              style={fieldStyle}
            />
          </FieldLabel>

          <FieldLabel label="Impact Assessment">
            <select
              value={impactAssessment}
              onChange={(e) => setImpactAssessment(e.target.value)}
              style={fieldStyle}
            >
              <option value="">-- Select impact --</option>
              <option value="No expected impact">No expected impact</option>
              <option value="At risk but recoverable">At risk but recoverable</option>
              <option value="Likely to miss target">Likely to miss target</option>
              <option value="Already recovered">Already recovered</option>
            </select>
          </FieldLabel>

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
              marginTop: "8px",
              backgroundColor: "#16a34a",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Submit Explanation
          </button>
        </div>
      )}

      {(status === "Submitted" || status === "Closed") && (
        <div
          style={{
            marginTop: "16px",
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "12px",
            backgroundColor: "#fafafa",
            fontSize: "14px",
          }}
        >
          <div>
            <strong>Explanation:</strong> {ex.explanation || "—"}
          </div>
          <div style={{ marginTop: "6px" }}>
            <strong>Corrective Action:</strong> {ex.corrective_action || "—"}
          </div>
          <div style={{ marginTop: "6px" }}>
            <strong>Recovery Date:</strong> {ex.recovery_date || "—"}
          </div>
          <div style={{ marginTop: "6px" }}>
            <strong>Impact:</strong> {ex.impact_assessment || "—"}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ fontSize: "14px", fontWeight: "bold", display: "block" }}>
      {label}
      {children}
    </label>
  );
}

const fieldStyle = {
  width: "100%",
  maxWidth: "560px",
  padding: "8px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  fontSize: "14px",
  display: "block",
  marginTop: "4px",
  marginBottom: "10px",
};