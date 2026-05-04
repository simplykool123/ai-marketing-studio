import { pgEnum, pgTable, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { profilesTable } from "./profiles";

export const CLIENT_ROLES = ["owner", "admin", "editor", "approver", "viewer"] as const;
export type ClientRole = (typeof CLIENT_ROLES)[number];
export const clientRoleEnum = pgEnum("client_role", CLIENT_ROLES);

export const clientUsersTable = pgTable(
  "client_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    role: clientRoleEnum("role").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    clientUserUnique: uniqueIndex("client_users_client_id_user_id_unique").on(
      table.clientId,
      table.userId,
    ),
  }),
);

export const insertClientUserSchema = createInsertSchema(clientUsersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertClientUser = z.infer<typeof insertClientUserSchema>;
export type ClientUser = typeof clientUsersTable.$inferSelect;
