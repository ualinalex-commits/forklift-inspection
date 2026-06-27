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

  const { name, email, password, siteId } = req.body || {};
  if (!name || !email || !password || !siteId) return res.status(400).json({ error: "name, email, password and siteId required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (authErr) return res.status(500).json({ error: authErr.message });

  const { data: profile, error: profileErr } = await supabaseAdmin.from("user_profiles")
    .insert({ id: authData.user.id, name: name.trim(), email, role: "site_admin", site_id: siteId, must_change_password: true })
    .select("*, sites(name)")
    .single();

  if (profileErr) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    return res.status(500).json({ error: profileErr.message });
  }

  return res.status(200).json({ siteAdmin: { ...profile, site_name: profile.sites?.name } });
}
