/**
 * generateReport.js — server-side only (API routes)
 * Fetches inspection data from Supabase, stamps it onto the actual
 * PL054-OP-V3 Telehandler Inspection Checklist PDF, uploads to storage.
 */

const path = require("path");
const fs   = require("fs");
const { supabaseAdmin } = require("./supabase-admin");

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Coordinate constants extracted from actual template via pdfjs-dist ───────
//
// Check columns: centers derived from header text x + width/2
// Same positions on page 0 and page 1 (main check sections)
const DAY_X = {
  Mon: 296.6,
  Tue: 330.0,
  Wed: 365.8,
  Thu: 401.9,
  Fri: 433.3,
  Sat: 464.8,
};

// Tyre pressure section on page 1 uses a different, wider column layout
const TYRE_COL_X = {
  Mon: 117.4,
  Tue: 167.4,
  Wed: 216.6,
  Thu: 266.6,
  Fri: 315.9,
  Sat: 369.3,
};

// Visual check rows: items 1–20, all on page 0 (template page 1)
// y = row label y-coord from pdfjs (bottom-left origin, same as pdf-lib)
const VIS_ROWS = {
  1:  { page: 0, y: 501.7 }, // Mirrors
  2:  { page: 0, y: 481.7 }, // Windows
  3:  { page: 0, y: 461.7 }, // Windshield Wipers
  4:  { page: 0, y: 440.4 }, // Forks
  5:  { page: 0, y: 419.1 }, // Warning Decals
  6:  { page: 0, y: 398.9 }, // Tyres
  7:  { page: 0, y: 378.9 }, // Wheels
  8:  { page: 0, y: 358.9 }, // Differentials
  9:  { page: 0, y: 338.9 }, // Guards and covers
  10: { page: 0, y: 318.9 }, // Steps and Handrail
  11: { page: 0, y: 297.6 }, // Stabiliser Arms (mid: 303.1, 292.1)
  12: { page: 0, y: 275.1 }, // Battery/Terminals
  13: { page: 0, y: 252.6 }, // Overall Machine
  14: { page: 0, y: 211.3 }, // Air Filter
  15: { page: 0, y: 191.1 }, // Radiator Fin
  16: { page: 0, y: 171.1 }, // All Hoses
  17: { page: 0, y: 151.1 }, // All Belts
  18: { page: 0, y: 129.8 }, // Overall Engine (mid: 135.3, 124.3)
  19: { page: 0, y:  88.5 }, // ROPS or FOPS
  20: { page: 0, y:  68.5 }, // Seat
};

// Function check rows: items 21–29 + accessories (31), pages 0–1
// Rows 26–29 = "The Driver" section (4 items only in updated PDF)
// Item 30 removed — no longer exists in updated PDF template
// y values re-extracted from updated PL054-OP-V3 via pdfjs-dist
const FUNC_ROWS = {
  21: { page: 0, y:  48.3 }, // Seat Belt & Mounting (bottom of page 0)
  22: { page: 1, y: 766.5 }, // Fire Extinguisher
  23: { page: 1, y: 750.7 }, // Horn, backup alarm, lights, wipers (top label line)
  24: { page: 1, y: 724.0 }, // Controls, gauge lenses
  25: { page: 1, y: 704.0 }, // Overall Cab
  26: { page: 1, y: 649.2 }, // Training ("Training" label y=649.2)
  27: { page: 1, y: 610.2 }, // Familiarisation ("Familiarisation" label y=610.2)
  28: { page: 1, y: 576.9 }, // Supervision ("Supervision" label y=576.9)
  29: { page: 1, y: 555.4 }, // Fit and well to carry out work (label y=555.4)
  31: { page: 1, y: 504.8 }, // Accessories — midpoint of "Slings…" lines (510.9+498.7)/2
};

// Comments column x per page index — used to stamp fault details when result is "fail"
const COMMENTS_COL_X = { 0: 503, 1: 506.5 };

// Result stamp font size — reduced from 7 so "Fault" still fits within the day column width
const RESULT_STAMP_SIZE = 6;

