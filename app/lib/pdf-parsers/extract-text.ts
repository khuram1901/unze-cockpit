import pdfParse from "pdf-parse";

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text;
}
