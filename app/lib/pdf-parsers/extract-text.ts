// Coordinate-based PDF text extraction using pdfjs-dist v4.
// Replaces the pdf-parse wrapper that produced column-disordered text on some
// PDFs (particularly IFPL two-column layout and some UTPL variants).
//
// Strategy: use pdfjs-dist getTextContent() which gives each text item an
// (x, y) position. Group items that share a Y position (within 2pt) into
// lines, then sort lines top-to-bottom (descending PDF Y) and items within
// each line left-to-right (ascending X). This reliably reconstructs reading
// order regardless of how the PDF was composed.
//
// For IFPL two-column layout: the left column (date + description) and right
// column (amount) share the same Y position, so they end up on the same line:
//   "21/10/2026 PACKAGES REAL ESTATE (PVT) LTD 307,020"
// extractSectionTransactions finds the date, takes the last number → correct.
//
// Per-company column-layout settings: none needed. Coordinate sorting is
// layout-agnostic — the correct line assembly emerges from the geometry.

// Cached module reference to avoid repeated dynamic imports in serverless.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsCached: any = null;

async function getPdfjs() {
  if (!pdfjsCached) {
    // Use the legacy build — avoids browser-only APIs in Vercel serverless.
    pdfjsCached = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Disable the worker thread — not available in serverless; all parsing
    // runs synchronously in the main thread instead.
    pdfjsCached.GlobalWorkerOptions.workerSrc = "";
  }
  return pdfjsCached;
}

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdfjs = await getPdfjs();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Avoid loading external CMaps or fonts — keeps execution fast and avoids
    // network calls that would fail behind the Vercel egress proxy.
    disableFontFace: true,
    verbosity: 0,
  });

  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Each item has a str and a transform [sx, bx, by, sy, tx, ty].
    // tx = x position (from left), ty = y position (from bottom of page).
    type TextItem = { str: string; x: number; y: number };
    const items: TextItem[] = content.items
      .filter(
        (it): it is { str: string; transform: number[] } =>
          "str" in it && Array.isArray((it as { transform?: unknown }).transform),
      )
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter(it => it.str.trim() !== "");

    if (items.length === 0) {
      pageTexts.push("");
      continue;
    }

    // ── Group items into lines by Y position ───────────────────────────────
    // Items within Y_TOLERANCE pts of each other are on the same line.
    const Y_TOLERANCE = 2;
    const lines: { y: number; items: TextItem[] }[] = [];

    // Process items top-to-bottom so lines are created in reading order.
    const sorted = [...items].sort((a, b) => b.y - a.y);
    for (const item of sorted) {
      const line = lines.find(l => Math.abs(l.y - item.y) <= Y_TOLERANCE);
      if (line) {
        line.items.push(item);
      } else {
        lines.push({ y: item.y, items: [item] });
      }
    }

    // Sort lines top to bottom; within each line sort items left to right.
    lines.sort((a, b) => b.y - a.y);
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
    }

    // Emit each line as a single space-separated string.
    const pageText = lines
      .map(l =>
        l.items
          .map(i => i.str)
          .join(" ")
          .replace(/\s{2,}/g, " ")
          .trim(),
      )
      .filter(l => l.length > 0)
      .join("\n");

    pageTexts.push(pageText);
    page.cleanup();
  }

  return pageTexts.join("\n");
}
