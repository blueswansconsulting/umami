#!/bin/sh
# /opt/umami on the host is a checkout of this repo's blueswans branch.
# Deploying means: push, pull there, apply the compose file.
set -eu
HOST=${UMAMI_HOST:-root@91.98.124.241}
ssh "$HOST" 'set -e; cd /opt/umami && git pull --ff-only && cd deploy && test -f .env && docker compose up -d && docker compose ps'
