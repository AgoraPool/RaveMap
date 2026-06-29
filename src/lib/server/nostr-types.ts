export const PUBLIC_EVENT_KIND = 31923;
export const RSVP_EVENT_KIND = 31925;
export const COMMENT_EVENT_KIND = 1111;
export const SECRET_EVENT_KIND = 30420;
export const DRAFT_EVENT_KIND = 30421;
export const TOMBSTONE_EVENT_KIND = 30422;
export const DELETE_EVENT_KIND = 5;

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type NostrUnsignedEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type NostrFilter = {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  "#d"?: string[];
  "#e"?: string[];
  "#a"?: string[];
  "#t"?: string[];
};

export type EventAccessType = "public" | "gated";

export type EventSource = {
  name: string;
  url: string;
  id?: string;
  contentHash?: string;
};

export type PublicEventDto = {
  id: string;
  authorPubkey: string;
  slug: string;
  title: string;
  summary: string;
  publicLocation: string;
  publicLatitude?: number;
  publicLongitude?: number;
  startsAt: Date;
  endAt?: Date;
  coverImageUrl?: string;
  externalUrl?: string;
  simplexUrl?: string;
  source?: EventSource;
  genres: string[];
  lineup: string[];
  tags: string[];
  galleryImageUrls: string[];
  accessType: EventAccessType;
  createdAt: Date;
};

export type PublicSubmitEventCommand = {
  title: string;
  summary: string;
  publicLocation: string;
  publicLatitude?: number;
  publicLongitude?: number;
  startsAt: Date;
  endAt?: Date;
  coverImageUrl?: string;
  externalUrl?: string;
  simplexUrl?: string;
  genres?: string[];
  lineup?: string[];
  tags?: string[];
  accessType?: EventAccessType;
  unlockCode?: string;
  secretInfo?: string;
  secretLocationName?: string;
  secretLatitude?: number;
  secretLongitude?: number;
  secretMapNote?: string;
  signedEvent?: NostrEvent;
};

export type AdminEventDto = PublicEventDto & {
  isPublished: boolean;
};

export type EventCommentDto = {
  id: string;
  slug: string;
  content: string;
  authorPubkey: string;
  authorName: string;
  isAnonymous: boolean;
  createdAt: Date;
};

export type RsvpStatus = "accepted" | "tentative";

export type EventRsvpSummaryDto = {
  accepted: number;
  tentative: number;
};

export type CreateRsvpCommand = {
  slug: string;
  status: RsvpStatus;
  nickname?: string;
};

export type CreateCommentCommand = {
  slug: string;
  content: string;
  nickname?: string;
};

export type RelayWriteResult = {
  relay: string;
  ok: boolean;
  message?: string;
};

export type RelayReadResult = {
  relay: string;
  ok: boolean;
  events: number;
  message?: string;
};

export type CreateEventCommand = {
  slug: string;
  title: string;
  summary: string;
  publicLocation: string;
  publicLatitude?: number;
  publicLongitude?: number;
  startsAt: Date;
  endAt?: Date;
  coverImageUrl?: string;
  externalUrl?: string;
  simplexUrl?: string;
  source?: EventSource;
  genres?: string[];
  lineup?: string[];
  tags?: string[];
  galleryImageUrls?: string[];
  accessType: EventAccessType;
  isPublished: boolean;
  unlockCode?: string;
  secretInfo?: string;
  secretLocationName?: string;
  secretLatitude?: number;
  secretLongitude?: number;
  secretMapNote?: string;
};
