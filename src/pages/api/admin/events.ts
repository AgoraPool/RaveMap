import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { auditLogs, eventSecrets, events } from "../../../db/schema";
import { requireAdmin } from "../../../lib/server/auth";
import { encryptSecretPayload, hashUnlockCode } from "../../../lib/server/crypto";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { createEventSchema } from "../../../lib/server/schemas";
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

    const codeHash = await hashUnlockCode(input.unlockCode);
    const encryptedPayload = encryptSecretPayload({
      secretInfo: input.secretInfo,
      secretLocationName: input.secretLocationName,
      secretLatitude: input.secretLatitude,
      secretLongitude: input.secretLongitude,
      secretMapNote: input.secretMapNote,
    });

    let created;
    try {
      created = await db.transaction(async (tx) => {
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

        await tx.insert(eventSecrets).values({
          eventId: event.id,
          codeHash,
          codeHashAlgo: "scrypt",
          encryptedPayload,
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
      if (import.meta.env.DEV) {
        console.error("POST /api/admin/events failed", error);
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

    return jsonOk(
      {
        id: created.id,
        slug: created.slug,
      },
      201,
    );
  });
