---
name: scraper-dashboard
description: >-
  Builds full scraping automation dashboards with Express, SQLite job queue, SSE
  live logs, NodeMaven proxy toggle, and the dark Scraper Dashboard UI theme.
  Use when the user wants a browser OS to start jobs, monitor progress, browse
  history, and export CSV. Run scraper-intake first unless scope is confirmed.
---

# Scraper Dashboard Builder

Build a runnable automation OS: form → job → live logs → history drawer → export.

## Prerequisites

Run [scraper-intake](../scraper-intake/SKILL.md) first, or confirm:
- Dashboard requested (not script-only)
- Proxy provider confirmed
- Storage: SQLite (default for dashboards)

## Workflow

```
Task Progress:
- [ ] Scaffold server/ + public/ structure
- [ ] Create .env.example (unique PORT + NODEMAVEN_API_KEY)
- [ ] Copy nodemaven-proxy.js from nodemaven.md
- [ ] Implement db.js + jobRunner.js
- [ ] Implement server/index.js routes
- [ ] Apply ui-theme.md to public/
- [ ] Add scripts/test-proxy.js
- [ ] Document npm start + EADDRINUSE fix in README
```

## Default architecture — Pattern A

Job-queue dashboard with vanilla SPA. **Do not** use React/Vite unless user explicitly asks for Pattern B (Extract OS with complex filters).

```
project/
├── server/
│   ├── index.js
│   ├── config.js
│   ├── db.js
│   ├── jobRunner.js
│   └── nodemaven-proxy.js
├── public/
│   ├── index.html    # From ui-theme.md shell
│   ├── styles.css    # From ui-theme.md CSS
│   └── app.js        # From ui-theme.md JS skeleton
├── scripts/test-proxy.js
├── data/*.sqlite
├── output/exports/
├── .env.example
└── package.json
```

## UI theme (required)

Apply the **Dark Scraper Dashboard** from [ui-theme.md](ui-theme.md):

- Indigo/emerald color tokens
- 380px sticky sidebar with `.sidebar-fixed` + `.sidebar-scroll`
- Right history drawer (`#historyPanel` + backdrop)
- Header Local/Proxy `.route-toggle`
- `.status-pill.online` server indicator
- `.toggle-row` iOS switches for options
- `.log-panel` mono terminal
- 4-column `.stats-row`
- `.tabs` for results/logs

Customize logo emoji, title, subtitle, and form fields per project. Keep the component classes unchanged.

**Override only if user explicitly asks** for light spreadsheet or React Extract OS.

## Server API

Follow [server-api.md](server-api.md) for:
- REST routes (`/api/health`, `/api/jobs`, etc.)
- SSE on `/api/jobs/:id/stream`
- Proxy validation on `POST /api/jobs`
- SPA fallback `GET *`

## Storage

Follow [storage.md](storage.md):
- SQLite WAL in `data/dashboard.sqlite`
- Tables: `jobs`, `activity_logs`, domain `results` table
- CSV export to `output/exports/`
- Stale job recovery on server start

## Env & ports

Read [env-and-ports.md](../scraper-kit/env-and-ports.md):
- Only create/update `.env.example`
- Unique `PORT` per project
- `NODEMAVEN_API_KEY` when proxy confirmed

## Proxy integration

Read [nodemaven.md](../scraper-kit/nodemaven.md):
- Header toggle sends `proxyMode: true` in job body
- Disable Proxy button when not configured
- Emit SSE `proxy-rotation`, `proxy-ip`, `proxy-summary` events
- Run `npm run test:proxy` before first proxy scrape

## Anti-bot

Follow [anti-bot.md](../scraper-kit/anti-bot.md) in collector modules under `src/`.

## package.json scripts

```json
{
  "type": "module",
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "test:proxy": "node scripts/test-proxy.js"
  }
}
```

## README essentials

Include:
1. `cp .env.example .env` and fill `NODEMAVEN_API_KEY`
2. `npm install && npm start`
3. Open `http://localhost:<PORT>`
4. EADDRINUSE: `lsof -i :<PORT>` then kill PID, or change PORT in `.env`

## Escalation / downgrade

| User change | Action |
|-------------|--------|
| "Just a script, no UI" | Switch to [scraper-script](../scraper-script/SKILL.md) |
| "Add React filters UI" | Pattern B — add `dashboard/` Vite app |
| "Light spreadsheet look" | Override theme per ui-theme.md light section |

## Additional resources

- UI theme: [ui-theme.md](ui-theme.md)
- Server API: [server-api.md](server-api.md)
- Storage: [storage.md](storage.md)
- Proxy: [nodemaven.md](../scraper-kit/nodemaven.md)
- Ports: [env-and-ports.md](../scraper-kit/env-and-ports.md)
- Anti-bot: [anti-bot.md](../scraper-kit/anti-bot.md)
