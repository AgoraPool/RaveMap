# Backend Foundation (Tasks 1-3 + Core API)

## Environment Variables

Required in Netlify and local `.env`:

- `DATABASE_URL`: PostgreSQL connection URL.
- `ADMIN_SECRET`: high-entropy secret for MVP admin operations.
- `ENCRYPTION_KEY`: base64-encoded 32-byte key for secret payload encryption.

## Netlify Security Headers

Defined in `netlify.toml` for all paths:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

Note: current CSP allows `'unsafe-inline'` for scripts/styles because current Astro pages use inline blocks. We should remove this when frontend scripts/styles are externalized or nonce-based.

## Server Skeleton

- `src/lib/server/errors.ts`: typed application errors.
- `src/lib/server/http.ts`: safe JSON response helpers and generic API error wrapper.
- `src/lib/server/validation.ts`: strict JSON + schema validation with `zod`.
- `src/lib/server/env.ts`: runtime env validation.
- `src/lib/server/crypto.ts`: unlock code hashing (`scrypt`) and secret payload encryption (`AES-256-GCM`).
- `src/lib/server/auth.ts`: MVP single-admin guard (`x-admin-secret` or bearer token).
- `src/lib/server/schemas.ts`: shared request validation schemas.
- `src/lib/server/request.ts`: client IP extraction + hashing helper.
- `src/lib/server/rate-limit.ts`: DB-backed unlock attempt throttling and temporary blocking.

## Database Scaffold

- ORM: Drizzle (`drizzle-orm`, `drizzle-kit`)
- Client: `postgres`
- Schema: `src/db/schema.ts`
- SQL init migration: `drizzle/0000_init.sql`

Tables introduced:

- `events` (public event metadata)
- `event_secrets` (hashed unlock credential + encrypted payload)
- `audit_logs` (sensitive action log)
- `unlock_attempts` (per-event + per-IP anti-bruteforce state)

## Implemented API

- `POST /api/admin/events`
  - Requires admin secret via `x-admin-secret` header (or `Authorization: Bearer ...`).
  - Accepts validated event payload.
  - Persists public event row + hashed unlock code + encrypted secret payload + audit log in one transaction.

- `GET /api/events`
  - Returns published events list (public fields only).

- `GET /api/events/[slug]`
  - Returns published event detail (public fields only).

- `POST /api/events/[slug]/unlock`
  - Validates code input.
  - Applies per-IP and per-event brute-force throttling.
  - Verifies code hash and returns decrypted secret payload on success.
