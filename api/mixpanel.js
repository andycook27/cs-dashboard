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
    return res.status(500).json({ error: "Missing env vars" });
  }

  const auth = Buffer.from(username + ":" + password).toString("base64");
  const headers = { Authorization: "Basic " + auth, Accept: "application/json" };

  try {
    // ── ENGAGE: fetch user profiles by email domain ──────────────────────────
    if (endpoint === "engage") {
      const domain = params.domain;
      const selector = `properties["$email"] =~ "(?i)@${domain}$"`;
      let allProfiles = [];
      let sessionId = null;
      let page = 0;

      // Engage API paginates — loop until all pages fetched
      while (true) {
        const body = { where: selector, project_id: projectId };
        if (sessionId) { body.session_id = sessionId; body.page = page; }

        const qRes = await fetch("https://mixpanel.com/api/2.0/engage", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body).toString(),
        });

        const data = await qRes.json();
        console.log("Engage page", page, "status:", qRes.status, "results:", data.results?.length, "total:", data.total);

        if (!qRes.ok || !data.results) break;
        allProfiles = allProfiles.concat(data.results);

        if (!sessionId) sessionId = data.session_id;
        if (allProfiles.length >= data.total || !data.results.length) break;
        page++;
        if (page > 10) break; // safety cap
      }

      return res.status(200).json({ results: allProfiles });
    }

    // ── EXPORT: fetch raw events by distinct_ids ─────────────────────────────
    if (endpoint === "export") {
      const { from_date, to_date, event, distinct_ids } = params;

      // Build where clause filtering by distinct_id list
      let where = "";
      if (distinct_ids && distinct_ids.length) {
        const ids = distinct_ids.slice(0, 50); // Mixpanel selector has limits
        const idClauses = ids.map(id => `distinct_id == "${id}"`).join(" or ");
        where = `(${idClauses})`;
      }

      const exportParams = { from_date, to_date, project_id: projectId };
      if (event) exportParams.event = event;
      if (where) exportParams.where = where;

      const qs  = new URLSearchParams(exportParams).toString();
      const url = "https://data.mixpanel.com/api/2.0/export?" + qs;

      console.log("Export URL:", url.slice(0, 200));

      const mpRes = await fetch(url, { headers: { ...headers, Accept: "text/plain" } });
      const text  = await mpRes.text();

      console.log("Export status:", mpRes.status, "| preview:", text.slice(0, 300));

      if (!mpRes.ok) {
        return res.status(mpRes.status).json({ error: "Export failed", body: text.slice(0, 500) });
      }

      const lines  = text.trim().split("\n").filter(Boolean);
      const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      console.log("Export parsed:", parsed.length, "events");
      return res.status(200).json({ results: parsed });
    }

    // ── SEGMENTATION: count events ───────────────────────────────────────────
    if (endpoint === "segmentation") {
      const segParams = { ...params, project_id: projectId };
      const qs  = new URLSearchParams(segParams).toString();
      const url = "https://mixpanel.com/api/2.0/segmentation?" + qs;

      const mpRes = await fetch(url, { headers });
      const text  = await mpRes.text();

      console.log("Segmentation status:", mpRes.status, "| preview:", text.slice(0, 200));

      if (!mpRes.ok) {
        return res.status(mpRes.status).json({ error: "Segmentation failed", body: text.slice(0, 500) });
      }
      return res.status(200).json(JSON.parse(text));
    }

    return res.status(400).json({ error: "Unknown endpoint: " + endpoint });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}