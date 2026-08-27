import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";

// POST — upload a fuel slip image to Supabase Storage
// Accepts multipart/form-data with a field named "file"
// Returns { url: string } — the public URL of the stored image
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "No file provided" }, { status: 400 });

  // Enforce max 2 MB (already enforced by bucket, but check here too)
  if (file.size > 2 * 1024 * 1024) {
    return Response.json({ error: "File too large (max 2 MB)" }, { status: 413 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return Response.json({ error: "Only JPEG, PNG, or WebP images allowed" }, { status: 415 });
  }

  // Build a unique path: fuel-slips/<date>/<uuid>.<ext>
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const uid   = crypto.randomUUID();
  const path  = `${today}/${uid}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const supabase = createServiceClient();

  const { error } = await supabase.storage
    .from("fuel-slips")
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: { publicUrl } } = supabase.storage
    .from("fuel-slips")
    .getPublicUrl(path);

  return Response.json({ url: publicUrl });
}
