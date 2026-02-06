import { createHash } from "node:crypto";
import { getEnv } from "./env";

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "unknown";
}

export function hashIpAddress(ip: string): string {
  const env = getEnv();
  return createHash("sha256").update(`${ip}:${env.ADMIN_SECRET}`).digest("hex");
}
