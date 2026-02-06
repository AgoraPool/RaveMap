# Architecture Deep Dive

This document explains the runtime architecture and backend control flow.

## 1) Runtime Topology

- Astro runs in SSR mode on Netlify.
- Astro page routes render server-side.
- API routes run as Netlify server functions.
- Postgres is accessed only from server code.

No browser-side DB credentials are used.

## 2) Request Flow

### Public listing flow

1. Homepage renders `src/components/Akce.astro` server-side.
2. Component reads `events` table where `is_published = true`.
3. User clicks event -> `/akce/[slug]` route.

### Unlock flow

1. Client submits unlock code on `/akce/[slug]`.
2. Client calls `POST /api/events/[slug]/unlock`.
3. Server validates slug + payload.
4. Server applies rate-limit check.
5. Server verifies entered code against stored `scrypt` hash.
6. Server decrypts secret payload (`AES-256-GCM`) on success.
7. Secret payload is returned to client.

### Admin create flow

1. Organizer submits `/admin` form.
2. Frontend calls `POST /api/admin/events` with admin secret header.
3. Server validates auth and request body.
4. Server hashes unlock code and encrypts secret payload.
5. Server writes event, event_secret, and audit log in one DB transaction.

## 3) Module Responsibilities

## API routes (`src/pages/api`)

- `admin/events.ts`: create-event command endpoint.
- `admin/diagnostics.ts`: operational DB health/debug endpoint.
- `events/index.ts`: public event list.
- `events/[slug].ts`: public event detail.
- `events/[slug]/unlock.ts`: secret unlock endpoint.

## Server utilities (`src/lib/server`)

- `auth.ts`: admin secret verification.
- `crypto.ts`: hashing/encryption/decryption.
- `env.ts`: env validation and caching.
- `errors.ts`: typed app errors.
- `http.ts`: standard JSON success/error formatting.
- `request.ts`: client IP extraction and hashing.
- `rate-limit.ts`: unlock attempt throttling.
- `schemas.ts`: Zod request contracts.
- `slug.ts`: slug generation helpers.
- `validation.ts`: content-type + JSON + schema validation.

## Data layer (`src/db`)

- `schema.ts`: typed table definitions and indexes.
- `client.ts`: lazy DB connection creation with Drizzle.

## 4) Data Model

## `events`

Public metadata:

- `slug`, `title`, `summary`, `public_location`, `starts_at`, `is_published`

## `event_secrets`

Secret material:

- `event_id`
- `code_hash`
- `code_hash_algo` (currently `scrypt`)
- `encrypted_payload`
- `encryption_version`

## `unlock_attempts`

Bruteforce controls:

- key: (`event_slug`, `ip_hash`)
- `failed_count`, `window_start`, `blocked_until`

## `audit_logs`

Security-relevant command logs for admin actions.

## 5) Security Architecture

### Authentication

- Admin creation routes require shared secret (`ADMIN_SECRET`).
- Comparison is performed with timing-safe method.

### Cryptography

- Unlock code:
  - `scrypt` with per-code random salt.
  - hash string stores params and salt for future verification.
- Secret payload:
  - encrypted with `AES-256-GCM`.
  - key loaded from env (`ENCRYPTION_KEY`, 32 bytes base64).

### Abuse mitigation

- Unlock endpoint has per-event + per-IP-hash rate-limiting.
- Temporary lockout after repeated failures.

### Data exposure minimization

- Public endpoints only select public columns.
- Secret table queried only in unlock/admin paths.

### DB surface reduction

- direct table access revoked from `anon` and `authenticated` roles.
- backend-only access pattern via private DB connection string.

## 6) Error Handling Strategy

- Domain/validation errors throw `AppError` with explicit status/code.
- Route handlers wrapped with `withApiErrorHandling`.
- Production returns safe generic internal errors.
- Dev mode includes extra debug metadata for troubleshooting.

## 7) Why lazy DB initialization exists

`src/db/client.ts` creates DB connection lazily through `getDb()`.

Reason:
- avoids import-time env/db crashes during build/static phases.
- only connects when endpoint/page actually executes DB work.

## 8) Deployment and runtime assumptions

- running in Netlify SSR mode.
- env vars correctly configured at runtime.
- DB reachable over network from Netlify environment.

## 9) Known MVP tradeoffs

- admin auth is shared secret, not multi-user auth yet.
- CSP still permits inline script/style due current Astro page style/script blocks.
- RLS disabled to match backend-only role model (can be revisited later with explicit policies).
