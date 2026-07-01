import { z } from "zod";
import { RSVP_CONTACT_SIGNALS, RSVP_SIGNALS } from "./nostr-types";

const slugSchema = z.string().trim().min(3).max(120).regex(/^[a-z0-9-]+$/);

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSimplexUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isSimplexHost =
      hostname === "simplex.chat" || hostname === "www.simplex.chat" || hostname === "simplex.im" || hostname.endsWith(".simplex.im");
    return (url.protocol === "https:" && isSimplexHost) || url.protocol === "simplex:";
  } catch {
    return false;
  }
}

const optionalHttpUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z
    .string()
    .max(2048)
    .refine(isHttpUrl, { message: "Povolené jsou jen http a https URL" })
    .optional(),
);

const optionalSimplexUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z
    .string()
    .max(2048)
    .refine(isSimplexUrl, { message: "Použij SimpleX odkaz ze simplex.chat, simplex.im nebo simplex: invite" })
    .optional(),
);

const optionalTrimmedString = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z.string().max(max).optional(),
  );

const lightningAddressSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim().toLowerCase();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z
    .string()
    .max(320)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, { message: "Použij lightning adresu ve tvaru jmeno@domena" })
    .optional(),
);

const optionalSecretCodeSchema = (min: number, max: number, message: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z.string().min(min, { message }).max(max).optional(),
  );

const stringListSchema = z.preprocess(
  (value) => {
    if (!Array.isArray(value)) {
      return value;
    }

    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  },
  z.array(z.string().min(1).max(120)).max(40).default([]),
);

const httpUrlListSchema = z.preprocess(
  (value) => {
    if (!Array.isArray(value)) {
      return value;
    }

    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  },
  z.array(z.string().max(2048).refine(isHttpUrl, { message: "Povolené jsou jen http a https URL" })).max(20).default([]),
);

export const createEventSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    summary: z.string().trim().min(10).max(2000),
    publicLocation: z.string().trim().min(2).max(180),
    publicLatitude: z.number().min(-90).max(90).optional(),
    publicLongitude: z.number().min(-180).max(180).optional(),
    startsAt: z.string().trim().datetime({ offset: true }),
    endAt: z.string().trim().datetime({ offset: true }).optional(),
    coverImageUrl: optionalHttpUrlSchema,
    externalUrl: optionalHttpUrlSchema,
    simplexUrl: optionalSimplexUrlSchema,
    sourceName: optionalTrimmedString(80),
    sourceUrl: optionalHttpUrlSchema,
    genres: stringListSchema,
    lineup: stringListSchema,
    tags: stringListSchema,
    galleryImageUrls: httpUrlListSchema,
    accessType: z.enum(["public", "gated"]).optional(),
    isPublished: z.boolean().optional(),
    slug: slugSchema.optional(),
    unlockCode: optionalTrimmedString(128),
    secretInfo: optionalTrimmedString(4400),
    secretLocationName: optionalTrimmedString(180),
    secretLatitude: z.number().min(-90).max(90).optional(),
    secretLongitude: z.number().min(-180).max(180).optional(),
    secretMapNote: optionalTrimmedString(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.publicLatitude === undefined) !== (value.publicLongitude === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "Šířka a délka musí být vyplněné společně",
        path: ["publicLatitude"],
      });
    }

    const accessType = value.accessType ?? (value.unlockCode ? "gated" : "public");
    if (accessType !== "gated") {
      return;
    }

    const required: Array<keyof typeof value> = [
      "unlockCode",
      "secretInfo",
      "secretLocationName",
      "secretLatitude",
      "secretLongitude",
    ];

    for (const field of required) {
      const fieldValue = value[field];
      const missing = typeof fieldValue === "string" ? fieldValue.trim().length === 0 : fieldValue === undefined;
      if (missing) {
        ctx.addIssue({
          code: "custom",
          message: "Povinné pro akce na kód",
          path: [field],
        });
      }
    }

    if (value.unlockCode && value.unlockCode.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Kód k odemknutí musí mít alespoň 8 znaků",
        path: ["unlockCode"],
      });
    }
  });

