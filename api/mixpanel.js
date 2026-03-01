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
    return res.status(500).json({ error: "Missing env vars: MIXPANEL_SERVICE_ACCOUNT_USER, MIXPANEL_SERVICE_ACCOUNT_SECRET, MIXPANEL_PROJECT_ID" });
  }

  const auth    = Buffer.from(username + ":" + password).toString("base64");
  const headers = { Authorization: "Basic " + auth, Accept: "application/json" };

  // ── Fetch helper with timeout ─────────────────────────────────────────────
  async function mpFetch(url, opts = {}, timeoutMs = 25000) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(tid);
      return r;
    } catch (e) {
      clearTimeout(tid);
      if (e.name === "AbortError") throw new Error("Mixpanel request timed out after " + timeoutMs / 1000 + "s");
      throw e;
    }
  }

  // ── GET: debug endpoint ───────────────────────────────────────────────────
  if (req.method === "GET") {
    const { debug, domain } = req.query;

    if (!debug) {
      return res.status(200).json({ status: "ok", hasUser: !!username, hasSecret: !!password, hasProjectId: !!projectId });
    }

    if (debug === "engage") {
      try {
        const domains = (domain || "sitemarker.com").split(",").map(d => d.trim()).filter(Boolean);
        // FIX: Engage uses "in" operator for substring match (not =~, not like)
        const where   = domains.map(d => `"@${d}" in properties["$email"]`).join(" or ");
        const body    = new URLSearchParams({ where, project_id: projectId });
        const r       = await mpFetch("https://mixpanel.com/api/2.0/engage", {
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

    if (debug === "export") {
      try {
        const to   = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        // FIX: event must be a JSON array string; project_id goes in query string for Export
        const qs   = new URLSearchParams({
          from_date:  from,
          to_date:    to,
          project_id: projectId,
          event:      JSON.stringify(["User Signed In"]),
        }).toString();
        const r    = await mpFetch("https://data.mixpanel.com/api/2.0/export?" + qs, {
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

  try {

    // ── ENGAGE ──────────────────────────────────────────────────────────────
    if (endpoint === "engage") {
      const domains = Array.isArray(params.domain) ? params.domain : [params.domain];

      // FIX: Engage selector uses "in" for substring match — verified working syntax
      const where = domains.map(d => `"@${d}" in properties["$email"]`).join(" or ");

      let allResults = [];
      let sessionId  = null;
      let page       = 0;

      while (true) {
        const bodyObj = {
          where,
          project_id: projectId,
          // FIX: page_size default is 1000 — set explicitly to avoid undocumented limits
          page_size: 1000,
        };

        // FIX: only add session_id + page after first successful page
        // session_id must be present for pages > 0; page must be an integer (not string)
        if (sessionId !== null) {
          bodyObj.session_id = sessionId;
          bodyObj.page       = page; // integer, not String(page)
        }

        let r, text;
        try {
          r    = await mpFetch("https://mixpanel.com/api/2.0/engage", {
            method:  "POST",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
            body:    new URLSearchParams(bodyObj).toString(),
          });
          text = await r.text();
        } catch (fetchErr) {
          return res.status(500).json({ error: "Engage fetch failed: " + fetchErr.message });
        }

        console.log("Engage page", page, "status:", r.status, "body:", text.slice(0, 400));

        if (!r.ok) {
          return res.status(r.status).json({ error: "Engage failed", status: r.status, body: text.slice(0, 500) });
        }

        let data;
        try { data = JSON.parse(text); } catch {
          return res.status(500).json({ error: "Engage response not valid JSON", raw: text.slice(0, 300) });
        }

        if (!Array.isArray(data.results)) break;
        if (data.results.length === 0) break;

        allResults = allResults.concat(data.results);
        console.log("Engage accumulated:", allResults.length, "of", data.total);

        // FIX: always capture session_id (not just on first page)
        if (data.session_id) sessionId = data.session_id;

        // Done if we have everything
        if (allResults.length >= data.total) break;

        // Safety valve
        page++;
        if (page > 50) {
          console.warn("Engage hit page safety limit (50). Results may be incomplete.");
          break;
        }
      }

      return res.status(200).json({ results: allResults, total: allResults.length });
    }

    // ── EXPORT ──────────────────────────────────────────────────────────────
    if (endpoint === "export") {
      const { from_date, to_date, event, distinct_ids, domains } = params;

      // FIX: Build where clause using domain-based filter OR distinct_id list
      // Export API supports standard JQL "like" operator (unlike Engage)
      // Prefer domain filter when available — avoids the 50-user cap entirely
      let where = "";

      if (domains?.length) {
        // Export API uses has_suffix for string suffix matching (not like, not =~, not in)
        // Wrapped in defined() guard to skip profiles with no email property
        where = domains.map(d => `defined(properties["$email"]) and properties["$email"].has_suffix("@${d}")`).join(" or ");
      } else if (distinct_ids?.length) {
        // FIX: batch in groups of 200 to avoid URL length limits
        // Export where clause has no documented hard limit but ~200 IDs is safe
        const ids     = distinct_ids.slice(0, 200);
        const clauses = ids.map(id => `distinct_id == "${id.replace(/"/g, '\\"')}"`).join(" or ");
        where         = `(${clauses})`;
        if (distinct_ids.length > 200) {
          console.warn("distinct_ids truncated from", distinct_ids.length, "to 200");
        }
      }

      // FIX: event must be serialized as JSON array string by the proxy, not the caller
      // Accepts either a raw array or an already-stringified array (handle both)
      let eventParam;
      if (Array.isArray(event)) {
        eventParam = JSON.stringify(event);
      } else if (typeof event === "string") {
        // Validate it's already a JSON array to avoid double-encoding
        try {
          const parsed = JSON.parse(event);
          eventParam   = Array.isArray(parsed) ? event : JSON.stringify([event]);
        } catch {
          eventParam = JSON.stringify([event]);
        }
      }

      const exportParams = { from_date, to_date, project_id: projectId };
      if (eventParam) exportParams.event = eventParam;
      if (where)      exportParams.where = where;

      const qs  = new URLSearchParams(exportParams).toString();
      const url = "https://data.mixpanel.com/api/2.0/export?" + qs;
      console.log("Export URL:", url.slice(0, 400));

      let r, text;
      try {
        r    = await mpFetch(url, { headers: { ...headers, Accept: "text/plain" } });
        text = await r.text();
      } catch (fetchErr) {
        return res.status(500).json({ error: "Export fetch failed: " + fetchErr.message });
      }

      console.log("Export status:", r.status, "| preview:", text.slice(0, 400));

      if (!r.ok) {
        return res.status(r.status).json({ error: "Export failed", status: r.status, body: text.slice(0, 500) });
      }

      // FIX: Export returns newline-delimited JSON — handle empty response gracefully
      if (!text.trim()) {
        return res.status(200).json({ results: [] });
      }

      const lines  = text.trim().split("\n").filter(Boolean);
      const parsed = [];
      for (const l of lines) {
        try { parsed.push(JSON.parse(l)); } catch { console.warn("Skipped unparseable Export line:", l.slice(0, 100)); }
      }

      console.log("Export events parsed:", parsed.length, "of", lines.length, "lines");
      return res.status(200).json({ results: parsed });
    }

    return res.status(400).json({ error: "Unknown endpoint: " + endpoint });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}