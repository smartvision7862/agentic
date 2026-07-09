#!/usr/bin/env bash
# List recent Node.js builds for a domain.
# Usage: hostinger-builds.sh DOMAIN [USERNAME]
set -euo pipefail

DOMAIN="${1:?Usage: hostinger-builds.sh DOMAIN [USERNAME]}"
USERNAME="${2:-}"

token() {
  if [[ -n "${HOSTINGER_API_TOKEN:-}" ]]; then echo "$HOSTINGER_API_TOKEN"
  elif [[ -f "$HOME/.config/hostinger-mcp/credentials.json" ]]; then
    node -e "console.log(require('$HOME/.config/hostinger-mcp/credentials.json').access_token)"
  else echo "No auth" >&2; exit 1; fi
}

if [[ -z "$USERNAME" ]]; then
  USERNAME=$(curl -sS -H "Authorization: Bearer $(token)" -H "Accept: application/json" \
    "https://developers.hostinger.com/api/hosting/v1/websites?domain=${DOMAIN}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['username'] if d else '')")
  [[ -n "$USERNAME" ]] || { echo "Site not found: $DOMAIN" >&2; exit 1; }
fi

curl -sS -H "Authorization: Bearer $(token)" -H "Accept: application/json" \
  "https://developers.hostinger.com/api/hosting/v1/accounts/${USERNAME}/websites/${DOMAIN}/nodejs/builds?per_page=10" \
  | python3 -m json.tool
