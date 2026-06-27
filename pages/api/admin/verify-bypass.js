export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { token } = req.body || {};
  const valid = !!process.env.ADMIN_BYPASS_TOKEN && token === process.env.ADMIN_BYPASS_TOKEN;
  return res.status(200).json({ valid });
}
