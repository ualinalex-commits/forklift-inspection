/**
 * createTemplate.js — run once to generate public/template.pdf
 * Usage: node lib/createTemplate.js
 *
 * Produces a blank A4-landscape telehandler inspection grid.
 * generateReport.js stamps values at the coordinates defined here.
 *
 * COORDINATE EXPORT (copy into generateReport.js):
 * These constants are computed by the layout algorithm below.
 * Keep them in sync if you ever re-run this script.
 */

const path = require("path");
const fs   = require("fs");

// ─── Layout constants ───────────────────────────────────────────────────────
const PAGE_W = 841.92;
const PAGE_H = 595.28;

const MARGIN      = 18;
const HEADER_H    = 72;  // height of top header band
const FOOTER_H    = 20;  // bottom margin

const DESC_COL_W  = 220; // width of item description column
const NUM_COL_W   = 24;  // width of item number column
const DATA_START_X = MARGIN + NUM_COL_W + DESC_COL_W + 4; // ~266

const DATA_W      = PAGE_W - DATA_START_X - MARGIN;       // ~557.92
const NUM_DAYS    = 6;
const COL_W       = DATA_W / NUM_DAYS;                    // ~92.99

// Day column x-centres (used in generateReport.js as DAY_X)
const DAY_X = {};
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
DAY_NAMES.forEach((d, i) => {
  DAY_X[d] = DATA_START_X + COL_W * i + COL_W / 2;
});
// Mon≈312.5  Tue≈405.5  Wed≈498.5  Thu≈591.5  Fri≈684.5  Sat≈777.5

// ─── Vertical layout (top → bottom, pdf-lib is bottom-left origin) ─────────
const CONTENT_TOP = PAGE_H - HEADER_H;          // ≈523.28  (top of data grid)

// Column header row
const COL_HDR_H   = 18;
const COL_HDR_TOP = CONTENT_TOP;                // ≈523.28
const COL_HDR_BOT = COL_HDR_TOP - COL_HDR_H;   // ≈505.28

// VISUAL CHECKS section
const VIS_SEC_H   = 12;
const VIS_SEC_TOP = COL_HDR_BOT - 2;            // ≈503.28
const VIS_SEC_BOT = VIS_SEC_TOP - VIS_SEC_H;    // ≈491.28

const VIS_ROW_H   = 8.6;
const VIS_ROWS    = 20;
const VIS_FIRST_TOP = VIS_SEC_BOT - 1;          // ≈490.28
// Row i (0-indexed) top: VIS_FIRST_TOP - i * VIS_ROW_H
// Text baseline ≈ row top - 5.8
const VIS_LAST_BOT = VIS_FIRST_TOP - VIS_ROWS * VIS_ROW_H; // ≈318.28

// TYRE PRESSURES section
const TYRE_SEC_H   = 11;
const TYRE_SEC_TOP = VIS_LAST_BOT - 3;          // ≈315.28
const TYRE_SEC_BOT = TYRE_SEC_TOP - TYRE_SEC_H; // ≈304.28

const TYRE_ROW_H  = 9.5;
const TYRE_LABELS = ["FL (Front Left)", "FR (Front Right)", "RL (Rear Left)", "RR (Rear Right)"];
const TYRE_KEYS   = ["FL", "FR", "RL", "RR"];
const TYRE_FIRST_TOP = TYRE_SEC_BOT - 1;        // ≈303.28
const TYRE_LAST_BOT  = TYRE_FIRST_TOP - TYRE_LABELS.length * TYRE_ROW_H; // ≈265.28

// FUNCTION CHECKS section
const FUNC_SEC_H   = 12;
const FUNC_SEC_TOP = TYRE_LAST_BOT - 3;         // ≈262.28
const FUNC_SEC_BOT = FUNC_SEC_TOP - FUNC_SEC_H; // ≈250.28

const FUNC_ROW_H  = 8.6;
const FUNC_ROWS   = 10;
const FUNC_FIRST_TOP = FUNC_SEC_BOT - 1;        // ≈249.28
const FUNC_LAST_BOT  = FUNC_FIRST_TOP - FUNC_ROWS * FUNC_ROW_H; // ≈163.28

// INITIALS row
const INIT_H     = 14;
const INIT_TOP   = FUNC_LAST_BOT - 3;           // ≈160.28
const INIT_BOT   = INIT_TOP - INIT_H;           // ≈146.28

