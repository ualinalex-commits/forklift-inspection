const { supabaseAdmin }  = require("../../../lib/supabase-admin");
const { generateReport } = require("../../../lib/generateReport");

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Week commencing = Monday of current week
  const today = new Date();
  const day   = today.getDay();
  const diff  = (day + 6) % 7;
  const mon   = new Date(today);
  mon.setDate(today.getDate() - diff);
  const weekCommencing = mon.toISOString().slice(0, 10);

  // All active non-archived forklifts
  const { data: forklifts, error: forkErr } = await supabaseAdmin
    .from("forklifts")
    .select("id, machine_ref, site_id")
    .eq("active", true)
    .or("is_archived.eq.false,is_archived.is.null");

  if (forkErr) return res.status(500).json({ error: forkErr.message });

  const results = [];

  for (const forklift of forklifts || []) {
    const { data: sheet } = await supabaseAdmin
      .from("weekly_inspection_sheets")
      .select("id")
      .eq("forklift_id", forklift.id)
      .eq("week_commencing", weekCommencing)
      .maybeSingle();

    if (!sheet) {
      results.push({ forklift_id: forklift.id, machine_ref: forklift.machine_ref, status: "skipped" });
      continue;
    }

    try {
      const url = await generateReport(forklift.id, weekCommencing);
      results.push({ forklift_id: forklift.id, machine_ref: forklift.machine_ref, status: "ok", url });
    } catch (err) {
      results.push({ forklift_id: forklift.id, machine_ref: forklift.machine_ref, status: "error", error: err.message });
    }
  }

  const ok      = results.filter(r => r.status === "ok").length;
  const skipped = results.filter(r => r.status === "skipped").length;
  const errors  = results.filter(r => r.status === "error").length;

  return res.status(200).json({ ok, skipped, errors, weekCommencing, results });
}
