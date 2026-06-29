import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import { getEnv } from "./env";

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf-8").digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(hashSecret(a), hashSecret(b));
}

function providedSecret(request: Request, headerName: string): string | null {
  const headerSecret = request.headers.get(headerName);
  const authHeader = request.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  return headerSecret?.trim() || bearerSecret || null;
}

function requireSecret(request: Request, headerName: string, expectedSecret: string, label: string): void {
  const provided = providedSecret(request, headerName);
  if (!provided) {
    throw new AppError(`Chybí ${label.toLowerCase()} přihlašovací údaje`, {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }

  if (!safeEqual(provided, expectedSecret)) {
    throw new AppError(`${label} přihlašovací údaje nejsou platné`, {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }
}

export function requireAdmin(request: Request): void {
  requireSecret(request, "x-admin-secret", getEnv().ADMIN_SECRET, "Admin");
}

export function requireOrganizer(request: Request): void {
  requireSecret(request, "x-organizer-secret", getEnv().ORGANIZER_SECRET, "Organizer");
}
