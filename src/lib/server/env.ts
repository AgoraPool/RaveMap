import { z } from "zod";
import { AppError } from "./errors";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_SECRET: z.string().min(24),
  ENCRYPTION_KEY: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse({
    DATABASE_URL: import.meta.env.DATABASE_URL,
    ADMIN_SECRET: import.meta.env.ADMIN_SECRET,
    ENCRYPTION_KEY: import.meta.env.ENCRYPTION_KEY,
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
