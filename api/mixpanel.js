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

  if (!username || !password || !projectId) {
    return res.status(500).json({
      error: "Missing env vars",
      hasUser: !!username, hasSecret: !!password, hasProjectId: !!projectId,
    });
  }

  const baseUrls = {
    engage:       "https://mixpanel.com/api/2.0/engage",
    segmentation: "https://mixpanel.com/api/2.0/segmentation",
    export:       "https://data.mixpanel.com/api/2.0/export",
  };

  const base = baseUrls[endpoint];
  if (!base) return res.status(400).json({ error: "Unknown endpoint: " + endpoint });

  // Build params — export does NOT use project_id as query param, uses auth only
  const allParams = endpoint === "export"
    ? { ...params }
    : { ...params, project_id: projectId };

  // Remove limit from export params — not supported
  if (endpoint === "export") delete allParams.limit;

  const qs  = new URLSearchParams(allParams).toString();
  const url = base + "?" + qs;

  try {
    const auth  = Buffer.from(username + ":" + password).toString("base64");
    const mpRes = await fetch(url, {
      headers: {
        Authorization: "Basic " + auth,
        Accept: "application/json",
        // export endpoint needs project id in header
        ...(endpoint === "export" ? { "X-Mixpanel-Project-Id": projectId } : {}),
      },
    });

    const text = await mpRes.text();
    console.log("Mixpanel", endpoint, "status:", mpRes.status, "| preview:", text.slice(0, 200));

    if (!mpRes.ok) {
      return res.status(mpRes.status).json({
        error: "Mixpanel API error",
        status: mpRes.status,
        body: text.slice(0, 500),
      });
    }

    if (endpoint === "export") {
      const lines  = text.trim().split("\n").filter(Boolean);
      const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return res.status(200).json({ results: parsed });
    }

    return res.status(200).json(JSON.parse(text));
  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}