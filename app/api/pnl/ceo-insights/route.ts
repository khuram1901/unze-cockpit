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
    const { companyId, from, to, plant, company, channel, branch } = await request.json();
    if (!from || !to) {
      return Response.json({ error: "from and to are required" }, { status: 400 });
    }

    const db = createServiceClient();
    let summary: Record<string, unknown>;
    let businessContext: string;

    if (company === "IFPL") {
      // Imperial Footwear — Unze London retail (plan vs actual).
      const channelFilter = typeof channel === "string" && channel ? channel : "All";
      const branchFilter = typeof branch === "string" && branch ? branch : "All";
      const [kpiRes, leagueRes, lineRes] = await Promise.all([
        db.rpc("ifpl_kpi_by_month", { p_from: from, p_to: to, p_channel: channelFilter, p_branch: branchFilter }),
        db.rpc("ifpl_branch_league", { p_from: from, p_to: to }),
        db.rpc("ifpl_line_totals", { p_from: from, p_to: to, p_channel: channelFilter, p_branch: branchFilter }),
      ]);
      if (kpiRes.error) return Response.json({ error: kpiRes.error.message }, { status: 500 });
      summary = {
        scope: branchFilter !== "All" ? `${branchFilter} branch only` : channelFilter !== "All" ? `${channelFilter} channel only` : "Whole company (all branches)",
        monthly_plan_vs_actual: kpiRes.data,
        branch_league: leagueRes.data || [],
        expense_lines: lineRes.data || [],
        note: "Amounts are PKR. Every figure has projection (plan) and actual — variance vs plan is central. Highly seasonal retail: Nov-Mar are the peak months.",
      };
      businessContext = `The company: Imperial Footwear (brand "Unze London") — Pakistani footwear retailer with ~32 branches across malls and cities plus a large Online PK channel (~24% of sales). Highly seasonal (wedding season Nov-Dec, Eid ~Mar). Head Office and warehouses are cost centres. You are briefing the CEO on plan-vs-actual discipline, branch performance, channel mix and seasonality risk.

Market context (Pakistan retail, as of July 2026):
- Footwear market growing ~6.5% CAGR; overall retail ~8.2% CAGR. Competitors with strong retail presence: Bata, Service, Stylo, Hush Puppies.
- E-commerce is the growth engine: Pakistan online sales projected past PKR 1.2 trillion in 2026, 85%+ of orders from mobile, social commerce (Facebook/Instagram/TikTok/WhatsApp) heading toward ~35% of online retail; fashion is the top category on marketplaces. Cash on delivery still dominates (~95%).
- Cost pressure on physical stores: CPI inflation 11.0% (June 2026), SBP policy rate 11.5%, elevated energy costs — mall rents, wages and electricity squeeze store margins while online scales cheaper.`;
    } else {
      if (!companyId) return Response.json({ error: "companyId is required" }, { status: 400 });
      const plantFilter = typeof plant === "string" && plant ? plant : "All";
      const [kpiRes, plantRes, costRes] = await Promise.all([
        db.rpc("pnl_kpi_summary_plant", { p_company_id: companyId, p_from: from, p_to: to, p_plant: plantFilter }),
        db.rpc("pnl_plant_margin_trend", { p_company_id: companyId, p_from: from, p_to: to }),
        db.rpc("pnl_cost_structure", { p_company_id: companyId, p_from: from, p_to: to, p_plant: plantFilter }),
      ]);
      if (kpiRes.error) return Response.json({ error: kpiRes.error.message }, { status: 500 });
      summary = {
        scope: plantFilter === "All" ? "Whole company (all plants + HO)" : `${plantFilter} only`,
        monthly_kpis: kpiRes.data,
        plant_margins: plantRes.data || [],
        cost_buckets: costRes.data || [],
        note: "Amounts are PKR. Costs are negative in monthly_kpis; in cost_buckets expenses are positive and income negative.",
      };
      businessContext = "";
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      tools: [{ name: "record_insights", description: "Record the CEO insights", input_schema: INSIGHT_SCHEMA }],
      tool_choice: { type: "tool", name: "record_insights" },
      messages: [{
        role: "user",
        content: company === "IFPL"
          ? `You are a sharp CFO briefing the CEO of a fast-growing Pakistani footwear retailer. Analyse the plan-vs-actual P&L data below and produce 4-6 insights (each tagged good / watch / urgent) and 3-5 concrete actions. Be direct and specific — quote figures in PKR millions (divide raw amounts by 1,000,000, one decimal). Focus on: variance vs plan, branch winners and losers, online vs retail margin mix, seasonality dependence, overhead discipline. No fluff.\n\n${businessContext}\n\nInternal data (JSON):\n${JSON.stringify(summary)}`
          : `You are a sharp CFO briefing the CEO of a Pakistani pole and smart-meter manufacturer. Analyse the monthly P&L data below and produce 4-6 insights (each tagged good / watch / urgent) and 3-5 concrete actions. Be direct and specific — quote figures in PKR millions (divide raw amounts by 1,000,000, one decimal). Focus on: margin trajectory, loss-making months, plant-level performance differences, cost structure shifts, and how the market context creates risk or opportunity. No fluff.\n\n${MARKET_CONTEXT}\n\nInternal data (JSON):\n${JSON.stringify(summary)}`,
      }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return Response.json({ error: "No insights generated" }, { status: 500 });
    }
    const result = toolUse.input as { insights: unknown; actions: unknown };

    // Persist so the same period+scope shows this exact analysis on every
    // return visit — regeneration upserts over the old row.
    const companyKey = company === "IFPL" ? "IFPL" : "UTPL";
    const scopeKey = company === "IFPL"
      ? `${typeof channel === "string" && channel ? channel : "All"}|${typeof branch === "string" && branch ? branch : "All"}`
      : (typeof plant === "string" && plant ? plant : "All");
    const generatedAt = new Date().toISOString();
    await db.from("pnl_commentary").upsert({
      company: companyKey,
      scope_key: scopeKey,
      month_from: from,
      month_to: to,
      insights: result.insights,
      actions: result.actions,
      generated_by: auth.email,
      generated_at: generatedAt,
    }, { onConflict: "company,scope_key,month_from,month_to" });

    return Response.json({ ...result, generated_at: generatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
