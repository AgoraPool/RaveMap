import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { unlockAttempts } from "../../db/schema";

type AttemptState = {
  blocked: boolean;
  retryAfterSeconds?: number;
};

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_MS = 30 * 60 * 1000;

export async function enforceUnlockRateLimit(eventSlug: string, ipHash: string): Promise<AttemptState> {
  const now = new Date();

  const existing = await db
    .select()
    .from(unlockAttempts)
    .where(and(eq(unlockAttempts.eventSlug, eventSlug), eq(unlockAttempts.ipHash, ipHash)))
    .limit(1);

  const record = existing[0];
  if (!record) {
    await db.insert(unlockAttempts).values({
      eventSlug,
      ipHash,
      failedCount: 0,
      windowStart: now,
      blockedUntil: null,
    });

    return { blocked: false };
  }

  if (record.blockedUntil && record.blockedUntil.getTime() > now.getTime()) {
    const retryAfterSeconds = Math.ceil((record.blockedUntil.getTime() - now.getTime()) / 1000);
    return { blocked: true, retryAfterSeconds };
  }

  const windowExpired = now.getTime() - record.windowStart.getTime() > WINDOW_MS;
  if (windowExpired) {
    await db
      .update(unlockAttempts)
      .set({
        failedCount: 0,
        windowStart: now,
        blockedUntil: null,
        updatedAt: now,
      })
      .where(and(eq(unlockAttempts.eventSlug, eventSlug), eq(unlockAttempts.ipHash, ipHash)));
  }

  return { blocked: false };
}

export async function recordUnlockFailure(eventSlug: string, ipHash: string): Promise<void> {
  const now = new Date();
  const existing = await db
    .select()
    .from(unlockAttempts)
    .where(and(eq(unlockAttempts.eventSlug, eventSlug), eq(unlockAttempts.ipHash, ipHash)))
    .limit(1);

  const record = existing[0];
  if (!record) {
    await db.insert(unlockAttempts).values({
      eventSlug,
      ipHash,
      failedCount: 1,
      windowStart: now,
      blockedUntil: null,
    });
    return;
  }

  const windowExpired = now.getTime() - record.windowStart.getTime() > WINDOW_MS;
  const nextFailed = windowExpired ? 1 : record.failedCount + 1;
  const shouldBlock = nextFailed >= MAX_FAILED_ATTEMPTS;

  await db
    .update(unlockAttempts)
    .set({
      failedCount: nextFailed,
      windowStart: windowExpired ? now : record.windowStart,
      blockedUntil: shouldBlock ? new Date(now.getTime() + BLOCK_MS) : null,
      updatedAt: now,
    })
    .where(and(eq(unlockAttempts.eventSlug, eventSlug), eq(unlockAttempts.ipHash, ipHash)));
}

export async function clearUnlockFailures(eventSlug: string, ipHash: string): Promise<void> {
  const now = new Date();
  await db
    .update(unlockAttempts)
    .set({
      failedCount: 0,
      blockedUntil: null,
      windowStart: now,
      updatedAt: now,
    })
    .where(and(eq(unlockAttempts.eventSlug, eventSlug), eq(unlockAttempts.ipHash, ipHash)));
}
