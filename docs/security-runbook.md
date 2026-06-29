# RaveMap Security Runbook

## Netlify Environment

Set production secrets only in the Netlify UI. Keep local `.env` untracked and rotate values before launch.

Required production values:
- `ADMIN_SECRET`: generated high-entropy admin secret.
- `ENCRYPTION_KEY`: base64 encoded 32-byte key.
- `RATE_LIMIT_SECRET`: generated high-entropy HMAC key for rate-limit identity.
- `NOSTR_RELAYS`: comma-separated `wss://` relay URLs.
- `NOSTR_PRIVATE_KEY`: app hot publisher key as 64-char hex or `nsec`.
- `MIRROR_SYNC_SECRET`: generated high-entropy secret if mirror sync is enabled.

Optional:
- `ORGANIZER_SECRET`: legacy shared organizer secret. Prefer crew accounts.
- `SIMPLEX_GROUP_URL`: public SimpleX invite URL.

Generate local values:

```bash
npm run secrets:generate
```

## Pre-Launch Rotation

Before production launch, rotate:
- `ADMIN_SECRET`
- all crew codes
- `RATE_LIMIT_SECRET`
- `MIRROR_SYNC_SECRET`
- `ENCRYPTION_KEY`
- `NOSTR_PRIVATE_KEY`
- `ORGANIZER_SECRET`, or remove it if crew accounts fully replace it

If encrypted gated events already exist in production, do not rotate `ENCRYPTION_KEY` without re-encrypting or recreating secret bundles.

If public Nostr data already exists in production, do not rotate `NOSTR_PRIVATE_KEY` without a publisher migration plan. For disposable pre-launch data, rotate and republish.

## Custody Model

The MVP uses a hybrid model:
- The server holds a hot app publisher key for admin/studio publishing.
- Public submissions, comments, and RSVP can be client-signed.
- Future admin signing should move toward NIP-07 or another client-held signer.

Never expose private keys, encrypted secret bundles, unlock code hashes, or crew code hashes through public APIs.
