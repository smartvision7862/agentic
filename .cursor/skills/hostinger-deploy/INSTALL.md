# Install Hostinger Deploy skill in another project

Portable kit — copy or symlink into any repo or your personal skills folder.

## Quick install (personal — all projects)

```bash
# Already installed at ~/.cursor/skills/hostinger-deploy if you ran setup from Agentic OS.
# To install on a new machine, copy the folder:
cp -R /path/to/agentic-os/.cursor/skills/hostinger-deploy ~/.cursor/skills/
```

## Per-project MCP

```bash
mkdir -p your-project/.cursor
cp ~/.cursor/skills/hostinger-deploy/mcp.json.example your-project/.cursor/mcp.json
```

Or merge the `hostinger` block from `mcp.json.example` into an existing `.cursor/mcp.json`.

## Authenticate

```bash
~/.cursor/skills/hostinger-deploy/scripts/hostinger-auth.sh
```

Restart Cursor → Settings → MCP → confirm **hostinger** is connected.

## Verify

```bash
~/.cursor/skills/hostinger-deploy/scripts/hostinger-sites.sh
```

## Use in Cursor

Ask the agent: *"Deploy this app to Hostinger"* — it should load the **hostinger-deploy** skill automatically from the description triggers.