// Tyre pressure rows on page 1 — re-extracted from updated PDF
const TYRE_ROW_Y = {
  FL: 417.4,           // "Front Left PSI" label y=417.4
  FR: 391.3,           // midpoint of "Front Right" y=397.4 and "PSI" y=385.1
  RL: 372.4,           // "Rear Left PSI" label y=372.4
  RR: 352.4,           // "Rear Right PSI" label y=352.4
};

// Header field stamp positions (page 0) — re-extracted from updated PL054-OP-V3 via pdfjs-dist
// Left column:  "Serial Number" ends at x≈85.3  → value at x=105 (20pt clearance)
// Left column:  "Size" ends at x≈65             → value at x=105 (aligned with Serial row)
// Right column: "Examination"   ends at x≈369.7 → value at x=390 (20pt clearance)
// Right column: "Commencing"    ends at x≈371.1 → value at x=390 (aligned with Thorough row)
const STAMP_SERIAL         = { x: 105, y: 739   }; // serial number
const STAMP_THOROUGH_EXAM  = { x: 390, y: 739   }; // thorough exam expiry date
const STAMP_SITE           = { x: 105, y: 701.7 }; // site name
const STAMP_WEEK_COMM      = { x: 390, y: 701.7 }; // week commencing date

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getInitials(name) {
  if (!name) return "";
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || "").join("").slice(0, 3);
}

function getDayAbbr(dayOfWeek) {
  const map = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat" };
  return map[dayOfWeek?.toLowerCase()] || "";
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

async function fetchImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}

// ─── Check descriptions (for fault table in daily summary pages) ──────────────
// Must match the SECTIONS/FUNCTION_CHECKS text in pages/check/[forkliftId].jsx,
// which itself matches the printed rows on the PL054-OP-V3 template (see
// VIS_ROWS / FUNC_ROWS above) — item_number is the single source of truth
// tying a worker's answer to a physical row on the PDF.
const CHECK_DESCRIPTIONS = {
  1:  "Mirrors — clean, no damage, properly adjusted",
  2:  "Windows — clean, no damage, front and top",
  3:  "Windshield wipers — arm and rubber blade intact",
  4:  "Forks — no damage, cracks or misalignment; check welds, locking pins in place and secure",
  5:  "Warning decals — present, legible, not damaged",
  6:  "Tyres — no damage, bulges, correct ply rating",
  7:  "Wheels — no loose lug bolts, bent rims or cracks",
  8:  "Differentials — no oil leaks or cracks in housing",
  9:  "Guards and covers — no damage, all in place",
  10: "Steps and handrail — no damage, clean",
  11: "Stabiliser arms, cylinders, pads — no damage or oil leaks, cylinder rod condition, no missing bolts",
  12: "Battery / terminals — cable connections secure, no water ingress, clean — no corrosion",
  13: "Overall machine — no loose/missing nuts or bolts, guards secure, no damage, clean",
  14: "Air filter — check restriction indicator",
  15: "Radiator fin — no blockage, leaks; clean",
  16: "All hoses — no cracks, wear spots or leaks",
  17: "All belts — check tightness, wear, cracks, delamination",
  18: "Overall engine compartment — no rubbish or dirt build-up, no leaks",
  19: "ROPS or FOPS — no damage, no loose bolts",
  20: "Seat — adjustment and pedal travel correct",
  21: "Seat belt & mounting — no damage or wear, adjusts and functions correctly",
  22: "Fire extinguisher — charge OK, no damage, inspection card in date",
  23: "Horn, backup alarm, lights, wipers — proper function",
  24: "Controls, gauge lenses — proper function, clean",
  25: "Overall cab — interior cleanliness",
  26: "Training — do you have a current CPCS card for the item of plant you are operating?",
  27: "Familiarisation — are you familiar with the model of telehandler, its functions and controls, and any attachments you are using?",
  28: "Supervision — do you know who your supervisor is?",
  29: "Fit and well to carry out work — are you?",
  31: "Slings, bin handlers, chains etc — suitable storage, free from damage, good condition",
};

