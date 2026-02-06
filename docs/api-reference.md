# API Reference

All responses are JSON.

## Common Success Format

```json
{
  "ok": true,
  "data": {}
}
```

## Common Error Format

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Safe message"
  }
}
```

## `POST /api/admin/events`

Create a new event.

Authentication:

- Header `x-admin-secret: <ADMIN_SECRET>`
- or `Authorization: Bearer <ADMIN_SECRET>`

Request body:

```json
{
  "title": "Warehouse Night",
  "summary": "Public event info",
  "publicLocation": "Brno",
  "startsAt": "2026-03-14T21:00:00+01:00",
  "coverImageUrl": "https://example.com/cover.jpg",
  "isPublished": true,
  "unlockCode": "my-strong-code",
  "secretInfo": "Secret organizer instructions",
  "secretLocationName": "Industrial Hall",
  "secretLatitude": 49.1951,
  "secretLongitude": 16.6068,
  "secretMapNote": "Use side entrance"
}
```

Success `201`:

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "slug": "warehouse-night-2026-03-14"
  }
}
```

## `GET /api/admin/diagnostics`

Admin-only diagnostic endpoint for DB health checks.

Authentication:

- same as `POST /api/admin/events`

Success `200` (shape abbreviated):

```json
{
  "ok": true,
  "data": {
    "checks": {
      "identity": [],
      "rls": [],
      "eventsSelect": { "ok": true, "rows": 0 },
      "auditInsert": { "ok": true },
      "auditCleanup": { "ok": true }
    }
  }
}
```

## `GET /api/events`

Returns published events list.

Success `200`:

```json
{
  "ok": true,
  "data": {
    "events": [
      {
        "slug": "warehouse-night-2026-03-14",
        "title": "Warehouse Night",
        "summary": "Public event info",
        "publicLocation": "Brno",
        "startsAt": "2026-03-14T20:00:00.000Z",
        "coverImageUrl": "https://example.com/cover.jpg"
      }
    ]
  }
}
```

## `GET /api/events/[slug]`

Returns one published event by slug.

Success `200`:

```json
{
  "ok": true,
  "data": {
    "event": {
      "slug": "warehouse-night-2026-03-14",
      "title": "Warehouse Night",
      "summary": "Public event info",
      "publicLocation": "Brno",
      "startsAt": "2026-03-14T20:00:00.000Z",
      "coverImageUrl": "https://example.com/cover.jpg"
    }
  }
}
```

Possible errors:

- `400 INVALID_SLUG`
- `404 EVENT_NOT_FOUND`

## `POST /api/events/[slug]/unlock`

Verify unlock code and return decrypted secret payload.

Request body:

```json
{
  "unlockCode": "my-strong-code"
}
```

Success `200`:

```json
{
  "ok": true,
  "data": {
    "secretInfo": "Secret organizer instructions",
    "secretLocationName": "Industrial Hall",
    "secretLatitude": 49.1951,
    "secretLongitude": 16.6068,
    "secretMapNote": "Use side entrance"
  }
}
```

Possible errors:

- `400 INVALID_SLUG`
- `401 INVALID_UNLOCK_CODE`
- `404 EVENT_NOT_FOUND`
- `429 TOO_MANY_ATTEMPTS` with `Retry-After` header

## Rate-limit behavior (`unlock` endpoint)

- Window: 15 minutes
- Max failures in window: 5
- Block duration after threshold: 30 minutes
- Tracking key: (`event_slug`, hashed client IP)
