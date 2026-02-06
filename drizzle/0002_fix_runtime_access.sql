BEGIN;

-- Backend-only app mode: keep direct table grants locked down,
-- but disable RLS so backend DB role can read/write without policies.
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_secrets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unlock_attempts DISABLE ROW LEVEL SECURITY;

COMMIT;
