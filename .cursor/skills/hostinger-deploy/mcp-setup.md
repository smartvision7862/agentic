# Hostinger MCP Setup

Works in **any** Cursor project. Requires Node.js 20+ locally (24+ for `hostinger-api-mcp` CLI).

## Option A — Project-scoped (recommended for teams)

Copy into the repo root:

```
your-project/
└── .cursor/
    └── mcp.json
```

Use [mcp.json.example](mcp.json.example) verbatim. Commit `.cursor/mcp.json` — it contains **no secrets**.

## Option B — Global (all projects)

Merge the `hostinger` block into `~/.cursor/mcp.json` under `mcpServers`.

## Authentication

### OAuth (default — no token in files)

```bash
npx -y hostinger-api-mcp --login
```

Opens browser; stores creds in `~/.config/hostinger-mcp/credentials.json`.
MCP config needs **no** `env` block when OAuth is active.

Logout: `npx -y hostinger-api-mcp --logout`

### API token (optional)

1. hPanel → **Profile** → **API** → Create token
2. Cursor → **Settings** → **MCP** → `hostinger` → add environment variable:
   - Key: `HOSTINGER_API_TOKEN`
   - Value: paste the real token (not a placeholder)

When `HOSTINGER_API_TOKEN` is set, OAuth is bypassed.

**Do not** commit tokens. **Do not** use `"${HOSTINGER_API_TOKEN}"` in JSON — Cursor passes it literally.

## Enable in Cursor

1. Add or merge MCP config
2. Run OAuth login (if not using API token)
3. **Restart Cursor** or use MCP refresh in Settings
4. Confirm `hostinger` appears in available MCP servers

## Verify connection

Ask the agent to call `hosting_listWebsitesV1`. Success returns a `data` array of domains.
`{"message":"Unauthenticated."}` → fix auth (step above) and restart MCP.

## MCP tools used for deploy

| Tool | Purpose |
|------|---------|
| `hosting_listWebsitesV1` | Find domain + username |
| `hosting_listNodeJSBuildsV1` | Recent builds + state |
| `hosting_getNodeJSBuildLogsV1` | Build log lines |
| `hosting_createNodeJSBuildFromArchiveV1` | Upload zip + start build |
| `hosting_deployJsApplication` | Legacy archive deploy |
| `hosting_listJsDeployments` | Legacy deployment list |
| `hosting_showJsDeploymentLogs` | Legacy logs |

Always read the tool descriptor JSON before calling.
