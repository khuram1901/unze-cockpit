import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

const BUCKET = "member-photos";
const MAX_BYTES = 150_000; // 150 KB after canvas compression

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  // Parse multipart — the client sends: memberId (field) + photo (file)
  let formData: FormData;
  try { formData = await request.formData(); }
  catch { return NextResponse.json({ error: "Invalid form data" }, { status: 400 }); }

  const memberId = formData.get("memberId") as string | null;
  const file     = formData.get("photo") as File | null;

  if (!memberId || !file) {
    return NextResponse.json({ error: "memberId and photo are required" }, { status: 400 });
  }

  // Any user may upload their own photo. Admins/CEOs may upload for anyone.
  const { data: me } = await supabase
    .from("members")
    .select("id, role")
    .eq("email", auth.email)
    .maybeSingle();

  const isAdmin = me && (me.role === "Admin" || me.role === "CEO" || me.role === "Executive");
  const isOwn   = me?.id === memberId;

  if (!isAdmin && !isOwn) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate size — canvas should compress well under this
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Image too large (${Math.round(file.size / 1000)} KB). Max is ${MAX_BYTES / 1000} KB.` }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const path  = `${memberId}.jpg`;

  // Upsert into storage (overwrite existing photo for this member)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });

  if (upErr) {
    console.error("Storage upload error:", upErr);
    return NextResponse.json({ error: "Upload failed: " + upErr.message }, { status: 500 });
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // Bust CDN cache by appending a timestamp query param
  const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  // Save to members table
  const { error: dbErr } = await supabase
    .from("members")
    .update({ photo_url: photoUrl })
    .eq("id", memberId);

  if (dbErr) {
    return NextResponse.json({ error: "DB update failed: " + dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ photoUrl });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: me } = await supabase
    .from("members")
    .select("role")
    .eq("email", auth.email)
    .maybeSingle();
  if (!me || (me.role !== "Admin" && me.role !== "CEO" && me.role !== "Executive")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { memberId } = await request.json();
  if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

  await supabase.storage.from(BUCKET).remove([`${memberId}.jpg`]);
  await supabase.from("members").update({ photo_url: null }).eq("id", memberId);

  return NextResponse.json({ ok: true });
}
