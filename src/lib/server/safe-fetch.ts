import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./errors";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 512 * 1024;

export type SafeFetchOptions = {
  headers?: HeadersInit;
  timeoutMs?: number;
  maxBytes?: number;
  requireHttps?: boolean;
  allowPrivateHosts?: boolean;
};

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function normalizedIpv6(address: string): string {
  return address.toLowerCase();
}

function isPrivateIpv6(address: string): boolean {
  const value = normalizedIpv6(address);
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:") ||
    value.startsWith("2001:db8:")
  );
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "0.0.0.0";
}

function isBlockedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

export function validateSafeUrl(rawUrl: string | URL, options: SafeFetchOptions = {}): URL {
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  if (url.username || url.password) {
    throw new AppError("URL nesmí obsahovat přihlašovací údaje", {
      code: "OUTBOUND_URL_FORBIDDEN",
      status: 400,
      expose: true,
    });
  }

  if (options.requireHttps !== false && url.protocol !== "https:") {
    throw new AppError("Odchozí požadavek musí používat HTTPS", {
      code: "OUTBOUND_URL_FORBIDDEN",
      status: 400,
      expose: true,
    });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AppError("Odchozí protokol není povolený", {
      code: "OUTBOUND_URL_FORBIDDEN",
      status: 400,
      expose: true,
    });
  }

  if (!options.allowPrivateHosts && (isBlockedHostname(url.hostname) || (isIP(url.hostname) && isBlockedIp(url.hostname)))) {
    throw new AppError("Odchozí host není povolený", {
      code: "OUTBOUND_URL_FORBIDDEN",
      status: 400,
      expose: true,
    });
  }

  return url;
}

async function assertResolvedHostAllowed(url: URL, allowPrivateHosts: boolean | undefined): Promise<void> {
  if (allowPrivateHosts || isIP(url.hostname)) {
    return;
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
    throw new AppError("Odchozí host není povolený", {
      code: "OUTBOUND_URL_FORBIDDEN",
      status: 400,
      expose: true,
    });
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Best effort only.
      }
      throw new AppError("Odchozí odpověď je příliš velká", {
        code: "OUTBOUND_RESPONSE_TOO_LARGE",
        status: 502,
        expose: true,
      });
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export async function safeFetchText(rawUrl: string | URL, options: SafeFetchOptions = {}): Promise<{ response: Response; text: string }> {
  const url = validateSafeUrl(rawUrl, options);
  await assertResolvedHostAllowed(url, options.allowPrivateHosts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: options.headers,
      redirect: "error",
      signal: controller.signal,
    });
    const text = await readLimitedText(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    return { response, text };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Odchozí požadavek selhal", {
      code: "OUTBOUND_FETCH_FAILED",
      status: 502,
      expose: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function safeFetchJson<T>(rawUrl: string | URL, options: SafeFetchOptions = {}): Promise<{ response: Response; json: T }> {
  const headers = new Headers(options.headers);
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }

  const { response, text } = await safeFetchText(rawUrl, {
    ...options,
    headers,
  });
  try {
    return { response, json: JSON.parse(text) as T };
  } catch {
    throw new AppError("Odchozí JSON odpověď není platná", {
      code: "OUTBOUND_JSON_INVALID",
      status: 502,
      expose: true,
    });
  }
}
