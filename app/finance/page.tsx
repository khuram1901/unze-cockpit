"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COMPANIES, getCompanyByName } from "../lib/constants";

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

export default function FinancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

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

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "20px 24px" }}>
          <p style={{ color: SLATE }}>Loading...</p>
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ marginBottom: "20px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: NAVY, margin: 0 }}>
            Finance &mdash; Select Company
          </h1>
          <p style={{ color: SLATE, fontSize: "16px", marginTop: "5px" }}>
            Choose which company to manage.
          </p>
        </div>

        {showPicker && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "14px",
            maxWidth: "600px",
          }}>
            {COMPANIES.map((c) => (
              <a
                key={c.slug}
                href={`/finance/${c.slug}`}
                style={{
                  textDecoration: "none",
                  border: `1px solid ${BORDER}`,
                  borderTop: `3px solid ${NAVY}`,
                  borderRadius: "8px",
                  padding: "20px",
                  backgroundColor: "white",
                  cursor: "pointer",
                  transition: "box-shadow 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 2px 10px rgba(0,0,0,0.1)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none"; }}
              >
                <div style={{ fontSize: "18px", fontWeight: 700, color: NAVY, marginBottom: "4px" }}>
                  {c.name}
                </div>
                <div style={{ fontSize: "14px", color: SLATE }}>
                  Cash position, daily banking &amp; forecasting
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}
