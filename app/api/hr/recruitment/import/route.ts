import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth } from "../../../../lib/api-auth";
import { createServiceClient } from "../../../../lib/supabase-server";

// ── Company name → company_id mapping ──────────────────────────────────────────
const COMPANY_ID_MAP: Record<string, string> = {
  "imperial":              "77921705-8a15-4406-847a-b234f84b5ec3",
  "imperial footwear":     "77921705-8a15-4406-847a-b234f84b5ec3",
  "imperial footwear pvt": "77921705-8a15-4406-847a-b234f84b5ec3",
  "unze trading":          "15884c2d-48a4-4d43-be90-0ef6e130790c",
  "unze trading pvt ltd":  "15884c2d-48a4-4d43-be90-0ef6e130790c",
  "baranh":                "6401ba75-f297-4617-84c1-305bcaf35a50",
  "baraanh":               "6401ba75-f297-4617-84c1-305bcaf35a50",
  "haute dolci":           "16a92b7f-b3fa-4271-819b-c6befb534f12",
  "hd":                    "16a92b7f-b3fa-4271-819b-c6befb534f12",
  "almahar":               "99bb9f67-4b19-48cb-b283-de1a8cabbd88",
};

function resolveCompanyId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return COMPANY_ID_MAP[key] ?? null;
}

// ── Status normalisation ────────────────────────────────────────────────────────
function normaliseStatus(remarks: unknown, section: string | null): string {
  const sec = (section ?? "").toUpperCase();
  if (sec.includes("ON HOLD")) return "On Hold";

  const r = String(remarks ?? "").toUpperCase().trim();
  if (!r || r === "NONE" || r === "NULL") {
    return sec.includes("CLOSED") ? "Filled" : "Open";
  }
  if (r.startsWith("CLOSED") || r.startsWith("CLSOED")) return "Filled";
  if (r.startsWith("PROCESS ONGOING")) return "Open";
  if (
    r.includes("EXPECTED DOJ") ||
    r.includes("D.O.J") ||
    r.includes("JOINED") ||
    r.includes("JOINING")
  ) return "Filled";
  if (r.includes("ONHOLD") || r === "ONHOLD") return "On Hold";
  if (sec.includes("CLOSED")) return "Filled";
  return "Open";
}

// ── Extract candidate name + salary from free-text remarks ──────────────────────
function extractFromRemarks(remarks: string | null): { candidate: string | null; salary: string | null } {
  if (!remarks) return { candidate: null, salary: null };

  // Try to find a name: patterns like "Mr. NAME selected", "NAME has been selected",
  // "Expected DOJ ... NAME selected", "NAME accepted the offer", etc.
  // We look for a capitalised word sequence before verbs like accepted/selected/shortlisted/joined
  const namePatterns = [
    /(?:Expected DOJ[^.]*?\.\s*)([A-Z][a-zA-Z\s\-\.]+?)\s+(?:accept|selected|select|shortlisted|joined|has been)/,
    /(?:Closed\s*[-–]\s*)([A-Z][a-zA-Z\s\-\.]+?)\s+(?:accept|selected|select|shortlisted|joined|has been)/i,
    /^(?:Closed\s*[-–]\s*)([A-Z][a-zA-Z\s\-\.]+?)\s+(?:accept|selected|select|shortlisted|joined|has been)/i,
    /(?:Mr\.|Ms\.|Mrs\.)\s+([A-Z][a-zA-Z\s\-\.]+?)\s+(?:accept|selected|select|shortlisted|joined|has been)/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\s+(?:accept|selected|select|shortlisted|joined|has been)\b/,
  ];

  let candidate: string | null = null;
  for (const pat of namePatterns) {
    const m = remarks.match(pat);
    if (m?.[1]) {
      candidate = m[1].trim().replace(/\s+/g, " ");
      break;
    }
  }

  // Salary: look for "@ XXk", "offer him XXk", "offer placed ... XXk", "XXk"
  const salaryPatterns = [
    /@\s*([\d,]+(?:k|K)?(?:\s*\+\s*[\d,]+(?:k|K)?(?:\s+\w+)?)?)/,
    /offer(?:ed)?\s+(?:him|her|them)?\s+(?:Rs\.?\s*)?([\d,]+(?:k|K)?(?:\s*\+\s*[\d,]+k?)?)/i,
    /salary\s+of\s+(?:Rs\.?\s*)?([\d,]+(?:k|K)?(?:\s*\+\s*[\d,]+k?)?)/i,
  ];

  let salary: string | null = null;
  for (const pat of salaryPatterns) {
    const m = remarks.match(pat);
    if (m?.[1]) {
      salary = m[1].trim();
      break;
    }
  }

  return { candidate, salary };
}

