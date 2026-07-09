# Hostinger Deploy — Reference

## API base

`https://developers.hostinger.com`

Auth header: `Authorization: Bearer <token>` (from OAuth `credentials.json` or API token).

## Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/hosting/v1/websites` | List sites |
| GET | `/api/hosting/v1/accounts/{username}/websites/{domain}/nodejs/builds` | List builds |
| GET | `.../nodejs/builds/{uuid}/logs` | Build logs (`from_line` for polling) |
| POST | `.../nodejs/builds/from-archive` | Upload zip + start build |

## Node.js app requirements (shared hosting)

- **Node 18 / 20 / 22 / 24** — match `engines` in `package.json`
- **Pure JavaScript dependencies** — no `node-gyp` / native addons
- **Entry file** — Hostinger defaults to `server.js`; `package.json` `"start"` must work
- **Port** — listen on `process.env.PORT` (Hostinger sets it, often `3000`)
- **Bind** — `app.listen(port, "0.0.0.0")` for platform routing
- **Build script** — required in hPanel even if no compile step

## `.env.example` template (production)

Ship this; user copies values into hPanel env vars:

```env
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://your-domain.hostingersite.com

# Add project-specific keys below (never commit real values)
# OPENROUTER_API_KEY=
# DATABASE_URL=
```

## Monorepo patterns

**Pattern 1 — subfolder root (preferred)**

hPanel application root = `apps/api/`

**Pattern 2 — repo root wrapper**

```
package.json          # postinstall: npm install --prefix apps/api
server.js             # import "./apps/api/server.js"
apps/api/
  package.json
  server.js
  ...
```

## Archive deploy checklist

```bash
zip -r /tmp/deploy.zip . \
  -x "node_modules/*" \
  -x ".git/*" \
  -x ".env" \
  -x "*/.env" \
  -x "data/*" \
  -x "storage/*" \
  -x "dist/*" \
  -x ".next/*"
```

## Log interpretation

| Log line | Meaning |
|----------|---------|
| `added N packages, and audited M packages` | **Install OK** |
| `npm warn deprecated` | Harmless warning |
| `found 0 vulnerabilities` | Audit OK |
| `BUILD_OK` | Custom build script passed |
| `gyp ERR!` / `better-sqlite3` | Native module — change dependency |
| `Cannot find module` at start | Wrong entry file or missing postinstall |

## Official links

- [Hostinger API MCP docs](https://www.hostinger.com/support/11079316-hostinger-api-mcp-server/)
- [Node.js web app hosting](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Fix failed build](https://www.hostinger.com/support/fix-failed-to-build-application-error-hostinger-node-js/)
- [hostinger-api-mcp on npm](https://www.npmjs.com/package/hostinger-api-mcp)
- [hostinger-cursor-plugin](https://github.com/hostinger/hostinger-cursor-plugin)
