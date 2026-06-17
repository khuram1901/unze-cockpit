import { supabase } from "./supabase";

export async function logAction(
  action: string,
  tableName: string,
  details?: string,
  recordId?: string
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return;

  const { data: member } = await supabase
    .from("members")
    .select("first_name, last_name, name")
    .eq("email", user.email)
    .maybeSingle();

  const userName = member
    ? `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || user.email
    : user.email;

  await supabase.from("audit_log").insert({
    user_email: user.email,
    user_name: userName,
    action,
    table_name: tableName,
    record_id: recordId || null,
    details: details || null,
  });
}