// ── Format Excel date value ─────────────────────────────────────────────────────
function fmtDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(val).trim();
  if (s === "-" || s === "" || s.toLowerCase() === "none") return null;
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// ── Parse Summary sheet → array of position rows ───────────────────────────────
function parseSummarySheet(ws: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false, dateNF: "yyyy-mm-dd" });

  // Re-parse with cellDates for actual Date objects
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });

  const positions: Record<string, unknown>[] = [];
  let currentSection: string | null = null;

  for (let i = 2; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    if (!row || row.every((c) => c == null)) continue;

    const col0 = String(row[0] ?? "").trim();

    // Section header rows (e.g. "CLOSED POSITIONS - JULY 2025")
    if (
      col0 &&
      typeof row[0] === "string" &&
      (col0.toUpperCase().includes("POSITIONS") || col0.toUpperCase().includes("SECTION"))
    ) {
      currentSection = col0;
      continue;
    }

    // Data rows have a numeric Sr. # in col 0
    const sr = Number(row[0]);
    if (!isFinite(sr) || sr <= 0) continue;

    const positionTitle = String(row[1] ?? "").trim();
    const rawCompany    = String(row[2] ?? "").trim();
    const required      = Number(row[3]) || 1;
    const salaryRange   = row[4] ? String(row[4]).trim() : null;
    const dateOpened    = fmtDate(row[5]);
    const dateClosed    = fmtDate(row[6]);
    const onHoldDate    = fmtDate(row[7]);
    const reOpenedDate  = fmtDate(row[8]);
    const reClosedDate  = fmtDate(row[9]);
    const assignedTo    = row[10] ? String(row[10]).trim() : null;
    const remarks       = row[11] ? String(row[11]).trim() : null;

    if (!positionTitle) continue;

    const status = normaliseStatus(remarks, currentSection);
    const { candidate, salary } = extractFromRemarks(remarks);

    positions.push({
      position_title:     positionTitle,
      flw_company:        rawCompany || null,
      company_id:         resolveCompanyId(rawCompany),
      required_count:     required,
      salary_range:       salaryRange,
      date_opened:        dateOpened,
      date_closed:        dateClosed || (status === "Filled" ? null : null),
      on_hold_date:       onHoldDate,
      re_opened_date:     reOpenedDate,
      re_closed_date:     reClosedDate,
      assigned_to:        assignedTo,
      flw_remarks:        remarks,
      status,
      selected_candidate: candidate,
      offered_salary:     salary,
      import_source:      "flwcm",
    });
  }

  return positions;
}

