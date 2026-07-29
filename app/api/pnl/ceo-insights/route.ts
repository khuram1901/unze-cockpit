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
- Cost headwinds: steel rebar around PKR 222-232/kg (grade 60); inflation
  elevated (7-11% range through 2026); SBP policy rate 11.5%; energy costs
  elevated (petrol/diesel roughly 48%/38% above pre-conflict levels).
- Competition (confirmed by the CEO: tenders are PRICE-DRIVEN, lowest
  compliant bidder wins — cost discipline IS the margin): poles — EAP
  (Engineers Associated Precast, the spun-pole pioneer with a patent) and
  Rajput Concrete (supplying LESCO/MEPCO/GEPCO/FESCO since 2018) plus
  regional makers; meters — Pak Elektron (PEL) and MicroTech (MTI, AMR
  deployed and developing AMI). The AMI spec (15-min reporting, GPRS/RF
  mesh) raises the technical bar; NEPRA's rollout runs via LESCO/KE/IESCO
  first. WAPDA/DISCO spun-pole demand is currently rising.
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

    if (company === "BARANH" || company === "HD") {
      // Restaurants — Baranh (premium desi dining) or Haute Dolci (desserts).
      const branchFilter = typeof branch === "string" && branch ? branch : "All";
      const [kpiRes, leagueRes, lineRes] = await Promise.all([
        db.rpc("rest_kpi_by_month", { p_company: company, p_from: from, p_to: to, p_branch: branchFilter }),
        db.rpc("rest_branch_league", { p_company: company, p_from: from, p_to: to }),
        db.rpc("rest_line_totals", { p_company: company, p_from: from, p_to: to, p_branch: branchFilter }),
      ]);
      if (kpiRes.error) return Response.json({ error: kpiRes.error.message }, { status: 500 });
      summary = {
        scope: branchFilter !== "All" ? `${branchFilter} branch only` : "Whole company (all branches)",
        monthly_kpis: kpiRes.data,
        branch_league: leagueRes.data || [],
        line_totals: lineRes.data || [],
        note: "Amounts are PKR actuals (no budget exists). Costs are stored positive. Food cost % = Total COGS / Net Sales is the key restaurant metric.",
      };
      businessContext = `The company: ${company === "BARANH" ? "Baranh — a casual/family dining restaurant chain (Lahore: Gulberg, Raya, Y-Block, plus a new Packages branch)" : "Haute Dolci — a casual/family dessert-dining chain FRANCHISED from the UK brand (founder Nizam Mohamed, East London; five Lahore sites: Raya, Gulberg, Dolmen, Y-Block, Packages). Franchise economics matter: brand fees and imported spec costs sit in the P&L regardless of sales"}. Part of the Unze Group. Head Office and warehouse costs are allocated to branches below the operating line.

Market context (Pakistan restaurants, as of July 2026 — positioning confirmed by the CEO as casual/family dining):
- Casual/family dining is the widest, most contested segment: every mall food court, mid-range chain and fast-food giant competes for the same family outing. Top-10 chains hold ~28% of the market; delivery platforms (Foodpanda) take heavy commissions visible in the P&L.
- SINGLE-CITY CONCENTRATION: the whole portfolio is in Lahore — Pakistan's most competitive dining scene, whose mall landscape shifted when Dolmen Mall Lahore (the country's biggest) opened Dec-24. Both brands share the same locations (Gulberg, Raya, Y-Block, Packages), so area-level softness hits both at once.
- Food cost inflation averaged ~8.6%/yr through 2025, easing lately, but ingredient costs remain the biggest margin lever; inflation 7-11% through 2026, SBP policy rate 11.5%.
- Typical healthy full-service restaurant food cost is 28-35% of net sales; rent+labour together should stay under ~35%.
You are briefing the CEO on branch profitability, food cost discipline, expense creep, franchise-cost burden (HD), and whether loss-making branches are structural or seasonal.`;
    } else if (company === "IFPL") {
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
- Footwear market growing ~6.5% CAGR; overall retail ~8.2% CAGR.
- Competition on THREE fronts (confirmed by the CEO — the brand straddles all three): premium ladies (Stylo 200+ outlets + Insignia, Metro Shoes 40+, ECS); mid-market volume (Bata, Service/Ndure, Borjan 145+ outlets); and online (marketplaces, social sellers, D2C — fashion is the top online category).
- E-commerce is the growth engine: Pakistan online sales projected past PKR 1.2 trillion in 2026, 85%+ of orders from mobile, social commerce heading toward ~35% of online retail. Cash on delivery still dominates (~95%).
- Cities: Lahore mall supply jumped with Dolmen Mall Lahore (country's biggest) opening Dec-24 — more premium space competing for the same footfall; Islamabad tolerates higher price points; retail expansion is heading into second-tier cities (Faisalabad, Multan, Gujranwala, Sialkot); KP stores (Peshawar/Mardan/Swat) have lower rents but smaller baskets; UK stores serve the diaspora and hedge the rupee.
- Cost pressure on physical stores: inflation elevated (7-11% through 2026), SBP policy rate 11.5%, mall rents/wages/electricity squeezing store margins while online scales cheaper.`;
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
        content: company === "BARANH" || company === "HD"
          ? `You are a sharp CFO briefing the CEO of a Pakistani restaurant group. Analyse the monthly P&L data below and produce 4-6 insights (each tagged good / watch / urgent) and 3-5 concrete actions. Be direct and specific — quote figures in PKR millions (divide raw amounts by 1,000,000, one decimal). Focus on: food cost % trajectory, branch winners and losers (are losses structural or seasonal?), expense creep vs sales, head-office/warehouse allocation burden, and what the market context means for pricing. No fluff.\n\n${businessContext}\n\nInternal data (JSON):\n${JSON.stringify(summary)}`
          : company === "IFPL"
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
    const companyKey = company === "IFPL" || company === "BARANH" || company === "HD" ? company : "UTPL";
    const scopeKey = company === "IFPL"
      ? `${typeof channel === "string" && channel ? channel : "All"}|${typeof branch === "string" && branch ? branch : "All"}`
      : company === "BARANH" || company === "HD"
      ? (typeof branch === "string" && branch ? branch : "All")
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
