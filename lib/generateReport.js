/**
 * generateReport.js — server-side only (API routes)
 * Fetches inspection data from Supabase, stamps it onto template.pdf, uploads to storage.
 */

const path = require("path");
const fs   = require("fs");
const { supabaseAdmin } = require("./supabase-admin");

// ─── Stamp coordinate constants (from createTemplate.js output) ──────────────
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_X = { Mon: 312.5, Tue: 405.5, Wed: 498.5, Thu: 591.5, Fri: 684.4, Sat: 777.4 };

const VIS_FIRST_TOP  = 490.28;
const VIS_ROW_H      = 8.6;
const TYRE_FIRST_TOP = 303.28;
const TYRE_ROW_H     = 9.5;
const FUNC_FIRST_TOP = 249.28;
const FUNC_ROW_H     = 8.6;
const INIT_TOP       = 160.28;
const TEXT_BASELINE_OFFSET = 5.8;

function visItemY(itemNum)  { return VIS_FIRST_TOP  - (itemNum - 1)  * VIS_ROW_H  - TEXT_BASELINE_OFFSET; }
function funcItemY(itemNum) { return FUNC_FIRST_TOP - (itemNum - 21) * FUNC_ROW_H - TEXT_BASELINE_OFFSET; }
const TYRE_Y = {
  FL: TYRE_FIRST_TOP - 0 * TYRE_ROW_H - TEXT_BASELINE_OFFSET,
  FR: TYRE_FIRST_TOP - 1 * TYRE_ROW_H - TEXT_BASELINE_OFFSET,
  RL: TYRE_FIRST_TOP - 2 * TYRE_ROW_H - TEXT_BASELINE_OFFSET,
  RR: TYRE_FIRST_TOP - 3 * TYRE_ROW_H - TEXT_BASELINE_OFFSET,
};
const INITIALS_Y = INIT_TOP - 8;

// Header value stamp positions
const STAMP_MACHINE_REF   = { x: 116, y: 541 };
const STAMP_WEEK_COMM     = { x: 374, y: 541 };
const STAMP_SERIAL        = { x: 539, y: 541 };
const STAMP_SITE          = { x: 72,  y: 527 };

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

// Fetch image bytes as Uint8Array, returns null on failure
async function fetchImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}

