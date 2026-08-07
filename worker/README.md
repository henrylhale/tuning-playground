# quartet-share Worker

A ~50-line Cloudflare Worker + one KV namespace that backs the **Share** button in
`quartet.html`. It stores a deflated sequence blob and returns a short content id; opening a
`#id=<id>` link fetches it back. See `../sharing-design.md` for the full design.

This is **dev tooling**. It is deployed separately and is never required to open the app —
without it, Share falls back to self-contained inline `#s=` links.

## API

- `POST /s` — body = raw deflated bytes → `{ "id": "<16-char id>" }`
- `GET /s/:id` — → the bytes (immutable, cached forever)

## One-time setup

From this `worker/` directory:

```sh
npx wrangler login                          # opens a browser; authorize the CLI
npx wrangler kv namespace create SHARE_KV   # prints an id=... line
# paste that id into wrangler.toml (the kv_namespaces id field), then:
npx wrangler deploy                         # prints the deployed URL
```

`deploy` prints something like `https://quartet-share.<your-subdomain>.workers.dev`.
Put that origin into `quartet.html`'s `SHARE_WORKER` constant to turn on hosted `#id=` links.

## Free-tier limits

KV free tier: 1 GB stored, 25 MB/value, 1,000 writes/day, 100k reads/day. One share = one
write; content-addressing dedups identical states. $5/mo Workers Paid lifts the write cap if
ever needed.
