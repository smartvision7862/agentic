#!/usr/bin/env bash
# Sign in to Hostinger via OAuth (stores ~/.config/hostinger-mcp/credentials.json)
set -euo pipefail
exec npx -y hostinger-api-mcp --login
