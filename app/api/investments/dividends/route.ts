import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Only Admin/CEO can manage dividends (same tier as investments access).
async function requireInvestmentAdmin(
  supabase: ReturnType<typeof createServiceClient>,
  email: string
): Promise<true | Response> {
  const lc = email.toLowerCase();
  if (lc === "khuram1901@gmail.com" || lc === "k.saleem@unzegroup.com") return true;
  const { data: m } = await supabase
    .from("members")
    .select("role")
    .eq("email", lc)
    .maybeSingle();
  const role = m?.role ?? null;
  if (role === "Admin" || role === "CEO") return true;
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

// GET — return all dividends (windowed for UI, all for management)
// ?mode=upcoming&days=14&daysBack=14  → RPC with holdings join, ex-dividend date
//                                       within [today-daysBack, today+days]
// ?mode=all                           → raw table, all statuses
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") ?? "upcoming";
  const days = parseInt(searchParams.get("days") ?? "14", 10);
  const daysBack = parseInt(searchParams.get("daysBack") ?? "0", 10);

  if (mode === "upcoming") {
    const { data, error } = await supabase.rpc("get_upcoming_dividends", { p_days_ahead: days, p_days_back: daysBack });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ dividends: data ?? [] });
  }

  // mode=all — management view
  const { data, error } = await supabase
    .from("stock_dividends")
    .select("*")
    .order("ex_dividend_date", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ dividends: data ?? [] });
}

// POST — add a new dividend (Admin/CEO only)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const guard = await requireInvestmentAdmin(supabase, auth.email);
  if (guard !== true) return guard;

  const body = await request.json().catch(() => ({}));
  const {
    ticker, dividend_per_share, ex_dividend_date,
    payment_date, announced_date, notes,
    source = "manual", confirmed = true,
  } = body;

  if (!ticker || !dividend_per_share || !ex_dividend_date) {
    return Response.json(
      { error: "ticker, dividend_per_share and ex_dividend_date are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("stock_dividends")
    .insert({
      ticker: ticker.toUpperCase().trim(),
      dividend_per_share: Number(dividend_per_share),
      ex_dividend_date,
      payment_date: payment_date || null,
      announced_date: announced_date || null,
      notes: notes?.trim() || null,
      source,
      confirmed,
      status: "upcoming",
      entered_by: auth.email,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { error: "A dividend for this ticker and ex-dividend date already exists." },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ dividend: data }, { status: 201 });
}

// PATCH — update status, confirm/dismiss, or edit fields
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const guard = await requireInvestmentAdmin(supabase, auth.email);
  if (guard !== true) return guard;

  const body = await request.json().catch(() => ({}));
  const { id, ...fields } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  const allowed = [
    "ticker", "dividend_per_share", "ex_dividend_date", "payment_date",
    "announced_date", "status", "confirmed", "notes", "source",
  ] as const;
  for (const key of allowed) {
    if (fields[key] !== undefined) updates[key] = fields[key];
  }
  if (fields.dividend_per_share !== undefined) {
    updates.dividend_per_share = Number(fields.dividend_per_share);
  }

  const { data, error } = await supabase
    .from("stock_dividends")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ dividend: data });
}

// DELETE — remove a dividend record (Admin/CEO only)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const guard = await requireInvestmentAdmin(supabase, auth.email);
  if (guard !== true) return guard;

  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("stock_dividends").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
