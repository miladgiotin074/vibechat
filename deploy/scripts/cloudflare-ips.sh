#!/usr/bin/env bash
# Regenerates deploy/nginx/cloudflare.conf from Cloudflare's published edge ranges.
set -euo pipefail
OUT="$(dirname "$0")/../nginx/cloudflare.conf"
{
  echo "# Cloudflare edge ranges — generated $(date -u +%F) from https://www.cloudflare.com/ips/"
  for ip in $(curl -fsSL https://www.cloudflare.com/ips-v4) $(curl -fsSL https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"
  done
  echo "real_ip_header CF-Connecting-IP;"
} > "$OUT"
echo "wrote $OUT — rebuild nginx: docker compose --profile app up -d --build nginx"
