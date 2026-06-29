import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/lib/server/errors.ts";
import { safeFetchJson, safeFetchText, validateSafeUrl } from "../src/lib/server/safe-fetch.ts";

test("safe URL validation accepts public HTTPS URLs", () => {
  const url = validateSafeUrl("https://example.com/.well-known/lnurlp/name");
  assert.equal(url.protocol, "https:");
});

test("safe URL validation rejects non-HTTPS URLs by default", () => {
  assert.throws(() => validateSafeUrl("http://example.com"), AppError);
});

test("safe URL validation rejects localhost and private IP literals", () => {
  assert.throws(() => validateSafeUrl("https://localhost/test"), AppError);
  assert.throws(() => validateSafeUrl("https://127.0.0.1/test"), AppError);
  assert.throws(() => validateSafeUrl("https://192.168.1.10/test"), AppError);
  assert.throws(() => validateSafeUrl("https://[::1]/test"), AppError);
  assert.throws(() => validateSafeUrl("https://[::ffff:10.0.0.1]/test"), AppError);
});

test("safe URL validation rejects embedded credentials", () => {
  assert.throws(() => validateSafeUrl("https://user:pass@example.com"), AppError);
});

test("safe fetch rejects oversized responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("x".repeat(32));
  try {
    await assert.rejects(() => safeFetchText("https://example.com/data", { allowPrivateHosts: true, maxBytes: 8 }), AppError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safe fetch rejects slow responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  try {
    await assert.rejects(() => safeFetchText("https://example.com/slow", { allowPrivateHosts: true, timeoutMs: 1 }), AppError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safe fetch accepts valid public HTTPS JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ callback: "https://example.com/invoice" });
  try {
    const { json } = await safeFetchJson<{ callback: string }>("https://example.com/.well-known/lnurlp/name", {
      allowPrivateHosts: true,
    });
    assert.equal(json.callback, "https://example.com/invoice");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
