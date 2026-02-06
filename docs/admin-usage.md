# Admin Usage (MVP)

## Create an event in browser

1. Open `/admin` on your deployment.
2. Fill in `Admin Secret` (from `ADMIN_SECRET` env var).
3. Fill public + secret event fields.
4. Submit.

If successful, the page returns the created slug path, e.g. `/akce/my-event-2026-02-07`.

## Security notes

- `/admin` is intentionally minimal MVP and uses shared admin secret.
- Use only over HTTPS.
- Rotate `ADMIN_SECRET` periodically and after any exposure.
- Future step: replace shared secret with organizer accounts/session auth.
