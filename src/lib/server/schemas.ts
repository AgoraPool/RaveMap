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

export const createEventSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    summary: z.string().trim().min(10).max(2000),
    publicLocation: z.string().trim().min(2).max(180),
    startsAt: z.string().trim().datetime({ offset: true }),
    coverImageUrl: optionalHttpUrlSchema,
    isPublished: z.boolean().optional(),
    slug: slugSchema.optional(),
    unlockCode: z.string().trim().min(8).max(128),
    secretInfo: z.string().trim().min(1).max(5000),
    secretLocationName: z.string().trim().min(2).max(180),
    secretLatitude: z.number().min(-90).max(90),
    secretLongitude: z.number().min(-180).max(180),
    secretMapNote: optionalTrimmedString(500),
  })
  .strict();

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

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type DeleteEventInput = z.infer<typeof deleteEventSchema>;
