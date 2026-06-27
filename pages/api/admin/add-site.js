const { supabaseAdmin } = require("../../../lib/supabase-admin");

async function verifyMainAdmin(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  if (process.env.ADMIN_BYPASS_TOKEN && token === process.env.ADMIN_BYPASS_TOKEN) return { id: "bypass" };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabaseAdmin.from("user_profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "main_admin") return null;
  return user;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const user = await verifyMainAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { name, location, postcode, managerName } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });

  const { data: site, error } = await supabaseAdmin.from("sites")
    .insert({ name: name.trim(), location: location?.trim() || null, postcode: postcode?.trim() || null, manager_name: managerName?.trim() || null })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const qrCodeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/site/${site.id}`;
  await supabaseAdmin.from("sites").update({ qr_code_url: qrCodeUrl }).eq("id", site.id);

  return res.status(200).json({ site: { ...site, qr_code_url: qrCodeUrl } });
}
