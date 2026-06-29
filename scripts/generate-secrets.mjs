import { randomBytes } from "node:crypto";

function secret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function encryptionKey() {
  return randomBytes(32).toString("base64");
}

const values = {
  ADMIN_SECRET: secret(32),
  RATE_LIMIT_SECRET: secret(32),
  MIRROR_SYNC_SECRET: secret(32),
  ENCRYPTION_KEY: encryptionKey(),
  CREW_CODE: secret(24),
};

for (const [name, value] of Object.entries(values)) {
  console.log(`${name}=${value}`);
}

console.error("\nCopy these into local .env or Netlify environment variables manually. This script does not write files.");
