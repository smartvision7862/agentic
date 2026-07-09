#!/usr/bin/env bash
# Quick health check for a deployed site.
# Usage: hostinger-check.sh https://your-domain.hostingersite.com [/api/health]
set -euo pipefail

BASE="${1:?Usage: hostinger-check.sh BASE_URL [HEALTH_PATH]}"
HEALTH="${2:-/api/health}"
BASE="${BASE%/}"

home=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/")
health=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}${HEALTH}" 2>/dev/null || echo "000")

echo "home:  ${BASE}/ → HTTP ${home}"
echo "health: ${BASE}${HEALTH} → HTTP ${health}"

if [[ "$home" == "200" ]]; then exit 0; else exit 1; fi
