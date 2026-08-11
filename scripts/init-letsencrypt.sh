#!/usr/bin/env bash
# TDH - Tacho Data Hub :: Let's Encrypt Bootstrap (einmalig vor Modus test4)
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${DOMAIN:?DOMAIN in .env setzen}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL in .env setzen}"

mkdir -p letsencrypt certbot-www

echo "[TDH] Starte temporaeren HTTP-Server fuer die ACME-Challenge ..."
docker run -d --name tdh-acme -p 80:80 \
  -v "$PWD/certbot-www:/usr/share/nginx/html:ro" \
  nginx:1.27-alpine >/dev/null

cleanup() { docker rm -f tdh-acme >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[TDH] Fordere Zertifikat fuer ${DOMAIN} an ..."
docker run --rm \
  -v "$PWD/letsencrypt:/etc/letsencrypt" \
  -v "$PWD/certbot-www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d "${DOMAIN}" --cert-name tdh \
  --email "${LETSENCRYPT_EMAIL}" --agree-tos --no-eff-email --non-interactive

echo "[TDH] Zertifikat liegt unter letsencrypt/live/tdh/."
echo "[TDH] Weiter mit: ./scripts/run.sh test4"