// ── Parse a candidate sheet → array of candidate rows ──────────────────────────
function parseCandidateSheet(ws: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, defval: null, raw: true,
  });
  if (rows.length < 2) return [];

  // Find header row (first row containing "Name" or "Employee Name")
  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = (rows[i] as unknown[]).map((c) => String(c ?? "").toLowerCase().trim());
    if (row.some((h) => h === "name" || h === "employee name" || h === "sr.#" || h === "sr. #")) {
      headerIdx = i;
      headers = row;
      break;
    }
  }

  if (headerIdx === -1) return [];

  // Identify column indices
  const nameIdx    = headers.findIndex((h) => h === "name" || h === "employee name");
  const contactIdx = headers.findIndex((h) => h.includes("contact"));
  const emailIdx   = headers.findIndex((h) => h === "email");
  const cvIdx      = headers.findIndex((h) => h.includes("cv") || h.includes("link") || h.includes("portfolio"));
  const ptIdx      = headers.findIndex((h) => h.includes("personality"));
  const dojIdx     = headers.findIndex((h) => h === "doj" || h.includes("joining") || h === "doi");
  const offerIdx   = headers.findIndex((h) => h.includes("extend offer") || h.includes("offer amount"));
  const stageIdx   = headers.findIndex((h) => h.includes("selected") || h.includes("reject"));

  // Feedback columns: anything after email that looks like a feedback column
  const feedbackIndices: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (
      h.includes("feedback") || h.includes("remarks") || h.includes("review") ||
      h.includes("recommendation") || h.includes("comment") || h.includes("hr head") ||
      h.includes("hod") || h.includes("gm") || h.includes("director") || h.includes("manager")
    ) {
      feedbackIndices.push(i);
    }
  }

  // Parse data rows
  const candidates: Record<string, unknown>[] = [];
  let currentName: string | null = null;
  let currentContact: string | null = null;
  let currentEmail: string | null = null;
  let currentOverview: string[] = [];
  let currentCvLink: string | null = null;
  let currentPT: string | null = null;
  let currentDoj: string | null = null;
  let currentOffer: string | null = null;
  let currentStage: string = "Applied";
  let currentFeedback: Record<string, string> = {};

  function flush() {
    if (!currentName) return;
    candidates.push({
      name:             currentName,
      contact:          currentContact,
      email:            currentEmail,
      overview:         currentOverview.filter(Boolean).join("\n").slice(0, 2000) || null,
      cv_link:          currentCvLink,
      personality_test: currentPT,
      stage:            currentStage,
      offer_amount:     currentOffer,
      date_of_joining:  currentDoj,
      feedback:         Object.keys(currentFeedback).length > 0 ? currentFeedback : {},
    });
    currentName = null; currentContact = null; currentEmail = null;
    currentOverview = []; currentCvLink = null; currentPT = null;
    currentDoj = null; currentOffer = null; currentStage = "Applied";
    currentFeedback = {};
  }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.every((c) => c == null)) continue;

    const nameVal = nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() : "";

    // A new candidate starts when the name cell has a meaningful value
    if (nameVal && nameVal.length > 1 && !nameVal.match(/^\d+$/)) {
      flush();
      currentName    = nameVal;
      currentContact = contactIdx >= 0 ? String(row[contactIdx] ?? "").trim() || null : null;
      currentEmail   = emailIdx >= 0   ? String(row[emailIdx]   ?? "").trim() || null : null;
      currentCvLink  = cvIdx >= 0      ? String(row[cvIdx]      ?? "").trim() || null : null;
      currentPT      = ptIdx >= 0      ? String(row[ptIdx]      ?? "").trim() || null : null;

      // Stage determination
      if (stageIdx >= 0) {
        const sv = String(row[stageIdx] ?? "").toLowerCase();
        if (sv.includes("selected") || sv.includes("hired")) currentStage = "Hired";
        else if (sv.includes("reject")) currentStage = "Rejected";
      }

      // Offer amount
      if (offerIdx >= 0) {
        const ov = String(row[offerIdx] ?? "").trim();
        if (ov && ov !== "null" && ov !== "-") currentOffer = ov;
      }

      // DOJ
      if (dojIdx >= 0) {
        const dv = fmtDate(row[dojIdx]);
        if (dv) { currentDoj = dv; currentStage = "Hired"; }
      }

      // Feedback columns
      for (const fi of feedbackIndices) {
        const label = headers[fi];
        const val   = String(row[fi] ?? "").trim();
        if (val && val !== "null") currentFeedback[label] = val;
      }

      // Overview / detail column (any remaining large text column)
      // Take the longest non-null string from the row that isn't already captured
      const captured = new Set([nameIdx, contactIdx, emailIdx, cvIdx, ptIdx, stageIdx, offerIdx, dojIdx, ...feedbackIndices]);
      for (let ci = 0; ci < row.length; ci++) {
        if (captured.has(ci)) continue;
        const v = String(row[ci] ?? "").trim();
        if (v.length > 10) currentOverview.push(v);
      }
    } else {
      // Continuation row — accumulate overview text
      for (let ci = 0; ci < row.length; ci++) {
        const v = String(row[ci] ?? "").trim();
        if (v.length > 5 && !v.match(/^\d+$/)) currentOverview.push(v);
      }
    }
  }
  flush();

  return candidates.filter((c) => c.name && String(c.name).length > 1);
}

