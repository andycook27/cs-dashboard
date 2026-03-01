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
        const r    = await mpFetch("https://data.mixpanel.com/api/2.0/export", {
          method:  "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" },
          body:    new URLSearchParams({ from_date: from, to_date: to, project_id: projectId, event: JSON.stringify(["User Signed In"]) }).toString(),
        });
        return res.status(r.status).send((await r.text()).slice(0, 3000));
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    return res.status(400).json({ error: "Unknown debug type" });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ── Parse body safely ─────────────────────────────────────────────────────
  // RISK: req.body can be undefined if Content-Type header is wrong or body is malformed
  let endpoint, params;
  try {
    ({ endpoint, params } = req.body || {});
    if (!endpoint) return res.status(400).json({ error: "Missing endpoint in request body" });
    if (!params)   return res.status(400).json({ error: "Missing params in request body" });
  } catch (e) {
    return res.status(400).json({ error: "Failed to parse request body: " + e.message });
  }

  console.log("POST endpoint:", endpoint, "params keys:", Object.keys(params));

  try {

    // ── ENGAGE ──────────────────────────────────────────────────────────────
    if (endpoint === "engage") {
      // RISK: domain param could be undefined, null, or empty array
      const rawDomains = params.domain;
      if (!rawDomains || (Array.isArray(rawDomains) && rawDomains.length === 0)) {
        return res.status(400).json({ error: "Engage requires at least one domain" });
      }
      const domains = Array.isArray(rawDomains) ? rawDomains : [rawDomains];
      const cleaned = domains.map(d => String(d).trim().toLowerCase()).filter(Boolean);
      if (!cleaned.length) return res.status(400).json({ error: "Engage: all domains were empty after cleaning" });

      // Engage selector: "in" operator for substring match — only valid syntax for this API
      const where = cleaned.map(d => `"@${d}" in properties["$email"]`).join(" or ");

      let allResults = [];
      let sessionId  = null;
      let page       = 0;

      while (true) {
        const bodyObj = { where, project_id: projectId, page_size: 1000 };
        if (sessionId !== null) {
          bodyObj.session_id = sessionId;
          bodyObj.page       = page; // must be integer
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

        // RISK: Mixpanel returns 200 with an error body in some cases (e.g. bad session_id)
        if (!r.ok) return res.status(r.status).json({ error: "Engage failed", body: text.slice(0, 500) });

        let data;
        try { data = JSON.parse(text); } catch {
          return res.status(500).json({ error: "Engage returned invalid JSON", raw: text.slice(0, 300) });
        }

        // RISK: results key missing entirely on some error responses
        if (!data || !Array.isArray(data.results)) {
          console.warn("Engage unexpected response shape:", JSON.stringify(data).slice(0, 200));
          break;
        }
        if (data.results.length === 0) break;

        allResults = allResults.concat(data.results);
        console.log("Engage accumulated:", allResults.length, "of", data.total);

        // RISK: session_id missing on single-page responses — only paginate if we have it
        if (data.session_id) sessionId = data.session_id;

        // RISK: data.total could be 0 or undefined — guard against infinite loop
        const total = Number(data.total) || 0;
        if (!total || allResults.length >= total) break;

        // RISK: if session_id never arrived we can't paginate — bail to avoid infinite loop
        if (!sessionId) {
          console.warn("Engage: no session_id returned, stopping pagination at", allResults.length);
          break;
        }

        page++;
        if (page > 50) { console.warn("Engage page safety limit hit"); break; }
      }

      return res.status(200).json({ results: allResults, total: allResults.length });
    }

    // ── EXPORT ──────────────────────────────────────────────────────────────
    if (endpoint === "export") {
      const { from_date, to_date, event, distinct_ids } = params;

      // RISK: missing required date params
      if (!from_date || !to_date) {
        return res.status(400).json({ error: "Export requires from_date and to_date" });
      }

      // RISK: date range too large — Export API max is 365 days
      const dayRange = Math.floor((new Date(to_date) - new Date(from_date)) / 86400000);
      if (dayRange > 365) {
        return res.status(400).json({ error: "Export date range exceeds 365 days (" + dayRange + " days requested)" });
      }
      if (dayRange < 0) {
        return res.status(400).json({ error: "Export from_date is after to_date" });
      }

      console.log("Export params — from:", from_date, "to:", to_date, "events:", Array.isArray(event) ? event.length : event, "distinct_ids:", distinct_ids?.length);

      // Normalize event param — accept raw array or pre-stringified
      let eventStr;
      if (Array.isArray(event)) {
        if (event.length === 0) return res.status(400).json({ error: "Export: event array is empty" });
        eventStr = JSON.stringify(event);
      } else if (typeof event === "string" && event.trim()) {
        try {
          const p = JSON.parse(event);
          eventStr = Array.isArray(p) ? event : JSON.stringify([event]);
        } catch { eventStr = JSON.stringify([event]); }
      }
      if (!eventStr) console.warn("Export: no event filter — may return very large response");

      // Helper: run one Export request for a given where clause
      async function runExport(where) {
        const exportParams = { from_date, to_date, project_id: projectId };
        if (eventStr) exportParams.event = eventStr;
        if (where)    exportParams.where = where;
        const body = new URLSearchParams(exportParams).toString();
        console.log("Export batch body length:", body.length, "| where length:", (where || "").length);
        const r    = await mpFetch("https://data.mixpanel.com/api/2.0/export", {
          method:  "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" },
          body,
        });
        const text = await r.text();
        console.log("Export batch status:", r.status, "| preview:", text.slice(0, 200));
        if (!r.ok) throw new Error("Export batch failed (" + r.status + "): " + text.slice(0, 300));
        return text;
      }

      // Chunk distinct_ids into batches of 50 to stay within Mixpanel's
      // expression complexity limit (~50 OR clauses is safe)
      const BATCH = 50;
      const ids   = (distinct_ids || []).slice(0, 500).map(id => String(id).replace(/"/g, '\\"'));
      const chunks = [];
      for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
      if (ids.length > 500) console.warn("distinct_ids capped at 500 from", distinct_ids.length);

      console.log("Export: running", chunks.length, "batch(es) of up to", BATCH, "IDs");

      let allLines = [];
      if (chunks.length === 0) {
        // No ID filter — fetch without where clause
        try {
          const text = await runExport("");
          if (text?.trim()) allLines = text.trim().split("\n").filter(Boolean);
        } catch (e) {
          return res.status(500).json({ error: e.message });
        }
      } else {
        for (const chunk of chunks) {
          const where = "(" + chunk.map(id => `distinct_id == "${id}"`).join(" or ") + ")";
          try {
            const text = await runExport(where);
            if (text?.trim()) allLines.push(...text.trim().split("\n").filter(Boolean));
          } catch (e) {
            console.error("Export chunk failed:", e.message);
            // Continue with remaining chunks rather than failing entirely
          }
        }
      }

      const parsed = [];
      let bad = 0;
      for (const l of allLines) {
        try { parsed.push(JSON.parse(l)); } catch { bad++; }
      }
      if (bad > 0) console.warn("Export skipped", bad, "unparseable lines");

      parsed.sort((a, b) => (b.properties?.time ?? 0) - (a.properties?.time ?? 0));
      console.log("Export total parsed:", parsed.length, "events from", allLines.length, "lines across", chunks.length || 1, "batch(es)");
      return res.status(200).json({ results: parsed });
    }

    return res.status(400).json({ error: "Unknown endpoint: " + endpoint });

  } catch (err) {
    console.error("Unhandled proxy error:", err.message, err.stack?.slice(0, 300));
    return res.status(500).json({ error: err.message });
  }
}