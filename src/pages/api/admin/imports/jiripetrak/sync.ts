import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../../lib/server/auth";
import { syncJiriPetrakEvents } from "../../../../../lib/server/importers/jiripetrak";
import { jsonOk, withApiErrorHandling } from "../../../../../lib/server/http";

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    requireAdmin(request);

    return jsonOk(await syncJiriPetrakEvents());
  });
