/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly ADMIN_SECRET: string;
  readonly ENCRYPTION_KEY: string;
  readonly RATE_LIMIT_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
