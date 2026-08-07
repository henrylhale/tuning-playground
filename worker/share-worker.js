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

const MAX_BYTES = 512 * 1024;                 // reject anything larger than a very big sequence
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });

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
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);   // ["s"] or ["s", id]

    // POST /s — store bytes, return their content id
    if (req.method === "POST" && parts.length === 1 && parts[0] === "s") {
      const buf = await req.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return json({ error: "bad size" }, 413);
      const bytes = new Uint8Array(buf);
      const id = await idOf(bytes);
      await env.SHARE_KV.put(id, bytes);          // idempotent: same content → same id
      return json({ id });
    }

    // GET /s/:id — return the stored bytes
    if (req.method === "GET" && parts.length === 2 && parts[0] === "s") {
      const id = parts[1];
      if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return json({ error: "bad id" }, 400);
      const val = await env.SHARE_KV.get(id, { type: "arrayBuffer" });
      if (!val) return json({ error: "not found" }, 404);
      return new Response(val, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
          ...CORS,
        },
      });
    }

    return json({ error: "not found" }, 404);
  },
};