// ─── PDF build ────────────────────────────────────────────────────────────────
async function buildPDF({ forklift, sheet, summaryByItem, operatorsByDay, defectsByDay, mediaByDay, page3Data }) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const GREEN = rgb(0.086, 0.502, 0.239);
  const RED   = rgb(0.729, 0.110, 0.129);
  const GRAY  = rgb(0.42,  0.44,  0.50);
  const DARK  = rgb(0.067, 0.094, 0.153);

  const templatePath = path.join(process.cwd(), 'public', 'PL054-OP-V3-Telehandler Inspection Checklist 1.pdf');
  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);

  const [reg, bold] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
  ]);

  const pages = pdfDoc.getPages();
  const page0 = pages[0];
  const page1 = pages[1];

  // ── Header values (page 0) ─────────────────────────────────────────────────
  page0.drawText(forklift.serial_number || "", { ...STAMP_SERIAL, size: 8, font: reg, color: DARK });
  if (forklift.thorough_exam_expiry) {
    page0.drawText(fmtDate(forklift.thorough_exam_expiry), { ...STAMP_THOROUGH_EXAM, size: 8, font: reg, color: DARK });
  }
  page0.drawText(forklift.sites?.name || "", { ...STAMP_SITE, size: 7, font: reg, color: DARK });
  page0.drawText(fmtDate(sheet.week_commencing), { ...STAMP_WEEK_COMM, size: 8, font: reg, color: DARK });

  // Build defect comment lookup: defectLookup[day][item_number] = truncated defect detail
  const defectLookup = {};
  for (const [day, defects] of Object.entries(defectsByDay || {})) {
    defectLookup[day] = {};
    for (const d of defects) {
      defectLookup[day][d.item_number] = (d.defect_details || "").slice(0, 80);
    }
  }

  // ── Visual check results: items 1–20 (page 0) ─────────────────────────────
  for (let item = 1; item <= 20; item++) {
    const row = VIS_ROWS[item];
    if (!row) continue;
    const data = summaryByItem[item] || {};
    const targetPage = pages[row.page];
    let commentStamped = false;
    for (const day of DAY_NAMES) {
      const result = data[`${day.toLowerCase()}_result`];
      if (!result) continue;
      const { text, color } = resultGlyph(result);
      const x = DAY_X[day] - bold.widthOfTextAtSize(text, RESULT_STAMP_SIZE) / 2;
      targetPage.drawText(text, { x, y: row.y, size: RESULT_STAMP_SIZE, font: bold, color });
      if (result === "fail" && !commentStamped) {
        const comment = defectLookup[day]?.[item] || "";
        if (comment) {
          const cx = COMMENTS_COL_X[row.page] ?? 503;
          const cLines = wrapText(comment, reg, 6, 62).slice(0, 2);
          cLines.forEach((ln, i) => targetPage.drawText(ln, { x: cx, y: row.y - i * 7, size: 6, font: reg, color: DARK }));
          commentStamped = true;
        }
      }
    }
  }

  // ── Function check results: items 21–31 (pages 0–1); 31 = Accessories ────
  for (let item = 21; item <= 31; item++) {
    const row = FUNC_ROWS[item];
    if (!row) continue;
    const data = summaryByItem[item] || {};
    const targetPage = pages[row.page];
    let commentStamped = false;
    for (const day of DAY_NAMES) {
      const result = data[`${day.toLowerCase()}_result`];
      if (!result) continue;
      const { text, color } = resultGlyph(result);
      const x = DAY_X[day] - bold.widthOfTextAtSize(text, RESULT_STAMP_SIZE) / 2;
      targetPage.drawText(text, { x, y: row.y, size: RESULT_STAMP_SIZE, font: bold, color });
      if (result === "fail" && !commentStamped) {
        const comment = defectLookup[day]?.[item] || "";
        if (comment) {
          const cx = COMMENTS_COL_X[row.page] ?? 506.5;
          const cLines = wrapText(comment, reg, 6, 62).slice(0, 2);
          cLines.forEach((ln, i) => targetPage.drawText(ln, { x: cx, y: row.y - i * 7, size: 6, font: reg, color: DARK }));
          commentStamped = true;
        }
      }
    }
  }

  // ── Tyre pressure values (page 1, dedicated tyre section) ─────────────────
  for (const day of DAY_NAMES) {
    const media = mediaByDay[day];
    if (!media) continue;
    const tyres = { FL: media.tyre_fl_psi, FR: media.tyre_fr_psi, RL: media.tyre_rl_psi, RR: media.tyre_rr_psi };
    for (const [key, psi] of Object.entries(tyres)) {
      if (psi == null) continue;
      const text = String(Math.round(psi));
      const x = TYRE_COL_X[day] - reg.widthOfTextAtSize(text, 7) / 2;
      page1.drawText(text, { x, y: TYRE_ROW_Y[key], size: 7, font: reg, color: DARK });
    }
  }

  // ── Stamp page 3 (additional comments, diagram, operator + supervisor sign-off) ─
  if (page3Data && pages[2]) {
    await stampPage3(pdfDoc, pages[2], page3Data, reg);
  }

  return Buffer.from(await pdfDoc.save());
}

