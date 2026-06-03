// Posts a message to a Slack channel via an Incoming Webhook.
// Set SLACK_WEBHOOK_URL in your Vercel project settings (Environment Variables).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return res.status(400).json({ error: "Slack not configured" });
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) return res.status(502).json({ error: "Slack rejected the message" });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
