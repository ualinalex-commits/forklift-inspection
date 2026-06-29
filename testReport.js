/**
 * testReport.js — local test: generates test-output.pdf without Supabase.
 * Run: node testReport.js
 */

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");

// Generate a minimal valid PNG (solid colour) — used as a test signature placeholder.
function makeTestPng(width, height) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = table[(c ^ b) & 0xFF] ^ (c >>> 8); return (~c) >>> 0; };
  const chunk = (type, data) => {
    const t = Buffer.from(type, "ascii");
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])));
    return Buffer.concat([len, t, d, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0); // filter type None
    for (let x = 0; x < width; x++) raw.push(30, 60, 140); // dark blue pixel
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Stub supabase-admin before loading generateReport so the import doesn't fail
const supabaseAdminPath = path.resolve(__dirname, "lib/supabase-admin.js");
require.cache[supabaseAdminPath] = {
  id: supabaseAdminPath,
  filename: supabaseAdminPath,
  loaded: true,
  exports: { supabaseAdmin: {} },
};

const { buildPDF } = require("./lib/generateReport");

// ─── Mock data ────────────────────────────────────────────────────────────────

const forklift = {
  machine_ref:          "TH-01",
  serial_number:        "SN-123456",
  site_id:              "test-site",
  thorough_exam_expiry: "2026-12-31",
  sites: { name: "Acme Construction Site" },
};

const sheet = {
  id:              "test-sheet",
  machine_ref:     "TH-01",
  week_commencing: "2026-06-23",
  week_ending:     "2026-06-28",
};

// All 30 items: visual 1-20 as pass, function 21-30 alternating pass/fail
const summaryByItem = {};
for (let i = 1; i <= 20; i++) {
  summaryByItem[i] = {
    item_number: i,
    mon_result: "pass", tue_result: "pass", wed_result: "pass",
    thu_result: "fail", fri_result: "pass", sat_result: "na",
  };
}
for (let i = 21; i <= 31; i++) {
  summaryByItem[i] = {
    item_number: i,
    mon_result: i % 2 === 0 ? "pass" : "fail",
    tue_result: "pass",
    wed_result: "pass",
    thu_result: "pass",
    fri_result: "na",
    sat_result: "pass",
  };
}

const operatorsByDay = {
  Mon: { operator_name: "Alice Smith",   pal_card_number: "PAL-001", daily_status: "ok",    inspection_date: "2026-06-23", submitted_at: "2026-06-23T07:45:00Z", forklift_owner: null },
  Tue: { operator_name: "Bob Jones",     pal_card_number: "PAL-002", daily_status: "fault", inspection_date: "2026-06-24", submitted_at: "2026-06-24T08:10:00Z", forklift_owner: "Hire Co Ltd" },
  Wed: { operator_name: "Alice Smith",   pal_card_number: "PAL-001", daily_status: "ok",    inspection_date: "2026-06-25", submitted_at: "2026-06-25T07:55:00Z", forklift_owner: null },
  Thu: { operator_name: "Charlie Brown", pal_card_number: "PAL-003", daily_status: "fault", inspection_date: "2026-06-26", submitted_at: "2026-06-26T08:30:00Z", forklift_owner: null },
  Fri: { operator_name: "Alice Smith",   pal_card_number: "PAL-001", daily_status: "ok",    inspection_date: "2026-06-27", submitted_at: "2026-06-27T07:50:00Z", forklift_owner: null },
  Sat: { operator_name: "Bob Jones",     pal_card_number: "PAL-002", daily_status: "ok",    inspection_date: "2026-06-28", submitted_at: "2026-06-28T09:00:00Z", forklift_owner: null },
};

const mediaByDay = {
  Mon: { photo_url: null, signature_url: null, tyre_fl_psi: 85, tyre_fr_psi: 85, tyre_rl_psi: 87, tyre_rr_psi: 86, photo_bytes: null, sig_bytes: null },
  Tue: { photo_url: null, signature_url: null, tyre_fl_psi: 83, tyre_fr_psi: 84, tyre_rl_psi: 85, tyre_rr_psi: 85, photo_bytes: null, sig_bytes: null },
  Wed: { photo_url: null, signature_url: null, tyre_fl_psi: 85, tyre_fr_psi: 85, tyre_rl_psi: 86, tyre_rr_psi: 86, photo_bytes: null, sig_bytes: null },
  Thu: { photo_url: null, signature_url: null, tyre_fl_psi: 80, tyre_fr_psi: 81, tyre_rl_psi: 82, tyre_rr_psi: 82, photo_bytes: null, sig_bytes: null },
  Fri: { photo_url: null, signature_url: null, tyre_fl_psi: 85, tyre_fr_psi: 85, tyre_rl_psi: 87, tyre_rr_psi: 86, photo_bytes: null, sig_bytes: null },
  Sat: { photo_url: null, signature_url: null, tyre_fl_psi: 85, tyre_fr_psi: 85, tyre_rl_psi: 86, tyre_rr_psi: 85, photo_bytes: null, sig_bytes: null },
};

const defectsByDay = {
  Tue: [
    { item_number: 4, defect_details: "Small crack on left fork arm — flagged to supervisor", status: "open", engineer_name: null, date_repaired: null },
  ],
  Thu: [
    { item_number: 6, defect_details: "Tyre pressure low on front left (70 psi)", status: "reported", engineer_name: "Dave Fix", date_repaired: null },
    { item_number: 12, defect_details: "Battery terminal showing corrosion", status: "open", engineer_name: null, date_repaired: null },
  ],
};

// ─── Page 3 data (most recent entry — tests comments, diagram fallback, sign-off) ─
// sig_bytes: small solid-colour PNG (100×25px) — confirms embedding without polluting
//   the Sign field with the diagram image.
// diagram_bytes: null → stampPage3 loads public/Picture 1.png automatically.
const page3Data = {
  additional_comments: "Minor surface rust on rear right panel corner — flagged to supervisor. No impact on structural integrity or operation. Treatment scheduled for next service.",
  diagram_bytes:   null,
  operator_name:   "Alice Smith",
  sig_bytes:       new Uint8Array(makeTestPng(100, 25)),
  inspection_date: "2026-06-23",
};

// ─── Run ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("Building PDF from actual template…");
  try {
    const buf = await buildPDF({ forklift, sheet, summaryByItem, operatorsByDay, defectsByDay, mediaByDay, page3Data });
    const out = path.join(__dirname, "test-output.pdf");
    fs.writeFileSync(out, buf);
    console.log(`✓ Written to ${out}  (${(buf.length / 1024).toFixed(1)} KB)`);
    console.log("Open test-output.pdf and verify:");
    console.log("  Page 1: machine name above serial, serial number, thorough exam expiry date, site name, week commencing");
    console.log("  Page 3: additional comments, Picture 1.png diagram, operator name, date");
  } catch (err) {
    console.error("✗ Failed:", err.message);
    process.exit(1);
  }
})();
