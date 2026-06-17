"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";

type Plant = { id: string; name: string; type: string; active: boolean };
type MachineIssue = {
  id: string;
  plant_name: string;
  machine_name: string;
  issue_status: string;
  expected_resolution: string | null;
  issue_description: string | null;
  action_taken: string | null;
  created_at: string;
};

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";
const STATUSES = ["Down", "Partially Working", "Resolved"];

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

export default function MachineIssuesPage() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [issues, setIssues] = useState<MachineIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(true);

  const [plantId, setPlantId] = useState("");
  const [machineName, setMachineName] = useState("");
  const [issueStatus, setIssueStatus] = useState("Down");
  const [expectedResolution, setExpectedResolution] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadData() {
    const [plantsRes, issuesRes] = await Promise.all([
      supabase.from("plants").select("*").eq("active", true).order("name"),
      supabase
        .from("machine_issues")
        .select("*")
        .neq("issue_status", "Resolved")
        .order("created_at", { ascending: false }),
    ]);
    setPlants(plantsRes.data || []);
    setIssues(issuesRes.data || []);
    setLoadingIssues(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const selectedPlant = plants.find((p) => p.id === plantId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    if (!plantId || !machineName || !issueDescription) {
      setSaving(false);
      setMessage("Please fill in plant, machine name, and issue description.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const enteredBy = userData.user?.email || "unknown";

    const { error } = await supabase.from("machine_issues").insert({
      plant_id: plantId,
      plant_name: selectedPlant?.name || "",
      machine_name: machineName,
      issue_status: issueStatus,
      expected_resolution: expectedResolution || null,
      issue_description: issueDescription,
      action_taken: actionTaken || null,
      entered_by: enteredBy,
    });

    setSaving(false);

    if (error) {
      setMessage("Error: " + error.message);
      return;
    }

    setMessage("✅ Machine issue submitted.");
    setPlantId("");
    setMachineName("");
    setIssueStatus("Down");
    setExpectedResolution("");
    setIssueDescription("");
    setActionTaken("");
    loadData();
  }

  const downCount = issues.filter((i) => i.issue_status === "Down").length;
  const partialCount = issues.filter(
    (i) => i.issue_status === "Partially Working"
  ).length;

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: NAVY, margin: 0 }}>
            Machine Issues
          </h1>
          <p style={{ color: SLATE, fontSize: "12px", marginTop: "5px" }}>
            Report any machine that is down or partially working. Resolved issues are cleared from the active list.
          </p>
        </div>

        {/* Summary pills */}
        {!loadingIssues && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "8px",
              marginBottom: "20px",
              maxWidth: "400px",
            }}
          >
            <CountCard label="Down" count={downCount} color="#dc2626" />
            <CountCard label="Partial" count={partialCount} color="#d97706" />
            <CountCard label="Total Open" count={issues.length} color={NAVY} />
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 440px) 1fr",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* Report form */}
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: "8px",
              padding: "16px",
              backgroundColor: "white",
            }}
          >
            <SectionTitle title="Report a Machine Issue" />
            <form onSubmit={handleSubmit}>
              <label style={labelStyle}>
                Plant
                <select
                  style={inputStyle}
                  value={plantId}
                  onChange={(e) => setPlantId(e.target.value)}
                  required
                >
                  <option value="">— Select plant —</option>
                  {plants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={labelStyle}>
                Machine name
                <input
                  type="text"
                  style={inputStyle}
                  value={machineName}
                  onChange={(e) => setMachineName(e.target.value)}
                  placeholder="e.g. Spinning Machine #2"
                  required
                />
              </label>

              <label style={labelStyle}>
                Status
                <select
                  style={inputStyle}
                  value={issueStatus}
                  onChange={(e) => setIssueStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>

              <label style={labelStyle}>
                Expected resolution
                <input
                  type="text"
                  style={inputStyle}
                  value={expectedResolution}
                  onChange={(e) => setExpectedResolution(e.target.value)}
                  placeholder="e.g. Today 5pm / Tomorrow / Waiting for part"
                />
              </label>

              <label style={labelStyle}>
                Issue description
                <textarea
                  style={{ ...inputStyle, height: "80px" }}
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  placeholder="What happened?"
                  required
                />
              </label>

              <label style={labelStyle}>
                Action taken so far
                <textarea
                  style={{ ...inputStyle, height: "70px" }}
                  value={actionTaken}
                  onChange={(e) => setActionTaken(e.target.value)}
                  placeholder="What has been done so far?"
                />
              </label>

              <button type="submit" disabled={saving} style={btnStyle}>
                {saving ? "Submitting…" : "Submit Machine Issue"}
              </button>

              {message && (
                <p
                  style={{
                    marginTop: "10px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: message.startsWith("Error") ? "#dc2626" : "#16a34a",
                  }}
                >
                  {message}
                </p>
              )}
            </form>
          </div>

          {/* Active issues table */}
          <div>
            <SectionTitle title={`Active Issues — ${issues.length} open`} />
            {loadingIssues ? (
              <p style={{ color: SLATE, fontSize: "13px" }}>Loading…</p>
            ) : issues.length === 0 ? (
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
                No open machine issues across any plant.
              </div>
            ) : (
              <div
                style={{
                  overflowX: "auto",
                  border: `1px solid ${BORDER}`,
                  borderRadius: "8px",
                  backgroundColor: "white",
                }}
              >
                <table
                  style={{
                    borderCollapse: "collapse",
                    width: "100%",
                    minWidth: "560px",
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc" }}>
                      <th style={th}>Plant</th>
                      <th style={th}>Machine</th>
                      <th style={th}>Status</th>
                      <th style={th}>Expected Fix</th>
                      <th style={th}>Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((m) => (
                      <tr key={m.id}>
                        <td style={tdBold}>{m.plant_name}</td>
                        <td style={td}>{m.machine_name}</td>
                        <td
                          style={{
                            ...td,
                            color:
                              m.issue_status === "Down" ? "#dc2626" : "#d97706",
                            fontWeight: 700,
                          }}
                        >
                          {m.issue_status}
                        </td>
                        <td style={td}>{m.expected_resolution || "—"}</td>
                        <td style={{ ...td, color: SLATE }}>
                          {m.issue_description || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
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
      <div style={{ color: SLATE, fontSize: "11px", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "19px", fontWeight: 800, color }}>{count}</div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 600,
  color: NAVY,
  marginBottom: "10px",
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

const btnStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "9px 18px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  marginTop: "4px",
};

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "6px 10px",
  fontSize: "11px",
  color: SLATE,
  fontWeight: 700,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "7px 10px",
  fontSize: "12px",
  verticalAlign: "top",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};
