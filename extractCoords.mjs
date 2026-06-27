/**
 * extractCoords.mjs
 * Scans the actual telehandler PDF template and prints coordinates for
 * column headers (Mon-Sat) and row positions (items 1-30 + tyre rows).
 *
 * Run: node extractCoords.mjs
 */

import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use legacy build which doesn't require DOM APIs
const pdfjsLib = await import("/Users/user/Desktop/AppProjects/forklift-inspection/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const { getDocument, GlobalWorkerOptions } = pdfjsLib;

// Point to the worker file for Node.js
GlobalWorkerOptions.workerSrc = new URL(
  "/Users/user/Desktop/AppProjects/forklift-inspection/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url
).href;

const pdfPath = join(__dirname, "public", "PL054-OP-V3-Telehandler Inspection Checklist 1.pdf");
const pdfBytes = readFileSync(pdfPath);

const loadingTask = getDocument({ data: new Uint8Array(pdfBytes), disableWorker: true });
const pdf = await loadingTask.promise;

console.log(`PDF has ${pdf.numPages} pages\n`);

for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.0 });
  const content = await page.getTextContent();

  console.log(`=== PAGE ${pageNum} (width=${viewport.width.toFixed(1)}, height=${viewport.height.toFixed(1)}) ===`);

  // Collect all text items with their pdf-lib coordinates (origin bottom-left)
  const items = content.items.map(item => {
    const [a, b, c, d, tx, ty] = item.transform;
    // pdfjs gives bottom-left transform — same as pdf-lib coordinate system
    const x = tx;
    const y = ty;
    const str = item.str.trim();
    return { str, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, width: item.width, height: item.height };
  }).filter(i => i.str.length > 0);

  // Print everything so we can identify patterns
  for (const item of items) {
    console.log(`  "${item.str}"  x=${item.x}  y=${item.y}  w=${item.width?.toFixed(1)}`);
  }

  // Highlight day headers
  const dayNames = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
                    "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
                    "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const dayItems = items.filter(i => dayNames.some(d => i.str.toUpperCase().includes(d.toUpperCase()) && i.str.length < 15));

  if (dayItems.length > 0) {
    console.log("\n  >>> DAY COLUMN HEADERS:");
    for (const d of dayItems) {
      console.log(`      "${d.str}"  x=${d.x}  y=${d.y}`);
    }
  }

  // Look for numeric items 1-30 to find row positions
  const numberItems = items.filter(i => /^\d+$/.test(i.str) && parseInt(i.str) >= 1 && parseInt(i.str) <= 35);
  if (numberItems.length > 0) {
    console.log("\n  >>> NUMBERED ROWS (potential item numbers):");
    for (const n of numberItems) {
      console.log(`      "${n.str}"  x=${n.x}  y=${n.y}`);
    }
  }

  // Look for "PASS", "FAIL", "tyre", "pressure" keywords
  const keywords = ["PASS", "FAIL", "TYRE", "TIRE", "PRESSURE", "PSI", "INITIALS", "SIGNED", "OPERATOR"];
  const kwItems = items.filter(i => keywords.some(k => i.str.toUpperCase().includes(k)));
  if (kwItems.length > 0) {
    console.log("\n  >>> KEYWORD ITEMS:");
    for (const k of kwItems) {
      console.log(`      "${k.str}"  x=${k.x}  y=${k.y}`);
    }
  }

  console.log();
}
