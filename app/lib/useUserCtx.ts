"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { UserCtx, PermOverrides } from "./permissions";

export function useUserCtx(): { ctx: UserCtx | null; loading: boolean } {
  const [ctx, setCtx] = useState<UserCtx | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active || !user?.email) { setLoading(false); return; }
      const { data: m } = await supabase
        .from("members").select("id, role, department, company").eq("email", user.email).maybeSingle();
      if (!active) return;
      let overrides: PermOverrides | null = null;
      if (m?.id) {
        const { data: p } = await supabase
          .from("member_permissions").select("*").eq("member_id", m.id).maybeSingle();
        if (p && active) overrides = p as PermOverrides;
      }
      if (!active) return;
      setCtx({
        email: user.email,
        role: m?.role ?? null,
        department: m?.department ?? null,
        company: m?.company ?? null,
        overrides,
      });
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, []);

  return { ctx, loading };
}
