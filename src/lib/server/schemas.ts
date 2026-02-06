import { z } from "zod";

export const createEventSchema = z.object({
  title: z.string().trim().min(3).max(180),
  summary: z.string().trim().min(10).max(2000),
  publicLocation: z.string().trim().min(2).max(180),
  startsAt: z.string().datetime({ offset: true }),
  coverImageUrl: z.string().url().optional(),
  isPublished: z.boolean().optional(),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  unlockCode: z.string().trim().min(8).max(128),
  secretInfo: z.string().trim().min(1).max(5000),
  secretLocationName: z.string().trim().min(2).max(180),
  secretLatitude: z.number().min(-90).max(90),
  secretLongitude: z.number().min(-180).max(180),
  secretMapNote: z.string().trim().max(500).optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