export const deleteEventSchema = z
  .object({
    slug: slugSchema,
    confirmSlug: slugSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.slug !== value.confirmSlug) {
      ctx.addIssue({
        code: "custom",
        message: "Potvrzovací slug se musí shodovat se slugem akce",
        path: ["confirmSlug"],
      });
    }
  });

export const eventActionSchema = z
  .object({
    slug: slugSchema,
    action: z.enum(["publish"]),
  })
  .strict();

export const studioEventActionSchema = z
  .object({
    slug: slugSchema,
    action: z.enum(["publish", "archive"]),
  })
  .strict();

export const crewAuthSchema = z
  .object({
    crewSlug: slugSchema,
    crewCode: z.string().trim().min(12).max(160),
  })
  .strict();

export const adminCrewSchema = z
  .object({
    action: z.enum(["upsert", "rotate-code", "archive", "assign-event"]),
    slug: slugSchema,
    name: optionalTrimmedString(80),
    summary: optionalTrimmedString(1000),
    avatarUrl: optionalHttpUrlSchema,
    bannerUrl: optionalHttpUrlSchema,
    simplexUrl: optionalSimplexUrlSchema,
    websiteUrl: optionalHttpUrlSchema,
    lightningAddress: lightningAddressSchema,
    crewCode: optionalSecretCodeSchema(12, 160, "Crew kód musí mít alespoň 12 znaků"),
    eventSlug: slugSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "rotate-code" && !value.crewCode) {
      ctx.addIssue({
        code: "custom",
        message: "Crew kód je povinný",
        path: ["crewCode"],
      });
    }

    if (value.action === "assign-event" && !value.eventSlug) {
      ctx.addIssue({
        code: "custom",
        message: "Slug akce je povinný",
        path: ["eventSlug"],
      });
    }
  });

const nostrTagSchema = z.array(z.string().max(2048)).min(1).max(8);
const signedNostrEventSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{64}$/),
    pubkey: z.string().regex(/^[0-9a-f]{64}$/),
    created_at: z.number().int().positive(),
    kind: z.number().int(),
    tags: z.array(nostrTagSchema).max(100),
    content: z.string().max(4400),
    sig: z.string().regex(/^[0-9a-f]{128}$/),
  })
  .strict();

export const createCommentSchema = z
  .object({
    content: z.string().trim().min(1).max(1200),
    nickname: optionalTrimmedString(40),
    signedEvent: signedNostrEventSchema.optional(),
  })
  .strict();

export const publicSubmitEventSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    summary: z.string().trim().min(10).max(2000),
    publicLocation: z.string().trim().min(2).max(180),
    publicLatitude: z.number().min(-90).max(90).optional(),
    publicLongitude: z.number().min(-180).max(180).optional(),
    startsAt: z.string().trim().datetime({ offset: true }),
    endAt: z.string().trim().datetime({ offset: true }).optional(),
    coverImageUrl: optionalHttpUrlSchema,
    externalUrl: optionalHttpUrlSchema,
    simplexUrl: optionalSimplexUrlSchema,
    genres: stringListSchema,
    lineup: stringListSchema,
    tags: stringListSchema,
    accessType: z.enum(["public", "gated"]).optional(),
    website: optionalTrimmedString(250),
    unlockCode: optionalTrimmedString(128),
    secretInfo: optionalTrimmedString(4400),
    secretLocationName: optionalTrimmedString(180),
    secretLatitude: z.number().min(-90).max(90).optional(),
    secretLongitude: z.number().min(-180).max(180).optional(),
    secretMapNote: optionalTrimmedString(500),
    signedEvent: signedNostrEventSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.publicLatitude === undefined) !== (value.publicLongitude === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "Šířka a délka musí být vyplněné společně",
        path: ["publicLatitude"],
      });
    }

    const accessType = value.accessType ?? "public";
    if (accessType !== "gated") {
      return;
    }

    const required: Array<keyof typeof value> = [
      "unlockCode",
      "secretInfo",
      "secretLocationName",
      "secretLatitude",
      "secretLongitude",
    ];

    for (const field of required) {
      const fieldValue = value[field];
      const missing = typeof fieldValue === "string" ? fieldValue.trim().length === 0 : fieldValue === undefined;
      if (missing) {
        ctx.addIssue({
          code: "custom",
          message: "Povinné pro akce na kód",
          path: [field],
        });
      }
    }

    if (value.unlockCode && value.unlockCode.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Kód k odemknutí musí mít alespoň 8 znaků",
        path: ["unlockCode"],
      });
    }
  });

