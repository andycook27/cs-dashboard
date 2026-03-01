// api/mixpanel.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { endpoint, params } = req.body;
  const username  = process.env.MIXPANEL_SERVICE_ACCOUNT_USER;
  const password  = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET;
  const projectId = process.env.MIXPANEL_PROJECT_ID;

  // Debug: confirm env vars are present (never log actual values)
  console.log("ENV CHECK:", {
    hasUser:      !!username,
    hasSecret:    !!password,
    hasProjectId: !!projectId,
    endpoint,
    params,
  });

  if (!username || !password || !projectId) {
    return res.status(500).json({
      error: "Missing env vars",
      hasUser: !!username,
      hasSecret: !!password,
      hasProjectId: !!projectId,
    });
  }

  const baseUrls = {
    engage:       "https://mixpanel.com/api/2.0/engage",
    segmentation: "https://mixpanel.com/api/2.0/segmentation",
    export:       "https://data.mixpanel.com/api/2.0/export",
    events:       "https://mixpanel.com/api/2.0/events",
  };

  const base = baseUrls[endpoint];
  if (!base) return res.status(400).json({ error: "Unknown endpoint: " + endpoint });

  const allParams = { ...params, project_id: projectId };
  const qs  = new URLSearchParams(allParams).toString();
  const url = base + "?" + qs;

  console.log("Calling Mixpanel URL:", url.replace(projectId, "[PROJECT_ID]"));

  try {
    const auth  = Buffer.from(username + ":" + password).toString("base64");
    const mpRes = await fetch(url, {
      headers: { Authorization: "Basic " + auth, Accept: "application/json" },
    });

    const text = await mpRes.text();
    console.log("Mixpanel status:", mpRes.status, "| Response preview:", text.slice(0, 300));

    if (!mpRes.ok) {
      return res.status(mpRes.status).json({ error: "Mixpanel API error", status: mpRes.status, body: text.slice(0, 500) });
    }

    if (endpoint === "export") {
      const lines  = text.trim().split("\n").filter(Boolean);
      const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      console.log("Export results count:", parsed.length);
      return res.status(200).json({ results: parsed });
    }

    const data = JSON.parse(text);
    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}