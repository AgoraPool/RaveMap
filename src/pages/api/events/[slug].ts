import type { APIRoute } from "astro";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";

export const GET: APIRoute = async ({ params }) =>
  withApiErrorHandling(async () => {
    const slug = params.slug?.trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
      throw new AppError("Invalid event slug", {
        code: "INVALID_SLUG",
        status: 400,
        expose: true,
      });
    }

    const event = await getNostrEventRepository().getPublishedEvent(slug);
    if (!event) {
      throw new AppError("Event not found", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    return jsonOk({ event });
  });
