import { NextRequest } from "next/server";
import pdfParse from "pdf-parse";
import * as mammoth from "mammoth";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    let text = "";

    if (name.endsWith(".pdf")) {
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      text = buffer.toString("utf-8");
    } else {
      return Response.json(
        { error: "Unsupported file type. Please upload PDF, Word (.docx), or text (.txt) files." },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return Response.json({ error: "No text could be extracted from the file." }, { status: 400 });
    }

    return Response.json({ success: true, text: text.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("File parse error:", message);
    return Response.json({ error: "Failed to parse file: " + message }, { status: 500 });
  }
}
