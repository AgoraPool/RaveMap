import { z } from "zod";

const slugSchema = z.string().trim().min(3).max(120).regex(/^[a-z0-9-]+$/);

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
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
    .refine(isHttpUrl, { message: "Only http and https URLs are allowed" })
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
  z.array(z.string().max(2048).refine(isHttpUrl, { message: "Only http and https URLs are allowed" })).max(20).default([]),
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
        message: "Latitude and longitude must be provided together",
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
          message: "Required for code-gated events",
          path: [field],
        });
      }
    }

    if (value.unlockCode && value.unlockCode.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Unlock code must be at least 8 characters",
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
        message: "Confirmation slug must match event slug",
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
    genres: stringListSchema,
    lineup: stringListSchema,
    tags: stringListSchema,
    accessType: z.enum(["public", "gated"]).optional(),
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
        message: "Latitude and longitude must be provided together",
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
          message: "Required for code-gated events",
          path: [field],
        });
      }
    }

    if (value.unlockCode && value.unlockCode.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "Unlock code must be at least 8 characters",
        path: ["unlockCode"],
      });
    }
  });

export const rsvpSchema = z
  .object({
    status: z.enum(["accepted", "tentative"]),
    nickname: optionalTrimmedString(40),
    signedEvent: signedNostrEventSchema.optional(),
  })
  .strict();

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type DeleteEventInput = z.infer<typeof deleteEventSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type PublicSubmitEventInput = z.infer<typeof publicSubmitEventSchema>;
export type RsvpInput = z.infer<typeof rsvpSchema>;
