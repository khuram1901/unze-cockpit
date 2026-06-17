import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "../../../lib/supabase-server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

const EXTRACTION_SCHEMA = {
  type: "object" as const,
  properties: {
    meeting_title: { type: "string" as const },
    meeting_date: { type: "string" as const, description: "DD/MM/YYYY format" },
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
          owner_name: { type: "string" as const },
          due_date: { type: "string" as const, description: "YYYY-MM-DD or empty" },
          priority: { type: "string" as const, enum: ["Low", "Medium", "High", "Urgent"] },
          department: { type: "string" as const },
        },
        required: ["description", "owner_name", "priority"] as const,
        additionalProperties: false as const,
      },
    },
  },
  required: ["meeting_title", "meeting_date", "attendees", "executive_summary", "decisions", "risks", "opportunities", "action_items"] as const,
  additionalProperties: false as const,
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transcript, memberNames } = body;

    if (!transcript || typeof transcript !== "string") {
      return Response.json({ error: "transcript is required" }, { status: 400 });
    }

    const memberContext = memberNames && memberNames.length > 0
      ? `\n\nKnown team members (try to match action item owners to these names): ${memberNames.join(", ")}`
      : "";

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
          content: `Extract structured meeting minutes from the following transcript or raw minutes. Use DD/MM/YYYY for dates. For action items, try to identify the owner, a due date if mentioned, priority level, and department.${memberContext}\n\n--- TRANSCRIPT ---\n${transcript}`,
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
