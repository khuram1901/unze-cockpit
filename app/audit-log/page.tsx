"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import { supabase } from "../lib/supabase";
import { formatDateTimeUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle } from "../lib/SharedUI";

type LogEntry = {
  id: string;
  user_email: string;
  user_name: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  details: string | null;
  created_at: string;
};

export default function AuditLogPage() {
  const isMobile = useMobile();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setLogs(data || []);
    setLoading(false);
  }

  const filtered = filter
    ? logs.filter((l) =>
        l.user_name?.toLowerCase().includes(filter.toLowerCase()) ||
        l.user_email.toLowerCase().includes(filter.toLowerCase()) ||
        l.table_name.toLowerCase().includes(filter.toLowerCase()) ||
        l.action.toLowerCase().includes(filter.toLowerCase()) ||
        l.details?.toLowerCase().includes(filter.toLowerCase())
      )
    : logs;

  return (
    <AuthWrapper>
      <RoleGuard allowedRoles={["Admin"]}>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
          <PageHeader title="Audit Log" subtitle="Who did what and when — last 200 entries" />

          <div style={{ marginBottom: "14px" }}>
            <input
              type="text"
              placeholder="Filter by user, table, action, or details..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "400px",
                padding: "8px 12px",
                border: `1px solid ${COLOURS.BORDER}`,
                borderRadius: "6px",
                fontSize: "16px",
                boxSizing: "border-box",
              }}
            />
          </div>

          {loading ? (
            <p style={{ color: COLOURS.SLATE, fontSize: "16px" }}>Loading...</p>
          ) : filtered.length === 0 ? (
            <p style={{ color: COLOURS.SLATE, fontSize: "16px" }}>No log entries found.</p>
          ) : (
            <div>
              {filtered.map((log) => (
                <div key={log.id} style={{
                  border: `1px solid ${COLOURS.BORDER}`,
                  borderRadius: "8px",
                  padding: "10px 12px",
                  backgroundColor: "white",
                  marginBottom: "6px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>
                        {log.user_name || log.user_email}
                        <span style={{
                          fontSize: "14px",
                          fontWeight: 600,
                          marginLeft: "8px",
                          padding: "1px 8px",
                          borderRadius: "8px",
                          backgroundColor: log.action === "Created" ? "#dcfce7" : log.action === "Deleted" ? "#fee2e2" : "#fef3c7",
                          color: log.action === "Created" ? "#166534" : log.action === "Deleted" ? "#991b1b" : "#92400e",
                        }}>
                          {log.action}
                        </span>
                      </div>
                      <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "2px" }}>
                        <strong>{log.table_name}</strong>
                        {log.details && <span> — {log.details}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {formatDateTimeUK(log.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </RoleGuard>
    </AuthWrapper>
  );
}
