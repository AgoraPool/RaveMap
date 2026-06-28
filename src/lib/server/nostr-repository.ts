import { verifyEvent } from "nostr-tools";
import {
  decryptDraftBundle,
  decryptSecretBundle,
  encryptDraftBundle,
  encryptSecretBundle,
  hashUnlockCode,
  type DraftBundle,
  type SecretPayload,
} from "./crypto";
import { AppError } from "./errors";
import { getEnv } from "./env";
import { getAppManagedSigner, type NostrSigner } from "./nostr-signer";
import {
  COMMENT_EVENT_KIND,
  DELETE_EVENT_KIND,
  DRAFT_EVENT_KIND,
  PUBLIC_EVENT_KIND,
  SECRET_EVENT_KIND,
  TOMBSTONE_EVENT_KIND,
  type AdminEventDto,
  type CreateCommentCommand,
  type CreateEventCommand,
  type EventCommentDto,
  type NostrEvent,
  type NostrFilter,
  type NostrUnsignedEvent,
  type PublicEventDto,
  type RelayReadResult,
  type RelayWriteResult,
} from "./nostr-types";

type RelayRequestResult = {
  relay: string;
  ok: boolean;
  events: NostrEvent[];
  message?: string;
};

type CreatedEventResult = {
  id: string;
  slug: string;
  writes: RelayWriteResult[];
};

type DeletedEventResult = {
  id: string;
  slug: string;
  writes: RelayWriteResult[];
};

type RelayDiagnostics = {
  relays: string[];
  publisherPubkey: string;
  writeMinSuccess: number;
  checks: {
    relays: RelayReadResult[];
    latestEvent: {
      ok: boolean;
      id?: string;
      kind?: number;
      createdAt?: string;
    };
    publishConfigured: boolean;
  };
};

function uniqueRelayUrls(rawRelays: string): string[] {
  const relays = rawRelays
    .split(",")
    .map((relay) => relay.trim())
    .filter(Boolean)
    .map((relay) => {
      const url = new URL(relay);
      if (url.protocol !== "wss:" && url.protocol !== "ws:") {
        throw new AppError("Nostr relay URLs must use ws or wss", {
          code: "NOSTR_RELAY_INVALID",
          status: 500,
        });
      }

      return url.toString().replace(/\/$/, "");
    });

  return [...new Set(relays)];
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function nostrCoordinate(kind: number, pubkey: string, slug: string): string {
  return `${kind}:${pubkey}:${slug}`;
}

function eventCoordinate(pubkey: string, slug: string): string {
  return nostrCoordinate(PUBLIC_EVENT_KIND, pubkey, slug);
}

function parseDateFromSeconds(value: string | undefined): Date | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags.filter((tag) => tag[0] === name && tag[1]).map((tag) => tag[1]);
}

function commentAuthorName(event: NostrEvent): string {
  const nickname = tagValue(event, "nickname") || tagValue(event, "name");
  if (nickname) {
    return nickname;
  }

  return tagValue(event, "anonymous") === "true" ? "Anonymous" : `${event.pubkey.slice(0, 8)}...`;
}

function parseCommentEvent(event: NostrEvent): EventCommentDto | null {
  const slug = tagValue(event, "ravemap-event");
  const content = event.content.trim();
  if (!slug || !content) {
    return null;
  }

  return {
    id: event.id,
    slug,
    content,
    authorPubkey: event.pubkey,
    authorName: commentAuthorName(event),
    isAnonymous: tagValue(event, "anonymous") === "true",
    createdAt: new Date(event.created_at * 1000),
  };
}

function accessTypeFromTag(value: string | undefined): "public" | "gated" {
  return value === "public" ? "public" : "gated";
}

function publicFieldsFromCommand(input: CreateEventCommand, createdAt = new Date().toISOString()): DraftBundle["public"] {
  return {
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    publicLocation: input.publicLocation,
    startsAt: input.startsAt.toISOString(),
    endAt: input.endAt?.toISOString(),
    coverImageUrl: input.coverImageUrl,
    externalUrl: input.externalUrl,
    source: input.source,
    genres: input.genres ?? [],
    lineup: input.lineup ?? [],
    tags: input.tags ?? [],
    galleryImageUrls: input.galleryImageUrls ?? [],
    accessType: input.accessType,
    createdAt,
  };
}

