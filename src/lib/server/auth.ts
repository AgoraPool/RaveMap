import { timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import { getEnv } from "./env";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf-8");
  const right = Buffer.from(b, "utf-8");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function requireAdmin(request: Request): void {
  const env = getEnv();
  const headerSecret = request.headers.get("x-admin-secret");
  const authHeader = request.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  const providedSecret = headerSecret?.trim() || bearerSecret;
  if (!providedSecret) {
    throw new AppError("Admin credentials missing", {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }

  if (!safeEqual(providedSecret, env.ADMIN_SECRET)) {
    throw new AppError("Admin credentials invalid", {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }
}
