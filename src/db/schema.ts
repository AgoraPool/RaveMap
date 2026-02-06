import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    summary: text("summary").notNull(),
    publicLocation: varchar("public_location", { length: 180 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    coverImageUrl: text("cover_image_url"),
    isPublished: boolean("is_published").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("events_slug_uq").on(table.slug), index("events_starts_at_idx").on(table.startsAt)],
);

export const eventSecrets = pgTable(
  "event_secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    codeHashAlgo: varchar("code_hash_algo", { length: 32 }).notNull().default("scrypt"),
    encryptedPayload: text("encrypted_payload").notNull(),
    encryptionVersion: integer("encryption_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("event_secrets_event_id_uq").on(table.eventId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actor: varchar("actor", { length: 100 }).notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: varchar("entity_id", { length: 120 }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_created_at_idx").on(table.createdAt)],
);

export const unlockAttempts = pgTable(
  "unlock_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventSlug: varchar("event_slug", { length: 120 }).notNull(),
    ipHash: varchar("ip_hash", { length: 128 }).notNull(),
    failedCount: integer("failed_count").notNull().default(0),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("unlock_attempts_event_slug_ip_hash_uq").on(table.eventSlug, table.ipHash)],
);
