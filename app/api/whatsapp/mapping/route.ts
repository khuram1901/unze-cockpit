import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { isAdminTier, type UserCtx, type PermOverrides } from "../../../lib/permissions";

// Admin API behind /settings/whatsapp — maps members' WhatsApp numbers and
// toggles who may issue tasks from WhatsApp.

async function adminCtx(request: NextRequest): Promise<{ email: string } | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members").select("id, role, department, company").eq("email", auth.email).maybeSingle();
  let overrides: PermOverrides | null = null;
  if (member?.id) {
    const { data: perms } = await supabase.from("member_permissions").select("*").eq("member_id", member.id).maybeSingle();
    overrides = (perms as PermOverrides) || null;
  }
  const ctx: UserCtx = { email: auth.email, role: member?.role ?? null, department: member?.department ?? null, company: member?.company ?? null, overrides };
  if (!isAdminTier(ctx)) {
    return Response.json({ error: "Only admins can manage WhatsApp mapping." }, { status: 403 });
  }
  return auth;
}

export async function GET(request: NextRequest) {
  const auth = await adminCtx(request);
  if (auth instanceof Response) return auth;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("members")
    .select("id, first_name, last_name, name, email, department, company, phone_e164, wa_can_issue_tasks")
    .order("first_name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ members: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await adminCtx(request);
  if (auth instanceof Response) return auth;

  let memberId: string, phone: string | null | undefined, canIssue: boolean | undefined;
  try {
    const body = await request.json();
    memberId = String(body.memberId || "");
    if (!memberId) throw new Error("memberId required");
    if ("phone" in body) {
      const raw = String(body.phone || "").trim();
      if (raw === "") phone = null;
      else {
        const cleaned = raw.replace(/[\s\-()]/g, "");
        if (!/^\+?\d{8,15}$/.test(cleaned)) {
          return Response.json({ error: "Phone must be digits in international format, e.g. +447700900123 or +923001234567." }, { status: 400 });
        }
        phone = cleaned.startsWith("+") ? cleaned : "+" + cleaned;
      }
    }
    if ("canIssue" in body) canIssue = !!body.canIssue;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (phone !== undefined) update.phone_e164 = phone;
  if (canIssue !== undefined) update.wa_can_issue_tasks = canIssue;
  if (Object.keys(update).length === 0) return Response.json({ error: "Nothing to update." }, { status: 400 });

  const supabase = createServiceClient();

  // A phone number may only map to ONE member — it identifies the sender.
  if (typeof update.phone_e164 === "string") {
    const targetDigits = (update.phone_e164 as string).replace(/\D/g, "");
    const { data: others } = await supabase
      .from("members").select("id, first_name, last_name, name, phone_e164").neq("id", memberId).not("phone_e164", "is", null);
    const clash = (others || []).find((m) => (m.phone_e164 || "").replace(/\D/g, "") === targetDigits);
    if (clash) {
      const clashName = `${clash.first_name || ""} ${clash.last_name || ""}`.trim() || clash.name || "another member";
      return Response.json({ error: `That number is already mapped to ${clashName}.` }, { status: 409 });
    }
  }

  const { error } = await supabase.from("members").update(update).eq("id", memberId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
