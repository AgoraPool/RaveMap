import assert from "node:assert/strict";
import test from "node:test";
import { studioEventActionSchema, studioEventSchema } from "../src/lib/server/schemas.ts";

test("studio event schema accepts a public draft", () => {
  const result = studioEventSchema.parse({
    title: "Studio Night",
    summary: "Public info for a studio-created event.",
    publicLocation: "Brno",
    startsAt: "2026-03-14T20:00:00+01:00",
    accessType: "public",
    isPublished: false,
    genres: ["tekno"],
    lineup: ["Crew"],
    tags: ["studio"],
  });

  assert.equal(result.accessType, "public");
  assert.equal(result.isPublished, false);
});

test("studio event schema rejects source/admin-only fields", () => {
  assert.throws(() =>
    studioEventSchema.parse({
      title: "Studio Night",
      summary: "Public info for a studio-created event.",
      publicLocation: "Brno",
      startsAt: "2026-03-14T20:00:00+01:00",
      sourceUrl: "https://example.com/import",
    }),
  );
});

test("studio event schema allows partial gated secret for existing-event preservation", () => {
  const result = studioEventSchema.parse({
    slug: "studio-night-2026-03-14",
    title: "Studio Night",
    summary: "Updated public info for a studio-created event.",
    publicLocation: "Brno",
    startsAt: "2026-03-14T20:00:00+01:00",
    accessType: "gated",
    isPublished: true,
  });

  assert.equal(result.accessType, "gated");
  assert.equal(result.unlockCode, undefined);
});

test("studio event action schema accepts publish and archive only", () => {
  assert.equal(studioEventActionSchema.parse({ slug: "studio-night-2026-03-14", action: "publish" }).action, "publish");
  assert.equal(studioEventActionSchema.parse({ slug: "studio-night-2026-03-14", action: "archive" }).action, "archive");
  assert.throws(() => studioEventActionSchema.parse({ slug: "studio-night-2026-03-14", action: "delete" }));
});
