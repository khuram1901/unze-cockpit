import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { isAdminTier, type UserCtx, type PermOverrides } from "../../../lib/permissions";

// Admin API behind /settings/telegram — maps members' Telegram chat IDs and
// toggles who may issue tasks from Telegram.

async function adminCtx(request: NextRequest): Promise<{ email: string } | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members")
    .select("id, role, department, company")
    .eq("email", auth.email)
    .maybeSingle();
  let overrides: PermOverrides | null = null;
  if (member?.id) {
    const { data: perms } = await supabase
      .from("member_permissions").select("*").eq("member_id", member.id).maybeSingle();
    overrides = (perms as PermOverrides) || null;
  }
  const ctx: UserCtx = {
    email: auth.email,
    role: member?.role ?? null,
    department: member?.department ?? null,
    company: member?.company ?? null,
    overrides,
  };
  if (!isAdminTier(ctx)) {
    return Response.json({ error: "Only admins can manage Telegram mapping." }, { status: 403 });
  }
  return auth;
}

export async function GET(request: NextRequest) {
  const auth = await adminCtx(request);
  if (auth instanceof Response) return auth;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("members")
    .select("id, first_name, last_name, name, email, department, company, telegram_chat_id, tg_can_issue_tasks")
    .order("first_name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ members: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await adminCtx(request);
  if (auth instanceof Response) return auth;

  let memberId: string;
  let chatId: number | null | undefined;
  let canIssue: boolean | undefined;

  try {
    const body = await request.json();
    memberId = String(body.memberId || "");
    if (!memberId) throw new Error("memberId required");

    if ("chatId" in body) {
      const raw = String(body.chatId || "").trim();
      if (raw === "" || raw === "null") {
        chatId = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n === 0) {
          return Response.json({ error: "Telegram ID must be a whole number (e.g. 123456789)." }, { status: 400 });
        }
        chatId = n;
      }
    }
    if ("canIssue" in body) canIssue = !!body.canIssue;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (chatId !== undefined) update.telegram_chat_id = chatId;
  if (canIssue !== undefined) update.tg_can_issue_tasks = canIssue;
  if (Object.keys(update).length === 0) return Response.json({ error: "Nothing to update." }, { status: 400 });

  const supabase = createServiceClient();

  // A chat_id may only map to ONE member.
  if (typeof update.telegram_chat_id === "number") {
    const { data: others } = await supabase
      .from("members")
      .select("id, first_name, last_name, name, telegram_chat_id")
      .neq("id", memberId)
      .not("telegram_chat_id", "is", null);
    const clash = (others || []).find((m) => m.telegram_chat_id === update.telegram_chat_id);
    if (clash) {
      const clashName = `${clash.first_name || ""} ${clash.last_name || ""}`.trim() || clash.name || "another member";
      return Response.json({ error: `That Telegram ID is already mapped to ${clashName}.` }, { status: 409 });
    }
  }

  const { error } = await supabase.from("members").update(update).eq("id", memberId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
