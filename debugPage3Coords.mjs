/**
 * debugPage3Coords.mjs
 * Prints exact bounding boxes for "Operator Name", "Sign", and "Date" labels
 * on page 3 of the PL054-OP-V3 template, plus every text item on that page
 * for full context.
 *
 * Run: node debugPage3Coords.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pdfjsLib = await import(
  "/Users/user/Desktop/AppProjects/forklift-inspection/node_modules/pdfjs-dist/legacy/build/pdf.mjs"
);
const { getDocument } = pdfjsLib;

const pdfPath = join(
  __dirname,
  "public",
  "PL054-OP-V3-Telehandler Inspection Checklist 1.pdf"
);
const pdfBytes = readFileSync(pdfPath);

const pdf = await getDocument({
  data: new Uint8Array(pdfBytes),
  disableWorker: true,
}).promise;

console.log(`PDF has ${pdf.numPages} pages total\n`);

// Page 3 is index 3 (1-based), i.e. pages[2] in pdf-lib (0-based)
const PAGE_NUM = 3;
const page = await pdf.getPage(PAGE_NUM);
const viewport = page.getViewport({ scale: 1.0 });
const content = await page.getTextContent();

console.log(
  `=== PAGE ${PAGE_NUM} (width=${viewport.width.toFixed(2)}, height=${viewport.height.toFixed(2)}) ===\n`
);

// pdfjs transform: [a, b, c, d, tx, ty] where tx=x, ty=y (bottom-left origin)
const items = content.items
  .map((item) => {
    const [, , , , tx, ty] = item.transform;
    const str = item.str; // keep spaces — don't trim yet
    const trimmed = str.trim();
    const w = item.width;
    const h = item.height;
    return {
      str: trimmed,
      raw: str,
      x: tx,
      y: ty,
      w,
      h,
      rightEdge: tx + w,
    };
  })
  .filter((i) => i.str.length > 0);

console.log("ALL TEXT ITEMS ON PAGE 3:");
for (const item of items) {
  console.log(
    `  "${item.str}"  x=${item.x.toFixed(2)}  y=${item.y.toFixed(2)}  w=${item.w.toFixed(2)}  h=${item.h.toFixed(2)}  rightEdge=${item.rightEdge.toFixed(2)}`
  );
}

console.log("\n--- KEY LABELS ---");

// Find "Operator Name" (may be split across items, look for "Operator" or "Operator Name")
const opNameItems = items.filter((i) =>
  /operator\s*name/i.test(i.str) || (i.str.toLowerCase() === "operator" || i.str.toLowerCase() === "name")
);
console.log("\n\"Operator Name\" candidates:");
for (const i of opNameItems) {
  console.log(
    `  "${i.str}"  x=${i.x.toFixed(2)}  y=${i.y.toFixed(2)}  rightEdge=${i.rightEdge.toFixed(2)}`
  );
}

// Find "Sign" label
const signItems = items.filter((i) => /^sign$/i.test(i.str));
console.log("\n\"Sign\" candidates:");
for (const i of signItems) {
  console.log(
    `  "${i.str}"  x=${i.x.toFixed(2)}  y=${i.y.toFixed(2)}  rightEdge=${i.rightEdge.toFixed(2)}`
  );
}

// Find "Date" label
const dateItems = items.filter((i) => /^date$/i.test(i.str));
console.log("\n\"Date\" candidates:");
for (const i of dateItems) {
  console.log(
    `  "${i.str}"  x=${i.x.toFixed(2)}  y=${i.y.toFixed(2)}  rightEdge=${i.rightEdge.toFixed(2)}`
  );
}

// Also print items near y≈374 to see the full sign-off row
console.log("\nAll items near y=374 (±20pt) — operator sign-off row:");
const nearRow = items.filter((i) => Math.abs(i.y - 374) < 20);
for (const i of nearRow) {
  console.log(
    `  "${i.str}"  x=${i.x.toFixed(2)}  y=${i.y.toFixed(2)}  rightEdge=${i.rightEdge.toFixed(2)}`
  );
}

// Print items in the range y=330–420 for broader context
console.log("\nAll items in y=330–420 (sign-off + diagram area):");
const signOffArea = items.filter((i) => i.y >= 330 && i.y <= 420);
for (const i of signOffArea.sort((a, b) => b.y - a.y)) {
  console.log(
    `  "${i.str}"  x=${i.x.toFixed(2)}  y=${i.y.toFixed(2)}  rightEdge=${i.rightEdge.toFixed(2)}`
  );
}

// Find the rightmost x boundary on this page to understand page width
const maxX = Math.max(...items.map((i) => i.rightEdge));
console.log(`\nMax rightEdge seen on page 3: ${maxX.toFixed(2)}`);
console.log(`Page width (viewport): ${viewport.width.toFixed(2)}`);
