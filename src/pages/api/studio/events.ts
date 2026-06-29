import type { APIRoute } from "astro";
import { recordAuthFailureRateLimit } from "../../../lib/server/api-security";
import { readCrewCredentials } from "../../../lib/server/auth";
import { AppError, isAppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";
import type { CrewSessionDto } from "../../../lib/server/nostr-types";
import { studioEventActionSchema, studioEventSchema } from "../../../lib/server/schemas";
import { randomSlugSuffix, slugify } from "../../../lib/server/slug";
import { parseJsonBody } from "../../../lib/server/validation";

async function createUniqueStudioSlug(title: string, startsAt: Date): Promise<string> {
  const repository = getNostrEventRepository();
  const base = `${slugify(title)}-${startsAt.toISOString().slice(0, 10)}`;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix(6)}`;
    if (!(await repository.slugExists(candidate))) {
      return candidate;
    }
  }

  return `${base}-${randomSlugSuffix(10)}`;
}

function readDateRange(startsAtRaw: string, endAtRaw: string | undefined): { startsAt: Date; endAt?: Date } {
  const startsAt = new Date(startsAtRaw);
  const endAt = endAtRaw ? new Date(endAtRaw) : undefined;
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

  return { startsAt, endAt };
}

async function authenticateCrewForRequest(request: Request): Promise<CrewSessionDto | Response> {
  try {
    const credentials = readCrewCredentials(request);
    return await getNostrEventRepository().authenticateCrew(credentials.slug, credentials.secret);
  } catch (error) {
    if (isAppError(error) && error.status === 401) {
      const limited = await recordAuthFailureRateLimit(request, "crew-auth", {
        code: "CREW_AUTH_RATE_LIMITED",
        message: "Příliš mnoho neúspěšných pokusů o crew přístup. Zkus to později.",
      });
      if (limited) return limited;
    }
    throw error;
  }
}

function isResponse(value: CrewSessionDto | Response): value is Response {
  return value instanceof Response;
}

export const GET: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const crew = await authenticateCrewForRequest(request);
    if (isResponse(crew)) return crew;
    const repository = getNostrEventRepository();
    const events = await repository.listStudioEvents(crew.slug);
    return jsonOk({ crew, events });
  });

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const crew = await authenticateCrewForRequest(request);
    if (isResponse(crew)) return crew;
    const repository = getNostrEventRepository();
    const input = await parseJsonBody(request, studioEventSchema);
    const { startsAt, endAt } = readDateRange(input.startsAt, input.endAt);
    const slug = input.slug ?? (await createUniqueStudioSlug(input.title, startsAt));

    const created = await repository.createStudioEvent({
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
      accessType: input.accessType,
      isPublished: input.isPublished,
      origin: "studio",
      unlockCode: input.accessType === "gated" ? input.unlockCode : undefined,
      secretInfo: input.accessType === "gated" ? input.secretInfo : undefined,
      secretLocationName: input.accessType === "gated" ? input.secretLocationName : undefined,
      secretLatitude: input.accessType === "gated" ? input.secretLatitude : undefined,
      secretLongitude: input.accessType === "gated" ? input.secretLongitude : undefined,
      secretMapNote: input.accessType === "gated" ? input.secretMapNote : undefined,
    }, crew.slug);

    return jsonOk({ id: created.id, slug: created.slug }, 201);
  });

export const PATCH: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const crew = await authenticateCrewForRequest(request);
    if (isResponse(crew)) return crew;
    const repository = getNostrEventRepository();
    const input = await parseJsonBody(request, studioEventActionSchema);

    if (input.action === "publish") {
      const published = await repository.publishStudioDraft(input.slug, crew.slug);
      return jsonOk({ id: published.id, slug: published.slug });
    }

    const archived = await repository.archiveStudioEvent(input.slug, crew.slug);
    return jsonOk({ id: archived.id, slug: archived.slug });
  });