// ── Normalise sheet name for matching ──────────────────────────────────────────
function normKey(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

// ── POST /api/hr/recruitment/import ────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const summaryName = wb.SheetNames.find((n) => n.trim() === "Summary" || n.toLowerCase().includes("summary"));
  if (!summaryName) {
    return NextResponse.json({ error: "Summary sheet not found in uploaded file" }, { status: 400 });
  }

  const summaryWs = wb.Sheets[summaryName];
  const positions  = parseSummarySheet(summaryWs);

  if (positions.length === 0) {
    return NextResponse.json({ error: "No positions found in Summary sheet" }, { status: 400 });
  }

  const db = createServiceClient();

  // ── Upsert positions ──────────────────────────────────────────────────────────
  let posInserted = 0;
  let posUpdated  = 0;
  const positionIdMap: Map<string, string> = new Map();

  for (const pos of positions) {
    const hasKey = !!pos.date_opened && !!pos.flw_company;

    if (hasKey) {
      // Try to find existing
      const { data: existing } = await db
        .from("recruitment_positions")
        .select("id")
        .eq("position_title", pos.position_title as string)
        .eq("flw_company", pos.flw_company as string)
        .eq("date_opened", pos.date_opened as string)
        .maybeSingle();

      if (existing) {
        await db
          .from("recruitment_positions")
          .update({
            salary_range:       pos.salary_range,
            required_count:     pos.required_count,
            date_closed:        pos.date_closed,
            on_hold_date:       pos.on_hold_date,
            re_opened_date:     pos.re_opened_date,
            re_closed_date:     pos.re_closed_date,
            assigned_to:        pos.assigned_to,
            flw_remarks:        pos.flw_remarks,
            flw_company:        pos.flw_company,
            company_id:         pos.company_id,
            status:             pos.status,
            selected_candidate: pos.selected_candidate,
            offered_salary:     pos.offered_salary,
            import_source:      "flwcm",
          })
          .eq("id", existing.id);
        positionIdMap.set(String(pos.position_title) + "|" + String(pos.flw_company), existing.id);
        posUpdated++;
      } else {
        const { data: inserted } = await db
          .from("recruitment_positions")
          .insert(pos)
          .select("id")
          .single();
        if (inserted) {
          positionIdMap.set(String(pos.position_title) + "|" + String(pos.flw_company), inserted.id);
          posInserted++;
        }
      }
    } else {
      // No unique key — just insert
      const { data: inserted } = await db
        .from("recruitment_positions")
        .insert(pos)
        .select("id")
        .single();
      if (inserted) {
        positionIdMap.set(String(pos.position_title) + "|" + String(pos.flw_company || ""), inserted.id);
        posInserted++;
      }
    }
  }

  // ── Parse candidate sheets and link to positions ──────────────────────────────
  let candInserted = 0;

  const candidateSheets = wb.SheetNames.filter(
    (n) => n !== summaryName && n.trim() !== "Sheet1" && n.trim() !== "Sheet2"
  );

  for (const sheetName of candidateSheets) {
    const ws   = wb.Sheets[sheetName];
    const cands = parseCandidateSheet(ws);
    if (cands.length === 0) continue;

    // Try to match sheet name to a position
    const normSheet = normKey(sheetName);
    let matchedId: string | null = null;

    // Exact match first
    for (const [key, id] of positionIdMap) {
      const posTitle = key.split("|")[0];
      if (normKey(posTitle) === normSheet) { matchedId = id; break; }
    }
    // Substring match
    if (!matchedId) {
      for (const [key, id] of positionIdMap) {
        const posTitle = key.split("|")[0];
        const normPos  = normKey(posTitle);
        if (normPos.includes(normSheet) || normSheet.includes(normPos)) {
          matchedId = id; break;
        }
      }
    }

    if (!matchedId) {
      // Create a position record for this sheet so candidates have a home
      const { data: newPos } = await db
        .from("recruitment_positions")
        .insert({
          position_title: sheetName.trim(),
          status:         "Filled",
          import_source:  "flwcm",
        })
        .select("id")
        .single();
      if (newPos) matchedId = newPos.id;
    }

    if (!matchedId) continue;

    // Delete existing auto-imported candidates to avoid duplicates on re-import
    await db
      .from("recruitment_candidates")
      .delete()
      .eq("position_id", matchedId);

    // Insert candidates
    for (const cand of cands) {
      const { error } = await db
        .from("recruitment_candidates")
        .insert({ ...cand, position_id: matchedId });
      if (!error) candInserted++;
    }
  }

  return NextResponse.json({
    ok: true,
    positions_inserted: posInserted,
    positions_updated:  posUpdated,
    candidates_inserted: candInserted,
    total_positions:    positions.length,
  });
}
