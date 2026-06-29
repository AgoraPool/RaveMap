import type { APIRoute } from "astro";
import { enforceRequestRateLimit } from "../../../lib/server/api-security";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";
import { promoInvoiceSchema } from "../../../lib/server/schemas";
import { parseJsonBody } from "../../../lib/server/validation";

export const POST: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    const limited = await enforceRequestRateLimit(request, "promo-invoice", {
      limit: 5,
      windowMs: 10 * 60 * 1000,
      code: "PROMO_INVOICE_RATE_LIMITED",
      message: "Příliš mnoho požadavků na promo fakturu. Zkus to později.",
    });
    if (limited) return limited;

    const input = await parseJsonBody(request, promoInvoiceSchema);
    const invoice = await getNostrEventRepository().createPromoInvoice(input);
    return jsonOk(invoice, 201);
  });