function resultGlyph(result) {
  const { rgb } = require("pdf-lib");
  if (result === "pass") return { text: "OK", color: rgb(0.086, 0.502, 0.239) };
  if (result === "fail") return { text: "Fault", color: rgb(0.729, 0.110, 0.129) };
  return { text: "N/A", color: rgb(0, 0, 0) };
}

// ─── Page 3 sign-off table cell geometry ─────────────────────────────────────
// Source: DOCX Table 9 cell widths (dxa/20 → pt) + Word 2.835pt default cell margin.
// Verified against pdfjs text positions (debugPage3Coords.mjs) and pdftoppm render.
//
// Table 9 — 6 columns, 2 rows (Operator + Supervisor).
// Cell widths (pt): 125.55 | 144.20 | 44.55 | 118.70 | 44.55 | 75.30
// table_left_border = 27.25 (label text x) − 2.835 (margin) = 24.415pt
//
//  Cell | Role              | Border left→right     | Content left→right    | Center
//  ─────+───────────────────+───────────────────────+───────────────────────+───────
//   1   | "Operator Name"   | 24.415 → 149.965      | 27.250 → 147.130      | 87.19
//   2   | Op Name VALUE     | 149.965 → 294.165      | 152.800 → 291.330     | 222.07
//   3   | "Sign"            | 294.165 → 338.715      | 297.000 → 335.880     | 316.44
//   4   | Sign VALUE        | 338.715 → 457.415      | 341.550 → 454.580     | 398.07
//   5   | "Date"            | 457.415 → 501.965      | 460.250 → 499.130     | 479.69
//   6   | Date VALUE        | 501.965 → 577.265      | 504.800 → 574.430     | 539.62
//
// Row heights (dxa/20): Operator=32.60pt  Supervisor=33.60pt
// Row baselines (pdfjs bottom-left origin): Operator y=374.63  Supervisor y=340.85
// Row vertical centre (baseline + ≈2.75pt): Operator≈377.4  Supervisor≈343.6
const P3 = {
  COMMENTS_X:     27,
  COMMENTS_Y:    750,  // just below "Additional comments" label at y=767.7
  COMMENTS_MAX_Y: 678, // stop above "Use diagram below..." at y=667.7
  COMMENTS_MAX_W: 540,

  DIAGRAM_X:      27,
  DIAGRAM_Y:     388,  // bottom edge (operator row top≈386, +1.4pt buffer)
  DIAGRAM_MAX_W:  540,
  DIAGRAM_MAX_H:  256, // top = 388+256=644, just below "(this may not...)" at y=654.2

  // Cell 2 — Operator Name VALUE cell (content area, with 2.835pt cell margin)
  OP_NAME_CELL_L:  152.80,
  OP_NAME_CELL_R:  291.33,
  OP_NAME_Y:       374.63,  // text baseline (same as "Operator Name" label)

  // Cell 4 — Sign VALUE cell
  OP_SIGN_CELL_L:  341.55,
  OP_SIGN_CELL_R:  454.58,
  OP_SIGN_ROW_CY:  377.4,   // vertical centre of operator row
  OP_SIGN_MAX_W:    80.0,   // signature fits in 113pt content space; 80pt max
  OP_SIGN_MAX_H:    18.0,

  // Cell 6 — Date VALUE cell
  OP_DATE_CELL_L:  504.80,
  OP_DATE_CELL_R:  574.43,
  OP_DATE_Y:       374.63,

  // Supervisor row — same 6-column structure as operator row, different y
  SUP_Y:           340.85,
  SUP_SIGN_ROW_CY: 343.6,
};

