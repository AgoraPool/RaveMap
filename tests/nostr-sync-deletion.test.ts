import assert from "node:assert/strict";
import test from "node:test";
import { cacheHeaderFor } from "../src/lib/server/cache-policy.ts";
import { AppError } from "../src/lib/server/errors.ts";
import { NostrEventRepository } from "../src/lib/server/nostr-repository.ts";
import {
  DELETE_EVENT_KIND,
  PUBLIC_EVENT_KIND,
  TOMBSTONE_EVENT_KIND,
  type NostrEvent,
  type NostrFilter,
  type NostrUnsignedEvent,
} from "../src/lib/server/nostr-types.ts";

const APP_PUBKEY = "a".repeat(64);
const USER_PUBKEY = "b".repeat(64);
const OTHER_PUBKEY = "c".repeat(64);

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags.filter((tag) => tag[0] === name && tag[1]).map((tag) => tag[1]);
}

function matchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#") || !Array.isArray(values)) continue;
    const tagName = key.slice(1);
    if (!tagValues(event, tagName).some((value) => values.includes(value))) return false;
  }
  return true;
}

function fakeRepository(events: NostrEvent[]) {
  let signedCount = 0;
  let queryCount = 0;
  let deleteQueryCount = 0;
  return Object.assign(Object.create(NostrEventRepository.prototype), {
    pubkey: APP_PUBKEY,
    relays: ["wss://relay.example"],
    writeTimeoutMs: 1000,
    readCache: new Map(),
    signer: {
      getPublicKey: () => APP_PUBKEY,
      sign: async (event: NostrUnsignedEvent): Promise<NostrEvent> => ({
        ...event,
        id: `signed-${(signedCount += 1)}`,
        pubkey: APP_PUBKEY,
        sig: "0".repeat(128),
      }),
    },
    query: async (filters: NostrFilter[]) => {
      queryCount += 1;
      if (filters.some((filter) => filter.kinds?.includes(DELETE_EVENT_KIND))) {
        deleteQueryCount += 1;
      }
      return [
        {
          relay: "test",
          ok: true,
          events: events.filter((event) => filters.some((filter) => matchesFilter(event, filter))),
        },
      ];
    },
    publish: async function (this: NostrEventRepository, event: NostrEvent) {
      events.push(event);
      this.readCache.clear();
      return [{ relay: "test", ok: true }];
    },
    queryCount: () => queryCount,
    deleteQueryCount: () => deleteQueryCount,
  }) as NostrEventRepository & { queryCount: () => number; deleteQueryCount: () => number };
}

function publicEvent({
  id,
  slug,
  pubkey = APP_PUBKEY,
  createdAt = 1_776_000_000,
  title = slug,
  ravemapSubmission = false,
}: {
  id: string;
  slug: string;
  pubkey?: string;
  createdAt?: number;
  title?: string;
  ravemapSubmission?: boolean;
}): NostrEvent {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: PUBLIC_EVENT_KIND,
    tags: [
      ["d", slug],
      ["title", title],
      ["summary", `Public summary for ${title}`],
      ["location", "Praha"],
      ["start", "1776531600"],
      ["access", "public"],
      ...(ravemapSubmission
        ? [
            ["client", "RaveMap"],
            ["submission", "public"],
            ["t", "ravemap"],
          ]
        : []),
    ],
    content: `Public summary for ${title}`,
    sig: "1".repeat(128),
  };
}

function arbitraryRavemapEvent(slug: string): NostrEvent {
  return {
    ...publicEvent({ id: `arbitrary-${slug}`, slug, pubkey: USER_PUBKEY, title: "Arbitrary" }),
    tags: [...publicEvent({ id: "template", slug }).tags, ["t", "ravemap"]],
  };
}

function tombstone(slug: string): NostrEvent {
  return {
    id: `tombstone-${slug}`,
    pubkey: APP_PUBKEY,
    created_at: 1_776_100_000,
    kind: TOMBSTONE_EVENT_KIND,
    tags: [["d", slug]],
    content: "{}",
    sig: "2".repeat(128),
  };
}

function authorDelete(target: NostrEvent, tags: string[][], pubkey = target.pubkey): NostrEvent {
  return {
    id: `delete-${target.id}-${pubkey.slice(0, 4)}`,
    pubkey,
    created_at: target.created_at + 10,
    kind: DELETE_EVENT_KIND,
    tags,
    content: "deleted",
    sig: "3".repeat(128),
  };
}

test("public sync includes app-key events and valid self-custody RaveMap submissions only", async () => {
  const repository = fakeRepository([
    publicEvent({ id: "app", slug: "app-night", title: "App Night" }),
    publicEvent({ id: "user", slug: "user-night", pubkey: USER_PUBKEY, title: "User Night", ravemapSubmission: true }),
    arbitraryRavemapEvent("spam-night"),
  ]);

  const events = await repository.listPublishedEvents();
  assert.deepEqual(
    events.map((event) => event.slug),
    ["app-night", "user-night"],
  );
});

