import type { APIRoute } from "astro";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";
import { promoZapQuerySchema } from "../../../lib/server/schemas";

export const GET: APIRoute = async ({ url }) =>
  withApiErrorHandling(async () => {
    const input = promoZapQuerySchema.parse({
      targetType: url.searchParams.get("targetType"),
      slug: url.searchParams.get("slug"),
    });
    const promo = await getNostrEventRepository().getPromoZapSummary(input.targetType, input.slug);
    return jsonOk({ promo });
  });
