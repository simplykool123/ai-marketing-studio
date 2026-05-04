import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const k = process.env.TOKEN_ENCRYPTION_KEY;
  if (!k) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY environment variable is required. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const buf = Buffer.from(k, "base64");
  if (buf.length < 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be at least 32 bytes when base64-decoded. " +
        "Generate a new one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  return buf.subarray(0, 32);
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const key = getKey();
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token — expected iv:tag:data format");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex!, "hex");
  const tag = Buffer.from(tagHex!, "hex");
  const data = Buffer.from(dataHex!, "hex");
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}

export function isEncryptionConfigured(): boolean {
  const k = process.env.TOKEN_ENCRYPTION_KEY;
  if (!k) return false;
  const buf = Buffer.from(k, "base64");
  return buf.length >= 32;
}
