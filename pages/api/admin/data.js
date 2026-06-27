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
  if (req.method !== "GET") return res.status(405).end();
  const user = await verifyMainAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const [{ data: sites }, { data: admins }] = await Promise.all([
    supabaseAdmin.from("sites").select("*").order("created_at"),
    supabaseAdmin.from("user_profiles")
      .select("*, sites(name)")
      .eq("role", "site_admin")
      .order("created_at"),
  ]);

  const siteAdmins = (admins || []).map(a => ({ ...a, site_name: a.sites?.name }));
  return res.status(200).json({ sites: sites || [], siteAdmins });
}
