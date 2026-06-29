import type { APIRoute } from "astro";
import { requireAdminOrRateLimited } from "../../../lib/server/api-security";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";

export const GET: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;

    return jsonOk(await getNostrEventRepository().diagnostics());
  });
