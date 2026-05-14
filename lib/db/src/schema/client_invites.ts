import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { profilesTable } from "./profiles";
import { clientRoleEnum } from "./client_users";

export const clientInvitesTable = pgTable(
  "client_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: clientRoleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("client_invites_token_hash_unique").on(table.tokenHash),
  }),
);

export const insertClientInviteSchema = createInsertSchema(clientInvitesTable).omit({
  id: true,
  acceptedAt: true,
  createdAt: true,
});
export type InsertClientInvite = z.infer<typeof insertClientInviteSchema>;
export type ClientInvite = typeof clientInvitesTable.$inferSelect;
