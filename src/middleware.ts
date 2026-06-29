import { defineMiddleware } from "astro:middleware";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' https: data:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self' https: ws: wss:",
    "frame-src https://www.openstreetmap.org",
    "upgrade-insecure-requests",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
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

export const onRequest = defineMiddleware(async ({ request, url }, next) => {
  const response = await next();

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
