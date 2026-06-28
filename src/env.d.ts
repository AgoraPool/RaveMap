/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly ADMIN_SECRET: string;
  readonly ENCRYPTION_KEY: string;
  readonly RATE_LIMIT_SECRET: string;
  readonly NOSTR_RELAYS: string;
  readonly NOSTR_PRIVATE_KEY: string;
  readonly NOSTR_READ_TIMEOUT_MS?: string;
  readonly NOSTR_WRITE_TIMEOUT_MS?: string;
  readonly NOSTR_WRITE_MIN_SUCCESS?: string;
  readonly MIRROR_SOURCE_URL?: string;
  readonly MIRROR_SYNC_SECRET?: string;
  readonly MIRROR_USER_AGENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
