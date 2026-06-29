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
    throw new AppError(`${label} přihlašovací údaje nejsou platné`, {
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
  const expected = getEnv().ORGANIZER_SECRET;
  if (!expected) {
    throw new AppError("Sdílený organizer kód je vypnutý; použij crew přihlášení", {
      code: "ORGANIZER_SECRET_DISABLED",
      status: 401,
      expose: true,
    });
  }

  requireSecret(request, "x-organizer-secret", expected, "Organizer");
}

export type CrewCredentials = {
  slug: string;
  secret: string;
};

export function readCrewCredentials(request: Request): CrewCredentials {
  const slug = request.headers.get("x-crew-slug")?.trim().toLowerCase();
  const secret = providedSecret(request, "x-crew-secret");

  if (!slug || !secret) {
    throw new AppError("Crew přihlašovací údaje nejsou platné", {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }

  if (!/^[a-z0-9-]{3,120}$/.test(slug)) {
    throw new AppError("Crew přihlašovací údaje nejsou platné", {
      code: "UNAUTHORIZED",
      status: 401,
      expose: true,
    });
  }

  return { slug, secret };
}
