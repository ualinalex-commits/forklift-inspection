/**
 * debugPage3Borders.mjs
 * Decodes all constructPath calls on page 3, finds every vertical line
 * segment and rectangle in the sign-off table area (y≈310–420).
 *
 * constructPath format in this pdfjs version:
 *   argsArray[i][0] = paint operator code (fill/stroke/etc.)
 *   argsArray[i][1] = array-like: interleaved [cmd, ...coords, cmd, ...coords, ...]
 *     cmd codes: 0=moveTo(x,y)  1=lineTo(x,y)  2=curveTo(x1,y1,x2,y2,x3,y3)
 *                3=curveTo2(4c)  4=closePath(0c)  5=rectangle(x,y,w,h)
 *
 * Run: node debugPage3Borders.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pdfjsLib = await import(
  "/Users/user/Desktop/AppProjects/forklift-inspection/node_modules/pdfjs-dist/legacy/build/pdf.mjs"
);
const { getDocument, OPS } = pdfjsLib;

const pdfBytes = readFileSync(
  join(__dirname, "public", "PL054-OP-V3-Telehandler Inspection Checklist 1.pdf")
);
const pdf  = await getDocument({ data: new Uint8Array(pdfBytes), disableWorker: true }).promise;
const page = await pdf.getPage(3);
const vp   = page.getViewport({ scale: 1.0 });
console.log(`Page 3: ${vp.width.toFixed(2)} × ${vp.height.toFixed(2)} pt  (bottom-left origin)\n`);

// ── Interleaved-format arg count per command code ─────────────────────────────
const ARGC = { 0:2, 1:2, 2:6, 3:4, 4:0, 5:4 };

// ── Parse the interleaved argsArray[i][1] data ────────────────────────────────
function decodePathData(data) {
  // data may be an array-like (not a real JS Array); convert it
  const flat = Array.from({ length: data.length }, (_, i) => data[i]);
  const segments = [];
  let i = 0;
  let curX = 0, curY = 0, startX = 0, startY = 0;
  while (i < flat.length) {
    const cmd  = flat[i++];
    const argc = ARGC[cmd] ?? 0;
    const args = flat.slice(i, i + argc);
    i += argc;
    if (cmd === 0) {           // moveTo
      [curX, curY] = args; startX = curX; startY = curY;
      segments.push({ type: "M", x: curX, y: curY });
    } else if (cmd === 1) {   // lineTo
      const [x2, y2] = args;
      segments.push({ type: "L", x0: curX, y0: curY, x1: x2, y1: y2 });
      curX = x2; curY = y2;
    } else if (cmd === 4) {   // closePath
      if (curX !== startX || curY !== startY)
        segments.push({ type: "L", x0: curX, y0: curY, x1: startX, y1: startY });
      curX = startX; curY = startY;
    } else if (cmd === 5) {   // rectangle (x, y, w, h)
      const [rx, ry, rw, rh] = args;
      segments.push({ type: "RE", x: rx, y: ry, w: rw, h: rh });
      // Expand to segments for vertical/horizontal detection
      segments.push({ type: "L", x0: rx,     y0: ry,     x1: rx+rw, y1: ry    });
      segments.push({ type: "L", x0: rx+rw,  y0: ry,     x1: rx+rw, y1: ry+rh });
      segments.push({ type: "L", x0: rx+rw,  y0: ry+rh,  x1: rx,    y1: ry+rh });
      segments.push({ type: "L", x0: rx,     y0: ry+rh,  x1: rx,    y1: ry    });
      curX = rx; curY = ry;
    } else if (cmd === 2) {   // curveTo — track endpoint only
      const [,,,,x6,y6] = args;
      segments.push({ type: "C", x0: curX, y0: curY, x1: x6, y1: y6 });
      curX = x6; curY = y6;
    } else if (cmd === 3) {   // curveTo variant
      const [,,x4,y4] = args;
      segments.push({ type: "C", x0: curX, y0: curY, x1: x4, y1: y4 });
      curX = x4; curY = y4;
    }
  }
  return segments;
}

// ── Transform stack ───────────────────────────────────────────────────────────
let ctmStack = [{ a:1,b:0,c:0,d:1,e:0,f:0 }];
function ctm() { return ctmStack[ctmStack.length-1]; }
function applyXY(x, y) {
  const m = ctm();
  return { x: m.a*x + m.c*y + m.e, y: m.b*x + m.d*y + m.f };
}
function multiplyM(m1, m2) {
  return {
    a: m1.a*m2.a + m1.b*m2.c,  b: m1.a*m2.b + m1.b*m2.d,
    c: m1.c*m2.a + m1.d*m2.c,  d: m1.c*m2.b + m1.d*m2.d,
    e: m1.a*m2.e + m1.c*m2.f + m1.e,
    f: m1.b*m2.e + m1.d*m2.f + m1.f,
  };
}

// ── Main collection ───────────────────────────────────────────────────────────
const Y_MIN = 310, Y_MAX = 420;
const allV = [], allH = [], allRE = [];

const { fnArray, argsArray } = await page.getOperatorList();

for (let i = 0; i < fnArray.length; i++) {
  const fn = fnArray[i];
  if (fn === OPS.save)    { ctmStack.push({ ...ctm() }); continue; }
  if (fn === OPS.restore) { if (ctmStack.length>1) ctmStack.pop(); continue; }
  if (fn === OPS.transform) {
    const [a,b,c,d,e,f] = argsArray[i];
    ctmStack[ctmStack.length-1] = multiplyM(ctm(), {a,b,c,d,e,f});
    continue;
  }
  if (fn !== OPS.constructPath) continue;

  const rawData = argsArray[i][1];  // interleaved command+coord data
  if (!rawData || !rawData.length) continue;

  const segs = decodePathData(rawData);

  for (const seg of segs) {
    if (seg.type === "RE") {
      // Apply transform to rectangle
      const p0 = applyXY(seg.x,         seg.y);
      const p1 = applyXY(seg.x+seg.w,   seg.y+seg.h);
      const x0 = Math.min(p0.x,p1.x), x1 = Math.max(p0.x,p1.x);
      const y0 = Math.min(p0.y,p1.y), y1 = Math.max(p0.y,p1.y);
      if (y0 <= Y_MAX && y1 >= Y_MIN) {
        allRE.push({ x0, y0, x1, y1, w: x1-x0, h: y1-y0 });
      }
    } else if (seg.type === "L") {
      const a = applyXY(seg.x0, seg.y0);
      const b = applyXY(seg.x1, seg.y1);
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      const yLo = Math.min(a.y,b.y), yHi = Math.max(a.y,b.y);
      const xLo = Math.min(a.x,b.x), xHi = Math.max(a.x,b.x);
      if (dx < 0.5 && dy > 0.1 && yLo <= Y_MAX && yHi >= Y_MIN) {
        allV.push({ x: (a.x+b.x)/2, y0: yLo, y1: yHi });
      } else if (dy < 0.5 && dx > 0.1 && a.y >= Y_MIN && a.y <= Y_MAX) {
        allH.push({ y: (a.y+b.y)/2, x0: xLo, x1: xHi });
      }
    }
  }
}

function dedup(arr, key) {
  const seen = new Set();
  return arr.filter(v => { const k = key(v); return seen.has(k)?false:(seen.add(k),true); });
}

const vLines = dedup(allV, v=>`${v.x.toFixed(1)}_${v.y0.toFixed(1)}_${v.y1.toFixed(1)}`).sort((a,b)=>a.x-b.x);
const hLines = dedup(allH, h=>`${h.y.toFixed(1)}_${h.x0.toFixed(1)}_${h.x1.toFixed(1)}`).sort((a,b)=>a.y-b.y);
const rects  = dedup(allRE,r=>`${r.x0.toFixed(1)}_${r.y0.toFixed(1)}_${r.w.toFixed(1)}_${r.h.toFixed(1)}`).sort((a,b)=>a.x0-b.x0);

console.log("=== VERTICAL SEGMENTS (column borders) y=310–420 ===");
if (!vLines.length) console.log("  (none)");
vLines.forEach(v => console.log(`  x=${v.x.toFixed(2)}  y=${v.y0.toFixed(2)}→${v.y1.toFixed(2)}`));

console.log("\n=== HORIZONTAL SEGMENTS (row borders) y=310–420 ===");
if (!hLines.length) console.log("  (none)");
hLines.forEach(h => console.log(`  y=${h.y.toFixed(2)}  x=${h.x0.toFixed(2)}→${h.x1.toFixed(2)}`));

console.log("\n=== RECTANGLES overlapping y=310–420 ===");
if (!rects.length) console.log("  (none)");
rects.forEach(r => console.log(`  [${r.x0.toFixed(2)},${r.y0.toFixed(2)}]→[${r.x1.toFixed(2)},${r.y1.toFixed(2)}]  (${r.w.toFixed(2)}×${r.h.toFixed(2)})`));

// ── Derive cell column x-boundaries ─────────────────────────────────────────
const xBorders = [...new Set([...vLines.map(v=>v.x), ...rects.flatMap(r=>[r.x0,r.x1])]
  .map(x => Math.round(x*10)/10))].sort((a,b)=>a-b);

console.log("\n=== CELL BOUNDARY x-COORDS (deduplicated, sorted) ===");
console.log(" ", xBorders.map(x=>x.toFixed(2)).join("  ") || "(none)");
if (xBorders.length >= 2) {
  console.log("\n  Cell spans (left border → right border):");
  for (let i = 0; i+1 < xBorders.length; i++) {
    const l = xBorders[i], r = xBorders[i+1];
    console.log(`    [${l.toFixed(2)} → ${r.toFixed(2)}]  center=${((l+r)/2).toFixed(2)}  width=${(r-l).toFixed(2)}`);
  }
}

// ── Print ALL constructPath calls (full page, sorted by y range) ─────────────
console.log("\n=== ALL constructPath CALLS — full page ===");
// Re-run without CTM (it's identity for most calls) and print raw coords
for (let i = 0; i < fnArray.length; i++) {
  if (fnArray[i] !== OPS.constructPath) continue;
  const rawData = argsArray[i][1];
  if (!rawData || !rawData.length) continue;
  const flat = Array.from({ length: rawData.length }, (_, j) => rawData[j]);
  // Extract all numeric values
  const nums = flat.filter(v => typeof v === "number" && v !== Math.floor(v) || (typeof v === "number" && v > 5));
  const ys = [];
  // Quick heuristic: find y values (every other coordinate after x values)
  for (let j = 0; j < flat.length; j++) {
    const cmd = flat[j];
    if (cmd === 0 || cmd === 1) { j++; const x=flat[j]; j++; const y=flat[j]; if(y!==undefined) ys.push(y); }
    else if (cmd === 5)         { j++; j++; const y=flat[j]; if(y!==undefined) ys.push(y); j++; j++; }
    else if (cmd === 2)         { j+=5; const y=flat[j]; if(y!==undefined) ys.push(y); }
    else if (cmd === 3)         { j+=3; const y=flat[j]; if(y!==undefined) ys.push(y); }
    else if (cmd === 4)         { /* closePath, no args */ }
  }
  const yMin = ys.length ? Math.min(...ys) : null;
  const yMax = ys.length ? Math.max(...ys) : null;
  if (yMin === null || yMax < Y_MIN || yMin > Y_MAX) continue;
  console.log(`  paintOp=${argsArray[i][0]}  data=[${flat.map(n=>typeof n==='number'?n.toFixed(2):n).join(",")}]`);
}
