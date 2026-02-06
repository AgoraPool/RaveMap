import type { APIRoute } from "astro";
import { asc, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { events } from "../../../db/schema";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";

export const GET: APIRoute = async () =>
  withApiErrorHandling(async () => {
    const list = await db
      .select({
        slug: events.slug,
        title: events.title,
        summary: events.summary,
        publicLocation: events.publicLocation,
        startsAt: events.startsAt,
        coverImageUrl: events.coverImageUrl,
      })
      .from(events)
      .where(eq(events.isPublished, true))
      .orderBy(asc(events.startsAt));

    return jsonOk({ events: list });
  });