export const rsvpSchema = z
  .object({
    status: z.enum(["accepted", "tentative"]),
    nickname: optionalTrimmedString(40),
    signal: z.enum(RSVP_SIGNALS).optional(),
    contact: optionalTrimmedString(120),
    signedEvent: signedNostrEventSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.contact && (!value.signal || !RSVP_CONTACT_SIGNALS.includes(value.signal as (typeof RSVP_CONTACT_SIGNALS)[number]))) {
      ctx.addIssue({
        code: "custom",
        message: "Kontakt lze přidat jen ke signálu hledám partu nebo mám místo v autě",
        path: ["contact"],
      });
    }
  });

export const studioEventSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    summary: z.string().trim().min(10).max(2000),
    publicLocation: z.string().trim().min(2).max(180),
    publicLatitude: z.number().min(-90).max(90).optional(),
    publicLongitude: z.number().min(-180).max(180).optional(),
    startsAt: z.string().trim().datetime({ offset: true }),
    endAt: z.string().trim().datetime({ offset: true }).optional(),
    coverImageUrl: optionalHttpUrlSchema,
    externalUrl: optionalHttpUrlSchema,
    simplexUrl: optionalSimplexUrlSchema,
    genres: stringListSchema,
    lineup: stringListSchema,
    tags: stringListSchema,
    accessType: z.enum(["public", "gated"]).default("public"),
    isPublished: z.boolean().default(false),
    slug: slugSchema.optional(),
    unlockCode: optionalTrimmedString(128),
    secretInfo: optionalTrimmedString(4400),
    secretLocationName: optionalTrimmedString(180),
    secretLatitude: z.number().min(-90).max(90).optional(),
    secretLongitude: z.number().min(-180).max(180).optional(),
    secretMapNote: optionalTrimmedString(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.publicLatitude === undefined) !== (value.publicLongitude === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "Šířka a délka musí být vyplněné společně",
        path: ["publicLatitude"],
      });
    }

    if (value.accessType !== "gated") {
      return;
    }

    if (value.unlockCode && value.unlockCode.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Kód k odemknutí musí mít alespoň 8 znaků",
        path: ["unlockCode"],
      });
    }

    if ((value.secretLatitude === undefined) !== (value.secretLongitude === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "Tajná šířka a délka musí být vyplněné společně",
        path: ["secretLatitude"],
      });
    }
  });

export const promoZapQuerySchema = z
  .object({
    targetType: z.enum(["event", "crew"]),
    slug: slugSchema,
  })
  .strict();

export const promoInvoiceSchema = z
  .object({
    targetType: z.enum(["event", "crew"]),
    slug: slugSchema,
    amountSats: z.number().int().min(21).max(1_000_000),
    comment: optionalTrimmedString(120),
  })
  .strict();

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type DeleteEventInput = z.infer<typeof deleteEventSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type PublicSubmitEventInput = z.infer<typeof publicSubmitEventSchema>;
export type RsvpInput = z.infer<typeof rsvpSchema>;
export type StudioEventInput = z.infer<typeof studioEventSchema>;
export type CrewAuthInput = z.infer<typeof crewAuthSchema>;
export type AdminCrewInput = z.infer<typeof adminCrewSchema>;
export type PromoZapQueryInput = z.infer<typeof promoZapQuerySchema>;
export type PromoInvoiceInput = z.infer<typeof promoInvoiceSchema>;
