/**
 * One-off script: copies page 3 of the inspection template to public/diagram.pdf
 * so the client can render it with pdfjs-dist for the annotation canvas.
 * Run: node lib/extractDiagram.js
 */
const path = require("path");
const fs   = require("fs");
const { PDFDocument } = require("pdf-lib");

async function main() {
  const src = path.join(__dirname, "..", "public", "PL054-OP-V3-Telehandler Inspection Checklist 1.pdf");
  const bytes = fs.readFileSync(src);
  const srcDoc  = await PDFDocument.load(bytes);
  const destDoc = await PDFDocument.create();
  const [page3] = await destDoc.copyPages(srcDoc, [2]); // 0-indexed
  destDoc.addPage(page3);
  const out = await destDoc.save();
  const outPath = path.join(__dirname, "..", "public", "diagram.pdf");
  fs.writeFileSync(outPath, out);
  console.log("Wrote", outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
