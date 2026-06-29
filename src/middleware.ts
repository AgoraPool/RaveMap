import { defineMiddleware } from "astro:middleware";
import { randomBytes } from "node:crypto";

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' https: data:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `script-src 'self' 'nonce-${nonce}'`,
    "connect-src 'self'",
    "frame-src https://www.openstreetmap.org",
    "upgrade-insecure-requests",
  ].join("; ");
}

const SECURITY_HEADERS: Record<string, string> = {
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function cacheHeaderFor(pathname: string, method: string): string | null {
  if (method !== "GET") {
    return null;
  }

  if (pathname === "/akce" || pathname.startsWith("/akce/")) {
    return "public, max-age=20, stale-while-revalidate=120";
  }

  return null;
}

export const onRequest = defineMiddleware(async ({ request, url, locals }, next) => {
  const nonce = randomBytes(16).toString("base64");
  locals.cspNonce = nonce;
  const response = await next();

  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) {
      response.headers.set(name, value);
    }
  }

  const cacheControl = cacheHeaderFor(url.pathname, request.method);
  if (cacheControl && !response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", cacheControl);
  }

  return response;
});
