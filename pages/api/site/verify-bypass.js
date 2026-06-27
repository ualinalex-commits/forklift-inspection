export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { token, siteId } = req.body || {};
  if (!siteId) return res.status(400).json({ valid: false });
  const valid = !!process.env.ADMIN_BYPASS_TOKEN && token === process.env.ADMIN_BYPASS_TOKEN;
  return res.status(200).json({ valid });
}
