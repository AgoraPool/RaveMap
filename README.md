# Kam Na Rave

Kam Na Rave is a Nostr-backed event app for underground music events. It publishes public event discovery data to relays and supports an optional code-gated secret layer for events where the exact location should stay private.

## Product Scope

- Public event feed and detail pages.
- Two event access modes: public-only and code-gated.
- Optional encrypted secret payloads unlocked with attendee codes.
- Nostr-backed admin cockpit for creating, editing, publishing, deleting, and diagnosing events.
- Hidden organizer studio for crew-friendly draft, preview, publish, and archive workflows.
- Import workflow for mirroring public music events from `jiripetrak.cz` into reviewable drafts.

## Runtime Model

- Astro SSR on Netlify.
- Event data is read from and written to configured Nostr relays.
- The app signs events with an app-managed Nostr private key.
- Public events use replaceable calendar-style Nostr events (`kind 31923`).
- Drafts, encrypted secret bundles, and tombstones use app-specific replaceable kinds.
- Unlock rate limiting is in-memory per server instance and keyed by HMAC-hashed client IP.

## Required Environment

- `ADMIN_SECRET`: shared admin secret.
- `ORGANIZER_SECRET`: shared organizer studio secret.
- `ENCRYPTION_KEY`: base64 encoded 32-byte key for gated secret payload encryption.
- `RATE_LIMIT_SECRET`: high-entropy HMAC key for unlock rate limit identity.
- `NOSTR_RELAYS`: comma-separated `wss://` or `ws://` relay URLs.
- `NOSTR_PRIVATE_KEY`: app publisher key as 64-char hex or `nsec`.
- `NOSTR_WRITE_MIN_SUCCESS`: minimum relay write quorum, default `1`.
- `MIRROR_SOURCE_URL`: source listing URL, default Jiri Petrak freetekno calendar.
- `MIRROR_SYNC_SECRET`: secret for scheduled mirror sync endpoint.
- `MIRROR_USER_AGENT`: optional fetch user agent for mirror requests.
- `SIMPLEX_GROUP_URL`: optional SimpleX group invite, for example `https://smp12.simplex.im/...`, shown in FAQ with a locally generated QR code.

## Scripts

```bash
npm run dev
npm run build
npm run preview
```

## Repo Guide

```text
src/components/        Public UI sections
src/pages/             Astro pages and API routes
src/lib/server/        Nostr repository, auth, crypto, validation, importers
docs/                  Architecture, API, and admin notes
```
