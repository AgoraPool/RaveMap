import { z } from "zod";
import { AppError } from "./errors";

const PLACEHOLDER_RE = /(change-?me|todo|example|placeholder|password|development|^secret$|^admin$|^test$)/i;
const MIN_SECRET_ENTROPY_CHARS = 32;

function isSimplexUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isSimplexHost =
      hostname === "simplex.chat" || hostname === "www.simplex.chat" || hostname === "simplex.im" || hostname.endsWith(".simplex.im");
    return (url.protocol === "https:" && isSimplexHost) || url.protocol === "simplex:";
  } catch {
    return false;
  }
}

const optionalSimplexUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z.string().max(2048).refine(isSimplexUrl).optional(),
);

function hasReasonableSecretEntropy(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < MIN_SECRET_ENTROPY_CHARS || PLACEHOLDER_RE.test(trimmed)) {
    return false;
  }

  const classes = [
    /[a-z]/.test(trimmed),
    /[A-Z]/.test(trimmed),
    /\d/.test(trimmed),
    /[^a-zA-Z\d]/.test(trimmed),
  ].filter(Boolean).length;
  const uniqueChars = new Set(trimmed).size;
  return classes >= 2 && uniqueChars >= 12;
}

const strongSecretSchema = z
  .string()
  .trim()
  .min(MIN_SECRET_ENTROPY_CHARS)
  .refine(hasReasonableSecretEntropy, { message: "Secret must be high entropy and not a placeholder" });

const optionalStrongSecretSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  strongSecretSchema.optional(),
);

function isStrictBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }

  return Buffer.from(value, "base64").toString("base64") === value;
}

const encryptionKeySchema = z.string().trim().refine(
  (value) => {
    try {
      return isStrictBase64(value) && Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  },
  { message: "ENCRYPTION_KEY must be base64 for exactly 32 bytes" },
);

function isStrongNostrPrivateKey(value: string): boolean {
  const trimmed = value.trim();
  if (PLACEHOLDER_RE.test(trimmed)) {
    return false;
  }

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return hasReasonableSecretEntropy(trimmed);
  }

  if (/^nsec1[023456789acdefghjklmnpqrstuvwxyz]+$/i.test(trimmed)) {
    return trimmed.length >= 63 && hasReasonableSecretEntropy(trimmed);
  }

  return false;
}

function parseRelayUrls(value: string): string[] {
  return value
    .split(",")
    .map((relay) => relay.trim())
    .filter(Boolean);
}

function isRelayUrl(value: string, production: boolean): boolean {
  try {
    const url = new URL(value);
    return production ? url.protocol === "wss:" : url.protocol === "wss:" || url.protocol === "ws:";
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    ADMIN_SECRET: strongSecretSchema,
    ORGANIZER_SECRET: optionalStrongSecretSchema,
    ENCRYPTION_KEY: encryptionKeySchema,
    RATE_LIMIT_SECRET: strongSecretSchema,
    NOSTR_RELAYS: z.string().min(1),
    NOSTR_PRIVATE_KEY: z.string().trim().min(1).refine(isStrongNostrPrivateKey, {
      message: "NOSTR_PRIVATE_KEY must be a high-entropy 64-char hex key or nsec",
    }),
    NOSTR_READ_TIMEOUT_MS: z.coerce.number().int().positive().max(15000).default(3000),
    NOSTR_WRITE_TIMEOUT_MS: z.coerce.number().int().positive().max(20000).default(4400),
    NOSTR_WRITE_MIN_SUCCESS: z.coerce.number().int().positive().default(1),
    MIRROR_SOURCE_URL: z.string().url().default("https://www.jiripetrak.cz/cs/tekno-parties-freetekno-kalendar-udalosti-42/"),
    MIRROR_SYNC_SECRET: optionalStrongSecretSchema,
    MIRROR_USER_AGENT: z.string().trim().min(1).max(180).default("Nostr event mirror"),
    SIMPLEX_GROUP_URL: optionalSimplexUrlSchema,
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  })
  .superRefine((value, ctx) => {
    const production = value.NODE_ENV === "production";
    const relays = parseRelayUrls(value.NOSTR_RELAYS);
    if (relays.length === 0) {
      ctx.addIssue({ code: "custom", message: "NOSTR_RELAYS must contain at least one relay URL", path: ["NOSTR_RELAYS"] });
      return;
    }

    for (const relay of relays) {
      if (!isRelayUrl(relay, production)) {
        ctx.addIssue({
          code: "custom",
          message: production ? "Production NOSTR_RELAYS must use wss://" : "NOSTR_RELAYS must use ws:// or wss://",
          path: ["NOSTR_RELAYS"],
        });
      }
    }

    if (value.NOSTR_WRITE_MIN_SUCCESS > relays.length) {
      ctx.addIssue({
        code: "custom",
        message: "NOSTR_WRITE_MIN_SUCCESS cannot exceed relay count",
        path: ["NOSTR_WRITE_MIN_SUCCESS"],
      });
    }

    try {
      const mirrorUrl = new URL(value.MIRROR_SOURCE_URL);
      if (production && mirrorUrl.protocol !== "https:") {
        ctx.addIssue({ code: "custom", message: "Production MIRROR_SOURCE_URL must use https://", path: ["MIRROR_SOURCE_URL"] });
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "MIRROR_SOURCE_URL is invalid", path: ["MIRROR_SOURCE_URL"] });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;
export type RawAppEnv = Record<string, unknown>;

export function validateAppEnv(input: RawAppEnv): AppEnv {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("Missing or invalid required environment variables", {
      code: "ENV_INVALID",
      status: 500,
    });
  }

  return parsed.data;
}

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = validateAppEnv({
    ADMIN_SECRET: import.meta.env.ADMIN_SECRET,
    ORGANIZER_SECRET: import.meta.env.ORGANIZER_SECRET,
    ENCRYPTION_KEY: import.meta.env.ENCRYPTION_KEY,
    RATE_LIMIT_SECRET: import.meta.env.RATE_LIMIT_SECRET,
    NOSTR_RELAYS: import.meta.env.NOSTR_RELAYS,
    NOSTR_PRIVATE_KEY: import.meta.env.NOSTR_PRIVATE_KEY,
    NOSTR_READ_TIMEOUT_MS: import.meta.env.NOSTR_READ_TIMEOUT_MS,
    NOSTR_WRITE_TIMEOUT_MS: import.meta.env.NOSTR_WRITE_TIMEOUT_MS,
    NOSTR_WRITE_MIN_SUCCESS: import.meta.env.NOSTR_WRITE_MIN_SUCCESS,
    MIRROR_SOURCE_URL: import.meta.env.MIRROR_SOURCE_URL,
    MIRROR_SYNC_SECRET: import.meta.env.MIRROR_SYNC_SECRET,
    MIRROR_USER_AGENT: import.meta.env.MIRROR_USER_AGENT,
    SIMPLEX_GROUP_URL: import.meta.env.SIMPLEX_GROUP_URL,
    NODE_ENV: import.meta.env.NODE_ENV,
  });
  return cachedEnv;
}
