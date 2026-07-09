# Anti-Bot & Proxy Decision Guide

## When proxies are needed

Add proxies when failures correlate with **your IP**, not broken selectors or auth.

| Signal | Likely cause | Action |
|--------|--------------|--------|
| Works for a few requests, then 403/429 | IP rate limit | Add residential proxy (NodeMaven) |
| Works on home IP, fails on VPS | Datacenter IP reputation | Proxy sooner on cloud |
| CAPTCHA / challenge pages | Bot detection | Proxy + slower pacing |
| Empty HTML but status 200 | Soft block / WAF | Proxy rotation |
| Parser finds nothing, no block signals | Selector/plateau issue | Fix selectors first — **not** a proxy problem |

## When proxies are often NOT needed (at first)

- Small volume, sequential runs, 2–5 s delays
- Public APIs with documented keys
- Your own sites / staging
- First prototype to prove the pipeline

**IP pressure model:**

```
IP pressure ≈ (parallel browsers) × (location slices) × (runs per day) × (pages per run)
```

- Low pressure → no proxy; cap parallel at 2–3
- High pressure → residential proxy; sticky IP per browser session, rotate between slices

## Implementation order

1. **Prototype** — single IP, delays, error taxonomy (403 vs 429 vs CAPTCHA vs selector miss)
2. **Harden** — retries, exponential backoff, respect `robots.txt` where applicable
3. **Add proxies** — only for proven IP bottlenecks
4. **Integrate** — env vars, per-site rotation, metrics on block rate

## Browser hardening (Puppeteer)

```js
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function launchBrowser({ headless, proxyServer } = {}) {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
  ];
  if (proxyServer) args.push(`--proxy-server=${proxyServer}`);

  return puppeteer.launch({
    headless: headless ? "shell" : false,
    args,
    defaultViewport: { width: 1366, height: 900 },
  });
}

export async function newPage(browser, { proxyAuth } = {}) {
  const page = await browser.newPage();
  if (proxyAuth?.username && proxyAuth?.password) {
    await page.authenticate(proxyAuth);
  }
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return page;
}
```

## Block detection (`detect-block.js`)

Classify failures before retrying:

```js
export function classifyBlock({ status, bodyText, url }) {
  const text = (bodyText || "").toLowerCase();
  if (status === 429) return { type: "rate_limit", retryable: true };
  if (status === 403) return { type: "forbidden", retryable: true };
  if (/captcha|challenge|verify you are human|unusual traffic/.test(text)) {
    return { type: "captcha", retryable: false };
  }
  if (status === 200 && text.length < 500) return { type: "empty_body", retryable: true };
  return { type: "none", retryable: false };
}
```

## Proxy fallback pattern (Indeed)

If proxy returns HTTP 403 on a strict site, retry once on local IP before marking failed.

## Decision checklist (before buying/configuring proxies)

1. Volume — requests per minute to the same host?
2. Geography — must data match a specific country?
3. Authentication — login required? (use sticky sessions, not per-request rotation)
4. Rendering — IP-only block or full fingerprint?
5. Plateau vs block — flat job count with working parsers = split queries, not proxies
6. Parallel locations — many city slices in parallel → plan on proxies when 429 scales with volume

## Error glossary

| Term | Meaning |
|------|---------|
| 403 Forbidden | Access refused — often WAF/bot |
| 429 Too Many Requests | Rate limit — often temporary |
| CAPTCHA | Human verification — bot signal |
| Sticky session | Same proxy IP for a full login/search flow |
| Rotate per request | New IP each request — breaks logged-in flows |
