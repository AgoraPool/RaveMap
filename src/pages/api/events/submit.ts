import type { APIRoute } from "astro";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";
import type { NostrEvent } from "../../../lib/server/nostr-types";
import { enforceRequestRateLimit } from "../../../lib/server/api-security";
import { publicSubmitEventSchema } from "../../../lib/server/schemas";
import { slugify, randomSlugSuffix } from "../../../lib/server/slug";
import { parseJsonBody } from "../../../lib/server/validation";

async function createUniquePublicSlug(title: string, startsAt: Date): Promise<string> {
  const repository = getNostrEventRepository();
  const base = `${slugify(title)}-${startsAt.toISOString().slice(0, 10)}`;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix(5)}`;
    const exists = await repository.slugExists(candidate);
    if (!exists) {
      return candidate;
    }
  }

  return `${base}-${randomSlugSuffix(10)}`;
}

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await enforceRequestRateLimit(request, "public-submit", {
      limit: 3,
      windowMs: 30 * 60 * 1000,
      code: "SUBMIT_RATE_LIMITED",
      message: "Příliš mnoho odeslání. Zkus to později.",
    });
    if (limited) return limited;

    const input = await parseJsonBody(request, publicSubmitEventSchema);
    const startsAt = new Date(input.startsAt);
    const endAt = input.endAt ? new Date(input.endAt) : undefined;
    if (Number.isNaN(startsAt.getTime()) || (endAt && Number.isNaN(endAt.getTime()))) {
      throw new AppError("Datum akce není platné", {
        code: "INVALID_EVENT_DATE",
        status: 400,
        expose: true,
      });
    }

    if (endAt && endAt <= startsAt) {
      throw new AppError("Konec akce musí být po začátku", {
        code: "INVALID_EVENT_RANGE",
        status: 400,
        expose: true,
      });
    }

    const repository = getNostrEventRepository();
    const accessType = input.accessType ?? "public";
    if (input.signedEvent) {
      const result = await repository.publishSignedPublicSubmission({
        title: input.title,
        summary: input.summary,
        publicLocation: input.publicLocation,
        publicLatitude: input.publicLatitude,
        publicLongitude: input.publicLongitude,
        startsAt,
        endAt,
        coverImageUrl: input.coverImageUrl,
        externalUrl: input.externalUrl,
        simplexUrl: input.simplexUrl,
        genres: input.genres,
        lineup: input.lineup,
        tags: input.tags,
        accessType,
        unlockCode: input.unlockCode,
        secretInfo: input.secretInfo,
        secretLocationName: input.secretLocationName,
        secretLatitude: input.secretLatitude,
        secretLongitude: input.secretLongitude,
        secretMapNote: input.secretMapNote,
        signedEvent: input.signedEvent as NostrEvent,
      });
      return jsonOk({ slug: result.slug, id: result.id }, 201);
    }

    const slug = await createUniquePublicSlug(input.title, startsAt);
    const command = {
      slug,
      title: input.title,
      summary: input.summary,
      publicLocation: input.publicLocation,
      publicLatitude: input.publicLatitude,
      publicLongitude: input.publicLongitude,
      startsAt,
      endAt,
      coverImageUrl: input.coverImageUrl,
      externalUrl: input.externalUrl,
      simplexUrl: input.simplexUrl,
      genres: input.genres,
      lineup: input.lineup,
      tags: input.tags,
      galleryImageUrls: [],
      accessType,
      isPublished: true,
      unlockCode: input.unlockCode,
      secretInfo: input.secretInfo,
      secretLocationName: input.secretLocationName,
      secretLatitude: input.secretLatitude,
      secretLongitude: input.secretLongitude,
      secretMapNote: input.secretMapNote,
    };
    const result = accessType === "gated" ? await repository.createEvent(command) : await repository.createPublicSubmission(command);

    return jsonOk({ slug, id: result.id }, 201);
  });
