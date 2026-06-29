# API Reference

All responses use:

```json
{ "ok": true, "data": {} }
```

Errors use:

```json
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Safe message" } }
```

## Admin Auth

Admin endpoints require one of:

- `x-admin-secret: <ADMIN_SECRET>`
- `Authorization: Bearer <ADMIN_SECRET>`

## `GET /api/admin/events`

Returns live events and unpublished drafts.

Each event includes `slug`, `title`, `summary`, `publicLocation`, `startsAt`, optional `endAt`, optional `coverImageUrl`, optional `externalUrl`, optional `source`, `genres`, `lineup`, `accessType`, `isPublished`, and `createdAt`.

## `POST /api/admin/events`

Creates or replaces the latest event/draft for a slug.

Public-only example:

```json
{
  "title": "Free Tekno Night",
  "summary": "Public calendar info",
  "publicLocation": "Czech Republic",
  "startsAt": "2026-03-14T21:00:00+01:00",
  "accessType": "public",
  "isPublished": false,
  "externalUrl": "https://example.com/event",
  "sourceName": "Jiri Petrak freetekno calendar",
  "sourceUrl": "https://example.com/event",
  "genres": ["tekno", "freetekno"],
  "lineup": ["Crew"]
}
```

Code-gated example:

```json
{
  "title": "Warehouse Night",
  "summary": "Public event info",
  "publicLocation": "Brno",
  "startsAt": "2026-03-14T21:00:00+01:00",
  "accessType": "gated",
  "isPublished": true,
  "unlockCode": "my-strong-code",
  "secretInfo": "Secret organizer instructions",
  "secretLocationName": "Industrial Hall",
  "secretLatitude": 49.1951,
  "secretLongitude": 16.6068,
  "secretMapNote": "Use side entrance"
}
```

## `PATCH /api/admin/events`

Publishes a draft.

```json
{
  "slug": "free-tekno-night-2026-03-14",
  "action": "publish"
}
```

## `DELETE /api/admin/events`

Writes a tombstone and best-effort Nostr delete request.

```json
{
  "slug": "free-tekno-night-2026-03-14",
  "confirmSlug": "free-tekno-night-2026-03-14"
}
```

## `GET /api/admin/diagnostics`

Returns relay diagnostics, publisher pubkey, latest event summary, and write quorum configuration.

## `GET /api/admin/imports/jiripetrak/preview`

Fetches `MIRROR_SOURCE_URL`, parses source events, and returns normalized import candidates without writing to relays.

## `POST /api/admin/imports/jiripetrak/sync`

Fetches source events and writes review drafts. Existing imported events are matched by `sourceUrl` and replaced under the same slug.

## `POST /api/mirror/jiripetrak/sync`

Scheduler-facing sync endpoint. Requires:

- `x-mirror-sync-secret: <MIRROR_SYNC_SECRET>`

## `GET /api/events`

Returns published public events.

## `GET /api/events/[slug]`

Returns one published public event.

## `GET /api/events/[slug]/rsvp`

Returns RSVP counts and recent roll-call entries.

```json
{
  "rsvp": { "accepted": 12, "tentative": 4, "signals": 3 },
  "entries": [
    {
      "id": "nostr-event-id",
      "slug": "free-tekno-night-2026-03-14",
      "status": "accepted",
      "signal": "hledám partu",
      "authorName": "Anonym",
      "isAnonymous": true,
      "createdAt": "2026-03-01T12:00:00.000Z"
    }
  ]
}
```

## `POST /api/events/[slug]/rsvp`

Writes a pseudonymous RSVP. `signal` is optional and must be one of `hledám partu`, `mám místo v autě`, `jedu vlakem`, `beru distro`, or `uvidíme se u stage`.

```json
{
  "status": "accepted",
  "nickname": "acid23",
  "signal": "jedu vlakem"
}
```

## `POST /api/events/[slug]/unlock`

Only applies to `accessType: "gated"` events. Verifies the unlock code and returns decrypted secret payload.

Possible errors:

- `400 INVALID_SLUG`
- `401 INVALID_UNLOCK_CODE`
- `404 EVENT_NOT_FOUND`
- `429 TOO_MANY_ATTEMPTS`
