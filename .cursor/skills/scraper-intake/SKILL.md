---
name: scraper-intake
description: >-
  Discovery and routing for web scraping and automation projects. Asks deliverable
  type (script vs dashboard), NodeMaven proxy confirmation, storage needs, and port
  allocation before building. Use when the user asks to scrape, automate, build a
  scraper, create an extraction tool, proxy setup, or data collection OS.
---

# Scraper Intake

Always run this skill **before** writing code for a new scraping or automation task. Never jump straight to implementation.

## Workflow

```
Task Progress:
- [ ] Ask deliverable type (script vs dashboard)
- [ ] Confirm NodeMaven proxy (or search alternative)
- [ ] Ask storage needs
- [ ] Clarify target site, volume, login
- [ ] Assign unique PORT in .env.example
- [ ] Route to scraper-script or scraper-dashboard skill
```

## Step 1 — Deliverable type

Use **AskQuestion** when available:

**"What do you need?"**
- Script only — run once, cron, CLI test
- Dashboard OS — browser UI to start jobs, live logs, history, export
- Both — script first, dashboard optional later

| User intent | Route to |
|-------------|----------|
| "Just run this", "extract once", "test", "perform this" | [scraper-script](../scraper-script/SKILL.md) |
| "Build tool", "dashboard", "OS", "monitor jobs", "UI" | [scraper-dashboard](../scraper-dashboard/SKILL.md) |
| Unclear | Ask: **"Do you need a dashboard, or just a script?"** |

## Step 2 — NodeMaven confirmation (required)

Ask verbatim:

> I'm trained on **NodeMaven** (residential proxies + Puppeteer). Use NodeMaven for this project?

- **Yes** → read [nodemaven.md](../scraper-kit/nodemaven.md), include `NODEMAVEN_API_KEY` in `.env.example`
- **No** → web search for user's preferred provider; document env vars in `.env.example` comments; still use Puppeteer proxy pattern from [anti-bot.md](../scraper-kit/anti-bot.md)

## Step 3 — Storage

Ask which applies:

| Choice | When | Pattern |
|--------|------|---------|
| None | One-off, stdout only | Print results; optional single `output/` file |
| Files | CSV/binary downloads | `output/` or `storage/downloads/` |
| JSON history | Rerun comparison, no UI queue | `output/history/{uuid}.json` |
| SQLite | Dashboard with job history | `data/*.sqlite` — see [storage.md](../scraper-dashboard/storage.md) |

**Rule:** SQLite only when dashboard is requested. Scripts use files or JSON unless user explicitly asks for DB.

## Step 4 — Target & volume

Gather:
- Target URL / platform
- Login required? (cookies, OAuth — note account risk per [anti-bot.md](../scraper-kit/anti-bot.md))
- Parallel sessions? Scheduled reruns?
- Expected volume (rows per run)

## Step 5 — Port & env (always)

Read [env-and-ports.md](../scraper-kit/env-and-ports.md):

1. Scan sibling `**/.env.example` for `PORT=` if in monorepo
2. Pick next unused port (greenfield: start at 3950)
3. Create `.env.example` with `PORT` + secrets — **never read user's `.env`**
4. For dashboards, note EADDRINUSE fix in README

## Step 6 — UI theme (dashboard only)

Default: **Dark Scraper Dashboard** from [ui-theme.md](../scraper-dashboard/ui-theme.md).

Override only if user explicitly asks:
- Light spreadsheet theme (export-heavy HR-style)
- React + Vite Extract OS (complex filters — Pattern B)
- Minimal single-page (no history drawer)

## Routing summary

After intake completes, invoke the target skill and pass a brief spec:

```markdown
## Intake spec
- Deliverable: script | dashboard
- Proxy: NodeMaven | <alternative>
- Storage: none | files | json | sqlite
- Target: <site/url>
- PORT: <number> (in .env.example only)
- UI: dark default | <override>
```

## Do not

- Skip the NodeMaven confirmation question
- Read or modify the user's `.env` file
- Build a dashboard without asking if user only wanted a script
- Reuse a PORT already assigned in another project's `.env.example`
