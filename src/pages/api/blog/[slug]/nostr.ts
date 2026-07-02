import type { APIRoute } from "astro";
import { enforceRequestRateLimit, requireAdminOrRateLimited } from "../../../../lib/server/api-security";
import { getBlogPostNip23Command } from "../../../../lib/server/blog-nostr";
import { AppError } from "../../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../../lib/server/http";
import { getNostrEventRepository } from "../../../../lib/server/nostr-repository";
import type { NostrEvent } from "../../../../lib/server/nostr-types";
import { blogNostrPublishSchema } from "../../../../lib/server/schemas";
import { parseJsonBody } from "../../../../lib/server/validation";

export const GET: APIRoute = async ({ params, request }) =>
  withApiErrorHandling(async () => {
    const command = await getBlogPostNip23Command(params.slug, request.url);
    const repository = getNostrEventRepository();
    return jsonOk({
      event: repository.blogPostUnsignedEvent(command),
      relays: repository.getRelays(),
      publisherPubkey: repository.getPublisherPubkey(),
    });
  });

export const POST: APIRoute = async ({ params, request }) =>
  withApiErrorHandling(async () => {
    const command = await getBlogPostNip23Command(params.slug, request.url);
    const input = await parseJsonBody(request, blogNostrPublishSchema);
    const repository = getNostrEventRepository();

    if (input.signedEvent) {
      const limited = await enforceRequestRateLimit(request, "blog-nostr-signed", {
        limit: 8,
        windowMs: 30 * 60 * 1000,
        code: "BLOG_NOSTR_RATE_LIMITED",
        message: "Příliš mnoho pokusů o publikování textu. Zkus to později.",
        keySuffix: command.slug,
      });
      if (limited) return limited;

      const result = await repository.publishSignedBlogPost(command, input.signedEvent as NostrEvent);
      return jsonOk({ id: result.id, slug: result.slug, relays: repository.getRelays() }, 201);
    }

    if (input.mode !== "app") {
      throw new AppError("Chybí způsob publikování", {
        code: "BLOG_NOSTR_MODE_MISSING",
        status: 400,
        expose: true,
      });
    }

    const limited = await requireAdminOrRateLimited(request);
    if (limited) return limited;

    const result = await repository.publishBlogPost(command);
    return jsonOk({ id: result.id, slug: result.slug, relays: repository.getRelays(), publisherPubkey: repository.getPublisherPubkey() }, 201);
  });
