import type { APIRoute } from "astro";
import { z } from "zod";
import { verifyUnlockCode } from "../../../../lib/server/crypto";
import { AppError } from "../../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../../lib/server/http";
import { getNostrEventRepository } from "../../../../lib/server/nostr-repository";
import { getClientIp, hashIpAddress } from "../../../../lib/server/request";
import { clearUnlockFailures, enforceUnlockRateLimit, recordUnlockFailure } from "../../../../lib/server/rate-limit";
import { parseJsonBody } from "../../../../lib/server/validation";

const unlockSchema = z.object({
  unlockCode: z.string().trim().min(1).max(128),
});

export const POST: APIRoute = async ({ params, request }) =>
  withApiErrorHandling(async () => {
    const slug = params.slug?.trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
      throw new AppError("Neplatný slug akce", {
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
            message: "Příliš mnoho neúspěšných pokusů. Zkus to později.",
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

    const event = await getNostrEventRepository().getPublishedEvent(slug);
    const secretBundle = event ? await getNostrEventRepository().getSecretBundle(slug) : null;
    if (!event || !secretBundle) {
      throw new AppError("Akce nenalezena", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const isValidCode = await verifyUnlockCode(unlockCode, secretBundle.codeHash);
    if (!isValidCode) {
      await recordUnlockFailure(slug, ipHash);
      throw new AppError("Kód k odemknutí není platný", {
        code: "INVALID_UNLOCK_CODE",
        status: 401,
        expose: true,
      });
    }

    await clearUnlockFailures(slug, ipHash);

    return jsonOk({
      secretInfo: secretBundle.secret.secretInfo,
      secretLocationName: secretBundle.secret.secretLocationName,
      secretLatitude: secretBundle.secret.secretLatitude,
      secretLongitude: secretBundle.secret.secretLongitude,
      secretMapNote: secretBundle.secret.secretMapNote,
    });
  });
