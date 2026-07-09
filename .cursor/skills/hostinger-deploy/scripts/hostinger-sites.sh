#!/usr/bin/env bash
# List Hostinger websites (uses OAuth credentials or HOSTINGER_API_TOKEN)
set -euo pipefail

token() {
  if [[ -n "${HOSTINGER_API_TOKEN:-}" ]]; then
    echo "$HOSTINGER_API_TOKEN"
  elif [[ -n "${API_TOKEN:-}" ]]; then
    echo "$API_TOKEN"
  elif [[ -f "$HOME/.config/hostinger-mcp/credentials.json" ]]; then
    node -e "console.log(require('$HOME/.config/hostinger-mcp/credentials.json').access_token)"
  else
    echo "No Hostinger auth. Run: hostinger-auth.sh or set HOSTINGER_API_TOKEN" >&2
    exit 1
  fi
}

curl -sS -H "Authorization: Bearer $(token)" -H "Accept: application/json" \
  "https://developers.hostinger.com/api/hosting/v1/websites?per_page=25" \
  | python3 -m json.tool
