import type { APIRoute } from "astro";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";

export const GET: APIRoute = async ({ params }) =>
  withApiErrorHandling(async () => {
    const slug = params.slug?.trim().toLowerCase() ?? "";
    const repository = getNostrEventRepository();
    const crew = await repository.getCrewProfile(slug);
    if (!crew) {
      throw new AppError("Crew nenalezena", {
        code: "CREW_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const events = (await repository.listPublishedEvents()).filter((event) => event.crewSlug === crew.slug);
    return jsonOk({ crew, events });
  });
