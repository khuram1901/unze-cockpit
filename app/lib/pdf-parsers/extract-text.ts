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

    // pdfjs-dist v4.x worker setup in Vercel serverless — full history:
    //
    // Attempt 1: workerSrc = "" (empty string)
    //   Failed: empty string is falsy; pdfjs `if (workerSrc)` check throws
    //   "No 'GlobalWorkerOptions.workerSrc' specified."
    //
    // Attempt 2: workerSrc = `file://${workerPath}` (file:// URL)
    //   Failed: pdfjs internally calls fileURLToPath() on this URL; on Vercel
    //   Linux the URL format produces "File URL host must be 'localhost' or
    //   empty on linux."
    //
    // Attempt 3 (current): workerPort with a real worker_threads.Worker
    //   Give pdfjs an already-running Node.js Worker directly via workerPort.
    //   With workerPort set, pdfjs uses the port object immediately and NEVER
    //   reads workerSrc or calls fileURLToPath() — the URL issue never arises.
    //   new NodeWorker(absolutePath) accepts a plain path string with no URL
    //   conversion needed; no file:// prefix required.
    //
    //   pdfjs-dist is in serverExternalPackages (next.config.ts) so it stays
    //   in node_modules and createRequire().resolve() returns the real path.
    const { createRequire } = await import("module");
    const req = createRequire(import.meta.url);
    const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const { Worker: NodeWorker } = await import("worker_threads");
    const worker = new NodeWorker(workerPath); // plain absolute path — no file:// prefix
    pdfjsCached.GlobalWorkerOptions.workerPort = worker; // port, not src
    // Do NOT set workerSrc — workerPort takes precedence and pdfjs skips
    // all URL parsing when a port is provided.
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
    // Cast to any[] to avoid pdfjs-dist TextItem | TextMarkedContent union
    // type mismatch — pdfjsCached is already `any` at runtime.
    type TextItem = { str: string; x: number; y: number };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawItems = (content.items as any[]).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (it: any) => typeof it.str === "string" && Array.isArray(it.transform),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: TextItem[] = rawItems
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => ({
        str: it.str as string,
        x: it.transform[4] as number,
        y: it.transform[5] as number,
      }))
      .filter((it: TextItem) => it.str.trim() !== "");

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