function publicDtoFromFields(fields: DraftBundle["public"], id: string): PublicEventDto {
  return {
    id,
    slug: fields.slug,
    title: fields.title,
    summary: fields.summary,
    publicLocation: fields.publicLocation,
    startsAt: new Date(fields.startsAt),
    endAt: fields.endAt ? new Date(fields.endAt) : undefined,
    coverImageUrl: fields.coverImageUrl,
    externalUrl: fields.externalUrl,
    source: fields.source,
    genres: fields.genres ?? [],
    lineup: fields.lineup ?? [],
    tags: fields.tags ?? [],
    galleryImageUrls: fields.galleryImageUrls ?? [],
    accessType: fields.accessType ?? "gated",
    createdAt: new Date(fields.createdAt),
  };
}

function commandFromFields(fields: DraftBundle["public"], isPublished: boolean): CreateEventCommand {
  return {
    slug: fields.slug,
    title: fields.title,
    summary: fields.summary,
    publicLocation: fields.publicLocation,
    startsAt: new Date(fields.startsAt),
    endAt: fields.endAt ? new Date(fields.endAt) : undefined,
    coverImageUrl: fields.coverImageUrl,
    externalUrl: fields.externalUrl,
    source: fields.source,
    genres: fields.genres,
    lineup: fields.lineup,
    tags: fields.tags,
    galleryImageUrls: fields.galleryImageUrls,
    accessType: fields.accessType ?? "gated",
    isPublished,
  };
}

function parsePublicEvent(event: NostrEvent): PublicEventDto | null {
  const slug = tagValue(event, "d");
  const title = tagValue(event, "title") || tagValue(event, "name");
  const publicLocation = tagValue(event, "location");
  const startsAt = parseDateFromSeconds(tagValue(event, "start"));

  if (!slug || !title || !publicLocation || !startsAt) {
    return null;
  }

  return {
    id: event.id,
    slug,
    title,
    summary: tagValue(event, "summary") || event.content,
    publicLocation,
    startsAt,
    endAt: parseDateFromSeconds(tagValue(event, "end")) ?? undefined,
    coverImageUrl: tagValue(event, "image"),
    externalUrl: tagValue(event, "external"),
    source: tagValue(event, "source-url")
      ? {
          name: tagValue(event, "source") || "Imported",
          url: tagValue(event, "source-url") as string,
          id: tagValue(event, "source-id"),
          contentHash: tagValue(event, "source-hash"),
        }
      : undefined,
    genres: tagValues(event, "genre"),
    lineup: tagValues(event, "artist"),
    tags: [...new Set([...tagValues(event, "tag"), ...tagValues(event, "t")])],
    galleryImageUrls: tagValues(event, "gallery"),
    accessType: accessTypeFromTag(tagValue(event, "access")),
    createdAt: new Date(event.created_at * 1000),
  };
}

function publicEventTemplate(input: CreateEventCommand): NostrUnsignedEvent {
  const tags = [
    ["d", input.slug],
    ["title", input.title],
    ["summary", input.summary],
    ["location", input.publicLocation],
    ["start", String(Math.floor(input.startsAt.getTime() / 1000))],
    ["access", input.accessType],
  ];

  if (input.endAt) {
    tags.push(["end", String(Math.floor(input.endAt.getTime() / 1000))]);
  }

  if (input.coverImageUrl) {
    tags.push(["image", input.coverImageUrl]);
  }

  if (input.externalUrl) {
    tags.push(["external", input.externalUrl]);
    tags.push(["r", input.externalUrl]);
  }

  if (input.source) {
    tags.push(["source", input.source.name], ["source-url", input.source.url]);
    if (input.source.id) {
      tags.push(["source-id", input.source.id]);
    }
    if (input.source.contentHash) {
      tags.push(["source-hash", input.source.contentHash]);
    }
  }

  for (const genre of input.genres ?? []) {
    tags.push(["genre", genre]);
  }

  for (const artist of input.lineup ?? []) {
    tags.push(["artist", artist]);
  }

  for (const sourceTag of input.tags ?? []) {
    tags.push(["tag", sourceTag]);
    tags.push(["t", sourceTag]);
  }

  for (const imageUrl of input.galleryImageUrls ?? []) {
    tags.push(["gallery", imageUrl]);
  }

  return {
    kind: PUBLIC_EVENT_KIND,
    created_at: nowSeconds(),
    tags,
    content: input.summary,
  };
}

