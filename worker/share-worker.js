// Cloudflare Worker — content-addressed store for quartet.html share links.
//
//   POST /s      body = deflated state bytes  ->  { id }
//   GET  /s/:id  ->  the same bytes (immutable, cached forever at the edge)
//
// The id is sha256(bytes) as base64url, truncated to 16 chars (~96 bits — collision-free at this
// scale). Identical content dedups to the same id. Blobs are immutable; orphans are accepted.
//
// This is DEV TOOLING, deployed separately with `wrangler deploy`. It is never a prerequisite for
// opening quartet.html — sharing is an optional feature layered on top of the static app.
//
// CORS / abuse: WRITES (POST) are restricted to an origin allowlist (production + local dev), enforced
// SERVER-SIDE — a browser always sends a truthful Origin, so a disallowed site's JS is refused (403),
// which is the only cross-site write vector CORS can actually close. Requests with no Origin (curl,
// server-side tools, tests) are allowed through — CORS never constrained those anyway. READS (GET) are
// public (Access-Control-Allow-Origin: *) so a shared link/blob is openable from anywhere.

const MAX_BYTES = 512 * 1024;                 // reject anything larger than a very big sequence

// Origins allowed to WRITE. Production + local dev (file:// reports as "null"; localhost/127.0.0.1 any port).
const WRITE_ORIGINS = new Set(["https://henryhale.com", "https://www.henryhale.com", "null"]);
const isLocalOrigin = o => o === "null" || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o || "");
const writeAllowed = o => WRITE_ORIGINS.has(o) || isLocalOrigin(o);

function corsWrite(origin) {
  const h = { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type", "Vary": "Origin" };
  if (origin && writeAllowed(origin)) h["Access-Control-Allow-Origin"] = origin;   // reflect only allowlisted origins
  return h;
}
const corsRead = () => ({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" });

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...extra } });

function b64url(buf) {
  let s = ""; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function idOf(bytes) {
  return b64url(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 16);
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin");
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);   // ["s"] or ["s", id]

    // Preflight — the app only ever preflights the POST, so reflect the write policy.
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsWrite(origin) });

    // POST /s — store bytes, return their content id
    if (req.method === "POST" && parts.length === 1 && parts[0] === "s") {
      // A browser sends a real Origin; refuse ones not on the allowlist. No Origin (curl/tools) passes.
      if (origin && !writeAllowed(origin)) return json({ error: "forbidden origin" }, 403, corsWrite(origin));
      const buf = await req.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return json({ error: "bad size" }, 413, corsWrite(origin));
      const bytes = new Uint8Array(buf);
      const id = await idOf(bytes);
      await env.SHARE_KV.put(id, bytes);          // idempotent: same content → same id
      return json({ id }, 200, corsWrite(origin));
    }

    // GET /s/:id — return the stored bytes (public read)
    if (req.method === "GET" && parts.length === 2 && parts[0] === "s") {
      const id = parts[1];
      if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return json({ error: "bad id" }, 400, corsRead());
      const val = await env.SHARE_KV.get(id, { type: "arrayBuffer" });
      if (!val) return json({ error: "not found" }, 404, corsRead());
      return new Response(val, {
        headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", ...corsRead() },
      });
    }

    return json({ error: "not found" }, 404, corsRead());
  },
};
