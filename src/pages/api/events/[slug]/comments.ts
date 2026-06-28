import type { APIRoute } from "astro";
import { AppError } from "../../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../../lib/server/http";
import { getNostrEventRepository } from "../../../../lib/server/nostr-repository";
import { enforceCommentRateLimit } from "../../../../lib/server/rate-limit";
import { getClientIp, hashIpAddress } from "../../../../lib/server/request";
import { createCommentSchema } from "../../../../lib/server/schemas";
import { parseJsonBody } from "../../../../lib/server/validation";
import type { NostrEvent } from "../../../../lib/server/nostr-types";

function readSlug(value: string | undefined): string {
  const slug = value?.trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
    throw new AppError("Invalid event slug", {
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
        code: "COMMENT_RATE_LIMITED",
        message: "Too many comments. Try again later.",
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
    const comments = await getNostrEventRepository().listComments(slug);
    return jsonOk({ comments });
  });

export const POST: APIRoute = async ({ params, request }) =>
  withApiErrorHandling(async () => {
    const slug = readSlug(params.slug);
    const input = await parseJsonBody(request, createCommentSchema);
    const clientIp = getClientIp(request);
    const ipHash = hashIpAddress(clientIp);
    const rateState = await enforceCommentRateLimit(slug, ipHash);
    if (rateState.blocked) {
      return rateLimitResponse(rateState.retryAfterSeconds);
    }

    const repository = getNostrEventRepository();
    const result = input.signedEvent
      ? await repository.publishSignedComment(slug, input.signedEvent as NostrEvent)
      : await repository.createAnonymousComment({
          slug,
          content: input.content,
          nickname: input.nickname,
        });
    const comments = await repository.listComments(slug);

    return jsonOk({ id: result.id, comments }, 201);
  });
