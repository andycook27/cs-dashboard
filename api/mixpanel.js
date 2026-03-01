// api/mixpanel.js
// Place this file at: cs-dashboard/api/mixpanel.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { endpoint, params } = req.body;
  const username = process.env.MIXPANEL_SERVICE_ACCOUNT_USER;
  const password = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET;
  const projectId = process.env.MIXPANEL_PROJECT_ID;

  if (!username || !password || !projectId) {
    return res.status(500).json({ error: "Mixpanel credentials not configured in environment variables." });
  }

  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const baseUrls = {
    engage:       "https://mixpanel.com/api/2.0/engage",
    segmentation: "https://mixpanel.com/api/2.0/segmentation",
    export:       "https://data.mixpanel.com/api/2.0/export",
    events:       "https://mixpanel.com/api/2.0/events",
  };

  const base = baseUrls[endpoint];
  if (!base) return res.status(400).json({ error: "Unknown endpoint: " + endpoint });

  // Inject project_id into all requests
  const allParams = { ...params, project_id: projectId };
  const qs = new URLSearchParams(allParams).toString();
  const url = base + "?" + qs;

  try {
    const mpRes = await fetch(url, {
      headers: { Authorization: "Basic " + auth, "Accept": "application/json" },
    });

    const text = await mpRes.text();

    // Export endpoint returns newline-delimited JSON — parse each line
    if (endpoint === "export") {
      const lines = text.trim().split("\n").filter(Boolean);
      const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return res.status(200).json({ results: parsed });
    }

    const data = JSON.parse(text);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}