// ─── All check item descriptions (for fault table in summary pages) ───────────
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
async function buildPDF({ forklift, sheet, summaryByItem, operatorsByDay, defectsByDay, mediaByDay }) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const GREEN = rgb(0.086, 0.502, 0.239);
  const RED   = rgb(0.729, 0.110, 0.129);
  const GRAY  = rgb(0.42,  0.44,  0.50);
  const DARK  = rgb(0.067, 0.094, 0.153);
  const WHITE = rgb(1, 1, 1);

  const templateBytes = fs.readFileSync(path.join(process.cwd(), "public", "template.pdf"));
  const pdfDoc = await PDFDocument.load(templateBytes);

  const [reg, bold] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
  ]);

  const page = pdfDoc.getPages()[0];

  // ── Header values ──────────────────────────────────────────
  page.drawText(forklift.machine_ref || "", { ...STAMP_MACHINE_REF, size: 8, font: bold, color: WHITE });
  page.drawText(fmtDate(sheet.week_commencing), { ...STAMP_WEEK_COMM, size: 8, font: bold, color: WHITE });
  page.drawText(forklift.serial_number || "", { ...STAMP_SERIAL, size: 8, font: reg, color: WHITE });
  // site name via forklift join
  const siteName = forklift.sites?.name || "";
  page.drawText(siteName, { ...STAMP_SITE, size: 8, font: reg, color: WHITE });

  // ── Visual check results ──────────────────────────────────
  for (let item = 1; item <= 20; item++) {
    const data = summaryByItem[item] || {};
    const y = visItemY(item);
    for (const day of DAY_NAMES) {
      const result = data[`${day.toLowerCase()}_result`];
      if (!result) continue;
      const { text, color } = resultGlyph(result);
      const x = DAY_X[day] - bold.widthOfTextAtSize(text, 7) / 2;
      page.drawText(text, { x, y, size: 7, font: bold, color });
    }
  }

  // ── Tyre pressure values ───────────────────────────────────
  for (const day of DAY_NAMES) {
    const media = mediaByDay[day];
    if (!media) continue;
    const tyres = { FL: media.tyre_fl_psi, FR: media.tyre_fr_psi, RL: media.tyre_rl_psi, RR: media.tyre_rr_psi };
    for (const [key, psi] of Object.entries(tyres)) {
      if (psi == null) continue;
      const text = String(Math.round(psi));
      const x = DAY_X[day] - reg.widthOfTextAtSize(text, 7) / 2;
      page.drawText(text, { x, y: TYRE_Y[key], size: 7, font: reg, color: DARK });
    }
  }

  // ── Function check results ────────────────────────────────
  for (let item = 21; item <= 30; item++) {
    const data = summaryByItem[item] || {};
    const y = funcItemY(item);
    for (const day of DAY_NAMES) {
      const result = data[`${day.toLowerCase()}_result`];
      if (!result) continue;
      const { text, color } = resultGlyph(result);
      const x = DAY_X[day] - bold.widthOfTextAtSize(text, 7) / 2;
      page.drawText(text, { x, y, size: 7, font: bold, color });
    }
  }

  // ── Operator initials ─────────────────────────────────────
  for (const day of DAY_NAMES) {
    const op = operatorsByDay[day];
    if (!op?.operator_name) continue;
    const initials = getInitials(op.operator_name);
    const x = DAY_X[day] - reg.widthOfTextAtSize(initials, 6.5) / 2;
    page.drawText(initials, { x, y: INITIALS_Y, size: 6.5, font: reg, color: WHITE });
  }

  // ── Daily summary pages ───────────────────────────────────
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
  const { rgb, PageSizes, StandardFonts } = await import("pdf-lib");

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
    const op     = operatorsByDay[day];
    const media  = mediaByDay[day] || {};
    const defects = defectsByDay[day] || [];
    const hasFaults = defects.length > 0;

    // Day header
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

    // Operator info row
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

    // Tyre pressures (if any recorded)
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

    // Photo + Signature
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

    // Defects table
    if (defects.length > 0) {
      ensureSpace(36);
      const cols = [
        { label: "Item", x: M,        w: 28  },
        { label: "Description", x: M + 28, w: 140 },
        { label: "Fault Details", x: M + 168, w: 160 },
        { label: "Status", x: M + 328, w: 60  },
        { label: "Engineer", x: M + 388, w: 80  },
        { label: "Date Fixed", x: M + 468, w: 67  },
      ];
      // Table header
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
        page.drawLine({ start: { x: M, y: curY - 13 }, end: { x: PW - M, y: curY - 13 }, thickness: 0.3, color: LGRAY });
        curY -= 13;
      });
    }

    curY -= 10; // gap between days
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────
async function generateReport(forkliftId, weekCommencing) {
  // 1. Fetch forklift + sheet
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

  // 2. Fetch pivoted check results from view
  const { data: summaryRows } = await supabaseAdmin
    .from("weekly_sheet_summary")
    .select("*")
    .eq("sheet_id", sheet.id);

  const summaryByItem = {};
  (summaryRows || []).forEach(r => { summaryByItem[r.item_number] = r; });

  // 3. Fetch daily entries (for operator log + tyre pressures)
  const weekEnd = new Date(weekCommencing);
  weekEnd.setDate(weekEnd.getDate() + 5);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const { data: entries } = await supabaseAdmin
    .from("daily_inspection_entries")
    .select("*")
    .eq("forklift_id", forkliftId)
    .gte("inspection_date", weekCommencing)
    .lte("inspection_date", weekEndStr);

  const operatorsByDay = {};
  const mediaByDay = {};

  (entries || []).forEach(e => {
    const day = getDayAbbr(e.day_of_week);
    if (!day) return;
    operatorsByDay[day] = {
      operator_name:  e.operator_name,
      pal_card_number: e.pal_card_number,
      daily_status:   e.daily_status,
      inspection_date: e.inspection_date,
      submitted_at:   e.submitted_at,
      forklift_owner: e.forklift_owner,
    };
    mediaByDay[day] = {
      photo_url:   e.photo_url,
      signature_url: e.signature_url,
      tyre_fl_psi: e.tyre_fl_psi,
      tyre_fr_psi: e.tyre_fr_psi,
      tyre_rl_psi: e.tyre_rl_psi,
      tyre_rr_psi: e.tyre_rr_psi,
    };
  });

  // 4. Fetch images in parallel
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

  // 5. Fetch defects
  const { data: defectRows } = await supabaseAdmin
    .from("defect_log")
    .select("*")
    .eq("sheet_id", sheet.id)
    .order("inspection_date");

  const defectsByDay = {};
  (defectRows || []).forEach(d => {
    const day = getDayAbbr(
      ["monday","tuesday","wednesday","thursday","friday","saturday"][new Date(d.inspection_date).getDay() === 0 ? 6 : new Date(d.inspection_date).getDay() - 1]
    );
    if (!day) return;
    if (!defectsByDay[day]) defectsByDay[day] = [];
    defectsByDay[day].push(d);
  });

  // 6. Build PDF
  const pdfBuffer = await buildPDF({ forklift, sheet, summaryByItem, operatorsByDay, defectsByDay, mediaByDay });

  // 7. Upload to storage (delete old first)
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

  // 8. Update sheet record
  await supabaseAdmin
    .from("weekly_inspection_sheets")
    .update({ pdf_url: publicUrl, pdf_generated_at: new Date().toISOString() })
    .eq("id", sheet.id);

  return publicUrl;
}

module.exports = { generateReport };
