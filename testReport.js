/**
 * testReport.js — local test: generates test-output.pdf without Supabase.
 * Run: node testReport.js
 */

const fs   = require("fs");
const path = require("path");

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
for (let i = 21; i <= 30; i++) {
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
const page3Data = {
  additional_comments: "Minor surface rust on rear right panel corner — flagged to supervisor. No impact on structural integrity or operation. Treatment scheduled for next service.",
  diagram_bytes:   null, // null → stampPage3 loads public/Picture 1.png automatically
  operator_name:   "Alice Smith",
  sig_bytes:       null,
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
