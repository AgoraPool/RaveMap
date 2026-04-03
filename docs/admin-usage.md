# Admin Usage (MVP)

## Manage events in browser

1. Open `/admin` on your deployment.
2. Fill in `Admin Secret` (from `ADMIN_SECRET` env var).
3. Use `Ověřit a načíst` to unlock admin tools and load current events.
4. Fill public + secret event fields to create an event.
5. Submit.
6. Filter or inspect existing events in the management panel.
7. To delete an event, open its danger zone, type its exact slug into the confirmation field, and confirm delete.

If successful, the page returns the created slug path, e.g. `/akce/my-event-2026-02-07`.

## Security notes

- `/admin` is intentionally minimal MVP and uses shared admin secret.
- Use only over HTTPS.
- Rotate `ADMIN_SECRET` periodically and after any exposure.
- Cover image URLs are restricted to `http`/`https`.
- Delete requires an exact slug confirmation to reduce accidental removal.
- Future step: replace shared secret with organizer accounts/session auth.
