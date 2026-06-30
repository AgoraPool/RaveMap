import assert from "node:assert/strict";
import test from "node:test";
import { eventProvenance, eventProvenanceLabel } from "../src/lib/provenance.ts";
import { AppError } from "../src/lib/server/errors.ts";
import { assertPublicSubmitAllowed } from "../src/lib/server/public-submit.ts";
import { publicSubmitEventSchema } from "../src/lib/server/schemas.ts";
import type { PublicEventDto } from "../src/lib/server/nostr-types.ts";
import { parsePublicEventsApiLimit, parsePublicEventsApiView, selectPublicEventsForApi } from "../src/pages/api/events/index.ts";

function publicSubmit(overrides: Record<string, unknown> = {}) {
  return publicSubmitEventSchema.parse({
    title: "Community Night",
    summary: "A public community-submitted event for the open map.",
    publicLocation: "Praha",
    startsAt: "2026-04-18T19:00:00.000Z",
    genres: ["tekno"],
    lineup: [],
    tags: [],
    accessType: "public",
    ...overrides,
  });
}

function event(overrides: Partial<PublicEventDto>): PublicEventDto {
  return {
    id: "event-id",
    authorPubkey: "pubkey",
    slug: "community-night-2026-04-18",
    title: "Community Night",
    summary: "A public event.",
    publicLocation: "Praha",
    startsAt: new Date("2026-04-18T19:00:00.000Z"),
    genres: [],
    lineup: [],
    tags: [],
    galleryImageUrls: [],
    accessType: "public",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("anonymous public submit allows public events", () => {
  assert.doesNotThrow(() => assertPublicSubmitAllowed(publicSubmit()));
});

test("anonymous public submit rejects gated events", () => {
  assert.throws(
    () =>
      assertPublicSubmitAllowed(
        publicSubmit({
          accessType: "gated",
          unlockCode: "strong-code",
          secretInfo: "Use the side gate.",
          secretLocationName: "Secret yard",
          secretLatitude: 50.1,
          secretLongitude: 14.4,
        }),
      ),
    (error) => error instanceof AppError && error.code === "PUBLIC_SUBMIT_PUBLIC_ONLY",
  );
});

test("anonymous public submit rejects secret fields even when access is public", () => {
  assert.throws(
    () => assertPublicSubmitAllowed(publicSubmit({ secretInfo: "Do not publish this location." })),
    (error) => error instanceof AppError && error.code === "PUBLIC_SUBMIT_SECRET_FIELDS",
  );
});

test("anonymous public submit rejects honeypot submissions", () => {
  assert.throws(
    () => assertPublicSubmitAllowed(publicSubmit({ website: "https://spam.example" })),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR",
  );
});

test("signed public submit payload remains allowed", () => {
  const signedEvent = {
    id: "0".repeat(64),
    pubkey: "1".repeat(64),
    created_at: 1_776_531_600,
    kind: 31923,
    tags: [
      ["d", "community-night-2026-04-18"],
      ["title", "Community Night"],
      ["summary", "A public community-submitted event for the open map."],
      ["location", "Praha"],
      ["start", "1776531600"],
      ["access", "public"],
      ["client", "RaveMap"],
      ["submission", "public"],
      ["t", "ravemap"],
    ],
    content: "A public community-submitted event for the open map.",
    sig: "2".repeat(128),
  };

  assert.doesNotThrow(() => assertPublicSubmitAllowed(publicSubmit({ signedEvent })));
});

test("event provenance labels crew, community, import, and admin events", () => {
  const cases = [
    [event({ origin: "studio", crewSlug: "acid-crew" }), "crew", "Crew"],
    [event({ origin: "public" }), "community", "Komunita"],
    [event({ tags: ["ravemap"] }), "community", "Komunita"],
    [event({ origin: "import", source: { name: "Calendar", url: "https://example.com" } }), "import", "Import"],
    [event({ origin: "admin" }), "admin", "Admin"],
  ] as const;

  for (const [input, provenance, label] of cases) {
    assert.equal(eventProvenance(input), provenance);
    assert.equal(eventProvenanceLabel(provenance), label);
  }
});

test("public events API helpers keep default shape inputs and enforce limit", () => {
  assert.equal(parsePublicEventsApiLimit(null), undefined);
  assert.equal(parsePublicEventsApiLimit("12"), 12);
  assert.equal(parsePublicEventsApiView(null), "all");
  assert.equal(parsePublicEventsApiView("upcoming"), "upcoming");
  assert.throws(() => parsePublicEventsApiLimit("0"), (error) => error instanceof AppError && error.code === "VALIDATION_ERROR");
  assert.throws(() => parsePublicEventsApiLimit("201"), (error) => error instanceof AppError && error.code === "VALIDATION_ERROR");
  assert.throws(() => parsePublicEventsApiView("private"), (error) => error instanceof AppError && error.code === "VALIDATION_ERROR");
});

test("public events API view filters upcoming and map events", () => {
  const now = Date.parse("2026-01-10T00:00:00.000Z");
  const past = event({
    slug: "past",
    startsAt: new Date("2026-01-01T20:00:00.000Z"),
    publicLocation: "Praha",
    publicLatitude: 50.08,
    publicLongitude: 14.42,
  });
  const upcomingCityOnly = event({
    slug: "city-only",
    startsAt: new Date("2026-01-12T20:00:00.000Z"),
    publicLocation: "Praha",
    publicLatitude: 50.08,
    publicLongitude: 14.42,
  });
  const upcomingPrecise = event({
    slug: "precise",
    startsAt: new Date("2026-01-13T20:00:00.000Z"),
    publicLocation: "Praha, Ankali",
    publicLatitude: 50.08,
    publicLongitude: 14.42,
  });

  assert.deepEqual(
    selectPublicEventsForApi([past, upcomingCityOnly, upcomingPrecise], "all", now).map((item) => item.slug),
    ["past", "city-only", "precise"],
  );
  assert.deepEqual(
    selectPublicEventsForApi([past, upcomingCityOnly, upcomingPrecise], "upcoming", now).map((item) => item.slug),
    ["city-only", "precise"],
  );
  assert.deepEqual(
    selectPublicEventsForApi([past, upcomingCityOnly, upcomingPrecise], "map", now).map((item) => item.slug),
    ["precise"],
  );
});
