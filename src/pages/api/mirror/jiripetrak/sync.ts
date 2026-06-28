import type { APIRoute } from "astro";
import { timingSafeEqual, createHash } from "node:crypto";
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
    throw new AppError("Mirror sync secret is not configured", {
      code: "MIRROR_SYNC_NOT_CONFIGURED",
      status: 503,
      expose: true,
    });
  }

  const provided = request.headers.get("x-mirror-sync-secret")?.trim();
  if (!provided || !timingSafeEqual(digest(provided), digest(env.MIRROR_SYNC_SECRET))) {
    throw new AppError("Mirror sync credentials invalid", {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }
}

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    requireMirrorSecret(request);
    return jsonOk(await syncJiriPetrakEvents());
  });
