# Database Migration Note

RaveMap no longer uses Postgres or Drizzle for event storage. Event state now lives on configured Nostr relays.

Operational hardening now focuses on:

- rotating `NOSTR_PRIVATE_KEY` if exposed,
- keeping `ENCRYPTION_KEY`, `RATE_LIMIT_SECRET`, `ADMIN_SECRET`, and `MIRROR_SYNC_SECRET` private,
- configuring multiple reliable relays and a realistic `NOSTR_WRITE_MIN_SUCCESS`,
- monitoring admin diagnostics for relay read/write issues,
- using HTTPS-only deployment and strict platform headers.
