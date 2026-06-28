import type { APIRoute } from "astro";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";

export const GET: APIRoute = async () =>
  withApiErrorHandling(async () => {
    const events = await getNostrEventRepository().listPublishedEvents();
    return jsonOk({ events });
  });
