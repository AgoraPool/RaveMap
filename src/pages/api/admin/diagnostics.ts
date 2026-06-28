import type { APIRoute } from "astro";
import { requireAdmin } from "../../../lib/server/auth";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";

export const GET: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    requireAdmin(request);

    return jsonOk(await getNostrEventRepository().diagnostics());
  });
