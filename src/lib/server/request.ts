import { createHmac } from "node:crypto";
import { getEnv } from "./env";

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "unknown";
}

export function hashIpAddress(ip: string): string {
  const env = getEnv();
  return createHmac("sha256", env.RATE_LIMIT_SECRET).update(ip, "utf-8").digest("hex");
}
