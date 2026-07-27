import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../../../lib/api-auth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// Schema for RAW transcription — full rewrite + extraction
const ACTION_ITEM_SCHEMA_RAW = {
  type: "object" as const,
  properties: {
    title:       { type: "string" as const, description: "Short task title, max 80 characters. One clear action." },
    notes:       { type: "string" as const, description: "Full detail, context, or background for this task. May be multi-sentence." },
    owner_name:  { type: "string" as const, description: "Person responsible — must be from the team list" },
    due_date:    { type: "string" as const, description: "YYYY-MM-DD. Extract exact dates from text ('by July 30' → use meeting year). For relative dates ('within 2 days') offset from meeting date. Leave empty only if truly no date is mentioned." },
    priority:    { type: "string" as const, enum: ["Low", "Medium", "High", "Urgent"] },
    department:  { type: "string" as const },
  },
  required: ["title", "owner_name", "priority"] as const,
  additionalProperties: false as const,
};

const ACTION_ITEM_SCHEMA_PREFORMATTED = {
  type: "object" as const,
  properties: {
    title:       { type: "string" as const, description: "Short task title, max 80 characters — distil the action into one clear phrase." },
    notes:       { type: "string" as const, description: "Full original text of the action item as written in the minutes — copy verbatim." },
    owner_name:  { type: "string" as const, description: "Person responsible — match exactly to the team list" },
    due_date:    { type: "string" as const, description: "YYYY-MM-DD. Extract exact dates from text ('by July 30' → use meeting year). For relative dates ('within 2 days') offset from meeting date. Leave empty only if truly no date is mentioned." },
    priority:    { type: "string" as const, enum: ["Low", "Medium", "High", "Urgent"] },
    department:  { type: "string" as const },
  },
  required: ["title", "owner_name", "priority"] as const,
  additionalProperties: false as const,
};

const BASE_SCHEMA_FIELDS = {
  meeting_title:     { type: "string" as const },
  meeting_date:      { type: "string" as const, description: "DD/MM/YYYY format" },
  company:           { type: "string" as const, description: "Which company: Unze Trading, Imperial Footwear, Haute Dolci, Barahn, K&K Jhang, or Executive Office if cross-company" },
  department:        { type: "string" as const, description: "Which department: Unze Trading Ops, Finance, HR, Audit, Taxation, Admin, or Executive Office if cross-department" },
  attendees:         { type: "array" as const, items: { type: "string" as const } },
  decisions:         { type: "array" as const, items: { type: "string" as const } },
  risks:             { type: "array" as const, items: { type: "string" as const } },
  opportunities:     { type: "array" as const, items: { type: "string" as const } },
};

function buildSchema(preFormatted: boolean) {
  return {
    type: "object" as const,
    properties: {
      ...BASE_SCHEMA_FIELDS,
      executive_summary: {
        type: "string" as const,
        description: preFormatted
          ? "Copy the executive summary verbatim from the minutes — do NOT paraphrase, shorten, or rewrite."
          : "3-5 sentence summary of the meeting.",
      },
      action_items: {
        type: "array" as const,
        items: preFormatted ? ACTION_ITEM_SCHEMA_PREFORMATTED : ACTION_ITEM_SCHEMA_RAW,
      },
    },
    required: ["meeting_title", "meeting_date", "company", "department", "attendees", "executive_summary", "decisions", "risks", "opportunities", "action_items"] as const,
    additionalProperties: false as const,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const { transcript, memberNames, memberDetails, preFormatted, meetingDateRef } = body;

    if (!transcript || typeof transcript !== "string") {
      return Response.json({ error: "transcript is required" }, { status: 400 });
    }

    // Reference date context so the AI can resolve relative due dates
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dateRef = meetingDateRef || today;

    let memberContext = "";
    if (memberDetails && memberDetails.length > 0) {
      memberContext = `\n\nTeam members (assign tasks ONLY to these people):\n${memberDetails.map((m: { name: string; role: string; department: string | null }) => `- ${m.name} (${m.role}${m.department ? `, ${m.department}` : ""})`).join("\n")}`;
    } else if (memberNames && memberNames.length > 0) {
      memberContext = `\n\nKnown team members: ${memberNames.join(", ")}`;
    }

    const schema = buildSchema(!!preFormatted);

    // Two extraction modes:
    //
    // preFormatted = true  (Claude / ChatGPT / Letterly output)
    //   The minutes are already professionally written. Extract structured
    //   fields but copy executive_summary, decisions, risks, and opportunities
    //   VERBATIM — do NOT rewrite, paraphrase, or condense.
    //
    // preFormatted = false (raw transcription)
    //   Full extraction + rewrite.
    const extractionPrompt = preFormatted
      ? `Extract structured meeting data from the following pre-formatted meeting minutes.

RULES:
- These minutes are ALREADY professionally written. Copy executive_summary, decisions, risks, and opportunities EXACTLY as written — no paraphrasing, no condensing, no rewriting. Verbatim means verbatim.
- Use DD/MM/YYYY for meeting_date.
- Identify company: Unze Trading, Imperial Footwear, Haute Dolci, Barahn, K&K Jhang, or "Executive Office".
- Identify department: Unze Trading Ops, Finance, HR, Audit, Taxation, Admin, or "Executive Office".
- For each action item:
  - title: one short phrase, max 80 characters (e.g. "Inspect tile delivery", "Resolve SNM calendar access").
  - notes: copy the full original action item text verbatim.
  - owner_name: match exactly to team member list.
  - due_date: use reference date ${dateRef} (YYYY-MM-DD). Convert "by July 30" → "${new Date(dateRef).getFullYear()}-07-30". Convert "within 2 days" → add 2 days to meeting date. Leave empty ONLY if no date is mentioned at all.
  - Do not invent tasks.${memberContext}

--- PRE-FORMATTED MINUTES ---
${transcript}`
      : `Extract structured meeting minutes from the following transcript or raw notes.

RULES:
- Use DD/MM/YYYY for meeting_date.
- Identify company: Unze Trading, Imperial Footwear, Haute Dolci, Barahn, K&K Jhang, or "Executive Office".
- Identify department: Unze Trading Ops, Finance, HR, Audit, Taxation, Admin, or "Executive Office".
- For each action item:
  - title: one short phrase, max 80 characters (the key action, e.g. "Inspect tile delivery").
  - notes: full detail and context for the task (can be multi-sentence).
  - owner_name: assign ONLY to Managers or Executives — never the meeting chair. Match to team list.
  - due_date: use reference date ${dateRef}. Convert "by July 30" → "${new Date(dateRef).getFullYear()}-07-30". Convert "within 2 days" → add 2 days to meeting date. Leave empty ONLY if no date is mentioned.${memberContext}

--- TRANSCRIPT ---
${transcript}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      output_config: {
        format: {
          type: "json_schema",
          schema,
        },
      },
      messages: [{ role: "user", content: extractionPrompt }],
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
