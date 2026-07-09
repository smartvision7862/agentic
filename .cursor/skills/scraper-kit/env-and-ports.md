# Environment & Port Allocation

## Rules

1. **Only create or update `.env.example`** — never read the user's `.env` file.
2. Every scraper project gets a **unique `PORT`** to avoid `EADDRINUSE` conflicts.
3. Pair `PORT` with required secrets (`NODEMAVEN_API_KEY`, site-specific keys) in `.env.example`.
4. Use **hand-rolled env loading** — no `dotenv` package (see [nodemaven.md](nodemaven.md) `loadProxyEnv()`).

## Standard `.env.example` template

```env
# NodeMaven — API key from Dashboard → Profile → API key
# App calls GET /api/v2/base/users/me → proxy_username + proxy_password for Puppeteer
NODEMAVEN_API_KEY=

# Optional: Proxy Setup credentials (skips API lookup)
# NODEMAVEN_PROXY_USER=
# NODEMAVEN_PROXY_PASSWORD=

# Optional: country code for sticky sessions (in, us, gb, …)
# NODEMAVEN_PROXY_COUNTRY=in

# Dashboard port — pick a unique value (see port map below)
PORT=3950
```

Add project-specific secrets below `PORT` (e.g. `LINKEDIN_LI_AT`, `HEADLESS=true`).

## Port map (reference workspace)

When working in a monorepo, scan all `**/.env.example` files for `PORT=` and pick the next unused number.

| Project | PORT |
|---------|------|
| job-scraper-test | 3847 |
| google-search-scraper | 3848 |
| Internet Download Automation | 3939 |
| HR Finding Automation | 3940 |
| google-maps-scraper | 3942 |

## Greenfield projects

- Start at **3950** if no siblings exist.
- Increment until unique.
- Add a comment listing known sibling ports:

```env
# Dashboard port (default 3950). Sibling ports — job-scraper 3847, google-search 3848, download 3939, hr-finding 3940, maps 3942
PORT=3950
```

## Vite dev ports (Pattern B only — React Extract OS)

| Dashboard | Vite port | Proxies API to |
|-----------|-----------|----------------|
| First React dashboard | 5173 | `localhost:<backend PORT>` |
| Second React dashboard | 5174 | `localhost:<backend PORT>` |

Configure in `dashboard/vite.config.js`:

```js
server: {
  port: 5173,
  proxy: { "/api": "http://localhost:3950" },
}
```

## Server port resolution

```js
// server/config.js
import { loadProxyEnv } from "./nodemaven-proxy.js";
loadProxyEnv();

export const config = {
  port: Number(process.env.PORT ?? 3950),
};
```

```js
// server/index.js
app.listen(config.port, () => {
  console.log(`\n  Dashboard → http://localhost:${config.port}\n`);
});
```

## EADDRINUSE troubleshooting

If `listen EADDRINUSE :::PORT` appears:

1. Another instance is already running: `lsof -i :PORT` then `kill <PID>`.
2. Or change `PORT` in the user's `.env` (not `.env.example` unless scaffolding).

Document this in the project README when creating a dashboard.
