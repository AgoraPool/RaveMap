import type { APIRoute } from "astro";
import { requireAdminOrRateLimited } from "../../../../../lib/server/api-security";
import { syncJiriPetrakEvents } from "../../../../../lib/server/importers/jiripetrak";
import { jsonOk, withApiErrorHandling } from "../../../../../lib/server/http";

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;

    return jsonOk(await syncJiriPetrakEvents());
  });
