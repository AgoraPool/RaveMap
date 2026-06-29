import type { APIRoute } from "astro";
import { AppError } from "../../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../../lib/server/http";
import { getNostrEventRepository } from "../../../../lib/server/nostr-repository";
import type { NostrEvent } from "../../../../lib/server/nostr-types";
import { enforceCommentRateLimit } from "../../../../lib/server/rate-limit";
import { getClientIp, hashIpAddress } from "../../../../lib/server/request";
import { rsvpSchema } from "../../../../lib/server/schemas";
import { parseJsonBody } from "../../../../lib/server/validation";

function readSlug(value: string | undefined): string {
  const slug = value?.trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
    throw new AppError("Neplatný slug akce", {
      code: "INVALID_SLUG",
      status: 400,
      expose: true,
    });
  }

  return slug;
}

function rateLimitResponse(retryAfterSeconds: number | undefined): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: "RSVP_RATE_LIMITED",
        message: "Příliš mnoho odpovědí. Zkus to později.",
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

export const GET: APIRoute = async ({ params }) =>
  withApiErrorHandling(async () => {
    const slug = readSlug(params.slug);
    const rsvp = await getNostrEventRepository().getRsvpSummary(slug);
    return jsonOk({ rsvp });
  });

export const POST: APIRoute = async ({ params, request }) =>
  withApiErrorHandling(async () => {
    const slug = readSlug(params.slug);
    const input = await parseJsonBody(request, rsvpSchema);
    const rateState = await enforceCommentRateLimit(`rsvp:${slug}`, hashIpAddress(getClientIp(request)));
    if (rateState.blocked) {
      return rateLimitResponse(rateState.retryAfterSeconds);
    }

    const repository = getNostrEventRepository();
    const result = input.signedEvent
      ? await repository.publishSignedRsvp(slug, input.signedEvent as NostrEvent)
      : await repository.createAnonymousRsvp({
          slug,
          status: input.status,
          nickname: input.nickname,
        });
    const rsvp = await repository.getRsvpSummary(slug);

    return jsonOk({ id: result.id, rsvp }, 201);
  });
