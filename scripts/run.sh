#!/usr/bin/env bash
# TDH - Tacho Data Hub :: Startskript
# Usage: ./scripts/run.sh test1|test2|test3|test4
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-}"
case "$MODE" in
  test1|test2|test3|test4) ;;
  *)
    echo "Usage: $0 test1|test2|test3|test4"
    echo "  test1  HTTP only, Port 80          (lokaler Funktionstest)"
    echo "  test2  self-signed HTTPS, Port 443 (lokaler TLS-Test)"
    echo "  test3  HTTP only, Port 8080        (hinter externem TLS-Proxy)"
    echo "  test4  Let's Encrypt HTTPS         (Produktivbetrieb)"
    exit 1
    ;;
esac

if [ ! -f .env ]; then
  echo "[TDH] .env fehlt - erzeuge aus .env.example"
  cp .env.example .env
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

DOMAIN="${DOMAIN:-tdh.example.com}"

if [ "$MODE" = "test2" ]; then
  mkdir -p nginx/certs
  if [ ! -f nginx/certs/fullchain.pem ]; then
    echo "[TDH] Erzeuge self-signed Zertifikat fuer ${DOMAIN} ..."
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout nginx/certs/privkey.pem \
      -out    nginx/certs/fullchain.pem \
      -subj "/CN=${DOMAIN}" \
      -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1"
  fi
fi

if [ "$MODE" = "test4" ]; then
  mkdir -p letsencrypt certbot-www
  if [ ! -f "letsencrypt/live/tdh/fullchain.pem" ]; then
    echo "[TDH] Kein Zertifikat gefunden - bitte zuerst den TLS-Bootstrap"
    echo "      aus DEPLOYMENT.md (Schritt 3) ausfuehren."
    exit 1
  fi
fi

echo "[TDH] Starte Modus ${MODE} ..."
docker compose -f docker-compose.yml -f "docker-compose.${MODE}.yml" up -d --build
echo "[TDH] Laeuft. Status:"
docker compose -f docker-compose.yml -f "docker-compose.${MODE}.yml" ps
echo "${MODE}" > .tdh-mode
