import assert from "node:assert/strict";
import test from "node:test";
import { rsvpSchema } from "../src/lib/server/schemas.ts";

test("rsvp schema accepts optional allowlisted roll call signal", () => {
  const result = rsvpSchema.parse({
    status: "accepted",
    nickname: "acid23",
    signal: "jedu vlakem",
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.nickname, "acid23");
  assert.equal(result.signal, "jedu vlakem");
});

test("rsvp schema rejects arbitrary roll call signal text", () => {
  assert.throws(() =>
    rsvpSchema.parse({
      status: "tentative",
      signal: "free-form update",
    }),
  );
});
