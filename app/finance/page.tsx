"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COMPANIES, getCompanyByName } from "../lib/constants";
import { COLOURS, PageHeader, SectionTitle } from "../lib/SharedUI";

export default function FinancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [uploading, setUploading] = useState(false);

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
        <PageHeader title="Finance" subtitle="Cash position, daily banking, and forecasting" />

        {/* Company selector */}
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

            {/* Bulk upload — all companies */}
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
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
