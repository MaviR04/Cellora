// Builds docs/report/report.pdf from docs/report/report.md:
//   Markdown -> HTML (marked) -> Mermaid diagrams rendered in the browser -> PDF (Edge via Playwright).
// Usage: npm run report:pdf
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Marked } from "marked";
import { closeBrowser, getBrowser } from "../evidence/screenshot";
import { repoRoot } from "../evidence/lib";

const dir = join(repoRoot, "docs", "report");
const source = readFileSync(join(dir, "report.md"), "utf8").replace(/<!--[\s\S]*?-->/g, ""); // drop draft notes

const marked = new Marked({
  renderer: {
    // ```mermaid blocks become diagrams; everything else stays a code block
    code({ text, lang }) {
      if (lang === "mermaid") return `<pre class="mermaid">${text}</pre>`;
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<pre><code>${escaped}</code></pre>`;
    },
  },
});
const body = await marked.parse(source);

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<title>Cellora: A NoSQL Telemetry Platform</title>
<style>
  @page { size: A4; margin: 20mm 18mm 22mm; }
  body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #111827; }
  h1 { font-size: 22pt; margin: 0 0 6pt; line-height: 1.2; }
  h2 { font-size: 15pt; margin: 22pt 0 6pt; border-bottom: 1px solid #d1d5db; padding-bottom: 3pt; break-after: avoid; }
  h2:not(:first-of-type) { break-before: page; }
  h3 { font-size: 12pt; margin: 14pt 0 4pt; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9pt; break-inside: auto; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #d1d5db; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 8.8pt; background: #f3f4f6; padding: 0 2pt; border-radius: 2pt; }
  pre { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 4pt; padding: 6pt 8pt; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 8.5pt; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  pre.mermaid { background: none; border: none; text-align: center; }
  img { display: block; max-width: 100%; max-height: 200mm; object-fit: contain; margin: 8pt auto 2pt; border: 1px solid #e5e7eb; }
  p:has(> img) + p > em, p > em:only-child { display: block; text-align: center; font-size: 9pt; color: #4b5563; }
  blockquote { border-left: 3px solid #d1d5db; margin: 8pt 0; padding: 0 10pt; color: #374151; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 14pt 0; }
</style>
</head>
<body>
${body}
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: false, theme: "neutral", flowchart: { useMaxWidth: true } });
  try { await mermaid.run(); } finally { window.__ready = true; }
</script>
</body>
</html>`;

// Written next to report.md so relative image paths (../../evidence/..., ../images/...) resolve
const htmlPath = join(dir, "report.html");
writeFileSync(htmlPath, html);

const browser = await getBrowser();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 60_000 });
const pdfPath = join(dir, "report.pdf");
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-size:8pt;color:#6b7280;text-align:center;font-family:Segoe UI,Arial">Cellora: a NoSQL telemetry platform · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  margin: { top: "20mm", bottom: "22mm", left: "18mm", right: "18mm" },
});
await closeBrowser();
console.log(`wrote ${pdfPath}`);
