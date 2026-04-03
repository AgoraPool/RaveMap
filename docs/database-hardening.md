# Database Hardening Runbook

This project uses server-side Postgres access only. Browser users must never query DB directly.

## 1) Apply migrations

```bash
npm run db:push
```

If you use SQL migrations manually, apply:

- `drizzle/0000_init.sql`
- `drizzle/0001_hardening.sql`
- `drizzle/0002_fix_runtime_access.sql`

## 2) Supabase network/auth notes

- Prefer Supabase pooled connection string (`pooler` host) for serverless.
- Include `sslmode=require` in `DATABASE_URL`.
- Do not expose `DATABASE_URL` in frontend/runtime public env.

## 3) Rotating compromised secrets

If credentials were ever pasted/shared:

1. Rotate DB password.
2. Rotate `ADMIN_SECRET`.
3. Rotate `ENCRYPTION_KEY` (32-byte base64).
4. Rotate `RATE_LIMIT_SECRET`.
5. Redeploy after updating env vars.

## 4) Permissions model used by this project

- Direct table access is revoked from Supabase `anon` and `authenticated` roles.
- App reads/writes happen only through backend code and private `DATABASE_URL`.
- RLS is disabled for app tables in MVP backend-only mode to prevent policy lockouts.

## 5) Optional advanced hardening (later)

When you introduce a dedicated least-privilege DB role, you can re-enable RLS with explicit policies for that role.
