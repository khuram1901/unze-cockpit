"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";

type Plant = {
  id: string;
  name: string;
  type: string;
  active: boolean;
};

const STATUSES = ["Down", "Partially Working", "Resolved"];

export default function MachineIssuesPage() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState("");
  const [machineName, setMachineName] = useState("");
  const [issueStatus, setIssueStatus] = useState("Down");
  const [expectedResolution, setExpectedResolution] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadPlants() {
      const { data } = await supabase
        .from("plants")
        .select("*")
        .eq("active", true)
        .order("name");

      if (data) setPlants(data);
    }

    loadPlants();
  }, []);

  const selectedPlant = plants.find((p) => p.id === plantId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    if (!plantId || !machineName || !issueDescription) {
      setSaving(false);
      setMessage("Please select plant, machine name, and issue description.");
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
  }

  const inputStyle = {
    display: "block",
    width: "100%",
    maxWidth: "420px",
    padding: "10px",
    marginTop: "4px",
    marginBottom: "14px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "15px",
  };

  const sectionStyle = {
    border: "1px solid #e0e0e0",
    borderRadius: "10px",
    padding: "20px",
    maxWidth: "520px",
  };

  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "8px" }}>
          Machine Issues
        </h1>

        <p style={{ color: "#666", marginBottom: "24px" }}>
          Use this page to report any machine that is down, partially working, or resolved.
        </p>

        <form onSubmit={handleSubmit} style={sectionStyle}>
          <label>
            Plant
            <select
              style={inputStyle}
              value={plantId}
              onChange={(e) => setPlantId(e.target.value)}
              required
            >
              <option value="">-- Select plant --</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label>
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

          <label>
            Status
            <select
              style={inputStyle}
              value={issueStatus}
              onChange={(e) => setIssueStatus(e.target.value)}
              required
            >
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>

          <label>
            Expected resolution
            <input
              type="text"
              style={inputStyle}
              value={expectedResolution}
              onChange={(e) => setExpectedResolution(e.target.value)}
              placeholder="e.g. Today 5pm / Tomorrow / Waiting for part"
            />
          </label>

          <label>
            Issue description
            <textarea
              style={{ ...inputStyle, height: "90px" }}
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              placeholder="What happened?"
              required
            />
          </label>

          <label>
            Action taken
            <textarea
              style={{ ...inputStyle, height: "80px" }}
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              placeholder="What has been done so far?"
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              backgroundColor: "#0070f3",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "12px 24px",
              fontSize: "15px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {saving ? "Submitting…" : "Submit Machine Issue"}
          </button>

          {message && (
            <p
              style={{
                marginTop: "16px",
                fontSize: "14px",
                color: message.startsWith("Error") ? "red" : "green",
              }}
            >
              {message}
            </p>
          )}
        </form>
      </main>
    </AuthWrapper>
  );
}