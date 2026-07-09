# Scraper Script Examples

## Example 1 — One-off Google search extract

**User:** "Scrape top 20 results for 'digital marketing agency Mumbai'"

```bash
node scripts/run.js --query "digital marketing agency Mumbai" --count 20
```

Output: `output/results-1717680000000.json`

## Example 2 — Proxy-enabled scrape

**User:** "Extract Indeed jobs with NodeMaven proxy"

```bash
npm run test:proxy          # verify creds first
node scripts/run.js --query "software engineer" --count 50 --proxy
```

On HTTP 403 via proxy, retry once on local IP (Indeed fallback pattern).

## Example 3 — API key validation only

**scripts/test-nodemaven-api.js:**

```js
import { loadProxyEnv, getApiKey, resolveNodeMavenCredentials } from "../src/nodemaven-proxy.js";

loadProxyEnv();

async function main() {
  const key = getApiKey();
  if (!key) { console.error("No NODEMAVEN_API_KEY"); process.exit(1); }
  const creds = await resolveNodeMavenCredentials();
  console.log("OK:", creds.source, creds.baseUser?.slice(0, 4) + "***");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

## Example 4 — Cron-friendly script

**User:** "Run daily at 6am, append to CSV"

```js
// scripts/run.js — add --format csv --append flags
import { appendFileSync, mkdirSync } from "fs";

function toCsv(rows) {
  const header = "title,url,date\n";
  const body = rows.map((r) => `"${r.title}","${r.url}","${new Date().toISOString()}"`).join("\n");
  return header + body + "\n";
}

// After collect():
const csvPath = "output/daily-jobs.csv";
mkdirSync("output", { recursive: true });
const exists = existsSync(csvPath);
appendFileSync(csvPath, exists ? toCsv(results).split("\n").slice(1).join("\n") + "\n" : toCsv(results));
```

## Example 5 — Diagnostic block test

**User:** "Test if LinkedIn blocks my IP"

```js
// scripts/test-block.js
import { launchBrowser, newPage } from "../src/browser.js";
import { classifyBlock } from "../src/detect-block.js";

const browser = await launchBrowser({ headless: true });
const page = await newPage(browser);
const res = await page.goto("https://www.linkedin.com/jobs/search/?keywords=test", { waitUntil: "domcontentloaded", timeout: 30000 });
const body = await page.evaluate(() => document.body?.innerText ?? "");
const block = classifyBlock({ status: res?.status(), bodyText: body });
console.log(block);
await browser.close();
```

## Example 6 — Intake → script routing

| User says | Action |
|-----------|--------|
| "Just scrape this URL once" | Script only, files storage |
| "I need to test proxy works" | `test-proxy.js` only |
| "Run every hour via cron" | Script + append CSV, no SQLite |
| "Show me live logs" | Escalate to dashboard skill |
