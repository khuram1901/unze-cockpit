import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// Market context researched 17/07/2026 — kept server-side so the model can
// tie internal numbers to the outside world. Refresh occasionally.
const MARKET_CONTEXT = `
Market context (Pakistan, as of July 2026):
- Demand tailwinds for distribution infrastructure: ADB has proposed the $130m
  Second Power Distribution Strengthening Project (PDSP-II) covering PESCO,
  HAZECO, QESCO, LESCO and SEPCO; an earlier $200m ADB loan funds at least
  332,000 AMI smart meters; the World Bank approved $375.9m for grid
  stability (BEST-PAK). Government target: replace all old meters with AMI
  meters by December 2026, via a PPP AMISP covering LESCO, MEPCO, PESCO,
  HAZECO and QESCO.
- Cost headwinds: steel rebar around PKR 222-232/kg (grade 60); CPI inflation
  11.0% (June 2026); SBP policy rate 11.5% after an April 2026 hike; energy
  costs elevated (petrol/diesel roughly 48%/38% above pre-conflict levels).
- The company: Unze Trading (UTPL) manufactures concrete distribution poles
  (31/36/45 ft) for Pakistani DISCOs at plants serving MEPCO, PESCO and
  FIEDMC, and operates a smart meter plant. Sales are lumpy, driven by DISCO
  tender wins and dispatch schedules.
`;

const INSIGHT_SCHEMA = {
  type: "object" as const,
  properties: {
    insights: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const, description: "Short headline, max 10 words" },
          detail: { type: "string" as const, description: "2-3 sentences. Reference actual figures in PKR millions." },
          severity: { type: "string" as const, enum: ["good", "watch", "urgent"] },
        },
        required: ["title", "detail", "severity"],
        additionalProperties: false as const,
      },
    },
    actions: {
      type: "array" as const,
      items: { type: "string" as const, description: "One concrete executive action, one sentence" },
    },
  },
  required: ["insights", "actions"],
  additionalProperties: false as const,
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { companyId, from, to, plant } = await request.json();
    if (!companyId || !from || !to) {
      return Response.json({ error: "companyId, from and to are required" }, { status: 400 });
    }
    const plantFilter = typeof plant === "string" && plant ? plant : "All";

    const db = createServiceClient();
    const [kpiRes, plantRes, costRes] = await Promise.all([
      db.rpc("pnl_kpi_summary_plant", { p_company_id: companyId, p_from: from, p_to: to, p_plant: plantFilter }),
      db.rpc("pnl_plant_margin_trend", { p_company_id: companyId, p_from: from, p_to: to }),
      db.rpc("pnl_cost_structure", { p_company_id: companyId, p_from: from, p_to: to, p_plant: plantFilter }),
    ]);
    if (kpiRes.error) return Response.json({ error: kpiRes.error.message }, { status: 500 });

    const summary = {
      scope: plantFilter === "All" ? "Whole company (all plants + HO)" : `${plantFilter} only`,
      monthly_kpis: kpiRes.data,
      plant_margins: plantRes.data || [],
      cost_buckets: costRes.data || [],
      note: "Amounts are PKR. Costs are negative in monthly_kpis; in cost_buckets expenses are positive and income negative.",
    };

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      tools: [{ name: "record_insights", description: "Record the CEO insights", input_schema: INSIGHT_SCHEMA }],
      tool_choice: { type: "tool", name: "record_insights" },
      messages: [{
        role: "user",
        content: `You are a sharp CFO briefing the CEO of a Pakistani pole and smart-meter manufacturer. Analyse the monthly P&L data below and produce 4-6 insights (each tagged good / watch / urgent) and 3-5 concrete actions. Be direct and specific — quote figures in PKR millions (divide raw amounts by 1,000,000, one decimal). Focus on: margin trajectory, loss-making months, plant-level performance differences, cost structure shifts, and how the market context creates risk or opportunity. No fluff.\n\n${MARKET_CONTEXT}\n\nInternal data (JSON):\n${JSON.stringify(summary)}`,
      }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return Response.json({ error: "No insights generated" }, { status: 500 });
    }
    return Response.json(toolUse.input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
