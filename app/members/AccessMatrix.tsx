"use client";

import { useState } from "react";
import { COLOURS } from "../lib/SharedUI";
import {
  CEO_EMAIL, ADMIN_EMAIL, PA_EMAIL,
  canViewFinance, financeCompanies, canViewReceivables,
  canViewExecutiveDashboard, isAdminTier, type UserCtx,
} from "../lib/permissions";

// ──────────────────────────────────────────────────────────────────
// Access Matrix — read-only view of every member's EFFECTIVE rights.
//
// This mirrors the real enforcement logic so it is truthful:
//   • UI nav rules            → app/lib/AuthWrapper.tsx
//   • RLS finance/receivables → supabase/013, 015, 027
//   • Receivables overrides   → app/receivables/page.tsx (EDIT/VIEW emails)
//   • Special accounts        → CEO / Admin / PA emails
//
// If any of those rules change, update the helpers below to match.
// ──────────────────────────────────────────────────────────────────

export type MatrixMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  role: string;
  department: string | null;
  company: string | null;
};

type Access = "Full" | "Edit" | "View" | "None";

const ACCESS_COLOUR: Record<Access, string> = {
  Full: COLOURS.GREEN,
  Edit: COLOURS.BLUE,
  View: COLOURS.AMBER,
  None: "#cbd5e1",
};

function lc(s: string | null) { return (s || "").toLowerCase(); }
function ctx(m: MatrixMember): UserCtx {
  return { email: m.email, role: m.role, department: m.department, company: m.company };
}

// ── Capability resolvers — delegate to central permissions.ts ─────
function financeAccess(m: MatrixMember): Access {
  return canViewFinance(ctx(m)) ? "Full" : "None";
}
function financeScope(m: MatrixMember): string {
  const s = financeCompanies(ctx(m));
  return s === "none" ? "—" : s === "both" ? "Both" : s;
}
function receivablesAccess(m: MatrixMember): Access {
  if (!canViewReceivables(ctx(m))) return "None";
  if (isAdminTier(ctx(m))) return "Full";
  return "Edit";
}
function executiveAccess(m: MatrixMember): Access {
  return canViewExecutiveDashboard(ctx(m)) ? "Full" : "None";
}
function departmentData(m: MatrixMember): string {
  if (isAdminTier(ctx(m))) return "All departments";
  if (m.role === "Executive") return "Admin only (PA)";
  if (m.role === "Manager" && m.department) return `${m.department} only`;
  return "—";
}
function effectiveLabel(m: MatrixMember): string {
  const e = lc(m.email);
  if (e === CEO_EMAIL) return "CEO";
  if (e === ADMIN_EMAIL) return "Admin";
  if (e === PA_EMAIL || m.role === "Executive") return "PA";
  return m.role;
}

function fullName(m: MatrixMember) {
  return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unnamed";
}

function Pill({ value }: { value: Access }) {
  return (
    <span style={{
      display: "inline-block", fontSize: "11px", fontWeight: 700, color: "white",
      backgroundColor: ACCESS_COLOUR[value], borderRadius: "8px", padding: "2px 8px",
      minWidth: "42px", textAlign: "center",
    }}>{value}</span>
  );
}

export default function AccessMatrix({ members, isMobile }: { members: MatrixMember[]; isMobile: boolean }) {
  const [open, setOpen] = useState(false);

  const rows = [...members].sort((a, b) => {
    // Admin/Exec first, then Managers, then rest — alpha within
    const rank = (m: MatrixMember) => (isAdminTier(ctx(m)) ? 0 : m.role === "Executive" ? 1 : m.role === "Manager" ? 2 : 3);
    return rank(a) - rank(b) || fullName(a).localeCompare(fullName(b));
  });

  return (
    <div style={{ marginTop: "12px" }}>
      <div onClick={() => setOpen(!open)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
        border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "12px 16px",
        backgroundColor: open ? COLOURS.NAVY : "white",
      }}>
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: open ? "white" : COLOURS.NAVY }}>Access Control Matrix</div>
          <div style={{ fontSize: "12px", color: open ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>
            Everyone&rsquo;s effective rights at a glance — finance, receivables, departments
          </div>
        </div>
        <span style={{ color: open ? "white" : COLOURS.SLATE, fontSize: "14px" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", backgroundColor: "white", padding: "12px", overflowX: "auto" }}>
          {/* Legend */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "12px", fontSize: "12px", color: COLOURS.SLATE, alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>Legend:</span>
            {(["Full", "Edit", "View", "None"] as Access[]).map((a) => (
              <span key={a} style={{ display: "flex", alignItems: "center", gap: "4px" }}><Pill value={a} /></span>
            ))}
            <span style={{ marginLeft: "auto", fontStyle: "italic" }}>Read-only — toggling comes next</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: isMobile ? "640px" : "auto" }}>
            <thead>
              <tr style={{ backgroundColor: COLOURS.LIGHT, textAlign: "left" }}>
                {["Name", "Effective Role", "Department", "Finance", "Fin. Company", "Receivables", "Executive", "Dept Data"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${COLOURS.BORDER}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ fontWeight: 600, color: COLOURS.NAVY }}>{fullName(m)}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{m.email || "—"}</div>
                  </td>
                  <td style={{ padding: "8px 10px", fontWeight: 600, color: COLOURS.NAVY }}>{effectiveLabel(m)}</td>
                  <td style={{ padding: "8px 10px", color: COLOURS.SLATE }}>{m.department || "—"}</td>
                  <td style={{ padding: "8px 10px" }}><Pill value={financeAccess(m)} /></td>
                  <td style={{ padding: "8px 10px", color: COLOURS.SLATE }}>{financeScope(m)}</td>
                  <td style={{ padding: "8px 10px" }}><Pill value={receivablesAccess(m)} /></td>
                  <td style={{ padding: "8px 10px" }}><Pill value={executiveAccess(m)} /></td>
                  <td style={{ padding: "8px 10px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>{departmentData(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
