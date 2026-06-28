import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../../lib/server/auth";
import { fetchJiriPetrakEvents } from "../../../../../lib/server/importers/jiripetrak";
import { jsonOk, withApiErrorHandling } from "../../../../../lib/server/http";
import { getNostrEventRepository } from "../../../../../lib/server/nostr-repository";

function sourceEventIdFromUrl(value: string): string | undefined {
  return value.match(/-(\d+)\/?$/)?.[1];
}

export const GET: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    requireAdmin(request);

    const existingEvents = await getNostrEventRepository().listAdminEvents();
    const knownSourceIds = new Set(
      existingEvents
        .map((event) => event.source?.id ?? (event.source?.url ? sourceEventIdFromUrl(event.source.url) : undefined))
        .filter((id): id is string => Boolean(id)),
    );
    const events = await fetchJiriPetrakEvents({ knownSourceIds });
    return jsonOk({
      source: "jiripetrak",
      events: events.map((event) => ({
        ...event,
        startsAt: event.startsAt.toISOString(),
        endAt: event.endAt?.toISOString(),
        sourceUpdatedAt: event.sourceUpdatedAt?.toISOString() ?? null,
        sourcePublicationAt: event.sourcePublicationAt?.toISOString() ?? null,
      })),
    });
  });
