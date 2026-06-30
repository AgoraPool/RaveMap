import assert from "node:assert/strict";
import test from "node:test";
import { readCrewCredentials } from "../src/lib/server/auth.ts";
import { AppError } from "../src/lib/server/errors.ts";
import { NostrEventRepository } from "../src/lib/server/nostr-repository.ts";
import type { AdminEventDto, CreateEventCommand } from "../src/lib/server/nostr-types.ts";

function fakeRepository(overrides: Record<string, unknown>) {
  return Object.assign(Object.create(NostrEventRepository.prototype), overrides) as NostrEventRepository;
}

function studioCommand(overrides: Partial<CreateEventCommand> = {}): CreateEventCommand {
  return {
    slug: "studio-night-2026-03-14",
    title: "Studio Night",
    summary: "Public info for a studio-created event.",
    publicLocation: "Brno",
    startsAt: new Date("2026-03-14T19:00:00.000Z"),
    genres: [],
    lineup: [],
    tags: [],
    galleryImageUrls: [],
    accessType: "public",
    isPublished: false,
    origin: "studio",
    ...overrides,
  };
}

test("crew auth failures use generic unauthorized errors", () => {
  assert.throws(() => readCrewCredentials(new Request("https://example.com/api/studio/events")), {
    name: "AppError",
    message: "Crew přihlašovací údaje nejsou platné",
  });

  assert.throws(
    () =>
      readCrewCredentials(
        new Request("https://example.com/api/studio/events", {
          headers: {
            "x-crew-slug": "Bad Slug",
            "x-crew-secret": "safe-enough-secret-code",
          },
        }),
      ),
    {
      name: "AppError",
      message: "Crew přihlašovací údaje nejsou platné",
    },
  );
});

test("new crew without crew code is rejected before writing", async () => {
  const repository = fakeRepository({
    getCrewProfile: async () => null,
  });

  await assert.rejects(
    () => repository.upsertCrewProfile({ slug: "first-crew" }),
    (error) => error instanceof AppError && error.code === "CREW_CODE_REQUIRED",
  );
});

test("studio event listing is scoped to the authenticated crew", async () => {
  const events = [
    { slug: "own", origin: "studio", crewSlug: "acid-crew" },
    { slug: "other", origin: "studio", crewSlug: "other-crew" },
    { slug: "admin", origin: "admin", crewSlug: "acid-crew" },
  ] as AdminEventDto[];
  const repository = fakeRepository({
    listAdminEvents: async () => events,
  });

  assert.deepEqual(
    (await repository.listStudioEvents("acid-crew")).map((event) => event.slug),
    ["own"],
  );
});

test("crew cannot replace another crew studio event", async () => {
  const repository = fakeRepository({
    listAdminEvents: async () => [{ slug: "studio-night-2026-03-14", origin: "studio", crewSlug: "other-crew" }],
  });

  await assert.rejects(
    () => repository.createStudioEvent(studioCommand(), "acid-crew"),
    (error) => error instanceof AppError && error.code === "STUDIO_EVENT_FORBIDDEN",
  );
});

test("new gated first publish requires a complete secret layer", async () => {
  const repository = fakeRepository({
    listAdminEvents: async () => [],
  });

  await assert.rejects(
    () =>
      repository.createStudioEvent(
        studioCommand({
          accessType: "gated",
          unlockCode: "strong-code",
          secretInfo: "Use the side gate.",
        }),
        "acid-crew",
      ),
    (error) => error instanceof AppError && error.code === "STUDIO_SECRET_INCOMPLETE",
  );
});

test("crew cannot publish or archive another crew's event", async () => {
  const repository = fakeRepository({
    listAdminEvents: async () => [{ slug: "studio-night-2026-03-14", origin: "studio", crewSlug: "other-crew" }],
    getLatestDraftBundle: async () => ({
      draft: {
        public: {
          slug: "studio-night-2026-03-14",
          origin: "studio",
          crewSlug: "other-crew",
        },
      },
    }),
  });

  await assert.rejects(
    () => repository.publishStudioDraft("studio-night-2026-03-14", "acid-crew"),
    (error) => error instanceof AppError && error.code === "STUDIO_DRAFT_NOT_FOUND",
  );
  await assert.rejects(
    () => repository.archiveStudioEvent("studio-night-2026-03-14", "acid-crew"),
    (error) => error instanceof AppError && error.code === "STUDIO_EVENT_NOT_FOUND",
  );
});
