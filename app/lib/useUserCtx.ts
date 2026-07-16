"use client";

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions, loadMyWidgetOverrides } from "./supabase";
import type { UserCtx, PermOverrides, WidgetOverrides } from "./permissions";

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
      const permData = await loadMyPermissions();
      if (permData) overrides = permData as PermOverrides;
      let widgetOverrides: WidgetOverrides | null = null;
      const widgetData = await loadMyWidgetOverrides();
      if (widgetData) widgetOverrides = widgetData;
      if (!active) return;
      setCtx({
        email: user.email,
        role: m?.role ?? null,
        department: m?.department ?? null,
        company: m?.company ?? null,
        overrides,
        widgetOverrides,
      });
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, []);

  return { ctx, loading };
}
