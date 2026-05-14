import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentStepsTable = pgTable("agent_steps", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull(),
  cycle: integer("cycle").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAgentStepSchema = createInsertSchema(agentStepsTable).omit({ id: true, createdAt: true });
export type InsertAgentStep = z.infer<typeof insertAgentStepSchema>;
export type AgentStep = typeof agentStepsTable.$inferSelect;
