BEGIN;

-- Keep updated_at consistent server-side.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_set_updated_at ON public.events;
CREATE TRIGGER events_set_updated_at
BEFORE UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS event_secrets_set_updated_at ON public.event_secrets;
CREATE TRIGGER event_secrets_set_updated_at
BEFORE UPDATE ON public.event_secrets
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS unlock_attempts_set_updated_at ON public.unlock_attempts;
CREATE TRIGGER unlock_attempts_set_updated_at
BEFORE UPDATE ON public.unlock_attempts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Data integrity checks (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_slug_format_ck') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_slug_format_ck CHECK (slug ~ '^[a-z0-9-]{3,120}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_title_length_ck') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_title_length_ck CHECK (char_length(btrim(title)) BETWEEN 3 AND 180);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_summary_length_ck') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_summary_length_ck CHECK (char_length(btrim(summary)) BETWEEN 10 AND 2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_public_location_length_ck') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_public_location_length_ck CHECK (char_length(btrim(public_location)) BETWEEN 2 AND 180);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_secrets_hash_algo_ck') THEN
    ALTER TABLE public.event_secrets
      ADD CONSTRAINT event_secrets_hash_algo_ck CHECK (code_hash_algo IN ('scrypt', 'argon2id'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_secrets_encryption_version_ck') THEN
    ALTER TABLE public.event_secrets
      ADD CONSTRAINT event_secrets_encryption_version_ck CHECK (encryption_version >= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unlock_attempts_failed_count_ck') THEN
    ALTER TABLE public.unlock_attempts
      ADD CONSTRAINT unlock_attempts_failed_count_ck CHECK (failed_count >= 0 AND failed_count <= 100);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unlock_attempts_ip_hash_length_ck') THEN
    ALTER TABLE public.unlock_attempts
      ADD CONSTRAINT unlock_attempts_ip_hash_length_ck CHECK (char_length(ip_hash) = 64);
  END IF;
END $$;

-- Deny direct reads/writes from Supabase anon/authenticated roles.
REVOKE ALL ON TABLE public.events FROM anon, authenticated;
REVOKE ALL ON TABLE public.event_secrets FROM anon, authenticated;
REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated;
REVOKE ALL ON TABLE public.unlock_attempts FROM anon, authenticated;

-- NOTE: In this MVP backend-only architecture we keep RLS disabled.
-- Enabling RLS without explicit policies can lock out the backend DB role.

COMMIT;
