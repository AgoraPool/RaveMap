import { verifyEvent } from "nostr-tools";
import {
  decryptDraftBundle,
  decryptCrewAccountBundle,
  decryptSecretBundle,
  encryptCrewAccountBundle,
  encryptDraftBundle,
  encryptSecretBundle,
  hashCrewCode,
  hashUnlockCode,
  verifyCrewCode,
  type DraftBundle,
  type SecretPayload,
} from "./crypto";
import { AppError } from "./errors";
import { getEnv } from "./env";
import { getAppManagedSigner, type NostrSigner } from "./nostr-signer";
import { safeFetchJson, validateSafeUrl } from "./safe-fetch";
import {
  COMMENT_EVENT_KIND,
  CREW_ACCOUNT_KIND,
  CREW_PROFILE_KIND,
  DELETE_EVENT_KIND,
  DRAFT_EVENT_KIND,
  PUBLIC_EVENT_KIND,
  SECRET_EVENT_KIND,
  TOMBSTONE_EVENT_KIND,
  type AdminEventDto,
  type CreateCommentCommand,
  type CreateEventCommand,
  type CreateRsvpCommand,
  type CrewProfileDto,
  type CrewSessionDto,
  type EventCommentDto,
  type EventOrigin,
  type EventRsvpEntryDto,
  type EventRsvpSummaryDto,
  type NostrEvent,
  type NostrFilter,
  type NostrUnsignedEvent,
  type PublicEventDto,
  type PublicSubmitEventCommand,
  type PromoZapSummaryDto,
  type PromoZapTargetType,
  RSVP_CONTACT_SIGNALS,
  RSVP_EVENT_KIND,
  RSVP_SIGNALS,
  type RelayReadResult,
  type RelayWriteResult,
  type RsvpSignal,
  type RsvpStatus,
  type UpsertCrewProfileCommand,
  ZAP_RECEIPT_KIND,
  ZAP_REQUEST_KIND,
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

type ReadCacheEntry<T> = {
  expiresAt: number;
  value: T;
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

const LIST_READ_CACHE_TTL_MS = 60_000;
const INTERACTION_READ_CACHE_TTL_MS = 15_000;
const MAX_READ_CACHE_ENTRIES = 600;

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

function crewCoordinate(pubkey: string, slug: string): string {
  return nostrCoordinate(CREW_PROFILE_KIND, pubkey, slug);
}

function parseDateFromSeconds(value: string | undefined): Date | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumberTag(value: string | undefined, min: number, max: number): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags.filter((tag) => tag[0] === name && tag[1]).map((tag) => tag[1]);
}

function commentAuthorName(event: NostrEvent): string {
  const nickname = tagValue(event, "nickname") || tagValue(event, "name");
  if (nickname) {
    return nickname;
  }

  return tagValue(event, "anonymous") === "true" ? "Anonym" : `${event.pubkey.slice(0, 8)}...`;
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

function rsvpStatusFromTag(value: string | undefined): RsvpStatus | null {
  return value === "accepted" || value === "tentative" ? value : null;
}

function rsvpSignalFromTag(value: string | undefined): RsvpSignal | undefined {
  return RSVP_SIGNALS.find((signal) => signal === value);
}

function rsvpContactAllowed(signal: RsvpSignal | undefined): boolean {
  return Boolean(signal && RSVP_CONTACT_SIGNALS.includes(signal as (typeof RSVP_CONTACT_SIGNALS)[number]));
}

function rsvpContactFromTag(event: NostrEvent, signal: RsvpSignal | undefined): string | undefined {
  const contact = tagValue(event, "contact")?.trim();
  if (!contact || contact.length > 120 || !rsvpContactAllowed(signal)) {
    return undefined;
  }
  return contact;
}

function rsvpAuthorName(event: NostrEvent): string {
  const nickname = tagValue(event, "nickname") || tagValue(event, "name");
  if (nickname) {
    return nickname;
  }

  return tagValue(event, "anonymous") === "true" ? "Anonym" : `${event.pubkey.slice(0, 8)}...`;
}

function parseRsvpEntry(event: NostrEvent): EventRsvpEntryDto | null {
  const slug = tagValue(event, "ravemap-event");
  const status = rsvpStatusFromTag(tagValue(event, "status"));
  if (!slug || !status) {
    return null;
  }

  const signal = rsvpSignalFromTag(tagValue(event, "signal"));
  return {
    id: event.id,
    slug,
    status,
    signal,
    contact: rsvpContactFromTag(event, signal),
    authorPubkey: event.pubkey,
    authorName: rsvpAuthorName(event),
    isAnonymous: tagValue(event, "anonymous") === "true",
    createdAt: new Date(event.created_at * 1000),
  };
}

function rsvpIdentity(event: NostrEvent, appPubkey: string): string {
  return event.pubkey === appPubkey && tagValue(event, "anonymous") === "true" ? event.id : event.pubkey;
}

function accessTypeFromTag(value: string | undefined): "public" | "gated" {
  return value === "public" ? "public" : "gated";
}

function eventOriginFromTag(value: string | undefined, source: CreateEventCommand["source"] | undefined): EventOrigin | undefined {
  if (value === "studio" || value === "admin" || value === "public" || value === "import") {
    return value;
  }

  return source ? "import" : undefined;
}

function parseCrewProfile(event: NostrEvent): CrewProfileDto | null {
  const slug = tagValue(event, "d");
  if (!slug) {
    return null;
  }

  return {
    id: event.id,
    slug,
    name: tagValue(event, "name") || slug,
    summary: tagValue(event, "summary") || event.content.trim(),
    avatarUrl: tagValue(event, "image"),
    bannerUrl: tagValue(event, "banner"),
    simplexUrl: tagValue(event, "simplex"),
    websiteUrl: tagValue(event, "website"),
    lightningAddress: tagValue(event, "lud16"),
    archived: tagValue(event, "archived") === "true",
    createdAt: parseDateFromSeconds(tagValue(event, "created")) ?? new Date(event.created_at * 1000),
    updatedAt: new Date(event.created_at * 1000),
  };
}

function crewProfileTemplate(input: UpsertCrewProfileCommand, createdAt: Date): NostrUnsignedEvent {
  const name = input.name?.trim() || input.slug;
  const summary = input.summary?.trim() || "";
  const tags: string[][] = [
    ["d", input.slug],
    ["name", name],
    ["created", String(Math.floor(createdAt.getTime() / 1000))],
    ["client", "RaveMap"],
  ];

  if (summary) {
    tags.push(["summary", summary]);
  }
  if (input.avatarUrl) {
    tags.push(["image", input.avatarUrl]);
  }
  if (input.bannerUrl) {
    tags.push(["banner", input.bannerUrl]);
  }
  if (input.simplexUrl) {
    tags.push(["simplex", input.simplexUrl]);
  }
  if (input.websiteUrl) {
    tags.push(["website", input.websiteUrl]);
    tags.push(["r", input.websiteUrl]);
  }
  if (input.lightningAddress) {
    tags.push(["lud16", input.lightningAddress]);
  }
  if (input.archived) {
    tags.push(["archived", "true"]);
  }

  return {
    kind: CREW_PROFILE_KIND,
    created_at: nowSeconds(),
    tags,
    content: summary,
  };
}

function publicFieldsFromCommand(input: CreateEventCommand, createdAt = new Date().toISOString()): DraftBundle["public"] {
  return {
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    publicLocation: input.publicLocation,
    publicLatitude: input.publicLatitude,
    publicLongitude: input.publicLongitude,
    startsAt: input.startsAt.toISOString(),
    endAt: input.endAt?.toISOString(),
    coverImageUrl: input.coverImageUrl,
    externalUrl: input.externalUrl,
    simplexUrl: input.simplexUrl,
    source: input.source,
    genres: input.genres ?? [],
    lineup: input.lineup ?? [],
    tags: input.tags ?? [],
    galleryImageUrls: input.galleryImageUrls ?? [],
    accessType: input.accessType,
    origin: input.origin,
    crewSlug: input.crewSlug,
    createdAt,
  };
}

function publicDtoFromFields(fields: DraftBundle["public"], id: string, authorPubkey = ""): PublicEventDto {
  return {
    id,
    authorPubkey,
    slug: fields.slug,
    title: fields.title,
    summary: fields.summary,
    publicLocation: fields.publicLocation,
    publicLatitude: fields.publicLatitude,
    publicLongitude: fields.publicLongitude,
    startsAt: new Date(fields.startsAt),
    endAt: fields.endAt ? new Date(fields.endAt) : undefined,
    coverImageUrl: fields.coverImageUrl,
    externalUrl: fields.externalUrl,
    simplexUrl: fields.simplexUrl,
    source: fields.source,
    genres: fields.genres ?? [],
    lineup: fields.lineup ?? [],
    tags: fields.tags ?? [],
    galleryImageUrls: fields.galleryImageUrls ?? [],
    accessType: fields.accessType ?? "gated",
    origin: fields.origin,
    crewSlug: fields.crewSlug,
    createdAt: new Date(fields.createdAt),
  };
}

function commandFromFields(fields: DraftBundle["public"], isPublished: boolean): CreateEventCommand {
  return {
    slug: fields.slug,
    title: fields.title,
    summary: fields.summary,
    publicLocation: fields.publicLocation,
    publicLatitude: fields.publicLatitude,
    publicLongitude: fields.publicLongitude,
    startsAt: new Date(fields.startsAt),
    endAt: fields.endAt ? new Date(fields.endAt) : undefined,
    coverImageUrl: fields.coverImageUrl,
    externalUrl: fields.externalUrl,
    simplexUrl: fields.simplexUrl,
    source: fields.source,
    genres: fields.genres,
    lineup: fields.lineup,
    tags: fields.tags,
    galleryImageUrls: fields.galleryImageUrls,
    accessType: fields.accessType ?? "gated",
    isPublished,
    origin: fields.origin,
    crewSlug: fields.crewSlug,
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
    authorPubkey: event.pubkey,
    slug,
    title,
    summary: tagValue(event, "summary") || event.content,
    publicLocation,
    publicLatitude: parseNumberTag(tagValue(event, "lat"), -90, 90),
    publicLongitude: parseNumberTag(tagValue(event, "lon"), -180, 180),
    startsAt,
    endAt: parseDateFromSeconds(tagValue(event, "end")) ?? undefined,
    coverImageUrl: tagValue(event, "image"),
    externalUrl: tagValue(event, "external"),
    simplexUrl: tagValue(event, "simplex"),
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
    origin: eventOriginFromTag(
      tagValue(event, "origin"),
      tagValue(event, "source-url")
        ? {
            name: tagValue(event, "source") || "Imported",
            url: tagValue(event, "source-url") as string,
            id: tagValue(event, "source-id"),
            contentHash: tagValue(event, "source-hash"),
          }
        : undefined,
    ),
    crewSlug: tagValue(event, "crew"),
    createdAt: new Date(event.created_at * 1000),
  };
}

function isPublicSubmission(event: NostrEvent): boolean {
  return (
    tagValue(event, "client") === "RaveMap" &&
    tagValue(event, "submission") === "public" &&
    tagValues(event, "t").includes("ravemap")
  );
}

function publicEventTemplate(input: CreateEventCommand): NostrUnsignedEvent {
  const tags = [
    ["d", input.slug],
    ["title", input.title],
    ["summary", input.summary],
    ["location", input.publicLocation],
    ["start", String(Math.floor(input.startsAt.getTime() / 1000))],
    ["access", input.accessType],
    ["client", "RaveMap"],
  ];

  if (input.endAt) {
    tags.push(["end", String(Math.floor(input.endAt.getTime() / 1000))]);
  }

  if (input.publicLatitude !== undefined && input.publicLongitude !== undefined) {
    tags.push(["lat", String(input.publicLatitude)], ["lon", String(input.publicLongitude)]);
  }

  if (input.coverImageUrl) {
    tags.push(["image", input.coverImageUrl]);
  }

  if (input.externalUrl) {
    tags.push(["external", input.externalUrl]);
    tags.push(["r", input.externalUrl]);
  }

  if (input.simplexUrl) {
    tags.push(["simplex", input.simplexUrl]);
    if (input.simplexUrl.startsWith("https://")) {
      tags.push(["r", input.simplexUrl]);
    }
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

  if (input.origin) {
    tags.push(["origin", input.origin]);
  }

  if (input.crewSlug) {
    tags.push(["crew", input.crewSlug]);
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

function publicSubmissionTemplate(input: CreateEventCommand): NostrUnsignedEvent {
  const event = publicEventTemplate(input);
  return {
    ...event,
    tags: [...event.tags, ["submission", "public"], ["t", "ravemap"]],
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
    throw new AppError("Akce na kód vyžadují kód k odemknutí a tajnou lokaci", {
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
        message: "WebSocket není v tomto prostředí dostupný",
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
      finish(true, "dosažen časový limit čtení");
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
      finish(false, "čtení z relaye selhalo");
    });
  });
}

function relayPublish(relay: string, event: NostrEvent, timeoutMs: number): Promise<RelayWriteResult> {
  return new Promise((resolve) => {
    if (typeof WebSocket === "undefined") {
      resolve({
        relay,
        ok: false,
        message: "WebSocket není v tomto prostředí dostupný",
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
      finish(false, "dosažen časový limit zápisu");
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
      finish(false, "zápis na relay selhal");
    });
  });
}

function lightningAddressMetadataUrl(address: string): string {
  const [name, domain] = address.split("@");
  if (!name || !domain) {
    throw new AppError("Lightning adresa není platná", {
      code: "LIGHTNING_ADDRESS_INVALID",
      status: 400,
      expose: true,
    });
  }

  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

function parseZapReceipt(event: NostrEvent, targetCoordinate: string): { id: string; amountMsats: number; createdAt: Date } | null {
  if (event.kind !== ZAP_RECEIPT_KIND || !tagValues(event, "a").includes(targetCoordinate)) {
    return null;
  }

  const description = tagValue(event, "description");
  if (!description) {
    return null;
  }

  let request: NostrEvent;
  try {
    request = JSON.parse(description) as NostrEvent;
  } catch {
    return null;
  }

  const amountMsats = Number(tagValue(request, "amount"));
  if (
    request.kind !== ZAP_REQUEST_KIND ||
    !verifyEvent(request) ||
    !tagValues(request, "a").includes(targetCoordinate) ||
    !Number.isFinite(amountMsats) ||
    amountMsats <= 0
  ) {
    return null;
  }

  return {
    id: event.id,
    amountMsats,
    createdAt: new Date(event.created_at * 1000),
  };
}

function promoScore(amountMsats: number, createdAt: Date): number {
  const ageDays = Math.max(0, (Date.now() - createdAt.getTime()) / 86_400_000);
  const decay = Math.max(0, 1 - ageDays / 14);
  return (amountMsats / 1000) * decay;
}

export class NostrEventRepository {
  private readonly relays: string[];
  private readonly readTimeoutMs: number;
  private readonly writeTimeoutMs: number;
  private readonly writeMinSuccess: number;
  private readonly signer: NostrSigner;
  private readonly pubkey: string;
  private readonly readCache = new Map<string, ReadCacheEntry<unknown>>();

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
      throw new AppError("Nepodařilo se dosáhnout zapisovacího kvóra Nostr relayů", {
        code: "NOSTR_WRITE_FAILED",
        status: 502,
        expose: import.meta.env.DEV,
      });
    }

    this.readCache.clear();
    return results;
  }

  private cacheGet<T>(key: string): T | undefined {
    const cached = this.readCache.get(key);
    if (!cached) {
      return undefined;
    }

    if (cached.expiresAt <= Date.now()) {
      this.readCache.delete(key);
      return undefined;
    }

    return cached.value as T;
  }

  private cacheSet<T>(key: string, value: T, ttlMs: number): T {
    if (!this.readCache.has(key) && this.readCache.size >= MAX_READ_CACHE_ENTRIES) {
      const now = Date.now();
      for (const [cachedKey, cached] of this.readCache) {
        if (cached.expiresAt <= now) {
          this.readCache.delete(cachedKey);
        }
      }

      while (this.readCache.size >= MAX_READ_CACHE_ENTRIES) {
        const oldestKey = this.readCache.keys().next().value as string | undefined;
        if (oldestKey === undefined) {
          break;
        }
        this.readCache.delete(oldestKey);
      }
    }

    this.readCache.set(key, {
      expiresAt: Date.now() + ttlMs,
      value,
    });
    return value;
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

  private async enrichEventsWithCrews<T extends PublicEventDto>(events: T[]): Promise<T[]> {
    const crewSlugs = [...new Set(events.map((event) => event.crewSlug).filter((slug): slug is string => Boolean(slug)))];
    if (crewSlugs.length === 0) {
      return events;
    }

    const crews = await this.listCrewProfiles({ includeArchived: true }).catch(() => []);
    const crewBySlug = new Map(crews.map((crew) => [crew.slug, crew]));
    return events.map((event) => {
      const crew = event.crewSlug ? crewBySlug.get(event.crewSlug) : undefined;
      return crew
        ? {
            ...event,
            crewName: crew.name,
            crewLightningAddress: crew.lightningAddress,
          }
        : event;
    });
  }

  private latestPublishedByD(events: NostrEvent[]): Map<string, NostrEvent> {
    const bySlug = new Map<string, NostrEvent>();

    for (const event of events) {
      const slug = tagValue(event, "d");
      const allowed = event.pubkey === this.pubkey || isPublicSubmission(event);
      if (!slug || !allowed) {
        continue;
      }

      const existing = bySlug.get(slug);
      const existingIsApp = existing?.pubkey === this.pubkey;
      const eventIsApp = event.pubkey === this.pubkey;
      if (!existing || (eventIsApp && !existingIsApp) || (eventIsApp === existingIsApp && event.created_at > existing.created_at)) {
        bySlug.set(slug, event);
      }
    }

    return bySlug;
  }

  private publicEventFilters(limit: number, slug?: string): NostrFilter[] {
    const slugFilter = slug ? { "#d": [slug] } : {};
    return [
      {
        authors: [this.pubkey],
        kinds: [PUBLIC_EVENT_KIND],
        limit,
        ...slugFilter,
      },
      {
        kinds: [PUBLIC_EVENT_KIND],
        "#t": ["ravemap"],
        limit,
        ...slugFilter,
      },
    ];
  }

  private async fetchOriginalAuthorDeletions(events: NostrEvent[]): Promise<NostrEvent[]> {
    const targets = events
      .filter((event) => event.pubkey !== this.pubkey)
      .map((event) => {
        const slug = tagValue(event, "d");
        return slug ? { event, coordinate: nostrCoordinate(event.kind, event.pubkey, slug) } : null;
      })
      .filter((target): target is { event: NostrEvent; coordinate: string } => Boolean(target));
    if (targets.length === 0) {
      return [];
    }

    const authors = [...new Set(targets.map((target) => target.event.pubkey))];
    const ids = [...new Set(targets.map((target) => target.event.id))];
    const coordinates = [...new Set(targets.map((target) => target.coordinate))];
    const limit = Math.max(100, targets.length * 4);

    return this.fetchEvents([
      {
        authors,
        kinds: [DELETE_EVENT_KIND],
        "#e": ids,
        limit,
      },
      {
        authors,
        kinds: [DELETE_EVENT_KIND],
        "#a": coordinates,
        limit,
      },
    ]);
  }

  private async visibleLatestPublishedEvents(events: NostrEvent[], tombstones: Set<string>): Promise<NostrEvent[]> {
    const candidates = [...this.latestPublishedByD(events).values()].filter((event) => {
      const slug = tagValue(event, "d");
      return Boolean(slug && !tombstones.has(slug));
    });
    const deletions = await this.fetchOriginalAuthorDeletions(candidates);
    return candidates.filter((event) => {
      const slug = tagValue(event, "d");
      if (!slug) return false;
      const coordinate = nostrCoordinate(event.kind, event.pubkey, slug);
      return !deletions.some(
        (deletion) =>
          deletion.kind === DELETE_EVENT_KIND &&
          deletion.pubkey === event.pubkey &&
          deletion.created_at >= event.created_at &&
          (tagValues(deletion, "e").includes(event.id) || tagValues(deletion, "a").includes(coordinate)),
      );
    });
  }

  async listTombstonedSlugs(slugs?: string[]): Promise<Set<string>> {
    const cacheKey = slugs?.length ? `tombstones:${[...slugs].sort().join(",")}` : "tombstones:all";
    const cached = this.cacheGet<Set<string>>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const filters: NostrFilter[] = [
      {
        authors: [this.pubkey],
        kinds: [TOMBSTONE_EVENT_KIND],
        limit: 1000,
        ...(slugs ? { "#d": slugs } : {}),
      },
    ];

    const events = await this.fetchEvents(filters);
    const tombstones = [...this.latestByD(events).keys()];
    return this.cacheSet(cacheKey, new Set(tombstones), LIST_READ_CACHE_TTL_MS);
  }

  async listCrewProfiles(options: { includeArchived?: boolean } = {}): Promise<CrewProfileDto[]> {
    const cacheKey = `crews:${options.includeArchived ? "all" : "active"}`;
    const cached = this.cacheGet<CrewProfileDto[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const events = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [CREW_PROFILE_KIND],
        limit: 500,
      },
    ]);

    const crews = [...this.latestByD(events).values()]
      .map(parseCrewProfile)
      .filter((crew): crew is CrewProfileDto => Boolean(crew && (options.includeArchived || !crew.archived)))
      .sort((left, right) => left.name.localeCompare(right.name, "cs-CZ"));

    return this.cacheSet(cacheKey, crews, LIST_READ_CACHE_TTL_MS);
  }

  async getCrewProfile(slug: string, options: { includeArchived?: boolean } = {}): Promise<CrewProfileDto | null> {
    const crews = await this.listCrewProfiles({ includeArchived: true });
    const crew = crews.find((item) => item.slug === slug) ?? null;
    if (!crew || (!options.includeArchived && crew.archived)) {
      return null;
    }
    return crew;
  }

  private async getCrewAccount(slug: string): Promise<{ slug: string; codeHash: string; archived?: boolean } | null> {
    const events = await this.fetchEvents([
      {
        authors: [this.pubkey],
        kinds: [CREW_ACCOUNT_KIND],
        "#d": [slug],
        limit: 20,
      },
    ]);
    const latest = this.latestByD(events).get(slug);
    if (!latest) {
      return null;
    }

    return decryptCrewAccountBundle(latest.content, {
      coordinate: nostrCoordinate(CREW_ACCOUNT_KIND, this.pubkey, slug),
    });
  }

  async authenticateCrew(slug: string, secret: string): Promise<CrewSessionDto> {
    const [profile, account] = await Promise.all([this.getCrewProfile(slug), this.getCrewAccount(slug)]);
    if (!profile || !account || account.archived || !(await verifyCrewCode(secret, account.codeHash))) {
      throw new AppError("Crew přihlašovací údaje nejsou platné", {
        code: "UNAUTHORIZED",
        status: 401,
        expose: true,
      });
    }

    return {
      slug: profile.slug,
      name: profile.name,
      lightningAddress: profile.lightningAddress,
    };
  }

  private async writeCrewAccount(slug: string, crewCode: string, archived = false): Promise<RelayWriteResult[]> {
    const accountEvent = await this.signer.sign({
      kind: CREW_ACCOUNT_KIND,
      created_at: nowSeconds(),
      tags: [
        ["d", slug],
        ["client", "RaveMap"],
        ...(archived ? [["archived", "true"]] : []),
      ],
      content: encryptCrewAccountBundle(
        {
          slug,
          codeHash: await hashCrewCode(crewCode),
          archived,
          updatedAt: new Date().toISOString(),
        },
        {
          coordinate: nostrCoordinate(CREW_ACCOUNT_KIND, this.pubkey, slug),
        },
      ),
    });

    return this.publish(accountEvent);
  }

  async upsertCrewProfile(input: UpsertCrewProfileCommand): Promise<{ id: string; slug: string; writes: RelayWriteResult[] }> {
    const existing = await this.getCrewProfile(input.slug, { includeArchived: true });
    if (!existing && !input.crewCode) {
      throw new AppError("Nová crew potřebuje crew kód pro Studio přístup", {
        code: "CREW_CODE_REQUIRED",
        status: 400,
        expose: true,
      });
    }

    const profileEvent = await this.signer.sign(crewProfileTemplate(input, existing?.createdAt ?? new Date()));
    const profileWrites = await this.publish(profileEvent);
    const accountWrites = input.crewCode ? await this.writeCrewAccount(input.slug, input.crewCode, Boolean(input.archived)) : [];
    return {
      id: profileEvent.id,
      slug: input.slug,
      writes: [...profileWrites, ...accountWrites],
    };
  }

  async rotateCrewCode(slug: string, crewCode: string): Promise<{ slug: string; writes: RelayWriteResult[] }> {
    const crew = await this.getCrewProfile(slug, { includeArchived: true });
    if (!crew) {
      throw new AppError("Crew nenalezena", {
        code: "CREW_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    return {
      slug,
      writes: await this.writeCrewAccount(slug, crewCode, crew.archived),
    };
  }

  async archiveCrew(slug: string): Promise<{ id: string; slug: string; writes: RelayWriteResult[] }> {
    const crew = await this.getCrewProfile(slug, { includeArchived: true });
    if (!crew) {
      throw new AppError("Crew nenalezena", {
        code: "CREW_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const profileEvent = await this.signer.sign(
      crewProfileTemplate(
        {
          slug: crew.slug,
          name: crew.name,
          summary: crew.summary,
          avatarUrl: crew.avatarUrl,
          bannerUrl: crew.bannerUrl,
          simplexUrl: crew.simplexUrl,
          websiteUrl: crew.websiteUrl,
          lightningAddress: crew.lightningAddress,
          archived: true,
        },
        crew.createdAt,
      ),
    );
    const profileWrites = await this.publish(profileEvent);
    return {
      id: profileEvent.id,
      slug,
      writes: profileWrites,
    };
  }

  async listPublishedEvents(limit?: number): Promise<PublicEventDto[]> {
    const normalizedLimit = limit ?? 200;
    const cacheKey = `published:${normalizedLimit}`;
    const cached = this.cacheGet<PublicEventDto[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const [events, tombstones] = await Promise.all([
      this.fetchEvents(this.publicEventFilters(normalizedLimit)),
      this.listTombstonedSlugs(),
    ]);

    const published = (await this.visibleLatestPublishedEvents(events, tombstones))
      .map(parsePublicEvent)
      .filter((event): event is PublicEventDto => Boolean(event && !tombstones.has(event.slug)))
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
      .slice(0, limit);

    const enriched = await this.enrichEventsWithCrews(published);
    return this.cacheSet(cacheKey, enriched, LIST_READ_CACHE_TTL_MS);
  }

  async getPublishedEvent(slug: string): Promise<PublicEventDto | null> {
    const cacheKey = `published-detail:${slug}`;
    const cached = this.cacheGet<PublicEventDto | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const [tombstones, events] = await Promise.all([
      this.listTombstonedSlugs([slug]),
      this.fetchEvents(this.publicEventFilters(20, slug)),
    ]);
    if (tombstones.has(slug)) {
      return this.cacheSet(cacheKey, null, LIST_READ_CACHE_TTL_MS);
    }

    const latest = (await this.visibleLatestPublishedEvents(events, tombstones)).find((event) => tagValue(event, "d") === slug);
    const parsed = latest ? parsePublicEvent(latest) : null;
    const enriched = parsed ? (await this.enrichEventsWithCrews([parsed]))[0] : null;
    return this.cacheSet(cacheKey, enriched ?? null, LIST_READ_CACHE_TTL_MS);
  }

  private async listCommentsForEvent(event: PublicEventDto): Promise<EventCommentDto[]> {
    const cacheKey = `comments:${event.authorPubkey}:${event.slug}`;
    const cached = this.cacheGet<EventCommentDto[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const coordinate = eventCoordinate(event.authorPubkey, event.slug);
    const events = await this.fetchEvents([
      {
        kinds: [COMMENT_EVENT_KIND],
        "#a": [coordinate],
        limit: 200,
      },
    ]);

    const comments = events
      .filter((comment) => tagValue(comment, "ravemap-event") === event.slug)
      .map(parseCommentEvent)
      .filter((comment): comment is EventCommentDto => Boolean(comment))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    return this.cacheSet(cacheKey, comments, INTERACTION_READ_CACHE_TTL_MS);
  }

  async listComments(slug: string): Promise<EventCommentDto[]> {
    const event = await this.getPublishedEvent(slug);
    if (!event) {
      throw new AppError("Akce nenalezena", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    return this.listCommentsForEvent(event);
  }

  async getRsvpSummariesForEvents(events: PublicEventDto[]): Promise<Record<string, EventRsvpSummaryDto>> {
    const summaries = Object.fromEntries(events.map((event) => [event.slug, { accepted: 0, tentative: 0, signals: 0 }])) as Record<
      string,
      EventRsvpSummaryDto
    >;
    if (events.length === 0) {
      return summaries;
    }

    const cacheKey = `rsvp-list:${events.map((event) => `${event.authorPubkey}:${event.slug}`).sort().join(",")}`;
    const cached = this.cacheGet<Record<string, EventRsvpSummaryDto>>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const eventByCoordinate = new Map(events.map((event) => [eventCoordinate(event.authorPubkey, event.slug), event]));
    const latestBySlug = new Map<string, Map<string, NostrEvent>>();
    const rsvps = await this.fetchEvents([
      {
        kinds: [RSVP_EVENT_KIND],
        "#a": [...eventByCoordinate.keys()],
        limit: Math.min(Math.max(events.length * 80, 500), 3000),
      },
    ]);

    for (const rsvp of rsvps) {
      const coordinate = tagValues(rsvp, "a").find((value) => eventByCoordinate.has(value));
      const target = coordinate ? eventByCoordinate.get(coordinate) : undefined;
      const status = rsvpStatusFromTag(tagValue(rsvp, "status"));
      if (!target || !status || tagValue(rsvp, "ravemap-event") !== target.slug) {
        continue;
      }

      const identity = rsvpIdentity(rsvp, this.pubkey);
      const latestForEvent = latestBySlug.get(target.slug) ?? new Map<string, NostrEvent>();
      const existing = latestForEvent.get(identity);
      if (!existing || rsvp.created_at > existing.created_at) {
        latestForEvent.set(identity, rsvp);
      }
      latestBySlug.set(target.slug, latestForEvent);
    }

    for (const [slug, latestByAuthor] of latestBySlug) {
      const summary: EventRsvpSummaryDto = { accepted: 0, tentative: 0, signals: 0 };
      for (const rsvp of latestByAuthor.values()) {
        const status = rsvpStatusFromTag(tagValue(rsvp, "status"));
        if (status) {
          summary[status] += 1;
        }
        if (rsvpSignalFromTag(tagValue(rsvp, "signal"))) {
          summary.signals += 1;
        }
      }
      summaries[slug] = summary;
    }

    return this.cacheSet(cacheKey, summaries, INTERACTION_READ_CACHE_TTL_MS);
  }

  private async listLatestRsvpEventsForEvent(event: PublicEventDto): Promise<NostrEvent[]> {
    const cacheKey = `rsvp-events:${event.authorPubkey}:${event.slug}`;
    const cached = this.cacheGet<NostrEvent[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const coordinate = eventCoordinate(event.authorPubkey, event.slug);
    const events = await this.fetchEvents([
      {
        kinds: [RSVP_EVENT_KIND],
        "#a": [coordinate],
        limit: 500,
      },
    ]);
    const latestByAuthor = new Map<string, NostrEvent>();
    for (const rsvp of events) {
      const status = rsvpStatusFromTag(tagValue(rsvp, "status"));
      if (!status || tagValue(rsvp, "ravemap-event") !== event.slug || !tagValues(rsvp, "a").includes(coordinate)) {
        continue;
      }

      const identity = rsvpIdentity(rsvp, this.pubkey);
      const existing = latestByAuthor.get(identity);
      if (!existing || rsvp.created_at > existing.created_at) {
        latestByAuthor.set(identity, rsvp);
      }
    }

    return this.cacheSet(
      cacheKey,
      [...latestByAuthor.values()].sort((left, right) => right.created_at - left.created_at),
      INTERACTION_READ_CACHE_TTL_MS,
    );
  }

  private async getRsvpSummaryForEvent(event: PublicEventDto): Promise<EventRsvpSummaryDto> {
    const cacheKey = `rsvp:${event.authorPubkey}:${event.slug}`;
    const cached = this.cacheGet<EventRsvpSummaryDto>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const rsvps = await this.listLatestRsvpEventsForEvent(event);
    const summary: EventRsvpSummaryDto = { accepted: 0, tentative: 0, signals: 0 };
    for (const rsvp of rsvps) {
      const status = rsvpStatusFromTag(tagValue(rsvp, "status"));
      if (status) {
        summary[status] += 1;
      }
      if (rsvpSignalFromTag(tagValue(rsvp, "signal"))) {
        summary.signals += 1;
      }
    }

    return this.cacheSet(cacheKey, summary, INTERACTION_READ_CACHE_TTL_MS);
  }

  private async listRsvpEntriesForEvent(event: PublicEventDto): Promise<EventRsvpEntryDto[]> {
    const cacheKey = `rsvp-entries:${event.authorPubkey}:${event.slug}`;
    const cached = this.cacheGet<EventRsvpEntryDto[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const entries = (await this.listLatestRsvpEventsForEvent(event))
      .map(parseRsvpEntry)
      .filter((entry): entry is EventRsvpEntryDto => Boolean(entry))
      .slice(0, 40);

    return this.cacheSet(cacheKey, entries, INTERACTION_READ_CACHE_TTL_MS);
  }

  async getPublishedEventPageData(slug: string): Promise<{
    event: PublicEventDto | null;
    comments: EventCommentDto[];
    rsvp: EventRsvpSummaryDto;
    rsvpEntries: EventRsvpEntryDto[];
  }> {
    const event = await this.getPublishedEvent(slug);
    if (!event) {
      return {
        event: null,
        comments: [],
        rsvp: { accepted: 0, tentative: 0, signals: 0 },
        rsvpEntries: [],
      };
    }

    const [comments, rsvp, rsvpEntries] = await Promise.all([
      this.listCommentsForEvent(event).catch(() => []),
      this.getRsvpSummaryForEvent(event).catch(() => ({ accepted: 0, tentative: 0, signals: 0 })),
      this.listRsvpEntriesForEvent(event).catch(() => []),
    ]);

    return { event, comments, rsvp, rsvpEntries };
  }

  private async getPromoTarget(
    targetType: PromoZapTargetType,
    slug: string,
  ): Promise<{ coordinate: string; lightningAddress: string; name: string }> {
    if (targetType === "crew") {
      const crew = await this.getCrewProfile(slug);
      if (!crew) {
        throw new AppError("Crew nenalezena", {
          code: "CREW_NOT_FOUND",
          status: 404,
          expose: true,
        });
      }
      if (!crew.lightningAddress) {
        throw new AppError("Crew nemá nastavenou Lightning adresu", {
          code: "CREW_ZAP_UNAVAILABLE",
          status: 409,
          expose: true,
        });
      }
      return {
        coordinate: crewCoordinate(this.pubkey, crew.slug),
        lightningAddress: crew.lightningAddress,
        name: crew.name,
      };
    }

    const event = await this.getPublishedEvent(slug);
    if (!event) {
      throw new AppError("Akce nenalezena", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }
    if (!event.crewSlug || !event.crewLightningAddress) {
      throw new AppError("Akce nemá crew s Lightning adresou", {
        code: "EVENT_ZAP_UNAVAILABLE",
        status: 409,
        expose: true,
      });
    }

    return {
      coordinate: eventCoordinate(event.authorPubkey, event.slug),
      lightningAddress: event.crewLightningAddress,
      name: event.title,
    };
  }

  async createPromoInvoice(input: {
    targetType: PromoZapTargetType;
    slug: string;
    amountSats: number;
    comment?: string;
  }): Promise<{ invoice: string; targetName: string; callback: string; zapRequest: NostrEvent }> {
    const target = await this.getPromoTarget(input.targetType, input.slug);
    const msats = input.amountSats * 1000;
    const metadataResult = await safeFetchJson<{
      callback?: string;
      minSendable?: number;
      maxSendable?: number;
      allowsNostr?: boolean;
      nostrPubkey?: string;
    }>(lightningAddressMetadataUrl(target.lightningAddress), {
      timeoutMs: 5000,
      maxBytes: 64 * 1024,
    });
    const metadataResponse = metadataResult.response;
    if (!metadataResponse.ok) {
      throw new AppError("Lightning adresa neodpovídá", {
        code: "LIGHTNING_ADDRESS_UNAVAILABLE",
        status: 502,
        expose: true,
      });
    }

    const metadata = metadataResult.json;
    if (
      !metadata.callback ||
      !metadata.allowsNostr ||
      !metadata.nostrPubkey ||
      !/^[0-9a-f]{64}$/.test(metadata.nostrPubkey) ||
      msats < Number(metadata.minSendable ?? 0) ||
      msats > Number(metadata.maxSendable ?? Number.MAX_SAFE_INTEGER)
    ) {
      throw new AppError("Lightning adresa nepodporuje ověřitelné Nostr zaps pro promo", {
        code: "NOSTR_ZAP_UNAVAILABLE",
        status: 409,
        expose: true,
      });
    }

    const zapRequest = await this.signer.sign({
      kind: ZAP_REQUEST_KIND,
      created_at: nowSeconds(),
      tags: [
        ["relays", ...this.relays.slice(0, 5)],
        ["amount", String(msats)],
        ["p", metadata.nostrPubkey],
        ["a", target.coordinate],
        ["client", "RaveMap"],
        ["promo", "true"],
      ],
      content: input.comment?.trim() ?? "",
    });
    const callbackUrl = validateSafeUrl(metadata.callback, { requireHttps: true });
    callbackUrl.searchParams.set("amount", String(msats));
    callbackUrl.searchParams.set("nostr", JSON.stringify(zapRequest));
    if (input.comment?.trim()) {
      callbackUrl.searchParams.set("comment", input.comment.trim());
    }

    const invoiceResult = await safeFetchJson<{ pr?: string; status?: string; reason?: string }>(callbackUrl, {
      timeoutMs: 5000,
      maxBytes: 64 * 1024,
    });
    const invoiceResponse = invoiceResult.response;
    if (!invoiceResponse.ok) {
      throw new AppError("Lightning fakturu se nepodařilo vytvořit", {
        code: "LIGHTNING_INVOICE_FAILED",
        status: 502,
        expose: true,
      });
    }
    const invoice = invoiceResult.json;
    if (!invoice.pr || invoice.status === "ERROR") {
      throw new AppError(invoice.reason || "Lightning faktura není dostupná", {
        code: "LIGHTNING_INVOICE_FAILED",
        status: 502,
        expose: true,
      });
    }

    return {
      invoice: invoice.pr,
      targetName: target.name,
      callback: metadata.callback,
      zapRequest,
    };
  }

  async getPromoZapSummary(targetType: PromoZapTargetType, slug: string): Promise<PromoZapSummaryDto> {
    const target = await this.getPromoTarget(targetType, slug);
    const events = await this.fetchEvents([
      {
        kinds: [ZAP_RECEIPT_KIND],
        "#a": [target.coordinate],
        limit: 300,
      },
    ]);
    const receipts = events
      .map((event) => parseZapReceipt(event, target.coordinate))
      .filter((receipt): receipt is { id: string; amountMsats: number; createdAt: Date } => Boolean(receipt))
      .filter((receipt) => Date.now() - receipt.createdAt.getTime() <= 14 * 86_400_000)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return {
      targetType,
      slug,
      receipts: receipts.length,
      totalMsats: receipts.reduce((sum, receipt) => sum + receipt.amountMsats, 0),
      score: Math.round(receipts.reduce((sum, receipt) => sum + promoScore(receipt.amountMsats, receipt.createdAt), 0)),
      recentReceipts: receipts.slice(0, 10),
    };
  }

  async listPromotedEvents(limit = 6, candidates?: PublicEventDto[]): Promise<Array<PublicEventDto & { promo: PromoZapSummaryDto }>> {
    const events = (candidates ?? (await this.listPublishedEvents(120))).filter((event) => event.startsAt.getTime() >= Date.now() && event.crewSlug);
    const promoted = await Promise.all(
      events.map(async (event) => {
        const promo = await this.getPromoZapSummary("event", event.slug).catch(() => null);
        return promo && promo.score > 0 ? { ...event, promo } : null;
      }),
    );

    return promoted
      .filter((event): event is PublicEventDto & { promo: PromoZapSummaryDto } => Boolean(event))
      .sort((left, right) => right.promo.score - left.promo.score)
      .slice(0, limit);
  }

  async createAnonymousComment(input: CreateCommentCommand): Promise<{ id: string; writes: RelayWriteResult[] }> {
    const event = await this.getPublishedEvent(input.slug);
    if (!event) {
      throw new AppError("Akce nenalezena", {
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
        ["A", eventCoordinate(event.authorPubkey, input.slug)],
        ["K", String(PUBLIC_EVENT_KIND)],
        ["P", event.authorPubkey],
        ["a", eventCoordinate(event.authorPubkey, input.slug)],
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
    const target = await this.getPublishedEvent(slug);
    if (!target) {
      throw new AppError("Akce nenalezena", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const coordinate = eventCoordinate(target.authorPubkey, slug);
    if (
      event.kind !== COMMENT_EVENT_KIND ||
      event.content.trim().length === 0 ||
      event.content.length > 1200 ||
      !tagValues(event, "a").includes(coordinate) ||
      tagValue(event, "ravemap-event") !== slug ||
      event.created_at > nowSeconds() + 10 * 60 ||
      !verifyEvent(event)
    ) {
      throw new AppError("Podepsaný komentář není platný", {
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

  async getRsvpSummary(slug: string): Promise<EventRsvpSummaryDto> {
    const event = await this.getPublishedEvent(slug);
    if (!event) {
      throw new AppError("Akce nenalezena", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    return this.getRsvpSummaryForEvent(event);
  }

  async listRsvpEntries(slug: string): Promise<EventRsvpEntryDto[]> {
    const event = await this.getPublishedEvent(slug);
    if (!event) {
      throw new AppError("Akce nenalezena", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    return this.listRsvpEntriesForEvent(event);
  }

  async createAnonymousRsvp(input: CreateRsvpCommand): Promise<{ id: string; writes: RelayWriteResult[] }> {
    const event = await this.getPublishedEvent(input.slug);
    if (!event) {
      throw new AppError("Akce nenalezena", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const nickname = input.nickname?.trim();
    const contact = input.contact?.trim();
    const coordinate = eventCoordinate(event.authorPubkey, input.slug);
    const rsvp = await this.signer.sign({
      kind: RSVP_EVENT_KIND,
      created_at: nowSeconds(),
      tags: [
        ["a", coordinate],
        ["d", `anonymous-${input.slug}-${crypto.randomUUID()}`],
        ["status", input.status],
        ["ravemap-event", input.slug],
        ["anonymous", "true"],
        ["client", "RaveMap"],
        ...(nickname ? [["nickname", nickname]] : []),
        ...(input.signal ? [["signal", input.signal]] : []),
        ...(contact && rsvpContactAllowed(input.signal) ? [["contact", contact]] : []),
      ],
      content: "",
    });

    return {
      id: rsvp.id,
      writes: await this.publish(rsvp),
    };
  }

  async publishSignedRsvp(slug: string, event: NostrEvent): Promise<{ id: string; writes: RelayWriteResult[] }> {
    const target = await this.getPublishedEvent(slug);
    if (!target) {
      throw new AppError("Akce nenalezena", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const coordinate = eventCoordinate(target.authorPubkey, slug);
    const signal = rsvpSignalFromTag(tagValue(event, "signal"));
    const contact = tagValue(event, "contact")?.trim();
    if (
      event.kind !== RSVP_EVENT_KIND ||
      !tagValues(event, "a").includes(coordinate) ||
      tagValue(event, "ravemap-event") !== slug ||
      !rsvpStatusFromTag(tagValue(event, "status")) ||
      (tagValue(event, "signal") !== undefined && !signal) ||
      (contact !== undefined && (!contact || contact.length > 120 || !rsvpContactAllowed(signal))) ||
      event.created_at > nowSeconds() + 10 * 60 ||
      !verifyEvent(event)
    ) {
      throw new AppError("Podepsaná odpověď k účasti není platná", {
        code: "INVALID_SIGNED_RSVP",
        status: 400,
        expose: true,
      });
    }

    return {
      id: event.id,
      writes: await this.publish(event),
    };
  }

  async createPublicSubmission(input: CreateEventCommand): Promise<CreatedEventResult> {
    const publicEvent = await this.signer.sign(publicSubmissionTemplate({ ...input, accessType: "public", isPublished: true }));
    const publicWrites = await this.publish(publicEvent);

    return {
      id: publicEvent.id,
      slug: input.slug,
      writes: publicWrites,
    };
  }

  async publishSignedPublicSubmission(input: PublicSubmitEventCommand): Promise<CreatedEventResult> {
    const event = input.signedEvent;
    if (!event) {
      throw new AppError("Chybí podepsaná akce", {
        code: "SIGNED_EVENT_MISSING",
        status: 400,
        expose: true,
      });
    }

    const slug = tagValue(event, "d");
    const startsAt = parseDateFromSeconds(tagValue(event, "start"));
    const access = tagValue(event, "access");
    const accessType = input.accessType ?? "public";
    const parsed = parsePublicEvent(event);
    if (
      accessType !== "public" ||
      event.kind !== PUBLIC_EVENT_KIND ||
      !parsed ||
      !slug ||
      !/^[a-z0-9-]{3,120}$/.test(slug) ||
      !startsAt ||
      access !== accessType ||
      tagValue(event, "client") !== "RaveMap" ||
      tagValue(event, "submission") !== "public" ||
      !tagValues(event, "t").includes("ravemap") ||
      event.content.trim().length < 10 ||
      event.content.length > 2000 ||
      event.created_at > nowSeconds() + 10 * 60 ||
      !verifyEvent(event)
    ) {
      throw new AppError("Podepsaná akce není platná", {
        code: "INVALID_SIGNED_EVENT",
        status: 400,
        expose: true,
      });
    }

    const existing = await this.getPublishedEvent(slug);
    if (existing && existing.authorPubkey !== event.pubkey) {
      throw new AppError("Tahle URL akce už je obsazená", {
        code: "SLUG_TAKEN",
        status: 409,
        expose: true,
      });
    }
    if (!existing && (await this.slugExists(slug))) {
      throw new AppError("Tahle URL akce už je obsazená", {
        code: "SLUG_TAKEN",
        status: 409,
        expose: true,
      });
    }

    const secretWrites =
      accessType === "gated"
        ? await (async () => {
            const command: CreateEventCommand = {
              slug,
              title: input.title,
              summary: input.summary,
              publicLocation: input.publicLocation,
              publicLatitude: input.publicLatitude,
              publicLongitude: input.publicLongitude,
              startsAt: input.startsAt,
              endAt: input.endAt,
              coverImageUrl: input.coverImageUrl,
              externalUrl: input.externalUrl,
              simplexUrl: input.simplexUrl,
              genres: input.genres,
              lineup: input.lineup,
              tags: input.tags,
              galleryImageUrls: [],
              accessType: "gated",
              isPublished: true,
              unlockCode: input.unlockCode,
              secretInfo: input.secretInfo,
              secretLocationName: input.secretLocationName,
              secretLatitude: input.secretLatitude,
              secretLongitude: input.secretLongitude,
              secretMapNote: input.secretMapNote,
            };
            const codeHash = await hashUnlockCode(input.unlockCode ?? "");
            const secret = secretFromCommand(command);
            const secretEvent = await this.signer.sign({
              kind: SECRET_EVENT_KIND,
              created_at: nowSeconds(),
              tags: [["d", slug]],
              content: encryptSecretBundle(
                {
                  codeHash,
                  secret,
                },
                {
                  coordinate: nostrCoordinate(SECRET_EVENT_KIND, this.pubkey, slug),
                },
              ),
            });
            return this.publish(secretEvent);
          })()
        : [];

    const writes = await this.publish(event);
    return {
      id: event.id,
      slug,
      writes: [...secretWrites, ...writes],
    };
  }

  async listAdminEvents(): Promise<AdminEventDto[]> {
    const tombstones = await this.listTombstonedSlugs();
    const events = await this.fetchEvents([
      ...this.publicEventFilters(500),
      {
        authors: [this.pubkey],
        kinds: [DRAFT_EVENT_KIND],
        limit: 500,
      },
    ]);

    const publicEvents = await this.enrichEventsWithCrews(
      (await this.visibleLatestPublishedEvents(events.filter((event) => event.kind === PUBLIC_EVENT_KIND), tombstones))
        .map(parsePublicEvent)
        .filter((event): event is PublicEventDto => Boolean(event && !tombstones.has(event.slug)))
        .map((event) => ({
          ...event,
          isPublished: true,
        })),
    );
    const publishedSlugs = new Set(publicEvents.map((event) => event.slug));

    const drafts = await this.enrichEventsWithCrews(
      [...this.latestByD(events.filter((event) => event.kind === DRAFT_EVENT_KIND)).values()]
        .map((event): AdminEventDto | null => {
          const slug = tagValue(event, "d");
          if (!slug || tombstones.has(slug) || publishedSlugs.has(slug)) {
            return null;
          }

          const draft = decryptDraftBundle(event.content, {
            coordinate: nostrCoordinate(DRAFT_EVENT_KIND, this.pubkey, slug),
          });
          return {
            ...publicDtoFromFields(draft.public, event.id, event.pubkey),
            isPublished: false,
          };
        })
        .filter((event): event is AdminEventDto => Boolean(event)),
    );

    return [...publicEvents, ...drafts].sort((left, right) => {
      const startsAtDiff = right.startsAt.getTime() - left.startsAt.getTime();
      return startsAtDiff || right.createdAt.getTime() - left.createdAt.getTime();
    });
  }

  async listStudioEvents(crewSlug?: string): Promise<AdminEventDto[]> {
    return (await this.listAdminEvents()).filter((event) => event.origin === "studio" && (!crewSlug || event.crewSlug === crewSlug));
  }

  private async getLatestDraftBundle(slug: string): Promise<{ event: NostrEvent; draft: DraftBundle } | null> {
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
      return null;
    }

    return {
      event: latest,
      draft: decryptDraftBundle(latest.content, {
        coordinate: nostrCoordinate(DRAFT_EVENT_KIND, this.pubkey, slug),
      }),
    };
  }

  private async getStudioEvent(slug: string, crewSlug?: string): Promise<AdminEventDto | null> {
    return (
      (await this.listAdminEvents()).find((event) => event.slug === slug && event.origin === "studio" && (!crewSlug || event.crewSlug === crewSlug)) ??
      null
    );
  }

  private async ensureStudioEvent(slug: string, crewSlug?: string): Promise<AdminEventDto> {
    const event = await this.getStudioEvent(slug, crewSlug);
    if (!event) {
      throw new AppError("Studio akce nenalezena", {
        code: "STUDIO_EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    return event;
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

      if (input.origin) {
        tags.push(["origin", input.origin]);
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

  async createStudioEvent(input: CreateEventCommand, crewSlug?: string): Promise<CreatedEventResult> {
    const command = { ...input, source: undefined, origin: "studio" as const, crewSlug };
    const existing = (await this.listAdminEvents()).find((event) => event.slug === command.slug);
    if (existing && existing.origin !== "studio") {
      throw new AppError("Tahle akce nepatří do Studia", {
        code: "STUDIO_EVENT_FORBIDDEN",
        status: 403,
        expose: true,
      });
    }
    if (crewSlug && existing && existing.crewSlug !== crewSlug) {
      throw new AppError("Tahle akce nepatří téhle crew", {
        code: "STUDIO_EVENT_FORBIDDEN",
        status: 403,
        expose: true,
      });
    }

    let codeHash: string | undefined;
    let secret: SecretPayload | undefined;
    if (command.accessType === "gated") {
      const hasAnySecret =
        Boolean(command.unlockCode) ||
        Boolean(command.secretInfo) ||
        Boolean(command.secretLocationName) ||
        command.secretLatitude !== undefined ||
        command.secretLongitude !== undefined ||
        Boolean(command.secretMapNote);
      const hasCompleteSecret =
        Boolean(command.unlockCode) &&
        Boolean(command.secretInfo) &&
        Boolean(command.secretLocationName) &&
        command.secretLatitude !== undefined &&
        command.secretLongitude !== undefined;

      if (hasAnySecret && !hasCompleteSecret) {
        throw new AppError("Nová tajná vrstva musí mít kód, info, lokaci a souřadnice", {
          code: "STUDIO_SECRET_INCOMPLETE",
          status: 400,
          expose: true,
        });
      }

      if (hasCompleteSecret) {
        codeHash = await hashUnlockCode(command.unlockCode ?? "");
        secret = secretFromCommand(command);
      } else if (existing) {
        const draft = existing.isPublished ? null : await this.getLatestDraftBundle(command.slug);
        const secretBundle = existing.isPublished ? await this.getSecretBundle(command.slug) : null;
        codeHash = draft?.draft.codeHash ?? secretBundle?.codeHash;
        secret = draft?.draft.secret ?? secretBundle?.secret;
      }

      if (!codeHash || !secret) {
        throw new AppError("Akce na kód vyžaduje kód a tajnou lokaci", {
          code: "STUDIO_SECRET_REQUIRED",
          status: 400,
          expose: true,
        });
      }
    }

    if (!command.isPublished) {
      const draftBundle: DraftBundle = {
        public: publicFieldsFromCommand(command),
        codeHash,
        secret,
      };
      const draftEvent = await this.signer.sign({
        kind: DRAFT_EVENT_KIND,
        created_at: nowSeconds(),
        tags: [
          ["d", command.slug],
          ["access", command.accessType],
          ["origin", "studio"],
          ...(crewSlug ? [["crew", crewSlug]] : []),
        ],
        content: encryptDraftBundle(draftBundle, {
          coordinate: nostrCoordinate(DRAFT_EVENT_KIND, this.pubkey, command.slug),
        }),
      });

      return {
        id: draftEvent.id,
        slug: command.slug,
        writes: await this.publish(draftEvent),
      };
    }

    if (command.accessType === "public") {
      const publicEvent = await this.signer.sign(publicEventTemplate(command));
      return {
        id: publicEvent.id,
        slug: command.slug,
        writes: await this.publish(publicEvent),
      };
    }

    const secretEvent = await this.signer.sign({
      kind: SECRET_EVENT_KIND,
      created_at: nowSeconds(),
      tags: [["d", command.slug]],
      content: encryptSecretBundle(
        {
          codeHash: codeHash as string,
          secret: secret as SecretPayload,
        },
        {
          coordinate: nostrCoordinate(SECRET_EVENT_KIND, this.pubkey, command.slug),
        },
      ),
    });
    const secretWrites = await this.publish(secretEvent);
    const publicEvent = await this.signer.sign(publicEventTemplate(command));
    const publicWrites = await this.publish(publicEvent);

    return {
      id: publicEvent.id,
      slug: command.slug,
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
      throw new AppError("Akce nenalezena", {
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
      throw new AppError("Koncept nenalezen", {
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
      throw new AppError("Koncept na kód nemá tajná data", {
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

  async publishStudioDraft(slug: string, crewSlug?: string): Promise<CreatedEventResult> {
    const draft = await this.getLatestDraftBundle(slug);
    if (!draft || draft.draft.public.origin !== "studio" || (crewSlug && draft.draft.public.crewSlug !== crewSlug)) {
      throw new AppError("Studio koncept nenalezen", {
        code: "STUDIO_DRAFT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    return this.publishDraft(slug);
  }

  async archiveStudioEvent(slug: string, crewSlug?: string): Promise<DeletedEventResult> {
    await this.ensureStudioEvent(slug, crewSlug);
    return this.deleteEvent(slug);
  }

  async assignStudioEventToCrew(eventSlug: string, crewSlug: string): Promise<CreatedEventResult> {
    const crew = await this.getCrewProfile(crewSlug);
    if (!crew) {
      throw new AppError("Crew nenalezena", {
        code: "CREW_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    const event = await this.ensureStudioEvent(eventSlug);
    if (!event.isPublished) {
      const draft = await this.getLatestDraftBundle(eventSlug);
      if (!draft) {
        throw new AppError("Studio koncept nenalezen", {
          code: "STUDIO_DRAFT_NOT_FOUND",
          status: 404,
          expose: true,
        });
      }

      const publicFields = {
        ...draft.draft.public,
        origin: "studio" as const,
        crewSlug,
      };
      const draftEvent = await this.signer.sign({
        kind: DRAFT_EVENT_KIND,
        created_at: nowSeconds(),
        tags: [
          ["d", eventSlug],
          ["access", publicFields.accessType ?? "public"],
          ["origin", "studio"],
          ["crew", crewSlug],
        ],
        content: encryptDraftBundle(
          {
            ...draft.draft,
            public: publicFields,
          },
          {
            coordinate: nostrCoordinate(DRAFT_EVENT_KIND, this.pubkey, eventSlug),
          },
        ),
      });

      return {
        id: draftEvent.id,
        slug: eventSlug,
        writes: await this.publish(draftEvent),
      };
    }

    const publicEvent = await this.signer.sign(
      publicEventTemplate({
        slug: event.slug,
        title: event.title,
        summary: event.summary,
        publicLocation: event.publicLocation,
        publicLatitude: event.publicLatitude,
        publicLongitude: event.publicLongitude,
        startsAt: event.startsAt,
        endAt: event.endAt,
        coverImageUrl: event.coverImageUrl,
        externalUrl: event.externalUrl,
        simplexUrl: event.simplexUrl,
        genres: event.genres,
        lineup: event.lineup,
        tags: event.tags,
        galleryImageUrls: event.galleryImageUrls,
        accessType: event.accessType,
        isPublished: true,
        origin: "studio",
        crewSlug,
      }),
    );

    return {
      id: publicEvent.id,
      slug: eventSlug,
      writes: await this.publish(publicEvent),
    };
  }

  async deleteEvent(slug: string): Promise<DeletedEventResult> {
    const [existing, displayed] = await Promise.all([
      this.fetchEvents([
        {
          authors: [this.pubkey],
          kinds: [PUBLIC_EVENT_KIND, SECRET_EVENT_KIND, DRAFT_EVENT_KIND],
          "#d": [slug],
          limit: 50,
        },
      ]),
      this.getPublishedEvent(slug),
    ]);

    if (existing.length === 0 && !displayed) {
      throw new AppError("Akce nenalezena", {
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

    const deletionWrites =
      deleteTags.length > 0
        ? await (async () => {
            const deleteEvent = await this.signer.sign({
              kind: DELETE_EVENT_KIND,
              created_at: nowSeconds(),
              tags: deleteTags,
              content: "Deleted from RaveMap.",
            });
            return Promise.all(this.relays.map((relay) => relayPublish(relay, deleteEvent, this.writeTimeoutMs)));
          })()
        : [];

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
