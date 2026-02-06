CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" varchar(120) NOT NULL,
  "title" varchar(180) NOT NULL,
  "summary" text NOT NULL,
  "public_location" varchar(180) NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "cover_image_url" text,
  "is_published" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "events_slug_uq" ON "events" ("slug");
CREATE INDEX IF NOT EXISTS "events_starts_at_idx" ON "events" ("starts_at");

CREATE TABLE IF NOT EXISTS "event_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE cascade,
  "code_hash" text NOT NULL,
  "code_hash_algo" varchar(32) NOT NULL DEFAULT 'scrypt',
  "encrypted_payload" text NOT NULL,
  "encryption_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_secrets_event_id_uq" ON "event_secrets" ("event_id");

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor" varchar(100) NOT NULL,
  "action" varchar(120) NOT NULL,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" varchar(120) NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at");

CREATE TABLE IF NOT EXISTS "unlock_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_slug" varchar(120) NOT NULL,
  "ip_hash" varchar(128) NOT NULL,
  "failed_count" integer NOT NULL DEFAULT 0,
  "window_start" timestamp with time zone NOT NULL,
  "blocked_until" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "unlock_attempts_event_slug_ip_hash_uq" ON "unlock_attempts" ("event_slug", "ip_hash");
