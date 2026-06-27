const { generateReport } = require("../../lib/generateReport");
const { supabaseAdmin }  = require("../../lib/supabase-admin");

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { forklift_id, sheet_id } = req.body || {};
  if (!forklift_id) return res.status(400).json({ error: "forklift_id required" });

  try {
    let weekCommencing;
    if (sheet_id) {
      const { data: sheet } = await supabaseAdmin
        .from("weekly_inspection_sheets")
        .select("week_commencing")
        .eq("id", sheet_id)
        .single();
      weekCommencing = sheet?.week_commencing;
    }
    if (!weekCommencing) {
      const today = new Date();
      const day   = today.getDay();
      const diff  = (day + 6) % 7;
      today.setDate(today.getDate() - diff);
      weekCommencing = today.toISOString().slice(0, 10);
    }

    const url = await generateReport(forklift_id, weekCommencing);
    return res.status(200).json({ ok: true, url });
  } catch (err) {
    console.error("generate-report error:", err);
    return res.status(500).json({ error: err.message });
  }
}
