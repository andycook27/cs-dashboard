// api/share.js — Team sync relay
// Stores the latest sync data in module-level memory for the lifetime of this
// Lambda instance (typically 5-30 min idle; keeps warm while team is active).
// For guaranteed persistence across instances, configure Vercel KV and swap the
// store below with @vercel/kv calls.

let store = { data: null, ts: null };

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json(store.ts ? { data: store.data, ts: store.ts } : {});
  }

  if (req.method === "POST") {
    const { data, ts } = req.body || {};
    if (data && ts) {
      store = { data, ts };
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Missing data or ts" });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
