---
name: hostinger-deploy
description: >-
  Deploy and troubleshoot Node.js apps on Hostinger Managed Node.js Hosting via
  the official hostinger-api-mcp server. Use when the user asks to deploy to
  Hostinger, fix Hostinger build failures, configure Hostinger MCP, read Hostinger
  build logs, or set up Node.js hosting on brown-lion / hostingersite.com domains.
---

# Hostinger Deploy

Portable workflow for **any** Node.js project on Hostinger Managed Node.js Hosting.
Uses the official [`hostinger-api-mcp`](https://www.npmjs.com/package/hostinger-api-mcp) MCP server.

## Before you start

```
Task Progress:
- [ ] MCP connected (see mcp-setup.md)
- [ ] OAuth signed in OR API token in Cursor MCP env (not a placeholder string)
- [ ] Read MCP tool schema before each CallMcpTool
- [ ] Project passes local preflight (below)
- [ ] Deploy → poll build → verify HTTP
```

## 1 — MCP setup (once per machine)

Copy [mcp.json.example](mcp.json.example) into the target project as `.cursor/mcp.json`,
**or** merge the `hostinger` block into `~/.cursor/mcp.json` for global use.

Then authenticate (pick one):

| Method | When | How |
|--------|------|-----|
| **OAuth** (recommended) | Interactive dev | `npx -y hostinger-api-mcp --login` |
| **API token** | CI / headless | hPanel → Profile → API → create token → paste into **Cursor Settings → MCP → hostinger → Environment** as `HOSTINGER_API_TOKEN` |

**Never** put `"HOSTINGER_API_TOKEN": "${HOSTINGER_API_TOKEN}"` in `mcp.json` — Cursor does not expand shell vars; MCP stays unauthenticated.

Restart or refresh MCP in Cursor after config changes.

Full details: [mcp-setup.md](mcp-setup.md)

## 2 — Project preflight (any Node app)

Run before first deploy:

1. **`package.json` scripts** — must include:
   - `"build"` — even a syntax-check is fine: `node --check server.js && echo BUILD_OK`
   - `"start"` — must listen on `process.env.PORT` and bind `0.0.0.0`
2. **Entry file** — Hostinger auto-detects **`server.js`**. If your app uses `app.js` / `index.js`, add a one-line shim:
   ```js
   // server.js
   import "./app.js"; // or require("./app.js")
   ```
3. **No native npm modules** on shared hosting (no `make`, old glibc). Replace e.g. `better-sqlite3` → `node-sqlite3-wasm` or hosted DB.
4. **Secrets** — never commit `.env`. Ship `.env.example`; user adds vars in hPanel → Deployments → Environment.
5. **Monorepo** — set hPanel **application root** to the subfolder with `package.json`, **or** add root `server.js` + `postinstall: npm install --prefix <app>`.

Local smoke test:

```bash
npm install && npm run build && PORT=3000 npm start
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
```

## 3 — hPanel settings (Git-connected app)

| Setting | Typical value |
|---------|----------------|
| Framework | **Express.js** or **Other** |
| Application root | `.` or subfolder (e.g. `api/`) |
| Node.js | **20** |
| Install | `npm install` |
| Build | `npm run build` |
| Start | `npm start` |
| Entry file | `server.js` |
| Output directory | **empty** (no static build unless SPA) |

Required env vars in hPanel (not in git): `NODE_ENV=production`, `PUBLIC_BASE_URL=https://YOUR-DOMAIN`, plus API keys.

## 4 — Deploy via MCP (agent workflow)

### Discover site

```
hosting_listWebsitesV1  →  note domain + username
```

Filter by domain if known: `{ "domain": "yoursite.hostingersite.com" }`

### Option A — Git push (already connected)

Push to `main` → Hostinger auto-builds. Poll:

```
hosting_listNodeJSBuildsV1  { username, domain, per_page: 3 }
```

### Option B — Archive upload

```
hosting_createNodeJSBuildFromArchiveV1
  username, domain, archive (path to .zip)
  node_version: 20
  app_type: express | vite | next | …
  entry_file: server.js
  build_script: npm run build
  root_directory: (subdir if needed)
```

Zip rules: exclude `node_modules/`, `.env`, `data/`, build output (`dist/`, `.next/`). Max 50 MB.

```
zip -r deploy.zip . -x "node_modules/*" -x ".env" -x "data/*" -x "dist/*"
```

### Diagnose failures

```
hosting_getNodeJSBuildLogsV1  { username, domain, uuid, from_line }
```

Or legacy: `hosting_showJsDeploymentLogs` / `hosting_listJsDeployments`

**Reading logs:** `npm warn deprecated` and `added N packages` mean **install succeeded**. Scroll for `BUILD_OK`, `ERROR`, or missing entry file.

## 5 — Common failures → fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Unauthenticated` MCP | Bad token / `${VAR}` in mcp.json | OAuth login or real token in Cursor MCP UI |
| `better-sqlite3` / `GLIBC_2.29` / `not found: make` | Native module on shared host | Pure-JS/WASM alternative |
| Build log stops after `npm install` | Wrong `entry_file` | Add `server.js` shim |
| Site 502 / connection refused | App listens on wrong port/host | `process.env.PORT`, `0.0.0.0` |
| `package.json not found` | Wrong application root | Set root in hPanel or archive `root_directory` |
| User thinks warnings = failure | npm deprecation warnings | Explain install succeeded; check build/start |

## 6 — Verify live

```bash
curl -s -o /dev/null -w "home:%{http_code}\n" https://DOMAIN/
curl -s -o /dev/null -w "health:%{http_code}\n" https://DOMAIN/api/health
```

Adjust health path to the project's actual endpoint.

## 7 — Helper scripts

Run from any project (OAuth creds at `~/.config/hostinger-mcp/credentials.json`):

```bash
~/.cursor/skills/hostinger-deploy/scripts/hostinger-auth.sh      # OAuth sign-in
~/.cursor/skills/hostinger-deploy/scripts/hostinger-sites.sh     # list websites
~/.cursor/skills/hostinger-deploy/scripts/hostinger-builds.sh DOMAIN [username]
~/.cursor/skills/hostinger-deploy/scripts/hostinger-logs.sh DOMAIN UUID [username]
```

## Additional resources

- [mcp-setup.md](mcp-setup.md) — global vs project MCP, OAuth, API token
- [reference.md](reference.md) — API endpoints, tool list, env var template
