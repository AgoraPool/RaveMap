type AttemptRecord = {
  failedCount: number;
  windowStart: number;
  blockedUntil: number | null;
  updatedAt: number;
};

type AttemptState = {
  blocked: boolean;
  retryAfterSeconds?: number;
};

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_MS = 30 * 60 * 1000;
const MAX_RECORDS = 5000;

const attempts = new Map<string, AttemptRecord>();
const commentAttempts = new Map<string, number[]>();

function getKey(eventSlug: string, ipHash: string): string {
  return `${eventSlug}:${ipHash}`;
}

function pruneAttempts(now: number): void {
  if (attempts.size <= MAX_RECORDS) {
    return;
  }

  for (const [key, record] of attempts) {
    const blockExpired = !record.blockedUntil || record.blockedUntil <= now;
    const staleWindow = now - record.updatedAt > WINDOW_MS;
    if (blockExpired && staleWindow) {
      attempts.delete(key);
    }

    if (attempts.size <= MAX_RECORDS) {
      return;
    }
  }
}

export async function enforceUnlockRateLimit(eventSlug: string, ipHash: string): Promise<AttemptState> {
  const now = Date.now();
  pruneAttempts(now);

  const key = getKey(eventSlug, ipHash);
  const record = attempts.get(key);
  if (!record) {
    attempts.set(key, {
      failedCount: 0,
      windowStart: now,
      blockedUntil: null,
      updatedAt: now,
    });
    return { blocked: false };
  }

  if (record.blockedUntil && record.blockedUntil > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((record.blockedUntil - now) / 1000),
    };
  }

  if (now - record.windowStart > WINDOW_MS) {
    attempts.set(key, {
      failedCount: 0,
      windowStart: now,
      blockedUntil: null,
      updatedAt: now,
    });
  }

  return { blocked: false };
}

export async function recordUnlockFailure(eventSlug: string, ipHash: string): Promise<void> {
  const now = Date.now();
  const key = getKey(eventSlug, ipHash);
  const record =
    attempts.get(key) ??
    ({
      failedCount: 0,
      windowStart: now,
      blockedUntil: null,
      updatedAt: now,
    } satisfies AttemptRecord);

  const windowExpired = now - record.windowStart > WINDOW_MS;
  const failedCount = windowExpired ? 1 : record.failedCount + 1;

  attempts.set(key, {
    failedCount,
    windowStart: windowExpired ? now : record.windowStart,
    blockedUntil: failedCount >= MAX_FAILED_ATTEMPTS ? now + BLOCK_MS : null,
    updatedAt: now,
  });
}

export async function clearUnlockFailures(eventSlug: string, ipHash: string): Promise<void> {
  attempts.delete(getKey(eventSlug, ipHash));
}

export async function enforceCommentRateLimit(eventSlug: string, ipHash: string): Promise<AttemptState> {
  const now = Date.now();
  const key = getKey(eventSlug, ipHash);
  const windowMs = 10 * 60 * 1000;
  const recent = (commentAttempts.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);

  if (recent.length >= 6) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((windowMs - (now - recent[0])) / 1000),
    };
  }

  recent.push(now);
  commentAttempts.set(key, recent);

  if (commentAttempts.size > MAX_RECORDS) {
    for (const [recordKey, timestamps] of commentAttempts) {
      if (timestamps.every((timestamp) => now - timestamp >= windowMs)) {
        commentAttempts.delete(recordKey);
      }
      if (commentAttempts.size <= MAX_RECORDS) {
        break;
      }
    }
  }

  return { blocked: false };
}
