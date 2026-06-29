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

// Function check rows: items 21–30, starting at bottom of page 0 then page 1
const FUNC_ROWS = {
  21: { page: 0, y:  48.3 }, // Seat Belt & Mounting (bottom of page 0)
  22: { page: 1, y: 766.5 }, // Fire Extinguisher
  23: { page: 1, y: 750.7 }, // Horn, backup alarm, lights, wipers
  24: { page: 1, y: 724.0 }, // Controls, gauge lenses
  25: { page: 1, y: 704.0 }, // Overall Cab
  26: { page: 1, y: 649.2 }, // Understands Good Order
  27: { page: 1, y: 615.7 }, // Understands Good Work
  28: { page: 1, y: 582.4 }, // Training
  29: { page: 1, y: 543.4 }, // Familiarisation
  30: { page: 1, y: 509.9 }, // Supervision / Fit and well
};

// Tyre pressure rows on page 1
const TYRE_ROW_Y = {
  FL: 350.4,
  FR: 324.2, // mid of 330.4 and 318.1
  RL: 305.6,
  RR: 285.6,
};

// Header field stamp positions (page 0) — extracted from updated PL054-OP-V3 template via pdfjs-dist
// "Serial Number" label at x=27.3 y=739; "Site" label at x=49.5 y=701.7;
// "Thorough/Examination/Expiry Date" right-column labels around y=739; "Week/Commencing/Date" right-column around y=701
const STAMP_MACHINE_REF    = { x:  92, y: 757 }; // machine name — blank row above Serial Number
const STAMP_SERIAL         = { x: 120, y: 739 }; // serial number value — right of "Serial Number" label
const STAMP_THOROUGH_EXAM  = { x: 405, y: 739 }; // thorough exam expiry date — right of right-column label
const STAMP_SITE           = { x:  92, y: 701 }; // site name — right of "Site" label (was "Size", now "Site" at y=701.7)
const STAMP_WEEK_COMM      = { x: 400, y: 701 }; // week commencing date — right of right-column label

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
const CHECK_DESCRIPTIONS = {
  1:  "Statutory examination in date (LOLER)",
  2:  "Operator manual present and accessible",
  3:  "Pre-use inspection record up to date",
  4:  "Tyre condition — no cuts, bulges or foreign objects",
  5:  "Wheel nuts / bolts secure, no damaged rims",
  6:  "Fuel level adequate for planned work",
  7:  "Engine oil and coolant levels correct",
  8:  "No fluid leaks visible on ground beneath machine",
  9:  "Hydraulic oil level correct",
  10: "No hydraulic leaks — hoses, cylinders, connections",
  11: "Boom — no cracks, damage, wear or misalignment",
  12: "Boom hoses and chains — condition, routing correct",
  13: "Attachment secure, correct type, no visible damage",
  14: "Attachment locking pins / retention devices secure",
  15: "Headboard / forks / bucket — no cracks, bends or wear",
  16: "Cab — seat, mirrors, windows, wipers undamaged",
  17: "ROPS/FOPS structure — secure, no cracks or damage",
  18: "Counterweight — secure and undamaged",
  19: "Seat belt / operator restraint — condition and function",
  20: "Lights and beacon present and working (if applicable)",
  21: "Engine start — normal operation, no warning lights",
  22: "Drive — forward, reverse, steering response correct",
  23: "Brakes — service and parking brake effective",
  24: "Boom lift — smooth, correct speed, holds position",
  25: "Boom lower — smooth, controlled descent",
  26: "Boom extend — smooth, full travel, no binding",
  27: "Boom retract — smooth, full travel",
  28: "Tilt — forward and back, smooth operation",
  29: "Horn — audible and functioning",
  30: "Audible travel / reversing alarm working",
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
  page0.drawText(forklift.machine_ref || "", { ...STAMP_MACHINE_REF, size: 8, font: bold, color: DARK });
  page0.drawText(forklift.serial_number || "", { ...STAMP_SERIAL, size: 8, font: reg, color: DARK });
  if (forklift.thorough_exam_expiry) {
    page0.drawText(fmtDate(forklift.thorough_exam_expiry), { ...STAMP_THOROUGH_EXAM, size: 8, font: reg, color: DARK });
  }
  page0.drawText(forklift.sites?.name || "", { ...STAMP_SITE, size: 7, font: reg, color: DARK });
  page0.drawText(fmtDate(sheet.week_commencing), { ...STAMP_WEEK_COMM, size: 8, font: reg, color: DARK });

  // ── Visual check results: items 1–20 (page 0) ─────────────────────────────
  for (let item = 1; item <= 20; item++) {
    const row = VIS_ROWS[item];
    if (!row) continue;
    const data = summaryByItem[item] || {};
    const targetPage = pages[row.page];
    for (const day of DAY_NAMES) {
      const result = data[`${day.toLowerCase()}_result`];
      if (!result) continue;
      const { text, color } = resultGlyph(result);
      const x = DAY_X[day] - bold.widthOfTextAtSize(text, 7) / 2;
      targetPage.drawText(text, { x, y: row.y, size: 7, font: bold, color });
    }
  }

  // ── Function check results: items 21–30 (pages 0–1) ───────────────────────
  for (let item = 21; item <= 30; item++) {
    const row = FUNC_ROWS[item];
    if (!row) continue;
    const data = summaryByItem[item] || {};
    const targetPage = pages[row.page];
    for (const day of DAY_NAMES) {
      const result = data[`${day.toLowerCase()}_result`];
      if (!result) continue;
      const { text, color } = resultGlyph(result);
      const x = DAY_X[day] - bold.widthOfTextAtSize(text, 7) / 2;
      targetPage.drawText(text, { x, y: row.y, size: 7, font: bold, color });
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

  // ── Stamp page 3 (additional comments, diagram, operator sign-off) ────────
  if (page3Data && pages[2]) {
    await stampPage3(pdfDoc, pages[2], page3Data, reg);
  }

  // ── Daily summary pages appended after template pages ─────────────────────
  await appendDailySummaryPages(pdfDoc, sheet, operatorsByDay, defectsByDay, mediaByDay, reg, bold);

  return Buffer.from(await pdfDoc.save());
}

function resultGlyph(result) {
  const { rgb } = require("pdf-lib");
  if (result === "pass") return { text: "P", color: rgb(0.086, 0.502, 0.239) };
  if (result === "fail") return { text: "F", color: rgb(0.729, 0.110, 0.129) };
  return { text: "-", color: rgb(0.42, 0.44, 0.50) };
}

// ─── Append A4-portrait daily summary pages ───────────────────────────────────
async function appendDailySummaryPages(pdfDoc, sheet, operatorsByDay, defectsByDay, mediaByDay, reg, bold) {
  const { rgb, PageSizes } = await import("pdf-lib");

  const BRAND  = rgb(0.816, 0.165, 0.208);
  const DARK   = rgb(0.067, 0.094, 0.153);
  const LGRAY  = rgb(0.90,  0.91,  0.92);
  const GRAY   = rgb(0.42,  0.44,  0.50);
  const WHITE  = rgb(1, 1, 1);
  const GREEN  = rgb(0.086, 0.502, 0.239);
  const RED    = rgb(0.729, 0.110, 0.129);
  const AMBER  = rgb(0.762, 0.254, 0.048);

  const PW = 595.28;
  const PH = 841.89;
  const M  = 30;

  const daysWithEntries = DAY_NAMES.filter(d => operatorsByDay[d]);
  if (daysWithEntries.length === 0) return;

  let page = pdfDoc.addPage([PW, PH]);
  let curY = PH - M;

  function ensureSpace(needed) {
    if (curY - needed < M) {
      page = pdfDoc.addPage([PW, PH]);
      curY = PH - M;
      drawPageHeader();
    }
  }

  function drawPageHeader() {
    page.drawRectangle({ x: 0, y: PH - 40, width: PW, height: 40, color: BRAND });
    page.drawText("DAILY INSPECTION SUMMARY", {
      x: M, y: PH - 25, size: 12, font: bold, color: WHITE,
    });
    page.drawText(`${sheet.machine_ref || ""}  —  Week commencing ${fmtDate(sheet.week_commencing)}`, {
      x: M, y: PH - 37, size: 8, font: reg, color: rgb(1, 0.85, 0.85),
    });
    curY = PH - 50;
  }

  drawPageHeader();

  for (const day of daysWithEntries) {
    const op      = operatorsByDay[day];
    const media   = mediaByDay[day] || {};
    const defects = defectsByDay[day] || [];
    const hasFaults = defects.length > 0;

    ensureSpace(60);
    page.drawRectangle({ x: M, y: curY - 22, width: PW - M * 2, height: 22, color: hasFaults ? RED : DARK });
    page.drawText(`${day.toUpperCase()}  ${fmtDate(op.inspection_date)}`, {
      x: M + 6, y: curY - 15, size: 10, font: bold, color: WHITE,
    });
    const statusText = hasFaults ? `FAULTS FOUND (${defects.length})` : "ALL CLEAR";
    const statusW = bold.widthOfTextAtSize(statusText, 8);
    page.drawText(statusText, {
      x: PW - M - statusW - 6, y: curY - 15, size: 8, font: bold, color: WHITE,
    });
    curY -= 26;

    ensureSpace(22);
    page.drawRectangle({ x: M, y: curY - 18, width: PW - M * 2, height: 18, color: rgb(0.96, 0.97, 0.98) });
    const infoText = [
      `Operator: ${op.operator_name || "—"}`,
      op.pal_card_number ? `PAL/Card: ${op.pal_card_number}` : null,
      op.submitted_at    ? `Time: ${fmtTime(op.submitted_at)}` : null,
      op.forklift_owner  ? `Owner: ${op.forklift_owner}` : null,
    ].filter(Boolean).join("   ");
    page.drawText(infoText, { x: M + 6, y: curY - 13, size: 7.5, font: reg, color: DARK });
    curY -= 22;

    const tyres = { FL: media.tyre_fl_psi, FR: media.tyre_fr_psi, RL: media.tyre_rl_psi, RR: media.tyre_rr_psi };
    const hasTyres = Object.values(tyres).some(v => v != null);
    if (hasTyres) {
      ensureSpace(18);
      page.drawText("Tyre PSI —", { x: M + 4, y: curY - 11, size: 7, font: bold, color: GRAY });
      const tyreStr = Object.entries(tyres)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}: ${Math.round(v)}`)
        .join("   ");
      page.drawText(tyreStr, { x: M + 58, y: curY - 11, size: 7, font: reg, color: DARK });
      curY -= 14;
    }

    const photoBytes = media.photo_bytes;
    const sigBytes   = media.sig_bytes;

    if (photoBytes || sigBytes) {
      ensureSpace(115);
      let imgX = M;

      if (photoBytes) {
        try {
          const img = await (media.photo_url?.match(/\.png$/i)
            ? pdfDoc.embedPng(photoBytes)
            : pdfDoc.embedJpg(photoBytes));
          const dims = img.scaleToFit(160, 100);
          page.drawImage(img, { x: imgX, y: curY - dims.height - 4, width: dims.width, height: dims.height });
          page.drawText("Photo", { x: imgX, y: curY - dims.height - 13, size: 6, font: reg, color: GRAY });
          imgX += dims.width + 8;
        } catch {}
      }

      if (sigBytes) {
        try {
          const img = await pdfDoc.embedPng(sigBytes);
          const dims = img.scaleToFit(130, 55);
          page.drawImage(img, { x: imgX, y: curY - dims.height - 4, width: dims.width, height: dims.height });
          page.drawText("Signature", { x: imgX, y: curY - dims.height - 13, size: 6, font: reg, color: GRAY });
        } catch {}
      }

      curY -= 115;
    }

    if (defects.length > 0) {
      ensureSpace(36);
      const cols = [
        { label: "Item",         x: M,        w: 28  },
        { label: "Description",  x: M + 28,   w: 140 },
        { label: "Fault Details",x: M + 168,  w: 160 },
        { label: "Status",       x: M + 328,  w: 60  },
        { label: "Engineer",     x: M + 388,  w: 80  },
        { label: "Date Fixed",   x: M + 468,  w: 67  },
      ];
      page.drawRectangle({ x: M, y: curY - 14, width: PW - M * 2, height: 14, color: AMBER });
      cols.forEach(c => {
        page.drawText(c.label, { x: c.x + 2, y: curY - 10, size: 6.5, font: bold, color: WHITE });
      });
      curY -= 14;

      defects.forEach((d, i) => {
        ensureSpace(22);
        if (i % 2 === 0) {
          page.drawRectangle({ x: M, y: curY - 13, width: PW - M * 2, height: 13, color: rgb(1, 0.97, 0.97) });
        }
        const row = [
          String(d.item_number),
          CHECK_DESCRIPTIONS[d.item_number] || "",
          d.defect_details || "",
          d.status || "open",
          d.engineer_name || "—",
          d.date_repaired ? fmtDate(d.date_repaired) : "—",
        ];
        cols.forEach((c, ci) => {
          const txt = row[ci];
          const maxChars = Math.floor(c.w / 4.2);
          page.drawText(txt.slice(0, maxChars), { x: c.x + 2, y: curY - 10, size: 6, font: reg, color: DARK });
        });
        page.drawLine({
          start: { x: M, y: curY - 13 }, end: { x: PW - M, y: curY - 13 },
          thickness: 0.3, color: LGRAY,
        });
        curY -= 13;
      });
    }

    curY -= 10;
  }
}

// ─── Page 3 stamp coordinates (pdf-lib bottom-left origin, same as pdfjs y) ──
// Re-extracted via pdfjs-dist from the updated PL054-OP-V3 template (June 2026).
// "Additional comments" label at y=553.9; "Use diagram below..." at y=427.4;
// "Operator Name" row at y=140.8; "Sign" at x=297.1 y=140.8; "Date" at x=460.5 y=140.8.
// Diagram box is the large empty area between y=413.9 ("this may not exactly...") and y=140.8.
const P3 = {
  COMMENTS_X:    27,
  COMMENTS_Y:   538,   // just below the "Additional comments" label (label at y=553.9)
  COMMENTS_MAX_Y: 430, // stop before "Use diagram below..." at y=427.4
  COMMENTS_MAX_W: 540,

  DIAGRAM_X:     27,
  DIAGRAM_Y:    148,   // bottom edge of diagram box (Operator Name row at y=140.8)
  DIAGRAM_MAX_W: 540,
  DIAGRAM_MAX_H: 262,  // up to y=410, just below diagram notes at y=413.9

  OP_NAME_X:   120,
  OP_NAME_Y:   140.8,
  OP_SIGN_X:   320,   // just right of "Sign" label (ends at x=316.2)
  OP_SIGN_Y:   113,   // bottom edge of signature image
  OP_SIGN_MAX_W: 135,
  OP_SIGN_MAX_H: 27,
  OP_DATE_X:   490,   // just right of "Date" label (ends at x=482.3)
  OP_DATE_Y:   140.8,
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

  // Operator name
  if (data.operator_name) {
    page.drawText(data.operator_name, { x: P3.OP_NAME_X, y: P3.OP_NAME_Y, size: 8.5, font: reg, color: DARK });
  }

  // Operator signature image
  if (data.sig_bytes) {
    try {
      const sig  = await pdfDoc.embedPng(data.sig_bytes);
      const dims = sig.scaleToFit(P3.OP_SIGN_MAX_W, P3.OP_SIGN_MAX_H);
      page.drawImage(sig, { x: P3.OP_SIGN_X, y: P3.OP_SIGN_Y, width: dims.width, height: dims.height });
    } catch (e) {
      console.warn("stampPage3: signature embed failed", e.message);
    }
  }

  // Inspection date (today's date for the most recent entry)
  if (data.inspection_date) {
    page.drawText(fmtDate(data.inspection_date), { x: P3.OP_DATE_X, y: P3.OP_DATE_Y, size: 8.5, font: reg, color: DARK });
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
      pal_card_number: e.pal_card_number,
      daily_status:    e.daily_status,
      inspection_date: e.inspection_date,
      submitted_at:    e.submitted_at,
      forklift_owner:  e.forklift_owner,
    };
    mediaByDay[day] = {
      photo_url:     e.photo_url,
      signature_url: e.signature_url,
      tyre_fl_psi:   e.tyre_fl_psi,
      tyre_fr_psi:   e.tyre_fr_psi,
      tyre_rl_psi:   e.tyre_rl_psi,
      tyre_rr_psi:   e.tyre_rr_psi,
    };
  });

  await Promise.all(
    Object.entries(mediaByDay).map(async ([day, m]) => {
      const [photoBytes, sigBytes] = await Promise.all([
        fetchImage(m.photo_url),
        fetchImage(m.signature_url),
      ]);
      mediaByDay[day].photo_bytes = photoBytes;
      mediaByDay[day].sig_bytes   = sigBytes;
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

  // Pick the best entry for page 3: most recent with additional_comments or
  // diagram_annotation_url, falling back to the most recent entry overall.
  const page3Entry =
    (entries || []).find(e => e.additional_comments || e.diagram_annotation_url) ||
    (entries || [])[0] ||
    null;

  let page3Data = null;
  if (page3Entry) {
    const day = getDayAbbr(page3Entry.day_of_week);
    const [diagBytes, sigBytes] = await Promise.all([
      fetchImage(page3Entry.diagram_annotation_url),
      // Reuse already-fetched sig bytes if available, otherwise fetch
      mediaByDay[day]?.sig_bytes
        ? Promise.resolve(mediaByDay[day].sig_bytes)
        : fetchImage(page3Entry.signature_url),
    ]);
    page3Data = {
      additional_comments: page3Entry.additional_comments,
      diagram_bytes:       diagBytes,
      operator_name:       page3Entry.operator_name,
      sig_bytes:           sigBytes,
      inspection_date:     page3Entry.inspection_date,
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
