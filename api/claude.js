// Secure proxy to the Anthropic API.
// Your API key lives here on the server and is NEVER sent to the browser.
// Deployed automatically by Vercel as the endpoint /api/claude

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Optional password protection: if APP_PASSWORD is set, the request must
  // include a matching x-app-password header. This stops strangers from
  // hitting your endpoint and spending your API budget.
  const required = process.env.APP_PASSWORD;
  if (required && req.headers["x-app-password"] !== required) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in your environment variables." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Required header for the server-side web search tool (Events page)
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
