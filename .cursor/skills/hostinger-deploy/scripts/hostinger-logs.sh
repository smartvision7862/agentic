#!/usr/bin/env bash
# Fetch build logs for a Node.js deployment.
# Usage: hostinger-logs.sh DOMAIN UUID [USERNAME] [FROM_LINE]
set -euo pipefail

DOMAIN="${1:?Usage: hostinger-logs.sh DOMAIN UUID [USERNAME] [FROM_LINE]}"
UUID="${2:?Missing build UUID}"
USERNAME="${3:-}"
FROM_LINE="${4:-0}"

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
fi

RESP=$(curl -sS -H "Authorization: Bearer $(token)" -H "Accept: application/json" \
  "https://developers.hostinger.com/api/hosting/v1/accounts/${USERNAME}/websites/${DOMAIN}/nodejs/builds/${UUID}/logs?from_line=${FROM_LINE}")

python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('logs', json.dumps(d, indent=2)))" <<< "$RESP"
