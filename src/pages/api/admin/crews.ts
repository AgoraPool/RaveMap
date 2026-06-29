import type { APIRoute } from "astro";
import { requireAdminOrRateLimited } from "../../../lib/server/api-security";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";
import { adminCrewSchema } from "../../../lib/server/schemas";
import { parseJsonBody } from "../../../lib/server/validation";

export const GET: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;
    const crews = await getNostrEventRepository().listCrewProfiles({ includeArchived: true });
    return jsonOk({ crews });
  });

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;
    const input = await parseJsonBody(request, adminCrewSchema);
    const repository = getNostrEventRepository();

    if (input.action === "rotate-code") {
      const updated = await repository.rotateCrewCode(input.slug, input.crewCode as string);
      return jsonOk({ slug: updated.slug });
    }

    if (input.action === "archive") {
      const archived = await repository.archiveCrew(input.slug);
      return jsonOk({ id: archived.id, slug: archived.slug });
    }

    if (input.action === "assign-event") {
      const assigned = await repository.assignStudioEventToCrew(input.eventSlug as string, input.slug);
      return jsonOk({ id: assigned.id, slug: assigned.slug });
    }

    const upserted = await repository.upsertCrewProfile({
      slug: input.slug,
      name: input.name,
      summary: input.summary,
      avatarUrl: input.avatarUrl,
      bannerUrl: input.bannerUrl,
      simplexUrl: input.simplexUrl,
      websiteUrl: input.websiteUrl,
      lightningAddress: input.lightningAddress,
      crewCode: input.crewCode,
    });
    return jsonOk({ id: upserted.id, slug: upserted.slug }, 201);
  });

export const PATCH = POST;
