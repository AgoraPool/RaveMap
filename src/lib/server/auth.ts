import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import { getEnv } from "./env";

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf-8").digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(hashSecret(a), hashSecret(b));
}

export function requireAdmin(request: Request): void {
  const env = getEnv();
  const headerSecret = request.headers.get("x-admin-secret");
  const authHeader = request.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  const providedSecret = headerSecret?.trim() || bearerSecret;
  if (!providedSecret) {
    throw new AppError("Chybí admin přihlašovací údaje", {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }

  if (!safeEqual(providedSecret, env.ADMIN_SECRET)) {
    throw new AppError("Admin přihlašovací údaje nejsou platné", {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }
}
