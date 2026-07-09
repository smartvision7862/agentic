# Deploy on Hostinger (Node.js Web App)

## Quick hPanel settings

| Setting | Value |
|---------|-------|
| **Framework** | Express.js (or **Other**) |
| **Application root** | `content-os` |
| **Node.js version** | 20 |
| **Install command** | `npm install` |
| **Build command** | `npm run build` |
| **Start command** | `npm start` |
| **Entry file** | `app.js` |
| **Output directory** | leave **empty** |

## Environment variables (hPanel → Deployments → Settings)

Add these in hPanel (do **not** commit `.env`):

| Variable | Example |
|----------|---------|
| `PORT` | leave blank — Hostinger sets this (usually `3000`) |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | `https://brown-lion-139149.hostingersite.com` |
| `OPENROUTER_API_KEY` | your key |
| `FIRECRAWL_API_KEY` | your key |
| `ZERNIO_API_KEY` | your key |
| `GOOGLE_CLIENT_ID` | your OAuth client |
| `GOOGLE_CLIENT_SECRET` | your OAuth secret |
| `GOOGLE_REDIRECT_URI` | `https://YOUR-DOMAIN/api/gmail/callback` |

## Deploy via Hostinger MCP in Cursor (recommended)

1. In **hPanel** → Profile → **API** → create an API token.
2. In your terminal (or Cursor env), export it:
   ```bash
   export HOSTINGER_API_TOKEN="your-token-here"
   ```
3. Restart Cursor (project includes `.cursor/mcp.json` for the Hostinger MCP).
4. Ask the agent: *"Deploy agentic-os to Hostinger and fix any build errors."*

The MCP can pull real build logs, update deploy settings, and trigger redeploys.

## Reading the build log

If you see:

```
added 149 packages, and audited 150 packages in 5s
```

**Install succeeded.** Warnings (`npm warn deprecated`) are normal.

Scroll further for:
- `BUILD_OK` → build passed
- `ERROR` / `npm error` → real failure (paste those lines)

## Fresh deploy checklist

```bash
cd content-os
npm install
npm run build    # should print BUILD_OK
npm start
```

The app creates `data/` and `storage/` on first run.

## Migrating an old WAL database

Only if you copied a local SQLite file that was in WAL mode:

```bash
sqlite3 data/content-os.sqlite "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"
rm -f data/content-os.sqlite-wal data/content-os.sqlite-shm
```
