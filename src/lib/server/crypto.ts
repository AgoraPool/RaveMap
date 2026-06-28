import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "./errors";
import { getEnv } from "./env";

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = "scrypt";
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const ENCRYPTION_VERSION = 2;

export type SecretPayload = {
  secretInfo: string;
  secretLocationName: string;
  secretLatitude: number;
  secretLongitude: number;
  secretMapNote?: string;
};

export type SecretBundle = {
  codeHash: string;
  secret: SecretPayload;
};

export type DraftBundle = {
  public: {
    slug: string;
    title: string;
    summary: string;
    publicLocation: string;
    startsAt: string;
    endAt?: string;
    coverImageUrl?: string;
    externalUrl?: string;
    source?: {
      name: string;
      url: string;
      id?: string;
      contentHash?: string;
    };
    genres?: string[];
    lineup?: string[];
    tags?: string[];
    galleryImageUrls?: string[];
    accessType?: "public" | "gated";
    createdAt: string;
  };
  codeHash?: string;
  secret?: SecretPayload;
};

type SecretPayloadContext = {
  coordinate: string;
};

function getPayloadAad(context: SecretPayloadContext): Buffer {
  return Buffer.from(JSON.stringify({ coordinate: context.coordinate }), "utf-8");
}

function getEncryptionKey(): Buffer {
  const env = getEnv();
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new AppError("Invalid encryption key", {
      code: "ENCRYPTION_KEY_INVALID",
      status: 500,
    });
  }

  return key;
}

export async function hashUnlockCode(code: string): Promise<string> {
  const normalizedCode = code.trim();
  if (normalizedCode.length < 8 || normalizedCode.length > 128) {
    throw new AppError("Unlock code does not meet security policy", {
      code: "INVALID_UNLOCK_CODE",
      status: 400,
      expose: true,
    });
  }

  const salt = randomBytes(16);
  const derivedKey = (await scrypt(normalizedCode, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;

  return [
    HASH_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

export async function verifyUnlockCode(code: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    throw new AppError("Stored hash format is invalid", {
      code: "HASH_FORMAT_INVALID",
      status: 500,
    });
  }

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const n = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);

  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    throw new AppError("Stored hash parameters are invalid", {
      code: "HASH_PARAMS_INVALID",
      status: 500,
    });
  }

  const salt = Buffer.from(saltB64, "base64");
  const expectedHash = Buffer.from(hashB64, "base64");
  const computedHash = (await scrypt(code.trim(), salt, expectedHash.length, {
    N: n,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;

  if (computedHash.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(computedHash, expectedHash);
}

function encryptJsonPayload(payload: unknown, context: SecretPayloadContext): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(getPayloadAad(context));

  const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    `v${ENCRYPTION_VERSION}`,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function decryptJsonPayload<T>(serialized: string, context?: SecretPayloadContext): T {
  const [version, ivB64, authTagB64, ciphertextB64] = serialized.split(":");

  if ((!version || !/^v\d+$/.test(version)) || !ivB64 || !authTagB64 || !ciphertextB64) {
    throw new AppError("Encrypted payload format is invalid", {
      code: "ENCRYPTED_PAYLOAD_INVALID",
      status: 500,
    });
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    if (version === `v${ENCRYPTION_VERSION}`) {
      if (!context) {
        throw new AppError("Encrypted payload context is missing", {
          code: "ENCRYPTED_PAYLOAD_CONTEXT_MISSING",
          status: 500,
        });
      }

      decipher.setAAD(getPayloadAad(context));
    } else if (version !== "v1") {
      throw new AppError("Encrypted payload version is unsupported", {
        code: "ENCRYPTED_PAYLOAD_VERSION_UNSUPPORTED",
        status: 500,
      });
    }

    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
    const parsed = JSON.parse(plaintext);

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Invalid decrypted payload object");
    }

    return parsed as T;
  } catch {
    throw new AppError("Encrypted payload could not be decrypted", {
      code: "ENCRYPTED_PAYLOAD_DECRYPT_FAILED",
      status: 500,
    });
  }
}

export function encryptSecretBundle(payload: SecretBundle, context: SecretPayloadContext): string {
  return encryptJsonPayload(payload, context);
}

export function decryptSecretBundle(serialized: string, context: SecretPayloadContext): SecretBundle {
  return decryptJsonPayload<SecretBundle>(serialized, context);
}

export function encryptDraftBundle(payload: DraftBundle, context: SecretPayloadContext): string {
  return encryptJsonPayload(payload, context);
}

export function decryptDraftBundle(serialized: string, context: SecretPayloadContext): DraftBundle {
  return decryptJsonPayload<DraftBundle>(serialized, context);
}
