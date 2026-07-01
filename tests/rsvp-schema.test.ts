import assert from "node:assert/strict";
import test from "node:test";
import { rsvpSchema } from "../src/lib/server/schemas.ts";

test("rsvp schema accepts optional allowlisted roll call signal", () => {
  const result = rsvpSchema.parse({
    status: "accepted",
    nickname: "acid23",
    signal: "hledám partu",
    contact: "@acid23",
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.nickname, "acid23");
  assert.equal(result.signal, "hledám partu");
  assert.equal(result.contact, "@acid23");
});

test("rsvp schema rejects arbitrary roll call signal text", () => {
  assert.throws(() =>
    rsvpSchema.parse({
      status: "tentative",
      signal: "free-form update",
    }),
  );
});

test("rsvp schema rejects contact for non-contact signals", () => {
  assert.throws(() =>
    rsvpSchema.parse({
      status: "accepted",
      signal: "uvidíme se u stage",
      contact: "@stage",
    }),
  );
});
