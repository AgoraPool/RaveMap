import type { APIRoute } from "astro";
import { sql } from "drizzle-orm";
import { db } from "../../../db/client";
import { auditLogs, events } from "../../../db/schema";
import { requireAdmin } from "../../../lib/server/auth";
import { jsonOk, withApiErrorHandling } from "../../../lib/server/http";

export const GET: APIRoute = async ({ request }) =>
  withApiErrorHandling(async () => {
    requireAdmin(request);

    const result: Record<string, unknown> = {
      checks: {},
    };

    const checks = result.checks as Record<string, unknown>;

    const identity = await db.execute(sql`select current_user, session_user`);
    checks.identity = identity;

    const rlsState = await db.execute(sql`
      select relname, relrowsecurity
      from pg_class
      where relname in ('events','event_secrets','audit_logs','unlock_attempts')
      order by relname
    `);
    checks.rls = rlsState;

    const eventsCount = await db.select({ id: events.id }).from(events).limit(1);
    checks.eventsSelect = { ok: true, rows: eventsCount.length };

    const inserted = await db
      .insert(auditLogs)
      .values({
        actor: "diag",
        action: "diag.write",
        entityType: "diag",
        entityId: crypto.randomUUID(),
        metadata: { source: "diagnostics" },
      })
      .returning({ id: auditLogs.id });

    const insertedId = inserted[0]?.id;
    checks.auditInsert = { ok: !!insertedId };

    if (insertedId) {
      await db.execute(sql`delete from audit_logs where id = ${insertedId}`);
      checks.auditCleanup = { ok: true };
    }

    return jsonOk(result);
  });
