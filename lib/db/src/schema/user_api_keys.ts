import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

export const userApiKeysTable = pgTable(
  "user_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(), // "anthropic" | "openai" | "gemini"
    encryptedKey: text("encrypted_key").notNull(),
    keyHint: text("key_hint").notNull(), // last 4 chars of plaintext key
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_api_keys_user_provider_idx").on(t.userId, t.provider)],
);

export type UserApiKey = typeof userApiKeysTable.$inferSelect;
