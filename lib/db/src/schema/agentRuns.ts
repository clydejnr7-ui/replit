import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentRunsTable = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  task: text("task").notNull(),
  status: text("status").notNull().default("running"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAgentRunSchema = createInsertSchema(agentRunsTable).omit({ id: true, createdAt: true });
export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;
export type AgentRun = typeof agentRunsTable.$inferSelect;
