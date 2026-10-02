# Self-hosted Umami (Blue Swans)

This fork tracks upstream `umami-software/umami` on `master`. Our deployment
lives on the `blueswans` branch under `deploy/`; code changes intended for
upstream branch from `master` and are sent as pull requests.

## Where it runs

Host `91.98.124.241` (the shared Kamal host). `/opt/umami` is a checkout of
this branch; Compose runs from `/opt/umami/deploy` with project name `umami`
(pinned by `name:` so the existing containers and the `umami_umami-db-data`
volume are reused). The image is our fork, pinned in `deploy/docker-compose.yml`
to an immutable commit tag. Update that pin, or use a reviewed Compose override
with an immutable digest, when deploying receiver changes. Postgres 16 lives in
the `umami-db-data` volume.

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

This fork supports user-owned API keys in the `x-umami-api-key` header as well
as bearer login tokens. TradeSites uses a dedicated `tradesites` user for
provisioning websites and syncing pageviews. Keys are authenticated as their
owner and website permissions are still checked.

## Server conversion receipt

`POST /api/conversions` requires an active API key whose owner can update the
requested website. It accepts `website` and `conversionId` UUIDs,
`occurredAt` (ISO timestamp), an optional signed tracker `sessionCache`, and
an allowlisted `data` object containing `quote_request_id` (equal to
`conversionId`), `pathname`, and optional `source`, `landing_page`,
`utm_source`, `utm_medium`, `utm_campaign`, `funnel_name`, `referrer_domain`
(hostname only). Paths must be
relative and contain no query string, fragment or newline. Do not send
customer contact data, IP addresses or user agents. Consent and selecting
server versus browser conversion ownership remain the sender's responsibility.

Valid tracker cache links the conversion to the original website/session/visit,
verified against stored records, without deriving a visitor from the server IP.
An invalid supplied cache returns HTTP 400 with `error.code` equal to
`invalid-session-cache`. A sender can explicitly resend without the invalid
reference, preserving the same conversion ID, to record an unlinked receipt.
No cache creates a deterministic anonymous session with
`attribution_status=unlinked`; it does not guess or recover a previous visit.
This creates no pageview and therefore does not increase headline visitors or
visits in the default traffic statistics. Event-specific visitor counts and
session lists can include this synthetic session; it is not an attributed visit.

The success response is `{conversionId,eventId,linked,duplicate}`. The event
name is `quote_request_submit`. Stable website/conversion event IDs do not
depend on signing-secret rotation. PostgreSQL commits the event and its
properties together; concurrent or repeated requests return the existing
receipt without duplicating it. This endpoint deliberately rejects ClickHouse
because its storage path does not offer this relational deduplication guarantee.

Verification uses unit tests plus an isolated migrated PostgreSQL database:
`UMAMI_CONVERSION_INTEGRATION=1 APP_SECRET=<test-only-secret> DATABASE_URL=<local-test-database> pnpm exec vitest run src/app/api/conversions`.
The integration suite deliberately adds a temporary rejecting constraint to
the test database to prove rollback. Never run it against production.
