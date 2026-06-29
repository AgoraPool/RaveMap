import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/lib/server/errors.ts";
import { validateAppEnv } from "../src/lib/server/env.ts";

function validEnv(overrides: Record<string, unknown> = {}) {
  return {
    ADMIN_SECRET: "AdminSecret_0123456789abcdefghijklmnopqrstuvwxyz",
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    RATE_LIMIT_SECRET: "RateLimitSecret_0123456789abcdefghijklmnopqrstuvwxyz",
    NOSTR_RELAYS: "wss://relay.example.com,wss://relay2.example.com",
    NOSTR_PRIVATE_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    NOSTR_WRITE_MIN_SUCCESS: "1",
    NODE_ENV: "production",
    ...overrides,
  };
}

test("env validation accepts strong production config", () => {
  const env = validateAppEnv(validEnv());
  assert.equal(env.NOSTR_WRITE_MIN_SUCCESS, 1);
});

test("env validation rejects invalid encryption key length", () => {
  assert.throws(() => validateAppEnv(validEnv({ ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })), AppError);
});

test("env validation rejects malformed encryption key base64", () => {
  assert.throws(() => validateAppEnv(validEnv({ ENCRYPTION_KEY: `${"a".repeat(43)}!` })), AppError);
});

test("env validation rejects insecure production relays", () => {
  assert.throws(() => validateAppEnv(validEnv({ NOSTR_RELAYS: "ws://relay.example.com" })), AppError);
});

test("env validation rejects relay quorum above relay count", () => {
  assert.throws(() => validateAppEnv(validEnv({ NOSTR_WRITE_MIN_SUCCESS: "3" })), AppError);
});

test("env validation rejects placeholder secrets", () => {
  assert.throws(() => validateAppEnv(validEnv({ ADMIN_SECRET: "change-me" })), AppError);
});

test("env validation rejects weak nostr publisher keys", () => {
  assert.throws(() => validateAppEnv(validEnv({ NOSTR_PRIVATE_KEY: "0".repeat(64) })), AppError);
});
