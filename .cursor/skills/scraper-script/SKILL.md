---
name: scraper-script
description: >-
  Builds headless CLI scraping scripts with Puppeteer, NodeMaven proxy support,
  anti-bot hardening, and file/JSON output. Use when the user wants a one-off
  extract, cron job, test script, or "just run this" without a dashboard. Run
  scraper-intake first unless deliverable type is already clear.
---

# Scraper Script Builder

Build CLI/headless automation — no dashboard unless user changes scope.

## Prerequisites

Run [scraper-intake](../scraper-intake/SKILL.md) first, or confirm:
- Script only (not dashboard)
- Proxy provider confirmed
- Storage choice: none | files | json

## Workflow

```
Task Progress:
- [ ] Scaffold project structure
- [ ] Create .env.example (PORT + secrets)
- [ ] Copy nodemaven-proxy.js from nodemaven.md
- [ ] Implement browser.js + detect-block.js
- [ ] Write scripts/run.js entry point
- [ ] Add scripts/test-proxy.js
- [ ] Write output to output/
- [ ] Document usage in README
```

## Project scaffold

```
project/
├── scripts/
│   ├── run.js                  # Main CLI entry
│   ├── test-proxy.js           # NodeMaven validation
│   └── test-nodemaven-api.js   # API key → creds check
├── src/
│   ├── collect.js              # Core scrape logic
│   ├── browser.js              # Puppeteer launch + proxy
│   ├── nodemaven-proxy.js      # Copy from nodemaven.md template
│   └── detect-block.js         # 403/429/CAPTCHA taxonomy
├── output/                     # CSV, JSON, screenshots
├── .env.example
├── package.json
└── README.md
```

## package.json

```json
{
  "name": "my-scraper",
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node scripts/run.js",
    "test:proxy": "node scripts/test-proxy.js",
    "test:api": "node scripts/test-nodemaven-api.js"
  },
  "dependencies": {
    "puppeteer": "^24.0.0"
  }
}
```

## Conventions

| Rule | Detail |
|------|--------|
| ESM only | `"type": "module"`, `import`/`export` |
| No dotenv | Use `loadProxyEnv()` from [nodemaven.md](../scraper-kit/nodemaven.md) |
| Env files | Only create/update `.env.example` — never read `.env` |
| Port | Include `PORT` in `.env.example` even for scripts (future dashboard compat) |
| Proxy test | Run `npm run test:proxy` before first scrape with proxy enabled |
| Anti-bot | Follow [anti-bot.md](../scraper-kit/anti-bot.md) browser hardening |

## scripts/run.js pattern

```js
import { loadProxyEnv, isProxyConfigured, resolveNodeMavenCredentials, createProxySessionManager } from "../src/nodemaven-proxy.js";
import { launchBrowser, newPage } from "../src/browser.js";
import { collect } from "../src/collect.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

loadProxyEnv();

function parseArgs(argv) {
  const args = { query: "", count: 10, proxy: false, headless: true };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--proxy") args.proxy = true;
    if (argv[i] === "--query" && argv[i + 1]) args.query = argv[++i];
    if (argv[i] === "--count" && argv[i + 1]) args.count = Number(argv[++i]);
    if (argv[i] === "--headed") args.headless = false;
    if (argv[i] === "--help") { console.log("Usage: node scripts/run.js --query \"...\" [--count 10] [--proxy]"); process.exit(0); }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.query) { console.error("Missing --query"); process.exit(1); }

  let proxyAuth, proxyServer;
  if (args.proxy) {
    if (!isProxyConfigured()) { console.error("Set NODEMAVEN_API_KEY in .env"); process.exit(1); }
    const creds = await resolveNodeMavenCredentials();
    const mgr = createProxySessionManager({ credentials: creds });
    const rot = mgr.rotateForSite("main");
    proxyServer = rot.proxyServer;
    proxyAuth = { username: rot.username, password: rot.password };
  }

  const browser = await launchBrowser({ headless: args.headless, proxyServer });
  const page = await newPage(browser, { proxyAuth });
  const results = await collect(page, { query: args.query, count: args.count });
  await browser.close();

  mkdirSync("output", { recursive: true });
  const outPath = join("output", `results-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} rows → ${outPath}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

## Storage without dashboard

| Need | Implementation |
|------|----------------|
| Single run | `output/results-{timestamp}.json` or `.csv` |
| Rerun comparison | `output/history/{uuid}.json` via `history-store.js` |
| Screenshots | `output/screenshots/` |
| Large structured | Avoid SQLite — use JSON lines or CSV |

### Lightweight history-store.js

```js
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const DIR = join("output", "history");
mkdirSync(DIR, { recursive: true });

export function saveRun({ query, results, meta }) {
  const id = randomUUID();
  const path = join(DIR, `${id}.json`);
  writeFileSync(path, JSON.stringify({ id, query, results, meta, createdAt: new Date().toISOString() }, null, 2));
  return id;
}

export function listRuns(limit = 20) {
  return readdirSync(DIR).filter((f) => f.endsWith(".json")).slice(0, limit);
}
```

## When to escalate to dashboard

If during script work the user asks for:
- Live progress / logs in browser
- Job history panel
- Export button in UI
- Proxy toggle in header

→ Stop and switch to [scraper-dashboard](../scraper-dashboard/SKILL.md).

## Additional resources

- Proxy setup: [nodemaven.md](../scraper-kit/nodemaven.md)
- Ports & env: [env-and-ports.md](../scraper-kit/env-and-ports.md)
- Anti-bot: [anti-bot.md](../scraper-kit/anti-bot.md)
- Examples: [examples.md](examples.md)
