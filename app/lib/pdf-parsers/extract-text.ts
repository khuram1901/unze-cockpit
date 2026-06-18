export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // pdf-parse v1 — simple and works in serverless without workers
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  return result.text;
}
