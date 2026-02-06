# RaveMap

RaveMap is an Astro + Netlify SSR application for publishing underground events with two visibility levels:

- Public event information visible to everyone.
- Secret event information protected behind a code/password distributed by organizers.

The project is designed for simple operation with a security-first backend MVP.

## Current Product Scope

- Homepage with sections:
  - `AKCE`: list of published events.
  - `NOVÉ`: organizer entry point to `/admin`.
  - `FAQ` and hero content.
- Event detail pages at `/akce/[slug]`:
  - Public details immediately visible.
  - Secret details (including map location) unlocked by code.
- Admin page at `/admin`:
  - Organizer creates events and secret payload.
  - Uses shared `ADMIN_SECRET` (MVP auth model).

## Tech Stack

- Framework: Astro (`output: server`)
- Deployment target: Netlify (`@astrojs/netlify` adapter)
- Database: PostgreSQL (tested with Supabase pooled connection)
- ORM/query layer: Drizzle ORM + postgres driver
- Validation: Zod
- Crypto:
  - `scrypt` for unlock code hashing
  - `AES-256-GCM` for secret payload encryption

## Repository Structure

```text
src/
  components/
    Hero.astro
    Akce.astro        # event list on homepage
    Nove.astro        # admin entry point on homepage
    Faq.astro
  pages/
    index.astro
    admin.astro       # event creation form
    akce/[slug].astro # event detail + unlock UI
    api/
      admin/
        events.ts
        diagnostics.ts
      events/
        index.ts
        [slug].ts
        [slug]/unlock.ts
  db/
    client.ts
    schema.ts
  lib/server/
    auth.ts
    crypto.ts
    env.ts
    errors.ts
    http.ts
    request.ts
    rate-limit.ts
    schemas.ts
    slug.ts
    validation.ts

docs/
  admin-usage.md
  backend-foundation.md
  database-hardening.md
  architecture.md
  api-reference.md

drizzle/
  0000_init.sql
  0001_hardening.sql
  0002_fix_runtime_access.sql
```

## Environment Variables

Create `.env` in project root:

```env
DATABASE_URL="postgresql://..."
ADMIN_SECRET="long-random-secret"
ENCRYPTION_KEY="base64-32-byte-key"
NODE_ENV="development"
```

### Requirements

- `DATABASE_URL`: server-side Postgres connection string (include `sslmode=require` where needed).
- `ADMIN_SECRET`: minimum 24 characters, high entropy.
- `ENCRYPTION_KEY`: base64 encoding of exactly 32 bytes.

Generate secure values:

```bash
openssl rand -hex 32      # ADMIN_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
```

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start dev server:

```bash
npm run dev
```

3. Build production bundle:

```bash
npm run build
```

## Database Setup

### Option A (recommended here): run SQL migrations manually in Supabase SQL editor

Apply in order:

1. `drizzle/0000_init.sql`
2. `drizzle/0001_hardening.sql`
3. `drizzle/0002_fix_runtime_access.sql`

### Option B: Drizzle push

```bash
npm run db:push
```

If `db:push` crashes on Node 24, use Node 20 (`nvm use 20`) and retry.

## Backend Architecture Overview

### Public/secret data split

- `events` stores only public event information.
- `event_secrets` stores hashed unlock credential and encrypted secret payload.

This separation prevents accidental secret exposure through public endpoints.

### API layers

- Route handlers in `src/pages/api/...`
- Shared validation and error shaping in `src/lib/server/...`
- DB schema and access in `src/db/...`

### Security controls

- Strict request validation with Zod.
- Shared admin secret gate for create-event endpoint.
- Unlock endpoint brute-force control per event + hashed IP.
- Secret payload encryption at rest.
- Unlock code stored as `scrypt` hash.

For full details, see `docs/architecture.md`.

## API Overview

### Admin

- `POST /api/admin/events`
  - Requires `x-admin-secret` header or `Authorization: Bearer ...`.
  - Creates event + encrypted secret data + audit log in one transaction.

- `GET /api/admin/diagnostics`
  - Requires admin secret.
  - Verifies DB identity/read/write status (for troubleshooting).

### Public

- `GET /api/events`
  - Returns published events list (public fields only).

- `GET /api/events/[slug]`
  - Returns one published event (public fields only).

- `POST /api/events/[slug]/unlock`
  - Validates unlock code, applies rate limit, returns decrypted secret on success.

Detailed request/response examples: `docs/api-reference.md`.

## Security Model (MVP)

### What is protected

- Admin event creation behind shared secret.
- Secret event payload encrypted at rest.
- Unlock code never stored in plaintext.
- Brute-force attempts throttled and temporarily blocked.

### Network and headers

`netlify.toml` sets:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

### DB hardening

- `anon` and `authenticated` roles have revoked direct table access.
- RLS is intentionally disabled for MVP backend-only role flow to avoid policy lockout.
- See `docs/database-hardening.md`.

## Deployment (Netlify)

1. Connect repo to Netlify.
2. Set required environment variables in Netlify UI:
   - `DATABASE_URL`
   - `ADMIN_SECRET`
   - `ENCRYPTION_KEY`
3. Deploy.

Build config is already in `netlify.toml`.

## Operational Notes

- If secrets were exposed anywhere, rotate all three immediately:
  - DB password
  - `ADMIN_SECRET`
  - `ENCRYPTION_KEY`
- Prefer Supabase pooled connection string for serverless environments.

## Troubleshooting

### `Missing required environment variables`

One or more env vars are absent in runtime environment.

### `Invalid URL` for `DATABASE_URL`

`DATABASE_URL` malformed or contains unescaped special characters in credentials.

### DB connect failures (`EHOSTUNREACH`, `ENOTFOUND`)

Usually DNS/network routing issue or wrong host string. Use exact pooled URL from provider dashboard.

### `POST /api/admin/events` returns 500

Use `GET /api/admin/diagnostics` with admin secret to validate DB permissions and connectivity.

## Future Improvements

- Replace shared admin secret with multi-organizer auth/session model.
- Add automated tests for unlock path and rate-limiting behavior.
- Tighten CSP by removing inline scripts/styles.
- Introduce dedicated least-privilege DB role.
