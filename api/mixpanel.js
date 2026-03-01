// api/mixpanel.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const username  = process.env.MIXPANEL_SERVICE_ACCOUNT_USER;
  const password  = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET;
  const projectId = process.env.MIXPANEL_PROJECT_ID;

  if (!username || !password || !projectId) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  const auth    = Buffer.from(username + ":" + password).toString("base64");
  const headers = { Authorization: "Basic " + auth, Accept: "application/json" };

  // ── Fetch with timeout ────────────────────────────────────────────────────
  async function mpFetch(url, opts = {}, timeoutMs = 25000) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(tid);
      return r;
    } catch (e) {
      clearTimeout(tid);
      if (e.name === "AbortError") throw new Error("Mixpanel timed out after " + timeoutMs / 1000 + "s");
      throw e;
    }
  }

  // ── GET: debug ────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { debug, domain } = req.query;
    if (!debug) return res.status(200).json({ status: "ok", hasUser: !!username, hasSecret: !!password, hasProjectId: !!projectId });

    if (debug === "engage") {
      try {
        const domains = (domain || "sitemarker.com").split(",").map(d => d.trim()).filter(Boolean);
        const where   = domains.map(d => `"@${d}" in properties["$email"]`).join(" or ");
        const r       = await mpFetch("https://mixpanel.com/api/2.0/engage", {
          method:  "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body:    new URLSearchParams({ where, project_id: projectId }).toString(),
        });
        return res.status(r.status).send(await r.text());
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    if (debug === "export") {
      try {
        const to   = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const qs   = new URLSearchParams({ from_date: from, to_date: to, project_id: projectId, event: JSON.stringify(["User Signed In"]) }).toString();
        const r    = await mpFetch("https://data.mixpanel.com/api/2.0/export?" + qs, { headers: { ...headers, Accept: "text/plain" } });
        return res.status(r.status).send((await r.text()).slice(0, 3000));
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    return res.status(400).json({ error: "Unknown debug type" });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { endpoint, params } = req.body;
  console.log("POST endpoint:", endpoint, "params keys:", Object.keys(params || {}));

  try {

    // ── ENGAGE ──────────────────────────────────────────────────────────────
    if (endpoint === "engage") {
      const domains = Array.isArray(params.domain) ? params.domain : [params.domain];
      const where   = domains.map(d => `"@${d}" in properties["$email"]`).join(" or ");

      let allResults = [];
      let sessionId  = null;
      let page       = 0;

      while (true) {
        const bodyObj = { where, project_id: projectId, page_size: 1000 };
        if (sessionId !== null) {
          bodyObj.session_id = sessionId;
          bodyObj.page       = page;
        }

        let r, text;
        try {
          r    = await mpFetch("https://mixpanel.com/api/2.0/engage", {
            method:  "POST",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
            body:    new URLSearchParams(bodyObj).toString(),
          });
          text = await r.text();
        } catch (e) {
          return res.status(500).json({ error: "Engage fetch error: " + e.message });
        }

        console.log("Engage page", page, "status:", r.status, "body:", text.slice(0, 400));
        if (!r.ok) return res.status(r.status).json({ error: "Engage failed", body: text.slice(0, 500) });

        let data;
        try { data = JSON.parse(text); } catch {
          return res.status(500).json({ error: "Engage invalid JSON", raw: text.slice(0, 300) });
        }

        if (!Array.isArray(data.results) || data.results.length === 0) break;
        allResults = allResults.concat(data.results);
        console.log("Engage accumulated:", allResults.length, "of", data.total);

        if (data.session_id) sessionId = data.session_id;
        if (allResults.length >= data.total) break;
        page++;
        if (page > 50) { console.warn("Engage page safety limit hit"); break; }
      }

      return res.status(200).json({ results: allResults, total: allResults.length });
    }

    // ── EXPORT ──────────────────────────────────────────────────────────────
    if (endpoint === "export") {
      const { from_date, to_date, event, distinct_ids } = params;

      console.log("Export params — from:", from_date, "to:", to_date, "events:", event?.length, "distinct_ids:", distinct_ids?.length);

      // Build where clause from distinct_ids (provided by Engage)
      let where = "";
      if (distinct_ids?.length) {
        const ids     = distinct_ids.slice(0, 100);
        const clauses = ids.map(id => `distinct_id == "${String(id).replace(/"/g, '\\"')}"`).join(" or ");
        where         = "(" + clauses + ")";
        if (distinct_ids.length > 100) console.warn("distinct_ids truncated to 100 from", distinct_ids.length);
      }

      // event: accept raw array or pre-stringified — normalize to JSON string
      let eventStr;
      if (Array.isArray(event))        eventStr = JSON.stringify(event);
      else if (typeof event === "string") {
        try { eventStr = Array.isArray(JSON.parse(event)) ? event : JSON.stringify([event]); }
        catch { eventStr = JSON.stringify([event]); }
      }

      const exportParams = { from_date, to_date, project_id: projectId };
      if (eventStr) exportParams.event = eventStr;
      if (where)    exportParams.where = where;

      const qs  = new URLSearchParams(exportParams).toString();
      const url = "https://data.mixpanel.com/api/2.0/export?" + qs;
      console.log("Export URL:", url.slice(0, 500));

      let r, text;
      try {
        r    = await mpFetch(url, { headers: { ...headers, Accept: "text/plain" } });
        text = await r.text();
      } catch (e) {
        return res.status(500).json({ error: "Export fetch error: " + e.message });
      }

      console.log("Export status:", r.status, "preview:", text.slice(0, 400));
      if (!r.ok) return res.status(r.status).json({ error: "Export failed", status: r.status, body: text.slice(0, 500) });
      if (!text.trim()) return res.status(200).json({ results: [] });

      const lines  = text.trim().split("\n").filter(Boolean);
      const parsed = [];
      for (const l of lines) {
        try { parsed.push(JSON.parse(l)); } catch { console.warn("Skipped bad Export line:", l.slice(0, 80)); }
      }

      console.log("Export parsed:", parsed.length, "events from", lines.length, "lines");
      return res.status(200).json({ results: parsed });
    }

    return res.status(400).json({ error: "Unknown endpoint: " + endpoint });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}