// api/mixpanel.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const username  = process.env.MIXPANEL_SERVICE_ACCOUNT_USER;
  const password  = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET;
  const projectId = process.env.MIXPANEL_PROJECT_ID;
  const auth      = Buffer.from(username + ":" + password).toString("base64");
  const headers   = { Authorization: "Basic " + auth, Accept: "application/json" };

  // ── GET: debug endpoint ───────────────────────────────────────────────────
  if (req.method === "GET") {
    const { debug, domain } = req.query;

    // Just check env vars
    if (!debug) {
      return res.status(200).json({
        status: "ok",
        hasUser: !!username,
        hasSecret: !!password,
        hasProjectId: !!projectId,
      });
    }

    // Test Engage API
    if (debug === "engage") {
      try {
        const where = `properties["$email"] != undefined and properties["$email"].indexOf("@${domain || "sitemarker.com"}") != -1`;
        const body  = new URLSearchParams({ where, project_id: projectId });
        const r     = await fetch("https://mixpanel.com/api/2.0/engage", {
          method:  "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body:    body.toString(),
        });
        const text = await r.text();
        console.log("Debug engage status:", r.status, text.slice(0, 500));
        return res.status(r.status).send(text);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // Test Export API
    if (debug === "export") {
      try {
        const to   = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const qs   = new URLSearchParams({
          from_date:  from,
          to_date:    to,
          project_id: projectId,
          event:      JSON.stringify(["User Signed In"]),
        }).toString();
        const r    = await fetch("https://data.mixpanel.com/api/2.0/export?" + qs, {
          headers: { ...headers, Accept: "text/plain" },
        });
        const text = await r.text();
        console.log("Debug export status:", r.status, text.slice(0, 500));
        return res.status(r.status).send(text.slice(0, 3000));
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    return res.status(400).json({ error: "Unknown debug type. Use ?debug=engage or ?debug=export" });
  }

  // ── POST: normal proxy ────────────────────────────────────────────────────
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { endpoint, params } = req.body;

  if (!username || !password || !projectId) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  try {
    // ENGAGE
    if (endpoint === "engage") {
      const domain   = params.domain;
      const where    = `properties["$email"] != undefined and properties["$email"].indexOf("@${domain}") != -1`;
      let allResults = [];
      let sessionId  = null;
      let page       = 0;

      while (true) {
        const bodyObj = { where, project_id: projectId };
        if (sessionId) { bodyObj.session_id = sessionId; bodyObj.page = String(page); }

        const r    = await fetch("https://mixpanel.com/api/2.0/engage", {
          method:  "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body:    new URLSearchParams(bodyObj).toString(),
        });
        const text = await r.text();
        console.log("Engage page", page, "status:", r.status, "body:", text.slice(0, 400));

        if (!r.ok) {
          return res.status(r.status).json({ error: "Engage failed", status: r.status, body: text.slice(0, 500) });
        }

        let data;
        try { data = JSON.parse(text); } catch { break; }
        if (!data.results?.length) break;

        allResults = allResults.concat(data.results);
        console.log("Engage accumulated:", allResults.length, "of", data.total);

        if (!sessionId) sessionId = data.session_id;
        if (allResults.length >= data.total) break;
        page++;
        if (page > 20) break;
      }

      return res.status(200).json({ results: allResults, total: allResults.length });
    }

    // EXPORT
    if (endpoint === "export") {
      const { from_date, to_date, event, distinct_ids } = params;

      let where = "";
      if (distinct_ids?.length) {
        const ids     = distinct_ids.slice(0, 50);
        const clauses = ids.map(id => `distinct_id == "${id}"`).join(" or ");
        where         = `(${clauses})`;
      }

      const exportParams = { from_date, to_date, project_id: projectId };
      if (event) exportParams.event = event;
      if (where) exportParams.where = where;

      const qs  = new URLSearchParams(exportParams).toString();
      const url = "https://data.mixpanel.com/api/2.0/export?" + qs;
      console.log("Export URL:", url.slice(0, 250));

      const r    = await fetch(url, { headers: { ...headers, Accept: "text/plain" } });
      const text = await r.text();
      console.log("Export status:", r.status, "| preview:", text.slice(0, 400));

      if (!r.ok) return res.status(r.status).json({ error: "Export failed", status: r.status, body: text.slice(0, 500) });

      const lines  = text.trim().split("\n").filter(Boolean);
      const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      console.log("Export events parsed:", parsed.length);
      return res.status(200).json({ results: parsed });
    }

    return res.status(400).json({ error: "Unknown endpoint: " + endpoint });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}