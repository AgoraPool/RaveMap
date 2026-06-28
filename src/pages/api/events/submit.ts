import type { APIRoute } from "astro";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";
import type { NostrEvent } from "../../../lib/server/nostr-types";
import { enforceCommentRateLimit } from "../../../lib/server/rate-limit";
import { getClientIp, hashIpAddress } from "../../../lib/server/request";
import { publicSubmitEventSchema } from "../../../lib/server/schemas";
import { slugify, randomSlugSuffix } from "../../../lib/server/slug";
import { parseJsonBody } from "../../../lib/server/validation";

async function createUniquePublicSlug(title: string, startsAt: Date): Promise<string> {
  const repository = getNostrEventRepository();
  const base = `${slugify(title)}-${startsAt.toISOString().slice(0, 10)}`;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix(5)}`;
    const exists = await repository.getPublishedEvent(candidate);
    if (!exists) {
      return candidate;
    }
  }

  return `${base}-${randomSlugSuffix(10)}`;
}

function rateLimitResponse(retryAfterSeconds: number | undefined): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: "SUBMIT_RATE_LIMITED",
        message: "Too many submissions. Try again later.",
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds ?? 60),
      },
    },
  );
}

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, publicSubmitEventSchema);
    const startsAt = new Date(input.startsAt);
    const endAt = input.endAt ? new Date(input.endAt) : undefined;
    if (Number.isNaN(startsAt.getTime()) || (endAt && Number.isNaN(endAt.getTime()))) {
      throw new AppError("Event date is invalid", {
        code: "INVALID_EVENT_DATE",
        status: 400,
        expose: true,
      });
    }

    if (endAt && endAt <= startsAt) {
      throw new AppError("End date must be after start date", {
        code: "INVALID_EVENT_RANGE",
        status: 400,
        expose: true,
      });
    }

    const clientIp = getClientIp(request);
    const rateState = await enforceCommentRateLimit("public-submit", hashIpAddress(clientIp));
    if (rateState.blocked) {
      return rateLimitResponse(rateState.retryAfterSeconds);
    }

    const repository = getNostrEventRepository();
    if (input.signedEvent) {
      const result = await repository.publishSignedPublicSubmission({
        title: input.title,
        summary: input.summary,
        publicLocation: input.publicLocation,
        startsAt,
        endAt,
        coverImageUrl: input.coverImageUrl,
        externalUrl: input.externalUrl,
        genres: input.genres,
        lineup: input.lineup,
        tags: input.tags,
        signedEvent: input.signedEvent as NostrEvent,
      });
      return jsonOk({ slug: result.slug, id: result.id }, 201);
    }

    const slug = await createUniquePublicSlug(input.title, startsAt);
    const result = await repository.createPublicSubmission({
      slug,
      title: input.title,
      summary: input.summary,
      publicLocation: input.publicLocation,
      startsAt,
      endAt,
      coverImageUrl: input.coverImageUrl,
      externalUrl: input.externalUrl,
      genres: input.genres,
      lineup: input.lineup,
      tags: input.tags,
      galleryImageUrls: [],
      accessType: "public",
      isPublished: true,
    });

    return jsonOk({ slug, id: result.id }, 201);
  });
