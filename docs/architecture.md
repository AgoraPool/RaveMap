# Architecture

## Runtime

- Astro runs in SSR mode on Netlify.
- Public pages and API routes use `NostrEventRepository`.
- No database is required for event storage.
- Nostr writes require a configured app-managed signer and relay quorum.

## Nostr Event Model

- `kind 31923`: published public event metadata.
- `kind 30420`: encrypted secret bundle for code-gated events.
- `kind 30421`: encrypted admin draft bundle.
- `kind 30422`: app tombstone used to hide deleted slugs.
- `kind 5`: Nostr delete request published best-effort.

Public event tags include `d`, `title`, `summary`, `location`, `start`, optional `end`, `image`, `external`, `source`, `source-url`, `genre`, `artist`, and `access`.

## Access Modes

- `public`: event detail shows public metadata only and no unlock form.
- `gated`: event detail shows an unlock form; success decrypts the secret bundle.

Gated event secrets use `scrypt` for unlock-code hashing and `AES-256-GCM` for payload encryption. Secret payload AAD is bound to the Nostr coordinate.

## Admin Flow

1. `/admin` authenticates with `ADMIN_SECRET`.
2. Admin lists live events and encrypted drafts from Nostr relays.
3. Admin creates or replaces events by slug.
4. Draft publish reads the encrypted draft and publishes a live public event, plus a secret bundle for gated drafts.
5. Delete writes an app tombstone and a best-effort Nostr delete event.

## Mirroring

- `GET /api/admin/imports/jiripetrak/preview` fetches and normalizes source events without writing.
- `POST /api/admin/imports/jiripetrak/sync` imports public-only review drafts.
- `POST /api/mirror/jiripetrak/sync` is protected by `MIRROR_SYNC_SECRET` for scheduled daily sync.
- Dedupe is based on the source event URL stored in Nostr tags.
