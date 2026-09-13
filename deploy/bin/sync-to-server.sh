#!/bin/sh
# Copies the compose file and local secrets to the host and applies them.
set -eu
HOST=${UMAMI_HOST:-root@91.98.124.241}
DIR=$(cd "$(dirname "$0")/.." && pwd)
test -f "$DIR/.env" || { echo "deploy/.env missing (copy .env.example)" >&2; exit 1; }
scp -q "$DIR/docker-compose.yml" "$DIR/.env" "$HOST:/opt/umami/"
ssh "$HOST" 'cd /opt/umami && chmod 600 .env && docker compose up -d && docker compose ps'
