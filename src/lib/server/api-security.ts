import { requireAdmin } from "./auth";
import { isAppError } from "./errors";
import { jsonRateLimited } from "./http";
import { enforceFixedWindowRateLimit } from "./rate-limit";
import { getClientIp, hashIpAddress } from "./request";

export async function enforceRequestRateLimit(
  request: Request,
  scope: string,
  options: { limit: number; windowMs: number; code: string; message: string; keySuffix?: string },
): Promise<Response | null> {
  const ipHash = hashIpAddress(getClientIp(request));
  const key = options.keySuffix ? `${ipHash}:${options.keySuffix}` : ipHash;
  const state = await enforceFixedWindowRateLimit(scope, key, options);
  return state.blocked ? jsonRateLimited(options.code, options.message, state.retryAfterSeconds) : null;
}

export async function recordAuthFailureRateLimit(
  request: Request,
  scope: string,
  options: { code: string; message: string; keySuffix?: string },
): Promise<Response | null> {
  return enforceRequestRateLimit(request, scope, {
    limit: 8,
    windowMs: 15 * 60 * 1000,
    code: options.code,
    message: options.message,
    keySuffix: options.keySuffix,
  });
}

export async function requireAdminOrRateLimited(request: Request): Promise<Response | null> {
  try {
    requireAdmin(request);
    return null;
  } catch (error) {
    if (isAppError(error) && error.status === 401) {
      const limited = await recordAuthFailureRateLimit(request, "admin-auth", {
        code: "ADMIN_AUTH_RATE_LIMITED",
        message: "Příliš mnoho neúspěšných pokusů o admin přístup. Zkus to později.",
      });
      if (limited) return limited;
    }
    throw error;
  }
}