// Wrap text to fit within maxWidth pts at the given fontSize.
function wrapText(text, font, fontSize, maxWidth) {
  const words = (text || "").split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Stamp page 3 (index 2) with additional comments, diagram, operator name, signature, date.
// Diagram: use the annotated PNG (user drawings on Picture 1.png) if available,
// otherwise fall back to loading public/Picture 1.png directly.
async function stampPage3(pdfDoc, page, data, reg) {
  const { rgb } = await import("pdf-lib");
  const DARK = rgb(0.067, 0.094, 0.153);

  // Additional comments text (word-wrapped)
  if (data.additional_comments) {
    const lines = wrapText(data.additional_comments, reg, 8.5, P3.COMMENTS_MAX_W);
    let y = P3.COMMENTS_Y;
    for (const line of lines) {
      if (y < P3.COMMENTS_MAX_Y) break;
      page.drawText(line, { x: P3.COMMENTS_X, y, size: 8.5, font: reg, color: DARK });
      y -= 12;
    }
  }

  // Diagram image: annotated version (user drew on it) or plain Picture 1.png fallback
  let diagramBytes = data.diagram_bytes || null;
  if (!diagramBytes) {
    const picturePath = path.join(process.cwd(), "public", "Picture 1.png");
    if (fs.existsSync(picturePath)) {
      diagramBytes = new Uint8Array(fs.readFileSync(picturePath));
    }
  }
  if (diagramBytes) {
    try {
      const img  = await pdfDoc.embedPng(diagramBytes);
      const dims = img.scaleToFit(P3.DIAGRAM_MAX_W, P3.DIAGRAM_MAX_H);
      const imgX = P3.DIAGRAM_X + (P3.DIAGRAM_MAX_W - dims.width) / 2;
      const imgY = P3.DIAGRAM_Y + (P3.DIAGRAM_MAX_H - dims.height) / 2;
      page.drawImage(img, { x: imgX, y: imgY, width: dims.width, height: dims.height });
    } catch (e) {
      console.warn("stampPage3: diagram image embed failed", e.message);
    }
  }

  // Operator name — centred in Cell 2 (value cell immediately right of "Operator Name" label)
  // Cell 2 content: x=152.80 → 291.33 (width=138.53pt), between the 1st and 2nd column borders
  if (data.operator_name) {
    const textW = reg.widthOfTextAtSize(data.operator_name, 8.5);
    const cellW = P3.OP_NAME_CELL_R - P3.OP_NAME_CELL_L;
    const nameX = P3.OP_NAME_CELL_L + (cellW - textW) / 2;
    console.log(`[page3] Op Name "${data.operator_name}" textW=${textW.toFixed(1)}  x=${nameX.toFixed(2)}  cell=[${P3.OP_NAME_CELL_L}→${P3.OP_NAME_CELL_R}]  → Cell 2 (Op Name value cell, between column borders at x≈150 and x≈294)`);
    page.drawText(data.operator_name, { x: nameX, y: P3.OP_NAME_Y, size: 8.5, font: reg, color: DARK });
  }

  // Signature — centred in Cell 4 (value cell immediately right of "Sign" label)
  // Cell 4 content: x=341.55 → 454.58 (width=113.03pt), between the 3rd and 4th column borders
  if (data.sig_bytes) {
    try {
      const sig  = await pdfDoc.embedPng(data.sig_bytes);
      const dims = sig.scaleToFit(P3.OP_SIGN_MAX_W, P3.OP_SIGN_MAX_H);
      const cellW = P3.OP_SIGN_CELL_R - P3.OP_SIGN_CELL_L;
      const sigX  = P3.OP_SIGN_CELL_L + (cellW - dims.width) / 2;
      const sigY  = P3.OP_SIGN_ROW_CY - dims.height / 2;
      console.log(`[page3] Signature dims=${dims.width.toFixed(1)}×${dims.height.toFixed(1)}  x=${sigX.toFixed(2)}  y=${sigY.toFixed(2)}  cell=[${P3.OP_SIGN_CELL_L}→${P3.OP_SIGN_CELL_R}]  → Cell 4 (Sign value cell, between column borders at x≈339 and x≈457)`);
      page.drawImage(sig, { x: sigX, y: sigY, width: dims.width, height: dims.height });
    } catch (e) {
      console.warn("stampPage3: signature embed failed", e.message);
    }
  }

  // Date — centred in Cell 6 (value cell immediately right of "Date" label)
  // Cell 6 content: x=504.80 → 574.43 (width=69.63pt), between the 5th and 6th column borders
  if (data.inspection_date) {
    const dateStr = fmtDate(data.inspection_date);
    const textW = reg.widthOfTextAtSize(dateStr, 8.5);
    const cellW = P3.OP_DATE_CELL_R - P3.OP_DATE_CELL_L;
    const dateX = P3.OP_DATE_CELL_L + (cellW - textW) / 2;
    console.log(`[page3] Date "${dateStr}" textW=${textW.toFixed(1)}  x=${dateX.toFixed(2)}  cell=[${P3.OP_DATE_CELL_L}→${P3.OP_DATE_CELL_R}]  → Cell 6 (Date value cell, between column borders at x≈502 and x≈577)`);
    page.drawText(dateStr, { x: dateX, y: P3.OP_DATE_Y, size: 8.5, font: reg, color: DARK });
  }

  // Supervisor Name — centred in Cell 2, supervisor row
  if (data.supervisor_name) {
    const textW = reg.widthOfTextAtSize(data.supervisor_name, 8.5);
    const cellW = P3.OP_NAME_CELL_R - P3.OP_NAME_CELL_L;
    const nameX = P3.OP_NAME_CELL_L + (cellW - textW) / 2;
    page.drawText(data.supervisor_name, { x: nameX, y: P3.SUP_Y, size: 8.5, font: reg, color: DARK });
  }

  // Supervisor Signature — centred in Cell 4, supervisor row
  if (data.supervisor_sig_bytes) {
    try {
      const sig  = await pdfDoc.embedPng(data.supervisor_sig_bytes);
      const dims = sig.scaleToFit(P3.OP_SIGN_MAX_W, P3.OP_SIGN_MAX_H);
      const cellW = P3.OP_SIGN_CELL_R - P3.OP_SIGN_CELL_L;
      const sigX  = P3.OP_SIGN_CELL_L + (cellW - dims.width) / 2;
      const sigY  = P3.SUP_SIGN_ROW_CY - dims.height / 2;
      page.drawImage(sig, { x: sigX, y: sigY, width: dims.width, height: dims.height });
    } catch (e) {
      console.warn("stampPage3: supervisor signature embed failed", e.message);
    }
  }

  // Supervisor Date — centred in Cell 6, supervisor row
  if (data.supervisor_sign_date) {
    const dateStr = fmtDate(data.supervisor_sign_date);
    const textW = reg.widthOfTextAtSize(dateStr, 8.5);
    const cellW = P3.OP_DATE_CELL_R - P3.OP_DATE_CELL_L;
    const dateX = P3.OP_DATE_CELL_L + (cellW - textW) / 2;
    page.drawText(dateStr, { x: dateX, y: P3.SUP_Y, size: 8.5, font: reg, color: DARK });
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────
async function generateReport(forkliftId, weekCommencing) {
  const { data: sheet, error: sheetErr } = await supabaseAdmin
    .from("weekly_inspection_sheets")
    .select("*, forklifts(*, sites(name))")
    .eq("forklift_id", forkliftId)
    .eq("week_commencing", weekCommencing)
    .single();

  if (sheetErr || !sheet) {
    console.error("generateReport: sheet not found", sheetErr);
    return null;
  }

  const forklift = sheet.forklifts;

  const { data: summaryRows } = await supabaseAdmin
    .from("weekly_sheet_summary")
    .select("*")
    .eq("sheet_id", sheet.id);

  const summaryByItem = {};
  (summaryRows || []).forEach(r => { summaryByItem[r.item_number] = r; });

  const weekEnd = new Date(weekCommencing);
  weekEnd.setDate(weekEnd.getDate() + 5);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const { data: entries } = await supabaseAdmin
    .from("daily_inspection_entries")
    .select("*")
    .eq("forklift_id", forkliftId)
    .gte("inspection_date", weekCommencing)
    .lte("inspection_date", weekEndStr)
    .order("inspection_date", { ascending: false }); // most recent first for page 3

  const operatorsByDay = {};
  const mediaByDay = {};

  (entries || []).forEach(e => {
    const day = getDayAbbr(e.day_of_week);
    if (!day) return;
    operatorsByDay[day] = {
      operator_name:   e.operator_name,
      daily_status:    e.daily_status,
      inspection_date: e.inspection_date,
      submitted_at:    e.submitted_at,
      forklift_owner:  e.forklift_owner,
    };
    mediaByDay[day] = {
      signature_url: e.signature_url,
      tyre_fl_psi:   e.tyre_fl_psi,
      tyre_fr_psi:   e.tyre_fr_psi,
      tyre_rl_psi:   e.tyre_rl_psi,
      tyre_rr_psi:   e.tyre_rr_psi,
    };
  });

  await Promise.all(
    Object.entries(mediaByDay).map(async ([day, m]) => {
      mediaByDay[day].sig_bytes = await fetchImage(m.signature_url);
    })
  );

  const { data: defectRows } = await supabaseAdmin
    .from("defect_log")
    .select("*")
    .eq("sheet_id", sheet.id)
    .order("inspection_date");

  const defectsByDay = {};
  (defectRows || []).forEach(d => {
    const dow = new Date(d.inspection_date).getDay();
    const dayIdx = dow === 0 ? 6 : dow - 1;
    const day = getDayAbbr(["monday","tuesday","wednesday","thursday","friday","saturday"][dayIdx]);
    if (!day) return;
    if (!defectsByDay[day]) defectsByDay[day] = [];
    defectsByDay[day].push(d);
  });

  // Pick the best entry for page 3 (operator name/sign/date + comments/diagram):
  // most recent with additional_comments or diagram_annotation_url, falling back
  // to the most recent entry overall. The supervisor sign-off is separate — it's
  // one per forklift per week, stored directly on the weekly sheet.
  const page3Entry =
    (entries || []).find(e => e.additional_comments || e.diagram_annotation_url) ||
    (entries || [])[0] ||
    null;

  let page3Data = null;
  if (page3Entry || sheet.supervisor_name) {
    const day = page3Entry ? getDayAbbr(page3Entry.day_of_week) : null;
    const [diagBytes, sigBytes, supervisorSigBytes] = await Promise.all([
      page3Entry ? fetchImage(page3Entry.diagram_annotation_url) : Promise.resolve(null),
      // Reuse already-fetched sig bytes if available, otherwise fetch
      page3Entry
        ? (mediaByDay[day]?.sig_bytes
            ? Promise.resolve(mediaByDay[day].sig_bytes)
            : fetchImage(page3Entry.signature_url))
        : Promise.resolve(null),
      fetchImage(sheet.supervisor_signature_url),
    ]);
    page3Data = {
      additional_comments:   page3Entry?.additional_comments,
      diagram_bytes:         diagBytes,
      operator_name:         page3Entry?.operator_name,
      sig_bytes:             sigBytes,
      inspection_date:       page3Entry?.inspection_date,
      supervisor_name:       sheet.supervisor_name,
      supervisor_sig_bytes:  supervisorSigBytes,
      supervisor_sign_date:  sheet.supervisor_sign_date,
    };
  }

  const pdfBuffer = await buildPDF({ forklift, sheet, summaryByItem, operatorsByDay, defectsByDay, mediaByDay, page3Data });

  const storagePath = `${forklift.site_id}/${forkliftId}/${weekCommencing}.pdf`;
  await supabaseAdmin.storage.from("weekly-reports").remove([storagePath]);

  const { error: uploadErr } = await supabaseAdmin.storage
    .from("weekly-reports")
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadErr) {
    console.error("generateReport: upload failed", uploadErr);
    return null;
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from("weekly-reports").getPublicUrl(storagePath);

  await supabaseAdmin
    .from("weekly_inspection_sheets")
    .update({ pdf_url: publicUrl, pdf_generated_at: new Date().toISOString() })
    .eq("id", sheet.id);

  return publicUrl;
}

module.exports = { generateReport, buildPDF };
