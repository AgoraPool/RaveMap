import type { APIRoute } from "astro";
import { requireAdminOrRateLimited } from "../../../lib/server/api-security";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";
import { createEventSchema, deleteEventSchema, eventActionSchema } from "../../../lib/server/schemas";
import { randomSlugSuffix, slugify } from "../../../lib/server/slug";
import { parseJsonBody } from "../../../lib/server/validation";

async function createUniqueSlug(base: string): Promise<string> {
  const repository = getNostrEventRepository();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix(6)}`;
    const exists = await repository.slugExists(candidate);

    if (!exists) {
      return candidate;
    }
  }

  throw new AppError("Nepodařilo se vytvořit unikátní slug", {
    code: "SLUG_COLLISION",
    status: 409,
    expose: true,
  });
}

export const GET: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;

    const events = await getNostrEventRepository().listAdminEvents();
    return jsonOk({ events });
  });

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;

    const input = await parseJsonBody(request, createEventSchema);
    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new AppError("Začátek akce není platný", {
        code: "INVALID_START_DATE",
        status: 400,
        expose: true,
      });
    }

    const endAt = input.endAt ? new Date(input.endAt) : undefined;
    if (endAt && Number.isNaN(endAt.getTime())) {
      throw new AppError("Konec akce není platný", {
        code: "INVALID_END_DATE",
        status: 400,
        expose: true,
      });
    }

    const slug = input.slug ?? (await createUniqueSlug(`${slugify(input.title)}-${startsAt.toISOString().slice(0, 10)}`));
    const accessType = input.accessType ?? (input.unlockCode ? "gated" : "public");
    const created = await getNostrEventRepository().createEvent({
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
      source: input.sourceUrl
        ? {
            name: input.sourceName || "Import",
            url: input.sourceUrl,
          }
        : undefined,
      genres: input.genres,
      lineup: input.lineup,
      tags: input.tags,
      galleryImageUrls: input.galleryImageUrls.filter((url): url is string => Boolean(url)),
      accessType,
      isPublished: input.isPublished ?? true,
      unlockCode: input.unlockCode,
      secretInfo: input.secretInfo,
      secretLocationName: input.secretLocationName,
      secretLatitude: input.secretLatitude,
      secretLongitude: input.secretLongitude,
      secretMapNote: input.secretMapNote,
    });

    return jsonOk(
      {
        id: created.id,
        slug: created.slug,
      },
      201,
    );
  });

export const PATCH: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;

    const input = await parseJsonBody(request, eventActionSchema);
    if (input.action !== "publish") {
      throw new AppError("Nepodporovaná akce", {
        code: "UNSUPPORTED_ACTION",
        status: 400,
        expose: true,
      });
    }

    const published = await getNostrEventRepository().publishDraft(input.slug);
    return jsonOk({
      id: published.id,
      slug: published.slug,
    });
  });

export const DELETE: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;

    const input = await parseJsonBody(request, deleteEventSchema);
    const deleted = await getNostrEventRepository().deleteEvent(input.slug);

    return jsonOk({
      id: deleted.id,
      slug: deleted.slug,
    });
  });
