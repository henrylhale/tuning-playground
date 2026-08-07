# State sharing — design

A **Share** button turns the current sequence into a short link. Opening the link loads
that state. No JSON is ever shown to the user. Zero new data model — the thing we store is
the existing `quartet-seq` document, deflated.

## Data model (unchanged)

The payload is **exactly what the app already produces**, compressed:

```
payload_bytes = deflate_raw( utf8( JSON.stringify(seqDoc()) ) )
```

where `seqDoc()` is today's document, verbatim:

```js
{ app: "quartet-seq", v: 1, active: <int>, slots: [ <snapshot>, … ] }
```

and each snapshot is the current `readSnapshot()` shape
(`key, root, chord, et, moveAll, vib, jit, shim, vol, voicing[[tone,octave]…],
voices[{bri,nas,f3,lvl,bend,mode,mute,f1,f2}]`). We invent no wire schema; the store holds
opaque deflated bytes. Compression is plain DEFLATE (native `CompressionStream('deflate-raw')`,
plain-base64 fallback where unavailable) — no columnar packing, no quantization.

Typical sizes (measured): 40-chord song ≈ 5 KB, worst-case 400-chord song ≈ 50 KB.

## Identity

**Content-addressed, immutable.** The id is the SHA-256 of `payload_bytes`, base64url,
truncated to 16 chars (~96 bits — collision-free at this scale). Computed **server-side**
in the Worker (so the client needs no `crypto.subtle`, and the happy path works even where
that API is gated). Identical bytes dedup to the same id; every distinct state is a new blob.
Orphaned blobs are accepted — no sessions, no mutation, no GC in v1.

## Client flow (in `quartet.html`)

**Share:**
1. `bytes = deflateRaw(JSON.stringify(seqDoc()))`
2. `POST <WORKER>/s` with `bytes` → `{ id }`
3. Build `https://henryhale.com/tuning#id=<id>`, copy to clipboard, flash "Link copied ✓".

**Open a link** (on load, if `location.hash` matches `#id=<id>`):
1. Check IndexedDB cache for `id`; else `GET <WORKER>/s/<id>` → `bytes`, cache it.
2. `loadDoc(JSON.parse(inflate(bytes)))`.
3. Clear the hash (so subsequent edits aren't "the shared version").

**Fallbacks (never depend on the backend):**
- No Worker configured / offline / `file://`: for small states, emit an inline
  `#s=<base64url(bytes)>` link (self-contained, no hosting). Oversized states show
  "too long to link — connect to share." This keeps the `file://`-open invariant intact:
  the app runs with no backend; only *sharing* needs the network.
- IndexedDB is a **cache only** — eviction is lossless (re-fetch by id).

## Worker API (separate dev tooling; not part of the shipped HTML)

Cloudflare Worker + one KV namespace.

- `POST /s` — body = raw deflated bytes (cap 512 KB). Hash → id, `KV.put(id, bytes)` if
  absent (idempotent), return `{ id }`. CORS for the app origin. Light per-IP rate-limit.
- `GET /s/:id` — return the bytes with `Cache-Control: public, max-age=31536000, immutable`
  (immutable content ⇒ cached forever at the edge). 404 if unknown.

**Free-tier headroom:** KV = 1 GB total (~20k max-size songs; realistically far more),
25 MB/value, 1,000 writes/day, 100k reads/day. Binding limit is writes/day = new shares/day,
which a hobby community won't approach. $5/mo Workers Paid lifts it if ever needed.

## UX changes

- Replace the "Copy · Paste · Edit JSON" window with a single **Share** button (+ the
  auto-load-from-link behavior). The raw JSON textarea leaves the default surface.
- **Great Tags import stays** — that's the "bring in content" path.
- *Open question:* keep a hidden/advanced JSON escape hatch for debugging, or remove it
  entirely? (Leaning: remove from the visible UI; it's trivial to restore if a power user
  ever needs it.)

## Explicit non-goals (v1)

- No session/mutable-link abstraction (orphaned immutable blobs are fine).
- No columnar/quantized/binary re-encoding (plain deflate is enough).
- No audio hosting. When audio-sync lands, the shared doc will *reference* audio by
  `{name, hash}` and the recipient supplies the local file (analysis-only).
- No JSON surfaced to end users.

## Build order

1. **Client, no backend:** deflate/inflate, inline `#s=` link + copy button, auto-load,
   IndexedDB cache, JSON window demoted. Ships value immediately; de-risks the encoding.
2. **Worker:** stand up KV + Worker (your ~15-min Cloudflare setup), point one `WORKER`
   constant at it. Share flips from inline to hosted `#id=` links; inline stays as fallback.
