import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { AppError } from "./errors";
import { getEnv } from "./env";
import type { NostrEvent, NostrUnsignedEvent } from "./nostr-types";

export type NostrSigner = {
  getPublicKey(): string;
  sign(event: NostrUnsignedEvent): Promise<NostrEvent>;
};

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new AppError("Nostr private key must be 64 hex chars or nsec encoded", {
      code: "NOSTR_PRIVATE_KEY_INVALID",
      status: 500,
    });
  }

  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function readSecretKey(): Uint8Array {
  const raw = getEnv().NOSTR_PRIVATE_KEY.trim();
  if (raw.startsWith("nsec")) {
    const decoded = nip19.decode(raw);
    if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
      throw new AppError("Nostr nsec key is invalid", {
        code: "NOSTR_PRIVATE_KEY_INVALID",
        status: 500,
      });
    }

    return decoded.data;
  }

  return hexToBytes(raw);
}

let cachedSigner: NostrSigner | null = null;

export function getAppManagedSigner(): NostrSigner {
  if (cachedSigner) {
    return cachedSigner;
  }

  const secretKey = readSecretKey();
  const pubkey = getPublicKey(secretKey);

  cachedSigner = {
    getPublicKey() {
      return pubkey;
    },
    async sign(event) {
      return finalizeEvent(event, secretKey) as NostrEvent;
    },
  };

  return cachedSigner;
}