// SIGN-OFF area (supervisor boxes)
const SIGNOFF_TOP = INIT_BOT - 4;               // ≈142.28
const SIGNOFF_BOT = FOOTER_H + 2;               // ≈22

// ─── Computed stamp positions for generateReport.js ─────────────────────────
// Visual item text y-baseline (item number i: 1–20):
//   VIS_FIRST_TOP - (i-1)*VIS_ROW_H - 5.8
// Tyre row text y-baseline (row j: 0–3):
//   TYRE_FIRST_TOP - j*TYRE_ROW_H - 5.8
// Function item text y-baseline (item number i: 21–30):
//   FUNC_FIRST_TOP - (i-21)*FUNC_ROW_H - 5.8
// Initials text y-baseline:
//   INIT_TOP - 8

// ─── Check item data ─────────────────────────────────────────────────────────
const SECTIONS = [
  { label: "Documentation", items: [
    { n: 1,  text: "Statutory examination in date (LOLER)" },
    { n: 2,  text: "Operator manual present and accessible" },
    { n: 3,  text: "Pre-use inspection record up to date" },
  ]},
  { label: "Tyres / Wheels", items: [
    { n: 4,  text: "Tyre condition — no cuts, bulges or foreign objects" },
    { n: 5,  text: "Wheel nuts / bolts secure, no damaged rims" },
  ]},
  { label: "Engine / Power Source", items: [
    { n: 6,  text: "Fuel level adequate for planned work" },
    { n: 7,  text: "Engine oil and coolant levels correct" },
    { n: 8,  text: "No fluid leaks visible on ground beneath machine" },
  ]},
  { label: "Hydraulics", items: [
    { n: 9,  text: "Hydraulic oil level correct" },
    { n: 10, text: "No hydraulic leaks — hoses, cylinders, connections" },
  ]},
  { label: "Boom & Attachment", items: [
    { n: 11, text: "Boom — no cracks, damage, wear or misalignment" },
    { n: 12, text: "Boom hoses and chains — condition, routing correct" },
    { n: 13, text: "Attachment secure, correct type, no visible damage" },
    { n: 14, text: "Attachment locking pins / retention devices secure" },
    { n: 15, text: "Headboard / forks / bucket — no cracks, bends or wear" },
  ]},
  { label: "Bodywork & Safety Devices", items: [
    { n: 16, text: "Cab — seat, mirrors, windows, wipers undamaged" },
    { n: 17, text: "ROPS/FOPS structure — secure, no cracks or damage" },
    { n: 18, text: "Counterweight — secure and undamaged" },
    { n: 19, text: "Seat belt / operator restraint — condition and function" },
    { n: 20, text: "Lights and beacon present and working (if applicable)" },
  ]},
];