test("app-key event wins over self-custody event with same slug", async () => {
  const repository = fakeRepository([
    publicEvent({ id: "user", slug: "same-night", pubkey: USER_PUBKEY, createdAt: 1_776_000_100, title: "User Copy", ravemapSubmission: true }),
    publicEvent({ id: "app", slug: "same-night", createdAt: 1_776_000_000, title: "App Copy" }),
  ]);

  const event = await repository.getPublishedEvent("same-night");
  assert.equal(event?.title, "App Copy");
  assert.equal(event?.authorPubkey, APP_PUBKEY);
});

test("admin inventory includes self-custody community submissions", async () => {
  const repository = fakeRepository([
    publicEvent({ id: "user", slug: "community-night", pubkey: USER_PUBKEY, title: "Community Night", ravemapSubmission: true }),
  ]);

  const events = await repository.listAdminEvents();
  assert.deepEqual(
    events.map((event) => [event.slug, event.isPublished, event.authorPubkey]),
    [["community-night", true, USER_PUBKEY]],
  );
});

test("app tombstone hides matching slug from list, detail, and admin reads", async () => {
  const repository = fakeRepository([
    publicEvent({ id: "app", slug: "deleted-night", title: "Deleted Night" }),
    tombstone("deleted-night"),
  ]);

  assert.deepEqual(await repository.listPublishedEvents(), []);
  assert.equal(await repository.getPublishedEvent("deleted-night"), null);
  assert.deepEqual(await repository.listAdminEvents(), []);
});

test("original author kind-5 e delete hides self-custody submission", async () => {
  const target = publicEvent({ id: "user-event", slug: "user-delete", pubkey: USER_PUBKEY, ravemapSubmission: true });
  const repository = fakeRepository([target, authorDelete(target, [["e", target.id]])]);

  assert.deepEqual(await repository.listPublishedEvents(), []);
});

test("original author kind-5 a delete hides self-custody submission", async () => {
  const target = publicEvent({ id: "user-event", slug: "coordinate-delete", pubkey: USER_PUBKEY, ravemapSubmission: true });
  const coordinate = `${PUBLIC_EVENT_KIND}:${USER_PUBKEY}:coordinate-delete`;
  const repository = fakeRepository([target, authorDelete(target, [["a", coordinate]])]);

  assert.equal(await repository.getPublishedEvent("coordinate-delete"), null);
});

test("unrelated-author kind-5 delete is ignored", async () => {
  const target = publicEvent({ id: "user-event", slug: "not-deleted", pubkey: USER_PUBKEY, ravemapSubmission: true });
  const repository = fakeRepository([target, authorDelete(target, [["e", target.id]], OTHER_PUBKEY)]);

  assert.equal((await repository.listPublishedEvents()).length, 1);
});

test("public list and detail reads use deletion-aware read cache", async () => {
  const repository = fakeRepository([publicEvent({ id: "app", slug: "cached-night", title: "Cached Night" })]);

  assert.equal((await repository.listPublishedEvents()).length, 1);
  const afterFirstList = repository.queryCount();
  assert.equal((await repository.listPublishedEvents()).length, 1);
  assert.equal(repository.queryCount(), afterFirstList);

  assert.equal((await repository.getPublishedEvent("cached-night"))?.slug, "cached-night");
  const afterFirstDetail = repository.queryCount();
  assert.equal((await repository.getPublishedEvent("cached-night"))?.slug, "cached-night");
  assert.equal(repository.queryCount(), afterFirstDetail);
});

test("delete clears current instance read cache", async () => {
  const repository = fakeRepository([
    publicEvent({ id: "user-event", slug: "delete-cache", pubkey: USER_PUBKEY, title: "Delete Cache", ravemapSubmission: true }),
  ]);

  assert.equal((await repository.listPublishedEvents()).length, 1);
  const afterFirstList = repository.queryCount();
  await repository.deleteEvent("delete-cache");
  assert.deepEqual(await repository.listPublishedEvents(), []);
  assert.ok(repository.queryCount() > afterFirstList);
});

test("app-authored events do not query original-author kind-5 deletes", async () => {
  const repository = fakeRepository([publicEvent({ id: "app", slug: "app-only", title: "App Only" })]);

  assert.equal((await repository.listPublishedEvents()).length, 1);
  assert.equal(repository.deleteQueryCount(), 0);
});

test("admin delete tombstones displayed self-custody submissions", async () => {
  const events = [publicEvent({ id: "user-event", slug: "cleanup-night", pubkey: USER_PUBKEY, ravemapSubmission: true })];
  const repository = fakeRepository(events);

  const result = await repository.deleteEvent("cleanup-night");
  assert.equal(result.slug, "cleanup-night");
  assert.equal(events.some((event) => event.kind === TOMBSTONE_EVENT_KIND && tagValues(event, "d").includes("cleanup-night")), true);
  assert.deepEqual(await repository.listPublishedEvents(), []);
});

test("admin delete still rejects unknown slugs", async () => {
  const repository = fakeRepository([]);

  await assert.rejects(
    () => repository.deleteEvent("missing-night"),
    (error) => error instanceof AppError && error.code === "EVENT_NOT_FOUND",
  );
});

test("event pages do not receive stale public cache headers", () => {
  assert.equal(cacheHeaderFor("/akce", "GET"), null);
  assert.equal(cacheHeaderFor("/akce/community-night", "GET"), null);
  assert.equal(cacheHeaderFor("/akce", "POST"), null);
});