function secretFromCommand(input: CreateEventCommand): SecretPayload {
  if (
    !input.unlockCode ||
    !input.secretInfo ||
    !input.secretLocationName ||
    input.secretLatitude === undefined ||
    input.secretLongitude === undefined
  ) {
    throw new AppError("Code-gated events require unlock and secret location fields", {
      code: "GATED_SECRET_REQUIRED",
      status: 400,
      expose: true,
    });
  }

  return {
    secretInfo: input.secretInfo,
    secretLocationName: input.secretLocationName,
    secretLatitude: input.secretLatitude,
    secretLongitude: input.secretLongitude,
    secretMapNote: input.secretMapNote,
  };
}

function relayRequest(relay: string, filters: NostrFilter[], timeoutMs: number): Promise<RelayRequestResult> {
  return new Promise((resolve) => {
    if (typeof WebSocket === "undefined") {
      resolve({
        relay,
        ok: false,
        events: [],
        message: "WebSocket is not available in this runtime",
      });
      return;
    }

    const subscriptionId = `ravemap-${crypto.randomUUID()}`;
    const events = new Map<string, NostrEvent>();
    const socket = new WebSocket(relay);
    let settled = false;

    const finish = (ok: boolean, message?: string) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(["CLOSE", subscriptionId]));
        }
        socket.close();
      } catch {
        // Closing is best-effort only.
      }

      resolve({ relay, ok, events: [...events.values()], message });
    };

    const timer = setTimeout(() => {
      finish(true, "read timeout reached");
    }, timeoutMs);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(["REQ", subscriptionId, ...filters]));
    });

    socket.addEventListener("message", (message) => {
      try {
        const parsed = JSON.parse(String(message.data));
        if (!Array.isArray(parsed) || parsed[1] !== subscriptionId) {
          return;
        }

        if (parsed[0] === "EVENT" && parsed[2]?.id) {
          events.set(parsed[2].id, parsed[2] as NostrEvent);
          return;
        }

        if (parsed[0] === "EOSE") {
          finish(true);
        }
      } catch {
        // Ignore malformed relay frames.
      }
    });

    socket.addEventListener("error", () => {
      finish(false, "relay read failed");
    });
  });
}

function relayPublish(relay: string, event: NostrEvent, timeoutMs: number): Promise<RelayWriteResult> {
  return new Promise((resolve) => {
    if (typeof WebSocket === "undefined") {
      resolve({
        relay,
        ok: false,
        message: "WebSocket is not available in this runtime",
      });
      return;
    }

    const socket = new WebSocket(relay);
    let settled = false;

    const finish = (ok: boolean, message?: string) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      try {
        socket.close();
      } catch {
        // Closing is best-effort only.
      }

      resolve({ relay, ok, message });
    };

    const timer = setTimeout(() => {
      finish(false, "relay write timeout reached");
    }, timeoutMs);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(["EVENT", event]));
    });

    socket.addEventListener("message", (message) => {
      try {
        const parsed = JSON.parse(String(message.data));
        if (!Array.isArray(parsed) || parsed[0] !== "OK" || parsed[1] !== event.id) {
          return;
        }

        finish(Boolean(parsed[2]), typeof parsed[3] === "string" ? parsed[3] : undefined);
      } catch {
        // Ignore malformed relay frames.
      }
    });

    socket.addEventListener("error", () => {
      finish(false, "relay write failed");
    });
  });
}

