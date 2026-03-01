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

  const auth = Buffer.from(username + ":" + password).toString("base64");

  try {
    let url, fetchOptions;

    if (endpoint === "export") {
      // Export API uses a completely different base URL and auth approach
      // project_id must be in the query string, no special headers needed
      const exportParams = { ...params, project_id: projectId };
      const qs = new URLSearchParams(exportParams).toString();
      url = "https://data.mixpanel.com/api/2.0/export?" + qs;
      fetchOptions = {
        headers: {
          Authorization: "Basic " + auth,
          Accept: "text/plain",
        },
      };
    } else if (endpoint === "segmentation") {
      const segParams = { ...params, project_id: projectId };
      const qs = new URLSearchParams(segParams).toString();
      url = "https://mixpanel.com/api/2.0/segmentation?" + qs;
      fetchOptions = {
        headers: {
          Authorization: "Basic " + auth,
          Accept: "application/json",
        },
      };
    } else {
      return res.status(400).json({ error: "Unknown endpoint: " + endpoint });
    }

    console.log("Calling:", endpoint, url.substring(0, 120));

    const mpRes = await fetch(url, fetchOptions);
    const text  = await mpRes.text();

    console.log("Mixpanel", endpoint, "status:", mpRes.status, "| preview:", text.slice(0, 300));

    if (!mpRes.ok) {
      return res.status(mpRes.status).json({
        error: "Mixpanel API error",
        status: mpRes.status,
        body:   text.slice(0, 500),
      });
    }

    if (endpoint === "export") {
      const lines  = text.trim().split("\n").filter(Boolean);
      const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      console.log("Export parsed", parsed.length, "events");
      return res.status(200).json({ results: parsed });
    }

    return res.status(200).json(JSON.parse(text));

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}