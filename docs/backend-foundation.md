# Backend Foundation

## Core Modules

- `auth.ts`: shared-secret admin guard.
- `crypto.ts`: unlock hashing and encrypted draft/secret bundles.
- `env.ts`: runtime environment validation.
- `nostr-repository.ts`: relay reads, writes, draft publish, delete, diagnostics, and source dedupe.
- `importers/jiripetrak.ts`: source-specific mirror parser and sync service.
- `rate-limit.ts`: in-memory unlock brute-force controls.
- `schemas.ts`: strict API input validation.

## Implemented API

- `GET /api/events`
- `GET /api/events/[slug]`
- `POST /api/events/[slug]/unlock`
- `GET /api/admin/events`
- `POST /api/admin/events`
- `PATCH /api/admin/events`
- `DELETE /api/admin/events`
- `GET /api/admin/diagnostics`
- `GET /api/admin/imports/jiripetrak/preview`
- `POST /api/admin/imports/jiripetrak/sync`
- `POST /api/mirror/jiripetrak/sync`