export class NostrEventRepository {
  private readonly relays: string[];
  private readonly readTimeoutMs: number;
  private readonly writeTimeoutMs: number;
  private readonly writeMinSuccess: number;
  private readonly signer: NostrSigner;
  private readonly pubkey: string;

  constructor(signer = getAppManagedSigner()) {
    const env = getEnv();
    this.relays = uniqueRelayUrls(env.NOSTR_RELAYS);
    this.readTimeoutMs = env.NOSTR_READ_TIMEOUT_MS;
    this.writeTimeoutMs = env.NOSTR_WRITE_TIMEOUT_MS;
    this.writeMinSuccess = env.NOSTR_WRITE_MIN_SUCCESS;
    this.signer = signer;
    this.pubkey = signer.getPublicKey();

    if (this.writeMinSuccess > this.relays.length) {
      throw new AppError("Nostr write quorum exceeds configured relay count", {
        code: "NOSTR_WRITE_QUORUM_INVALID",
        status: 500,
      });
    }
  }

  getRelays(): string[] {
    return [...this.relays];
  }

  getPublisherPubkey(): string {
    return this.pubkey;
  }

  private async query(filters: NostrFilter[]): Promise<RelayRequestResult[]> {
    const results = await Promise.all(this.relays.map((relay) => relayRequest(relay, filters, this.readTimeoutMs)));
    return results;
  }

  private async publish(event: NostrEvent): Promise<RelayWriteResult[]> {
    const results = await Promise.all(this.relays.map((relay) => relayPublish(relay, event, this.writeTimeoutMs)));
    const successes = results.filter((result) => result.ok).length;

    if (successes < this.writeMinSuccess) {
      throw new AppError("Nostr relay write quorum was not reached", {
        code: "NOSTR_WRITE_FAILED",
        status: 502,
        expose: import.meta.env.DEV,
      });
    }

    return results;
  }

  private async fetchEvents(filters: NostrFilter[]): Promise<NostrEvent[]> {
    const results = await this.query(filters);
    const byId = new Map<string, NostrEvent>();

    for (const result of results) {
      for (const event of result.events) {
        byId.set(event.id, event);
      }
    }

    return [...byId.values()];
  }

  private latestByD(events: NostrEvent[]): Map<string, NostrEvent> {
    const bySlug = new Map<string, NostrEvent>();

    for (const event of events) {
      const slug = tagValue(event, "d");
      if (!slug || event.pubkey !== this.pubkey) {
        continue;
      }

      const existing = bySlug.get(slug);
      if (!existing || event.created_at > existing.created_at) {
        bySlug.set(slug, event);
      }
    }

    return bySlug;
  }

  async listTombstonedSlugs(slugs?: string[]): Promise<Set<string>> {
    const filters: NostrFilter[] = [
      {
        authors: [this.pubkey],
        kinds: [TOMBSTONE_EVENT_KIND],
        limit: 1000,
        ...(slugs ? { "#d": slugs } : {}),
      },
    ];

    const events = await this.fetchEvents(filters);
    return new Set([...this.latestByD(events).keys()]);
  }

