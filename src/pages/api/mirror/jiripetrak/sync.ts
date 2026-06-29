import type { APIRoute } from "astro";
import { timingSafeEqual, createHash } from "node:crypto";
import { enforceRequestRateLimit } from "../../../../lib/server/api-security";
import { AppError } from "../../../../lib/server/errors";
import { getEnv } from "../../../../lib/server/env";
import { syncJiriPetrakEvents } from "../../../../lib/server/importers/jiripetrak";
import { jsonOk, withApiErrorHandling } from "../../../../lib/server/http";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf-8").digest();
}

function requireMirrorSecret(request: Request): void {
  const env = getEnv();
  if (!env.MIRROR_SYNC_SECRET) {
    throw new AppError("Tajný kód pro synchronizaci mirroru není nastavený", {
      code: "MIRROR_SYNC_NOT_CONFIGURED",
      status: 503,
      expose: true,
    });
  }

  const provided = request.headers.get("x-mirror-sync-secret")?.trim();
  if (!provided || !timingSafeEqual(digest(provided), digest(env.MIRROR_SYNC_SECRET))) {
    throw new AppError("Přihlašovací údaje pro synchronizaci mirroru nejsou platné", {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }
}

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await enforceRequestRateLimit(request, "mirror-sync", {
      limit: 5,
      windowMs: 15 * 60 * 1000,
      code: "MIRROR_SYNC_RATE_LIMITED",
      message: "Příliš mnoho požadavků na synchronizaci mirroru. Zkus to později.",
    });
    if (limited) return limited;

    requireMirrorSecret(request);
    return jsonOk(await syncJiriPetrakEvents());
  });
