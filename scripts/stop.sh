#!/usr/bin/env bash
# TDH - Tacho Data Hub :: Stopskript
# Usage: ./scripts/stop.sh [-v]   (-v loescht zusaetzlich die Volumes)
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="$(cat .tdh-mode 2>/dev/null || echo test1)"
ARGS=(-f docker-compose.yml -f "docker-compose.${MODE}.yml")

if [ "${1:-}" = "-v" ]; then
  docker compose "${ARGS[@]}" down -v
else
  docker compose "${ARGS[@]}" down
fi
echo "[TDH] Gestoppt (Modus ${MODE})."
