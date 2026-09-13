# API keys

API keys let scripts and integrations call the Umami API without a password or a
login session. A request authenticated with an API key acts as the user who owns the
key, with that user's role and permissions.

## Creating a key

1. Sign in and open **Settings → API keys**.
2. Click **Create API key**, give it a name (for example the name of the integration)
   and optionally pick an expiry.
3. Copy the key from the confirmation dialog. It is shown once; only a SHA-256 hash is
   stored, so a lost key has to be revoked and recreated.

Keys look like `umami_` followed by 40 URL-safe random characters. The settings page
lists each key by its first 12 characters, creation date, expiry and last use.

Admins can manage keys for any user through the API; a key can only be created or
revoked from a logged-in session, never with another API key.

## Using a key

Send the key in the `x-umami-api-key` header instead of the `Authorization: Bearer`
token returned by `POST /api/auth/login`:

```sh
curl -H "x-umami-api-key: umami_..." https://analytics.example.com/api/websites
```

Every endpoint that accepts a bearer token also accepts an API key. An invalid, revoked or
expired key returns the same `401 Unauthorized` as a bad bearer token. The key's
`lastUsedAt` is updated at most once a minute.

## Managing keys through the API

Authenticate these endpoints with a bearer token from a login session.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/users/{userId}/api-keys` | List the user's active keys (no secrets) |
| `POST` | `/api/users/{userId}/api-keys` | Create a key: `{ "name": string, "expiresAt"?: ISO date }`; the response includes `key` once |
| `DELETE` | `/api/users/{userId}/api-keys/{keyId}` | Revoke a key |

Only the user themself or an admin may call these.

## Revoking a key

Revoke a key from **Settings → API keys** or with the `DELETE` endpoint. Revocation is
immediate; the row is kept with its `revoked_at` timestamp for auditing.

## Database

Keys live in the `api_key` table (migration `25_add_api_key`), which `prisma migrate
deploy` applies on start-up like every other migration.
