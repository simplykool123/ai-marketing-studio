import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).");
  return buf;
}

/** Encrypts plaintext → "iv:authTag:ciphertext" (all hex) */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypts "iv:authTag:ciphertext" back to plaintext */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format.");
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}

/** Returns a display-safe masked key: prefix + bullets + last 4 chars */
export function maskKey(provider: string, hint: string): string {
  const prefixes: Record<string, string> = {
    anthropic: "sk-ant-",
    openai: "sk-",
    gemini: "AIza",
  };
  return `${prefixes[provider] ?? ""}••••${hint}`;
}

/** Extracts the last 4 characters from a plaintext key for storage as a hint */
export function extractHint(key: string): string {
  return key.slice(-4);
}
