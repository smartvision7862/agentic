# Content Agent OS

An agentic content operating system. It scrapes RSS feeds and arbitrary URLs,
ranks everything by priority with AI, keeps a freshness window (24h by default),
helps you write and illustrate posts, and schedules them to **Instagram,
LinkedIn, and X** through [Zernio](https://zernio.com).

```
Sources  ──►  Scheduler  ──►  Freshness filter  ──►  AI ranker  ──►  Feed
                                                                       │
                                                          Content Studio (caption + 4:3 image)
                                                                       │
                                                            Zernio  ──►  Instagram / LinkedIn / X
```

## Stack

- **Backend:** Node.js (ESM) + Express + SQLite via `node-sqlite3-wasm` (pure WebAssembly — no native build, runs on any host including shared hosting)
- **Scraping:** `rss-parser` for feeds, [Firecrawl](https://firecrawl.dev) for any URL or web search
- **AI:** [OpenRouter](https://openrouter.ai) — one key for GPT, Claude, Gemini (text, agentic edits, and 4:3 image generation)
- **Publishing:** [Zernio](https://zernio.com) — hosted OAuth + scheduling for IG, LinkedIn, X
- **Frontend:** vanilla SPA, dark dashboard theme
- **Scheduling:** in-process minute-tick scheduler with `p-queue` for parallel scrapes

## Quick start

```bash
cp .env.example .env     # then fill in your keys
npm install
npm start                # http://localhost:3950
```

Required keys in `.env`:

| Key | Where to get it |
|-----|-----------------|
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| `FIRECRAWL_API_KEY` | https://firecrawl.dev |
| `ZERNIO_API_KEY` | https://zernio.com dashboard |

The app runs without keys, but scraping/ranking/publishing for those services
will return a clear "not configured" error until the key is set.

## How to use it

1. **Sources** — drop a URL (or a search phrase) on the left, set the interval
   (hours / days / months), add topic tags, optionally override the freshness
   window per source. `Auto-detect` tries RSS first and falls back to Firecrawl.
2. **Feed** — articles ranked 0–100 by AI, newest-and-highest first. Toggle
   *Bypass freshness* to see everything. Hit **Make post** to start a draft.
3. **Studio** — edit the caption, ask the agent to refine it ("shorten, add a
   CTA"), and generate a 4:3 image. Every edit is versioned.
4. **Schedule** — pick connected accounts, choose a time (or publish now). The
   image is uploaded to Zernio and the post is created across all selected
   platforms in one call.
5. **Settings** — connect Instagram / LinkedIn / X via Zernio OAuth, pick your
   AI models, set the global freshness window, niche keywords, brand voice, and
   timezone.

### Freshness

The default window is **24 hours** (`global_freshness_hours` in Settings, seeded
from `DEFAULT_FRESHNESS_HOURS`). Override it globally in Settings, per source via
the freshness-override field, or per view with the *Bypass freshness* toggle.

## Zernio account setup notes

Zernio groups accounts under a **profile**. The app auto-resolves your default
profile (creating one if needed) and caches its id in settings — you don't need
to manage this manually.

- **Instagram** needs a Business or Creator account. Zernio runs the Meta OAuth
  and handles container creation, polling, and publishing server-side.
- **LinkedIn** connects a personal profile or company page via Zernio OAuth.
- **X / Twitter** connects via Zernio OAuth (platform value `twitter`).
  **Note:** Zernio requires a payment method on your Zernio account before X can
  be connected (API pass-through costs) — otherwise the connect call returns a
  `PAYMENT_REQUIRED` error. Instagram and LinkedIn have no such requirement.

After completing OAuth, click **Sync accounts** in Settings to pull them in.
Set `PUBLIC_BASE_URL` so the OAuth callback and webhook resolve to this app.
The webhook endpoint is `POST {PUBLIC_BASE_URL}/api/webhooks/zernio`.

## Verifying the integrations

Run a live check of all three services (uses your `.env` keys):

```bash
npm run test:apis
```

It probes Firecrawl (scrape), OpenRouter (models + a tiny chat), and Zernio
(profiles, accounts, connect URLs for IG/LinkedIn/X, and media presign), printing
a pass/fail line for each.

## Deploying to a Hostinger VPS

Use a **VPS plan** (Node app, not shared PHP hosting).

```bash
# 1. SSH in, install Node 20+ and PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2

# 2. Pull the code and configure
git clone <your-repo> /var/www/content-os
cd /var/www/content-os/content-os
cp .env.example .env && nano .env       # set keys + PUBLIC_BASE_URL=https://yourdomain.com
npm ci --omit=dev

# 3. Run under PM2 and keep it alive across reboots
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # follow the printed command

# 4. Reverse proxy + HTTPS
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/content-os
sudo ln -s /etc/nginx/sites-available/content-os /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com
```

Notes:
- `data/` (SQLite) and `storage/images/` (generated images) hold all state —
  back them up or mount them on a persistent volume.
- Set the Zernio webhook URL to `https://yourdomain.com/api/webhooks/zernio`
  and a matching `ZERNIO_WEBHOOK_SECRET`.
- SSE endpoints are excluded from Nginx buffering in the example config.

### Database / shared hosting

The DB engine is `node-sqlite3-wasm` (pure WebAssembly), so `npm install`
needs **no compiler, `make`, or modern glibc** — it works on shared hosts
(e.g. Hostinger) where native modules like `better-sqlite3` fail to build.

The wasm VFS does not support WAL journaling; the app runs in the default
rollback-journal mode automatically. If you are migrating an existing
`better-sqlite3` database that was in WAL mode, convert it once before first
boot (otherwise it can't be opened):

```bash
sqlite3 data/content-os.sqlite "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"
rm -f data/content-os.sqlite-wal data/content-os.sqlite-shm
```

A fresh deployment with no existing DB needs none of this.

## EADDRINUSE

If `listen EADDRINUSE :::3950` appears, another instance is running:
`lsof -i :3950` then `kill <PID>`, or change `PORT` in `.env`.

## Project layout

```
content-os/
├── server/
│   ├── index.js              # Express routes
│   ├── config.js             # hand-rolled .env loader + config
│   ├── db.js                 # SQLite schema + all CRUD
│   ├── sse.js                # per-job + global event streams
│   ├── jobRunner.js          # collect → dedup → rank, p-queue
│   ├── sourceScheduler.js    # per-source hours/days/months scheduler
│   ├── collectors/           # rss.js, firecrawl.js, index.js (dispatcher)
│   ├── ai/                   # openrouter.js, rankArticles.js, contentAgent.js
│   ├── prompts/rank.md       # editable ranking prompt
│   ├── zernio.js             # connect, accounts, media, posts
│   └── webhooks/zernio.js    # publish status callbacks
├── public/                   # index.html, styles.css, app.js
├── deploy/nginx.conf.example
├── ecosystem.config.cjs      # PM2
├── data/                     # SQLite (gitignored)
└── storage/images/           # generated 4:3 images (gitignored)
```
