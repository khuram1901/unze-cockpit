import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

const EXTRACTION_SCHEMA = {
  type: "object" as const,
  properties: {
    meeting_title: { type: "string" as const },
    meeting_date: { type: "string" as const, description: "DD/MM/YYYY format" },
    company: { type: "string" as const, description: "Which company this meeting relates to, e.g. Unze Trading, Imperial Footwear, Haute Dolci, Barahn, K&K Jhang, or General if cross-company" },
    department: { type: "string" as const, description: "Which department this meeting relates to, or General if cross-department" },
    attendees: { type: "array" as const, items: { type: "string" as const } },
    executive_summary: { type: "string" as const, description: "3-5 sentences" },
    decisions: { type: "array" as const, items: { type: "string" as const } },
    risks: { type: "array" as const, items: { type: "string" as const } },
    opportunities: { type: "array" as const, items: { type: "string" as const } },
    action_items: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          description: { type: "string" as const },
          owner_name: { type: "string" as const, description: "Must be a Manager or Executive from the team — never the meeting chair" },
          due_date: { type: "string" as const, description: "YYYY-MM-DD or empty" },
          priority: { type: "string" as const, enum: ["Low", "Medium", "High", "Urgent"] },
          department: { type: "string" as const },
        },
        required: ["description", "owner_name", "priority"] as const,
        additionalProperties: false as const,
      },
    },
  },
  required: ["meeting_title", "meeting_date", "company", "department", "attendees", "executive_summary", "decisions", "risks", "opportunities", "action_items"] as const,
  additionalProperties: false as const,
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const { transcript, memberNames, memberDetails } = body;

    if (!transcript || typeof transcript !== "string") {
      return Response.json({ error: "transcript is required" }, { status: 400 });
    }

    let memberContext = "";
    if (memberDetails && memberDetails.length > 0) {
      memberContext = `\n\nTeam members (assign tasks ONLY to these people):\n${memberDetails.map((m: { name: string; role: string; department: string | null }) => `- ${m.name} (${m.role}${m.department ? `, ${m.department}` : ""})`).join("\n")}`;
    } else if (memberNames && memberNames.length > 0) {
      memberContext = `\n\nKnown team members: ${memberNames.join(", ")}`;
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      output_config: {
        format: {
          type: "json_schema",
          schema: EXTRACTION_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: `Extract structured meeting minutes from the following transcript or raw minutes.

RULES:
- Use DD/MM/YYYY for dates.
- Identify which company this meeting relates to: Unze Trading, Imperial Footwear, Haute Dolci, Barahn, K&K Jhang, or "General" if cross-company.
- Identify which department: Unze Trading Ops, Finance, HR, Audit, Taxation, Admin, or "General" if cross-department.
- For action items: assign tasks ONLY to Managers or Executives from the team list — NEVER to the meeting chair/owner (the person who called/led the meeting). The chair delegates; they don't take tasks unless explicitly stated.
- Match owner names exactly to the team member list when possible.
- If a task mentions a department but no specific person, assign it to the Manager or Head of Department for that area from the team list.${memberContext}

--- TRANSCRIPT ---
${transcript}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return Response.json({ error: "No text response from AI" }, { status: 500 });
    }

    const extracted = JSON.parse(textBlock.text);

    return Response.json({ success: true, extracted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Meeting extraction error:", message);
    return Response.json({ error: "Extraction failed: " + message }, { status: 500 });
  }
}
