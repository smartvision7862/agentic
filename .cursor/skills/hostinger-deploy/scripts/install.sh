#!/usr/bin/env bash
# Install hostinger-deploy skill to ~/.cursor/skills/ and optional project MCP config.
# Usage:
#   ./install.sh                  # personal skill only
#   ./install.sh /path/to/project # personal skill + project .cursor/mcp.json
set -euo pipefail

SKILL_SRC="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_DST="$HOME/.cursor/skills/hostinger-deploy"
PROJECT="${1:-}"

echo "Installing skill → $SKILL_DST"
mkdir -p "$HOME/.cursor/skills"
rm -rf "$SKILL_DST"
cp -R "$SKILL_SRC" "$SKILL_DST"
chmod +x "$SKILL_DST/scripts/"*.sh

if [[ -n "$PROJECT" ]]; then
  PROJECT=$(cd "$PROJECT" && pwd)
  MCP="$PROJECT/.cursor/mcp.json"
  mkdir -p "$PROJECT/.cursor"
  if [[ -f "$MCP" ]]; then
    echo "Project already has $MCP — merge hostinger block from mcp.json.example manually."
  else
    cp "$SKILL_DST/mcp.json.example" "$MCP"
    echo "Created $MCP"
  fi
fi

echo "Done. Run: $SKILL_DST/scripts/hostinger-auth.sh"
echo "Then restart Cursor MCP."
