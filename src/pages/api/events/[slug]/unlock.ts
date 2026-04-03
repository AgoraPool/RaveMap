import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import { eventSecrets, events } from "../../../../db/schema";
import { decryptSecretPayload, verifyUnlockCode } from "../../../../lib/server/crypto";
import { AppError } from "../../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../../lib/server/http";
import { getClientIp, hashIpAddress } from "../../../../lib/server/request";
import { clearUnlockFailures, enforceUnlockRateLimit, recordUnlockFailure } from "../../../../lib/server/rate-limit";
import { parseJsonBody } from "../../../../lib/server/validation";
import { z } from "zod";

const unlockSchema = z.object({
  unlockCode: z.string().trim().min(1).max(128),
});

export const POST: APIRoute = async ({ params, request }) =>
  withApiErrorHandling(async () => {
    const slug = params.slug?.trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
      throw new AppError("Invalid event slug", {
        code: "INVALID_SLUG",
        status: 400,
        expose: true,
      });
    }

    const { unlockCode } = await parseJsonBody(request, unlockSchema);

    const clientIp = getClientIp(request);
    const ipHash = hashIpAddress(clientIp);

    const rateState = await enforceUnlockRateLimit(slug, ipHash);
    if (rateState.blocked) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "TOO_MANY_ATTEMPTS",
            message: "Too many failed unlock attempts. Try again later.",
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": String(rateState.retryAfterSeconds ?? 60),
          },
        },
      );
    }

    const rows = await db
      .select({
        eventId: events.id,
        codeHash: eventSecrets.codeHash,
        encryptedPayload: eventSecrets.encryptedPayload,
      })
      .from(eventSecrets)
      .innerJoin(events, eq(eventSecrets.eventId, events.id))
      .where(and(eq(events.slug, slug), eq(events.isPublished, true)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new AppError("Event not found", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const isValidCode = await verifyUnlockCode(unlockCode, row.codeHash);
    if (!isValidCode) {
      await recordUnlockFailure(slug, ipHash);
      throw new AppError("Unlock code is invalid", {
        code: "INVALID_UNLOCK_CODE",
        status: 401,
        expose: true,
      });
    }

    await clearUnlockFailures(slug, ipHash);

    const secret = decryptSecretPayload(row.encryptedPayload, { eventId: row.eventId });

    return jsonOk({
      secretInfo: secret.secretInfo,
      secretLocationName: secret.secretLocationName,
      secretLatitude: secret.secretLatitude,
      secretLongitude: secret.secretLongitude,
      secretMapNote: secret.secretMapNote,
    });
  });
