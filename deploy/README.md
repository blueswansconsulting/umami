# Self-hosted Umami (Blue Swans)

This fork tracks upstream `umami-software/umami` on `master`. Our deployment
lives on the `blueswans` branch under `deploy/`; code changes intended for
upstream branch from `master` and are sent as pull requests.

## Where it runs

Host `91.98.124.241` (the shared Kamal host). `/opt/umami` is a checkout of
this branch; Compose runs from `/opt/umami/deploy` with project name `umami`
(pinned by `name:` so the existing containers and the `umami_umami-db-data`
volume are reused). Stock image `ghcr.io/umami-software/umami:postgresql-latest`
(3.0.3 at the time of writing). Postgres 16 lives in the `umami-db-data` volume.

Hostnames, all proxied by Cloudflare and routed by the shared `kamal-proxy`:

- `analytics.solarinstallerlist.com` (zone solarinstallerlist.com)
- `analytics.tradesites.ai` (zone tradesites.ai; A record → host IP, proxied,
  with a Workers route `analytics.tradesites.ai/*` that runs no Worker so the
  canonical TradeSites Worker does not intercept it)

The kamal-proxy route is not managed by Compose. Re-register it after changing
the container IP or adding a hostname:

```sh
docker exec kamal-proxy kamal-proxy deploy umami-web \
  --target 172.18.0.15:3000 \
  --host analytics.solarinstallerlist.com --host analytics.tradesites.ai \
  --health-check-path /api/heartbeat
```

`CLIENT_IP_HEADER=x-visitor-ip` makes Umami read the visitor address from the
header the TradeSites site Worker sets when it relays `/api/send`; Umami falls
back to its normal detection for direct traffic.

## Deploying a change

Secrets live only on the host in `/opt/umami/deploy/.env` (ignored; copy
`.env.example`). Commit, push, then:

```sh
deploy/bin/sync-to-server.sh   # git pull on the host, docker compose up -d
```

Updating the image is `docker compose pull && docker compose up -d` in
`/opt/umami/deploy`; the health check on `/api/heartbeat` gates the swap.
Never edit files under `/opt/umami` by hand; `git status` there shows drift.

## Users and API access

Self-hosted Umami authenticates API calls with a bearer token from
`POST /api/auth/login`; there are no API keys in upstream (they are a Cloud
feature). TradeSites uses a dedicated `tradesites` user for provisioning
websites and syncing pageviews.
