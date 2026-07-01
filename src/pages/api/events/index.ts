import type { APIRoute } from "astro";
import { hasPrecisePublicLocation } from "../../../lib/location";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";
import { getNostrEventRepository } from "../../../lib/server/nostr-repository";
import type { EventRsvpSummaryDto, PublicEventDto } from "../../../lib/server/nostr-types";

type PublicEventsApiView = "all" | "upcoming" | "map";

export function parsePublicEventsApiLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AppError("Neplatný limit akcí", {
      code: "VALIDATION_ERROR",
      status: 400,
      expose: true,
    });
  }
  return limit;
}

export function parsePublicEventsApiView(value: string | null): PublicEventsApiView {
  const view = value ?? "all";
  if (view !== "all" && view !== "upcoming" && view !== "map") {
    throw new AppError("Neplatný pohled akcí", {
      code: "VALIDATION_ERROR",
      status: 400,
      expose: true,
    });
  }
  return view;
}

export function selectPublicEventsForApi(events: PublicEventDto[], view: PublicEventsApiView, now = Date.now()): PublicEventDto[] {
  if (view === "all") {
    return events;
  }
  const upcoming = events.filter((event) => (event.endAt ?? event.startsAt).getTime() >= now);
  if (view === "upcoming") {
    return upcoming;
  }
  return upcoming.filter(hasPrecisePublicLocation);
}

export const GET: APIRoute = async ({ url }) =>
  withApiErrorHandling(async () => {
    const limit = parsePublicEventsApiLimit(url.searchParams.get("limit"));
    const view = parsePublicEventsApiView(url.searchParams.get("view"));
    const repository = getNostrEventRepository();
    const events = selectPublicEventsForApi(await repository.listPublishedEvents(limit), view);
    const rsvpBySlug: Record<string, EventRsvpSummaryDto> = await repository.getRsvpSummariesForEvents(events).catch(() => ({}));

    return jsonOk({
      events: events.map((event) => ({
        ...event,
        rsvp: rsvpBySlug[event.slug] ?? { accepted: 0, tentative: 0, signals: 0 },
      })),
    });
  });
