import type { APIRoute } from "astro";
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { auditLogs, eventSecrets, events } from "../../../db/schema";
import { requireAdmin } from "../../../lib/server/auth";
import { encryptSecretPayload, hashUnlockCode } from "../../../lib/server/crypto";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { createEventSchema, deleteEventSchema } from "../../../lib/server/schemas";
import { slugify, randomSlugSuffix } from "../../../lib/server/slug";
import { parseJsonBody } from "../../../lib/server/validation";

function isPostgresLikeError(error: unknown): error is { code?: string; message?: string; detail?: string } {
  return typeof error === "object" && error !== null && ("code" in error || "message" in error);
}

async function createUniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix(6)}`;
    const existing = await db.select({ id: events.id }).from(events).where(eq(events.slug, candidate)).limit(1);

    if (existing.length === 0) {
      return candidate;
    }
  }

  throw new AppError("Could not allocate unique slug", {
    code: "SLUG_COLLISION",
    status: 409,
    expose: true,
  });
}

function throwMappedDatabaseError(action: "GET" | "POST" | "DELETE", error: unknown): never {
  if (import.meta.env.DEV) {
    console.error(`${action} /api/admin/events failed`, error);
  }

  if (error instanceof AppError) {
    throw error;
  }

  if (isPostgresLikeError(error)) {
    const dbCode = error.code ?? "DB_ERROR";
    throw new AppError(
      import.meta.env.DEV
        ? `Database error (${dbCode}): ${error.message ?? "unknown"}`
        : "Database operation failed",
      {
        code: dbCode,
        status: 500,
        expose: import.meta.env.DEV,
      },
    );
  }

  throw error;
}

export const GET: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    requireAdmin(request);

    try {
      const list = await db
        .select({
          id: events.id,
          slug: events.slug,
          title: events.title,
          publicLocation: events.publicLocation,
          startsAt: events.startsAt,
          isPublished: events.isPublished,
          createdAt: events.createdAt,
        })
        .from(events)
        .orderBy(desc(events.startsAt), desc(events.createdAt));

      return jsonOk({ events: list });
    } catch (error) {
      throwMappedDatabaseError("GET", error);
    }
  });

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    requireAdmin(request);

    const input = await parseJsonBody(request, createEventSchema);

    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new AppError("Event start date is invalid", {
        code: "INVALID_START_DATE",
        status: 400,
        expose: true,
      });
    }

    const baseSlug = input.slug ?? `${slugify(input.title)}-${startsAt.toISOString().slice(0, 10)}`;
    const slug = await createUniqueSlug(baseSlug);

    let created;
    try {
      created = await db.transaction(async (tx) => {
        const codeHash = await hashUnlockCode(input.unlockCode);

        const insertedEvent = await tx
          .insert(events)
          .values({
            slug,
            title: input.title,
            summary: input.summary,
            publicLocation: input.publicLocation,
            startsAt,
            coverImageUrl: input.coverImageUrl,
            isPublished: input.isPublished ?? true,
          })
          .returning({ id: events.id, slug: events.slug });

        const event = insertedEvent[0];
        if (!event) {
          throw new AppError("Event creation failed", { code: "EVENT_CREATE_FAILED", status: 500 });
        }

        const encryptedPayload = encryptSecretPayload(
          {
            secretInfo: input.secretInfo,
            secretLocationName: input.secretLocationName,
            secretLatitude: input.secretLatitude,
            secretLongitude: input.secretLongitude,
            secretMapNote: input.secretMapNote,
          },
          { eventId: event.id },
        );

        await tx.insert(eventSecrets).values({
          eventId: event.id,
          codeHash,
          codeHashAlgo: "scrypt",
          encryptedPayload,
          encryptionVersion: 2,
        });

        await tx.insert(auditLogs).values({
          actor: "admin",
          action: "event.create",
          entityType: "event",
          entityId: event.id,
          metadata: {
            slug: event.slug,
            title: input.title,
          },
        });

        return event;
      });
    } catch (error) {
      throwMappedDatabaseError("POST", error);
    }

    return jsonOk(
      {
        id: created.id,
        slug: created.slug,
      },
      201,
    );
  });

export const DELETE: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    requireAdmin(request);

    const input = await parseJsonBody(request, deleteEventSchema);

    try {
      const deleted = await db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: events.id,
            slug: events.slug,
            title: events.title,
          })
          .from(events)
          .where(eq(events.slug, input.slug))
          .limit(1);

        const event = existing[0];
        if (!event) {
          throw new AppError("Event not found", {
            code: "EVENT_NOT_FOUND",
            status: 404,
            expose: true,
          });
        }

        const removedRows = await tx.delete(events).where(eq(events.id, event.id)).returning({
          id: events.id,
          slug: events.slug,
          title: events.title,
        });

        const removed = removedRows[0];
        if (!removed) {
          throw new AppError("Event deletion failed", {
            code: "EVENT_DELETE_FAILED",
            status: 500,
          });
        }

        await tx.insert(auditLogs).values({
          actor: "admin",
          action: "event.delete",
          entityType: "event",
          entityId: removed.id,
          metadata: {
            slug: removed.slug,
            title: removed.title,
          },
        });

        return removed;
      });

      return jsonOk({
        id: deleted.id,
        slug: deleted.slug,
      });
    } catch (error) {
      throwMappedDatabaseError("DELETE", error);
    }
  });
