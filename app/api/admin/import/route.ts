import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Simple CSV line parser — handles quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

// DD/MM/YYYY → YYYY-MM-DD
function parseDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function parseNum(s: string): number | null {
  if (!s || s.trim() === "" || s.trim() === "-") return null;
  const n = parseFloat(s.replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}

function parseIntVal(s: string): number | null {
  if (!s || s.trim() === "" || s.trim() === "-") return null;
  const n = parseInt(s.replace(/,/g, "").trim(), 10);
  return isNaN(n) ? null : n;
}

// GET — ?type=fuel|maintenance|solar  → returns CSV template
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const type = new URL(request.url).searchParams.get("type");

  let csv = "";
  let filename = "";

  if (type === "fuel") {
    filename = "fuel_log_template.csv";
    csv = [
      "Date (DD/MM/YYYY),Plate Number,Price Per Litre (PKR),Quantity (Litres),Previous Odometer (km),Current Odometer (km)",
      "01/07/2026,AGK-001,278.50,65.0,54591,55213",
      "05/07/2026,ASQ-321,278.50,58.0,98234,98800",
    ].join("\n");
  } else if (type === "maintenance") {
    filename = "maintenance_template.csv";
    csv = [
      "Date (DD/MM/YYYY),Plate Number,Work Type,Description,Odometer (km),Cost (PKR),Workshop",
      "15/06/2026,AGK-001,Oil Change,Engine oil + filter replacement,54200,12500,ABC Motors",
      "20/06/2026,ASQ-321,Tyre Rotation,4 tyres rotated,98000,4000,Quick Fit",
    ].join("\n");
  } else if (type === "solar") {
    filename = "solar_template.csv";
    csv = [
      "Date (DD/MM/YYYY),Site Name,Units Produced (kWh)",
      "01/07/2026,482-XX,58.4",
      "01/07/2026,FIEDMC,72.1",
      "01/07/2026,Head Office,54.8",
    ].join("\n");
  } else {
    return Response.json({ error: "Unknown type. Use type=fuel, maintenance, or solar." }, { status: 400 });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// POST — multipart form: type + file (CSV)  → imports data
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const type = formData.get("type") as string;
  const file = formData.get("file") as File | null;

  if (!file || !type) return Response.json({ error: "type and file are required" }, { status: 400 });

  const text = await file.text();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return Response.json({ error: "No data rows found (file appears empty)" }, { status: 400 });

  // Skip header row
  const dataRows = lines.slice(1);
  const supabase = createServiceClient();

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // ── Fuel log ─────────────────────────────────────────────────────────
  if (type === "fuel") {
    const { data: vehicles } = await supabase
      .from("admin_vehicles").select("id, plate_number").eq("is_active", true);
    const vehicleMap = new Map((vehicles || []).map((v) => [v.plate_number.toLowerCase(), v.id]));

    for (let i = 0; i < dataRows.length; i++) {
      const cols = parseCSVLine(dataRows[i]);
      const [dateStr, plate, pplStr, qtyStr, prevStr, currStr] = cols;
      if (!dateStr || !plate) { skipped++; continue; }

      const date = parseDate(dateStr);
      if (!date) { errors.push(`Row ${i + 2}: invalid date "${dateStr}" — use DD/MM/YYYY`); skipped++; continue; }

      const vehicleId = vehicleMap.get((plate || "").toLowerCase().trim());
      if (!vehicleId) { errors.push(`Row ${i + 2}: vehicle plate not found "${plate}"`); skipped++; continue; }

      const qty = parseNum(qtyStr);
      const ppl = parseNum(pplStr);
      if (!qty || !ppl) { errors.push(`Row ${i + 2}: invalid quantity or price per litre`); skipped++; continue; }

      // Skip duplicate
      const { count } = await supabase.from("admin_fuel_log")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicleId).eq("date", date).eq("quantity_litres", qty);
      if ((count || 0) > 0) { skipped++; continue; }

      const { error: err } = await supabase.from("admin_fuel_log").insert({
        vehicle_id: vehicleId,
        date,
        price_per_litre: ppl,
        quantity_litres: qty,
        previous_odometer: parseIntVal(prevStr || "") ?? null,
        current_odometer:  parseIntVal(currStr || "") ?? null,
        entered_by: "csv-import",
      });
      if (err) { errors.push(`Row ${i + 2}: ${err.message}`); skipped++; }
      else imported++;
    }

  // ── Maintenance ───────────────────────────────────────────────────────
  } else if (type === "maintenance") {
    const { data: vehicles } = await supabase
      .from("admin_vehicles").select("id, plate_number").eq("is_active", true);
    const vehicleMap = new Map((vehicles || []).map((v) => [v.plate_number.toLowerCase(), v.id]));

    for (let i = 0; i < dataRows.length; i++) {
      const cols = parseCSVLine(dataRows[i]);
      const [dateStr, plate, workType, description, odoStr, costStr, workshop] = cols;
      if (!dateStr || !plate) { skipped++; continue; }

      const date = parseDate(dateStr);
      if (!date) { errors.push(`Row ${i + 2}: invalid date "${dateStr}" — use DD/MM/YYYY`); skipped++; continue; }

      const vehicleId = vehicleMap.get((plate || "").toLowerCase().trim());
      if (!vehicleId) { errors.push(`Row ${i + 2}: vehicle plate not found "${plate}"`); skipped++; continue; }

      const cost = parseNum(costStr);
      if (cost == null) { errors.push(`Row ${i + 2}: invalid cost "${costStr}"`); skipped++; continue; }

      // Skip duplicate (same vehicle, date, work type, cost)
      const { count } = await supabase.from("admin_vehicle_maintenance")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicleId).eq("date", date)
        .eq("work_type", workType || "Other").eq("cost_pkr", cost);
      if ((count || 0) > 0) { skipped++; continue; }

      const { error: err } = await supabase.from("admin_vehicle_maintenance").insert({
        vehicle_id:  vehicleId,
        date,
        work_type:   workType?.trim() || "Other",
        description: description?.trim() || null,
        odometer_km: parseIntVal(odoStr || "") ?? null,
        cost_pkr:    cost,
        workshop:    workshop?.trim() || null,
        entered_by:  "csv-import",
      });
      if (err) { errors.push(`Row ${i + 2}: ${err.message}`); skipped++; }
      else imported++;
    }

  // ── Solar readings ────────────────────────────────────────────────────
  } else if (type === "solar") {
    const { data: branches } = await supabase
      .from("admin_solar_branches").select("id, name").eq("is_active", true);
    const branchMap = new Map((branches || []).map((b) => [b.name.toLowerCase(), b.id]));

    for (let i = 0; i < dataRows.length; i++) {
      const cols = parseCSVLine(dataRows[i]);
      const [dateStr, siteName, kwhStr] = cols;
      if (!dateStr || !siteName) { skipped++; continue; }

      const date = parseDate(dateStr);
      if (!date) { errors.push(`Row ${i + 2}: invalid date "${dateStr}" — use DD/MM/YYYY`); skipped++; continue; }

      const branchId = branchMap.get((siteName || "").toLowerCase().trim());
      if (!branchId) { errors.push(`Row ${i + 2}: solar site not found "${siteName}"`); skipped++; continue; }

      const kwh = parseNum(kwhStr);
      if (kwh == null) { errors.push(`Row ${i + 2}: invalid kWh value "${kwhStr}"`); skipped++; continue; }

      const { error: err } = await supabase.from("admin_solar_readings").upsert(
        { branch_id: branchId, date, units_produced_kwh: kwh, entered_by: "csv-import" },
        { onConflict: "branch_id,date" }
      );
      if (err) { errors.push(`Row ${i + 2}: ${err.message}`); skipped++; }
      else imported++;
    }

  } else {
    return Response.json({ error: `Unknown type: "${type}"` }, { status: 400 });
  }

  return Response.json({
    imported,
    skipped,
    errors: errors.slice(0, 15),  // cap at 15 to avoid huge responses
  });
}