const FUNCTION_CHECKS = [
  { n: 21, text: "Engine start — normal operation, no warning lights" },
  { n: 22, text: "Drive — forward, reverse, steering response correct" },
  { n: 23, text: "Brakes — service and parking brake effective" },
  { n: 24, text: "Boom lift — smooth, correct speed, holds position" },
  { n: 25, text: "Boom lower — smooth, controlled descent" },
  { n: 26, text: "Boom extend — smooth, full travel, no binding" },
  { n: 27, text: "Boom retract — smooth, full travel" },
  { n: 28, text: "Tilt — forward and back, smooth operation" },
  { n: 29, text: "Horn — audible and functioning" },
  { n: 30, text: "Audible travel / reversing alarm working" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function clamp(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

function rowTop(index, firstTop, rowH) {
  return firstTop - index * rowH;
}

async function build() {
  const { PDFDocument, StandardFonts, rgb, LineCapStyle } = await import("pdf-lib");

  const BRAND    = rgb(0.816, 0.165, 0.208); // #d02a35
  const DARK     = rgb(0.067, 0.094, 0.153); // #111827
  const GRAY     = rgb(0.42,  0.44,  0.50);
  const LGRAY    = rgb(0.90,  0.91,  0.92);
  const WHITE    = rgb(1, 1, 1);
  const ALTROW   = rgb(0.97,  0.975, 0.98);
  const TYRE_CLR = rgb(0.082, 0.329, 0.573); // steel blue

  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const [reg, bold] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
  ]);

  // ── HEADER BAND ───────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: BRAND });

  // Title
  const title = "TELEHANDLER PRE-USE INSPECTION CHECKLIST";
  const titleW = bold.widthOfTextAtSize(title, 11);
  page.drawText(title, {
    x: PAGE_W / 2 - titleW / 2, y: PAGE_H - 22,
    size: 11, font: bold, color: WHITE,
  });

  // Doc ref
  const ref = "PL054-OP-V3";
  const refW = reg.widthOfTextAtSize(ref, 8);
  page.drawText(ref, {
    x: PAGE_W / 2 - refW / 2, y: PAGE_H - 34,
    size: 8, font: reg, color: rgb(1, 0.85, 0.85),
  });

  // Machine ref label + value box
  page.drawText("MACHINE REF:", { x: MARGIN + NUM_COL_W, y: PAGE_H - 52, size: 7, font: bold, color: WHITE });
  page.drawRectangle({ x: MARGIN + NUM_COL_W + 72, y: PAGE_H - 59, width: 130, height: 13, color: WHITE, opacity: 0.15, borderColor: WHITE, borderWidth: 0.5 });

  // Week commencing label + value box
  page.drawText("WEEK COMMENCING:", { x: MARGIN + NUM_COL_W + 215, y: PAGE_H - 52, size: 7, font: bold, color: WHITE });
  page.drawRectangle({ x: MARGIN + NUM_COL_W + 330, y: PAGE_H - 59, width: 100, height: 13, color: WHITE, opacity: 0.15, borderColor: WHITE, borderWidth: 0.5 });

  // Serial / Site
  page.drawText("SERIAL NO:", { x: MARGIN + NUM_COL_W + 440, y: PAGE_H - 52, size: 7, font: bold, color: WHITE });
  page.drawRectangle({ x: MARGIN + NUM_COL_W + 495, y: PAGE_H - 59, width: 90, height: 13, color: WHITE, opacity: 0.15, borderColor: WHITE, borderWidth: 0.5 });

  page.drawText("SITE:", { x: MARGIN + NUM_COL_W, y: PAGE_H - 66, size: 7, font: bold, color: WHITE });
  page.drawRectangle({ x: MARGIN + NUM_COL_W + 28, y: PAGE_H - 73, width: 160, height: 13, color: WHITE, opacity: 0.15, borderColor: WHITE, borderWidth: 0.5 });

  // ALL FAULTS note
  page.drawText("ALL FAULTS MUST BE REPORTED TO YOUR SUPERVISOR IMMEDIATELY", {
    x: MARGIN + NUM_COL_W + 200, y: PAGE_H - 66,
    size: 6.5, font: bold, color: rgb(1, 0.9, 0.4),
  });

  // ── COLUMN HEADERS ROW ────────────────────────────────────
  page.drawRectangle({ x: 0, y: COL_HDR_BOT, width: PAGE_W, height: COL_HDR_H, color: DARK });

  // "ITEM" and "CHECK DESCRIPTION" headers
  page.drawText("ITEM", { x: MARGIN + 2, y: COL_HDR_BOT + 5, size: 6.5, font: bold, color: WHITE });
  page.drawText("CHECK DESCRIPTION", { x: MARGIN + NUM_COL_W + 2, y: COL_HDR_BOT + 5, size: 6.5, font: bold, color: WHITE });

  // Day column headers
  DAY_NAMES.forEach((d) => {
    const dx = DAY_X[d];
    const w = bold.widthOfTextAtSize(d.toUpperCase(), 7.5);
    page.drawText(d.toUpperCase(), { x: dx - w / 2, y: COL_HDR_BOT + 5, size: 7.5, font: bold, color: WHITE });
  });

  // Vertical grid lines in data area
  for (let i = 0; i <= NUM_DAYS; i++) {
    const lx = DATA_START_X + i * COL_W;
    page.drawLine({
      start: { x: lx, y: SIGNOFF_BOT },
      end:   { x: lx, y: COL_HDR_TOP },
      thickness: 0.4, color: LGRAY,
    });
  }

  // Vertical separator between desc and data
  page.drawLine({
    start: { x: DATA_START_X - 2, y: SIGNOFF_BOT },
    end:   { x: DATA_START_X - 2, y: COL_HDR_TOP },
    thickness: 0.6, color: LGRAY,
  });

  // ── VISUAL CHECKS SECTION ────────────────────────────────
  page.drawRectangle({ x: 0, y: VIS_SEC_BOT, width: PAGE_W, height: VIS_SEC_H, color: BRAND });
  page.drawText("VISUAL CHECKS", {
    x: MARGIN + NUM_COL_W + 2, y: VIS_SEC_BOT + 3,
    size: 7, font: bold, color: WHITE,
  });
  page.drawText("PASS = P   FAIL = F   N/A = -", {
    x: PAGE_W - MARGIN - reg.widthOfTextAtSize("PASS = P   FAIL = F   N/A = -", 6) - 2,
    y: VIS_SEC_BOT + 3.5,
    size: 6, font: reg, color: WHITE,
  });

  // Visual item rows
  SECTIONS.forEach((sec) => {
    sec.items.forEach((item) => {
      const idx  = item.n - 1;
      const rTop = rowTop(idx, VIS_FIRST_TOP, VIS_ROW_H);
      const rBot = rTop - VIS_ROW_H;

      // Alternating row fill
      if (idx % 2 === 1) {
        page.drawRectangle({ x: 0, y: rBot, width: DATA_START_X - 2, height: VIS_ROW_H, color: ALTROW });
      }

      // Horizontal row line
      page.drawLine({ start: { x: 0, y: rBot }, end: { x: PAGE_W, y: rBot }, thickness: 0.3, color: LGRAY });

      // Item number
      const numW = reg.widthOfTextAtSize(String(item.n), 6.5);
      page.drawText(String(item.n), { x: MARGIN + NUM_COL_W / 2 - numW / 2, y: rBot + 2.5, size: 6.5, font: bold, color: DARK });

      // Description (truncated)
      page.drawText(clamp(item.text, 52), { x: MARGIN + NUM_COL_W + 2, y: rBot + 2.5, size: 6.2, font: reg, color: DARK });

      // Empty tick cells (data area already has vertical grid lines)
    });
  });

  // ── TYRE PRESSURES SECTION ───────────────────────────────
  page.drawRectangle({ x: 0, y: TYRE_SEC_BOT, width: PAGE_W, height: TYRE_SEC_H, color: TYRE_CLR });
  page.drawText("TYRE PRESSURES (PSI)", {
    x: MARGIN + NUM_COL_W + 2, y: TYRE_SEC_BOT + 2.5,
    size: 7, font: bold, color: WHITE,
  });
  page.drawText("Enter actual PSI reading per tyre", {
    x: PAGE_W - MARGIN - reg.widthOfTextAtSize("Enter actual PSI reading per tyre", 6) - 2,
    y: TYRE_SEC_BOT + 3,
    size: 6, font: reg, color: rgb(0.8, 0.9, 1),
  });

  TYRE_LABELS.forEach((label, j) => {
    const rTop = rowTop(j, TYRE_FIRST_TOP, TYRE_ROW_H);
    const rBot = rTop - TYRE_ROW_H;
    if (j % 2 === 1) {
      page.drawRectangle({ x: 0, y: rBot, width: DATA_START_X - 2, height: TYRE_ROW_H, color: ALTROW });
    }
    page.drawLine({ start: { x: 0, y: rBot }, end: { x: PAGE_W, y: rBot }, thickness: 0.3, color: LGRAY });
    page.drawText(label, { x: MARGIN + NUM_COL_W + 2, y: rBot + 2.2, size: 6.2, font: reg, color: DARK });
  });

  // ── FUNCTION CHECKS SECTION ──────────────────────────────
  page.drawRectangle({ x: 0, y: FUNC_SEC_BOT, width: PAGE_W, height: FUNC_SEC_H, color: rgb(0.10, 0.15, 0.28) });
  page.drawText("FUNCTION CHECKS", {
    x: MARGIN + NUM_COL_W + 2, y: FUNC_SEC_BOT + 3,
    size: 7, font: bold, color: WHITE,
  });

  FUNCTION_CHECKS.forEach((item) => {
    const idx  = item.n - 21;
    const rTop = rowTop(idx, FUNC_FIRST_TOP, FUNC_ROW_H);
    const rBot = rTop - FUNC_ROW_H;

    if (idx % 2 === 1) {
      page.drawRectangle({ x: 0, y: rBot, width: DATA_START_X - 2, height: FUNC_ROW_H, color: ALTROW });
    }
    page.drawLine({ start: { x: 0, y: rBot }, end: { x: PAGE_W, y: rBot }, thickness: 0.3, color: LGRAY });

    const numW = reg.widthOfTextAtSize(String(item.n), 6.5);
    page.drawText(String(item.n), { x: MARGIN + NUM_COL_W / 2 - numW / 2, y: rBot + 2.5, size: 6.5, font: bold, color: DARK });
    page.drawText(clamp(item.text, 52), { x: MARGIN + NUM_COL_W + 2, y: rBot + 2.5, size: 6.2, font: reg, color: DARK });
  });

  // ── INITIALS ROW ─────────────────────────────────────────
  page.drawRectangle({ x: 0, y: INIT_BOT, width: PAGE_W, height: INIT_H, color: rgb(0.24, 0.26, 0.30) });
  page.drawText("OPERATOR INITIALS", {
    x: MARGIN + NUM_COL_W + 2, y: INIT_BOT + 4,
    size: 7, font: bold, color: WHITE,
  });

  // ── SUPERVISOR SIGN-OFF ───────────────────────────────────
  const sigH   = (SIGNOFF_TOP - SIGNOFF_BOT) / 2 - 2;
  const sigY1  = SIGNOFF_BOT + sigH + 2;
  const sigY2  = SIGNOFF_BOT;
  const sigW   = (PAGE_W - MARGIN * 2) / 2 - 4;

  [[sigY1, "Supervisor Sign-Off 1"], [sigY2, "Supervisor Sign-Off 2"]].forEach(([sy, label]) => {
    page.drawRectangle({ x: MARGIN, y: sy, width: sigW, height: sigH - 1, borderColor: LGRAY, borderWidth: 0.5, color: rgb(0.985, 0.985, 0.985) });
    page.drawText(label, { x: MARGIN + 4, y: sy + sigH - 9, size: 6, font: bold, color: GRAY });
    page.drawText("Name: ___________________________", { x: MARGIN + 4, y: sy + 3, size: 6, font: reg, color: GRAY });
    page.drawText("Date: __________", { x: MARGIN + sigW / 2 + 4, y: sy + 3, size: 6, font: reg, color: GRAY });
  });

  // Footer doc ref
  page.drawText("PL054-OP-V3  |  Telehandler Pre-Use Inspection  |  ProLift Lifting Software", {
    x: PAGE_W / 2 - 120, y: 6, size: 5.5, font: reg, color: LGRAY,
  });

  // ── SAVE ──────────────────────────────────────────────────
  const outPath = path.join(__dirname, "..", "public", "template.pdf");
  fs.writeFileSync(outPath, await pdfDoc.save());
  console.log("✓ Template written to", outPath);

  // ── Print coordinate reference for generateReport.js ──────
  console.log("\n=== STAMP COORDINATES (copy into generateReport.js) ===");
  console.log("DAY_X:", JSON.stringify(
    Object.fromEntries(DAY_NAMES.map(d => [d, Math.round(DAY_X[d] * 10) / 10]))
  ));
  console.log("VIS_FIRST_TOP:", VIS_FIRST_TOP, "  VIS_ROW_H:", VIS_ROW_H);
  console.log("TYRE_FIRST_TOP:", TYRE_FIRST_TOP, "  TYRE_ROW_H:", TYRE_ROW_H);
  console.log("FUNC_FIRST_TOP:", FUNC_FIRST_TOP, "  FUNC_ROW_H:", FUNC_ROW_H);
  console.log("INIT_TOP:", INIT_TOP);
  console.log("Header machine ref value x:", Math.round(MARGIN + NUM_COL_W + 72), " y:", Math.round(PAGE_H - 55));
  console.log("Header week comm value x:", Math.round(MARGIN + NUM_COL_W + 330), " y:", Math.round(PAGE_H - 55));
  console.log("Header serial value x:", Math.round(MARGIN + NUM_COL_W + 495), " y:", Math.round(PAGE_H - 55));
  console.log("Header site value x:", Math.round(MARGIN + NUM_COL_W + 28), " y:", Math.round(PAGE_H - 69));
}

build().catch(console.error);
