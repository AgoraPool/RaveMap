import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { events } from "../../../db/schema";
import { AppError } from "../../../lib/server/errors";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";

export const GET: APIRoute = async ({ params }) =>
  withApiErrorHandling(async () => {
    const slug = params.slug?.trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
      throw new AppError("Invalid event slug", {
        code: "INVALID_SLUG",
        status: 400,
        expose: true,
      });
    }

    const match = await db
      .select({
        slug: events.slug,
        title: events.title,
        summary: events.summary,
        publicLocation: events.publicLocation,
        startsAt: events.startsAt,
        coverImageUrl: events.coverImageUrl,
      })
      .from(events)
      .where(and(eq(events.slug, slug), eq(events.isPublished, true)))
      .limit(1);

    const event = match[0];
    if (!event) {
      throw new AppError("Event not found", {
        code: "EVENT_NOT_FOUND",
        status: 404,
        expose: true,
      });
    }

    return jsonOk({ event });
  });