  async listPublishedEvents(limit?: number): Promise<PublicEventDto[]> {
    const events = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [PUBLIC_EVENT_KIND],
        limit: limit ?? 200,
      },
    ]);
    const tombstones = await this.listTombstonedSlugs();

    return [...this.latestByD(events).values()]
      .map(parsePublicEvent)
      .filter((event): event is PublicEventDto => Boolean(event && !tombstones.has(event.slug)))
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
      .slice(0, limit);
  }

  async getPublishedEvent(slug: string): Promise<PublicEventDto | null> {
    const tombstones = await this.listTombstonedSlugs([slug]);
    if (tombstones.has(slug)) {
      return null;
    }

    const events = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [PUBLIC_EVENT_KIND],
        "#d": [slug],
        limit: 20,
      },
    ]);

    const latest = this.latestByD(events).get(slug);
    return latest ? parsePublicEvent(latest) : null;
  }

  async listComments(slug: string): Promise<EventCommentDto[]> {
    const event = await this.getPublishedEvent(slug);
    if (!event) {
      throw new AppError("Event not found", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const coordinate = eventCoordinate(this.pubkey, slug);
    const events = await this.fetchEvents([
      {
        kinds: [COMMENT_EVENT_KIND],
        "#a": [coordinate],
        limit: 200,
      },
    ]);

    return events
      .filter((comment) => tagValue(comment, "ravemap-event") === slug)
      .map(parseCommentEvent)
      .filter((comment): comment is EventCommentDto => Boolean(comment))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async createAnonymousComment(input: CreateCommentCommand): Promise<{ id: string; writes: RelayWriteResult[] }> {
    if (!(await this.getPublishedEvent(input.slug))) {
      throw new AppError("Event not found", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const nickname = input.nickname?.trim();
    const comment = await this.signer.sign({
      kind: COMMENT_EVENT_KIND,
      created_at: nowSeconds(),
      tags: [
        ["A", eventCoordinate(this.pubkey, input.slug)],
        ["K", String(PUBLIC_EVENT_KIND)],
        ["P", this.pubkey],
        ["a", eventCoordinate(this.pubkey, input.slug)],
        ["ravemap-event", input.slug],
        ["anonymous", "true"],
        ["client", "RaveMap"],
        ...(nickname ? [["nickname", nickname]] : []),
      ],
      content: input.content.trim(),
    });

    return {
      id: comment.id,
      writes: await this.publish(comment),
    };
  }

  async publishSignedComment(slug: string, event: NostrEvent): Promise<{ id: string; writes: RelayWriteResult[] }> {
    if (!(await this.getPublishedEvent(slug))) {
      throw new AppError("Event not found", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const coordinate = eventCoordinate(this.pubkey, slug);
    if (
      event.kind !== COMMENT_EVENT_KIND ||
      event.content.trim().length === 0 ||
      event.content.length > 1200 ||
      !tagValues(event, "a").includes(coordinate) ||
      tagValue(event, "ravemap-event") !== slug ||
      event.created_at > nowSeconds() + 10 * 60 ||
      !verifyEvent(event)
    ) {
      throw new AppError("Signed comment is invalid", {
        code: "INVALID_SIGNED_COMMENT",
        status: 400,
        expose: true,
      });
    }

    return {
      id: event.id,
      writes: await this.publish(event),
    };
  }

  async listAdminEvents(): Promise<AdminEventDto[]> {
    const tombstones = await this.listTombstonedSlugs();
    const events = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [PUBLIC_EVENT_KIND, DRAFT_EVENT_KIND],
        limit: 500,
      },
    ]);

    const publicEvents = [...this.latestByD(events.filter((event) => event.kind === PUBLIC_EVENT_KIND)).values()]
      .map(parsePublicEvent)
      .filter((event): event is PublicEventDto => Boolean(event && !tombstones.has(event.slug)))
      .map((event) => ({
        ...event,
        isPublished: true,
      }));
    const publishedSlugs = new Set(publicEvents.map((event) => event.slug));

    const drafts = [...this.latestByD(events.filter((event) => event.kind === DRAFT_EVENT_KIND)).values()]
      .map((event): AdminEventDto | null => {
        const slug = tagValue(event, "d");
        if (!slug || tombstones.has(slug) || publishedSlugs.has(slug)) {
          return null;
        }

        const draft = decryptDraftBundle(event.content, {
          coordinate: nostrCoordinate(DRAFT_EVENT_KIND, this.pubkey, slug),
        });
        return {
          ...publicDtoFromFields(draft.public, event.id),
          isPublished: false,
        };
      })
      .filter((event): event is AdminEventDto => Boolean(event));

    return [...publicEvents, ...drafts].sort((left, right) => {
      const startsAtDiff = right.startsAt.getTime() - left.startsAt.getTime();
      return startsAtDiff || right.createdAt.getTime() - left.createdAt.getTime();
    });
  }

  async slugExists(slug: string): Promise<boolean> {
    const events = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [PUBLIC_EVENT_KIND, SECRET_EVENT_KIND, DRAFT_EVENT_KIND, TOMBSTONE_EVENT_KIND],
        "#d": [slug],
        limit: 20,
      },
    ]);

    return events.length > 0;
  }

  async findEventBySourceUrl(sourceUrl: string): Promise<AdminEventDto | null> {
    const events = await this.listAdminEvents();
    return events.find((event) => event.source?.url === sourceUrl) ?? null;
  }

  async findEventBySourceId(sourceId: string): Promise<AdminEventDto | null> {
    const events = await this.listAdminEvents();
    return events.find((event) => event.source?.id === sourceId) ?? null;
  }

  async createEvent(input: CreateEventCommand): Promise<CreatedEventResult> {
    const codeHash = input.accessType === "gated" ? await hashUnlockCode(input.unlockCode ?? "") : undefined;
    const secret = input.accessType === "gated" ? secretFromCommand(input) : undefined;

    if (!input.isPublished) {
      const draftBundle: DraftBundle = {
        public: publicFieldsFromCommand(input),
        codeHash,
        secret,
      };
      const tags = [
        ["d", input.slug],
        ["access", input.accessType],
      ];

      if (input.source) {
        tags.push(["source", input.source.name], ["source-url", input.source.url]);
        if (input.source.id) {
          tags.push(["source-id", input.source.id]);
        }
        if (input.source.contentHash) {
          tags.push(["source-hash", input.source.contentHash]);
        }
      }

      const draftEvent = await this.signer.sign({
        kind: DRAFT_EVENT_KIND,
        created_at: nowSeconds(),
        tags,
        content: encryptDraftBundle(draftBundle, {
          coordinate: nostrCoordinate(DRAFT_EVENT_KIND, this.pubkey, input.slug),
        }),
      });

      const writes = await this.publish(draftEvent);
      return { id: draftEvent.id, slug: input.slug, writes };
    }

    if (input.accessType === "public") {
      const publicEvent = await this.signer.sign(publicEventTemplate(input));
      const publicWrites = await this.publish(publicEvent);

      return {
        id: publicEvent.id,
        slug: input.slug,
        writes: publicWrites,
      };
    }

    const secretEvent = await this.signer.sign({
      kind: SECRET_EVENT_KIND,
      created_at: nowSeconds(),
      tags: [["d", input.slug]],
      content: encryptSecretBundle(
        {
          codeHash: codeHash as string,
          secret: secret as SecretPayload,
        },
        {
          coordinate: nostrCoordinate(SECRET_EVENT_KIND, this.pubkey, input.slug),
        },
      ),
    });

    const secretWrites = await this.publish(secretEvent);
    const publicEvent = await this.signer.sign(publicEventTemplate(input));
    const publicWrites = await this.publish(publicEvent);

    return {
      id: publicEvent.id,
      slug: input.slug,
      writes: [...secretWrites, ...publicWrites],
    };
  }

  async getSecretBundle(slug: string): Promise<{ codeHash: string; secret: SecretPayload } | null> {
    const tombstones = await this.listTombstonedSlugs([slug]);
    if (tombstones.has(slug)) {
      return null;
    }

    const events = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [SECRET_EVENT_KIND],
        "#d": [slug],
        limit: 20,
      },
    ]);

    const latest = this.latestByD(events).get(slug);
    if (!latest) {
      return null;
    }

    return decryptSecretBundle(latest.content, {
      coordinate: nostrCoordinate(SECRET_EVENT_KIND, this.pubkey, slug),
    });
  }

  async publishDraft(slug: string): Promise<CreatedEventResult> {
    const tombstones = await this.listTombstonedSlugs([slug]);
    if (tombstones.has(slug)) {
      throw new AppError("Event not found", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const events = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [DRAFT_EVENT_KIND],
        "#d": [slug],
        limit: 20,
      },
    ]);
    const latest = this.latestByD(events).get(slug);
    if (!latest) {
      throw new AppError("Draft not found", {
        code: "DRAFT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const draft = decryptDraftBundle(latest.content, {
      coordinate: nostrCoordinate(DRAFT_EVENT_KIND, this.pubkey, slug),
    });
    const command = commandFromFields(draft.public, true);

    if (command.accessType === "public") {
      const publicEvent = await this.signer.sign(publicEventTemplate(command));
      return {
        id: publicEvent.id,
        slug,
        writes: await this.publish(publicEvent),
      };
    }

    if (!draft.codeHash || !draft.secret) {
      throw new AppError("Gated draft is missing secret payload", {
        code: "DRAFT_SECRET_MISSING",
        status: 409,
        expose: true,
      });
    }

    const secretEvent = await this.signer.sign({
      kind: SECRET_EVENT_KIND,
      created_at: nowSeconds(),
      tags: [["d", slug]],
      content: encryptSecretBundle(
        {
          codeHash: draft.codeHash,
          secret: draft.secret,
        },
        {
          coordinate: nostrCoordinate(SECRET_EVENT_KIND, this.pubkey, slug),
        },
      ),
    });
    const secretWrites = await this.publish(secretEvent);
    const publicEvent = await this.signer.sign(publicEventTemplate(command));
    const publicWrites = await this.publish(publicEvent);

    return {
      id: publicEvent.id,
      slug,
      writes: [...secretWrites, ...publicWrites],
    };
  }

  async deleteEvent(slug: string): Promise<DeletedEventResult> {
    const existing = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [PUBLIC_EVENT_KIND, SECRET_EVENT_KIND, DRAFT_EVENT_KIND],
        "#d": [slug],
        limit: 50,
      },
    ]);

    if (existing.length === 0) {
      throw new AppError("Event not found", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const tombstone = await this.signer.sign({
      kind: TOMBSTONE_EVENT_KIND,
      created_at: nowSeconds(),
      tags: [["d", slug]],
      content: JSON.stringify({ slug, deletedAt: new Date().toISOString() }),
    });
    const tombstoneWrites = await this.publish(tombstone);

    const deleteTags = existing.flatMap((event) => {
      const eventSlug = tagValue(event, "d");
      return eventSlug
        ? [
            ["e", event.id],
            ["a", nostrCoordinate(event.kind, event.pubkey, eventSlug)],
          ]
        : [["e", event.id]];
    });

    const deleteEvent = await this.signer.sign({
      kind: DELETE_EVENT_KIND,
      created_at: nowSeconds(),
      tags: deleteTags,
      content: "Deleted from RaveMap.",
    });

    const deletionWrites = await Promise.all(
      this.relays.map((relay) => relayPublish(relay, deleteEvent, this.writeTimeoutMs)),
    );

    return {
      id: tombstone.id,
      slug,
      writes: [...tombstoneWrites, ...deletionWrites],
    };
  }

  async diagnostics(): Promise<RelayDiagnostics> {
    const relayResults = await this.query([
      {
        authors: [this.pubkey],
        kinds: [PUBLIC_EVENT_KIND, DRAFT_EVENT_KIND, TOMBSTONE_EVENT_KIND],
        limit: 1,
      },
    ]);

    const events = relayResults.flatMap((result) => result.events);
    const latest = events.sort((left, right) => right.created_at - left.created_at)[0];

    return {
      relays: this.getRelays(),
      publisherPubkey: this.pubkey,
      writeMinSuccess: this.writeMinSuccess,
      checks: {
        relays: relayResults.map((result) => ({
          relay: result.relay,
          ok: result.ok,
          events: result.events.length,
          message: result.message,
        })),
        latestEvent: latest
          ? {
              ok: true,
              id: latest.id,
              kind: latest.kind,
              createdAt: new Date(latest.created_at * 1000).toISOString(),
            }
          : { ok: false },
        publishConfigured: this.relays.length > 0 && this.writeMinSuccess <= this.relays.length,
      },
    };
  }
}

let repository: NostrEventRepository | null = null;

export function getNostrEventRepository(): NostrEventRepository {
  if (!repository) {
    repository = new NostrEventRepository();
  }

  return repository;
}
