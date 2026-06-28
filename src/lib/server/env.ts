import { z } from "zod";
import { AppError } from "./errors";

const envSchema = z.object({
  ADMIN_SECRET: z.string().min(24),
  ENCRYPTION_KEY: z.string().min(1),
  RATE_LIMIT_SECRET: z.string().min(24),
  NOSTR_RELAYS: z.string().min(1),
  NOSTR_PRIVATE_KEY: z.string().min(1),
  NOSTR_READ_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  NOSTR_WRITE_TIMEOUT_MS: z.coerce.number().int().positive().default(4400),
  NOSTR_WRITE_MIN_SUCCESS: z.coerce.number().int().positive().default(1),
  MIRROR_SOURCE_URL: z.string().url().default("https://www.jiripetrak.cz/cs/tekno-parties-freetekno-kalendar-udalosti-42/"),
  MIRROR_SYNC_SECRET: z.string().min(24).optional(),
  MIRROR_USER_AGENT: z.string().min(1).default("RaveMap event mirror"),
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse({
    ADMIN_SECRET: import.meta.env.ADMIN_SECRET,
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
    NODE_ENV: import.meta.env.NODE_ENV,
  });

  if (!parsed.success) {
    throw new AppError("Missing required environment variables", {
      code: "ENV_INVALID",
      status: 500,
    });
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
