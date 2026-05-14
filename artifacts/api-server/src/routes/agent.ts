import { Router, type Request, type Response } from "express";
import { db, agentRunsTable, agentStepsTable } from "@workspace/db";
import { eq, count, desc, sql } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MODEL = "anthropic/claude-3.5-sonnet";
const MAX_CYCLES = 5;

const SYSTEM_PROMPT = `You are ReplitReasoner, an autonomous programming agent. You solve programming tasks by thinking step-by-step and iteratively refining your approach.

For each cycle, you MUST output EXACTLY this structure with no extra text before or after:

THOUGHT: [Your reasoning about what to do next and why]

ACTION: [The exact code, command, or file content you would execute. Be specific and complete.]

OBSERVATION: [The expected output or result of your action. Simulate what would happen if run.]

Rules:
- Each THOUGHT/ACTION/OBSERVATION must be substantive and specific
- In ACTION, write real, runnable code (Python, JavaScript, bash, etc.)
- In OBSERVATION, simulate realistic output including any errors you would catch
- If you catch an error in OBSERVATION, fix it in the next cycle
- Keep iterating until the solution is correct and complete
- When the task is fully solved, after your final THOUGHT/ACTION/OBSERVATION, output on a new line: TASK COMPLETE: [brief summary of what your solution does]
- Maximum ${MAX_CYCLES} cycles allowed`;

function buildUserMessage(task: string, history: Array<{ type: string; content: string }>) {
  if (history.length === 0) {
    return `Your task is: ${task}

Begin solving it now. Output your first THOUGHT, ACTION, and OBSERVATION.`;
  }

  const historyText = history
    .map((s) => {
      if (s.type === "thought") return `THOUGHT: ${s.content}`;
      if (s.type === "action") return `ACTION: ${s.content}`;
      if (s.type === "observation") return `OBSERVATION: ${s.content}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  return `Your task is: ${task}

Previous cycles:
${historyText}

Continue with the next cycle. Either fix any errors from the previous observation or proceed to the next logical step. If the task is complete, output TASK COMPLETE after your final THOUGHT/ACTION/OBSERVATION.`;
}

function parseStep(text: string): Array<{ type: "thought" | "action" | "observation" | "complete"; content: string }> {
  const results: Array<{ type: "thought" | "action" | "observation" | "complete"; content: string }> = [];

  const thoughtMatch = text.match(/THOUGHT:\s*([\s\S]*?)(?=\n\nACTION:|$)/i);
  const actionMatch = text.match(/ACTION:\s*([\s\S]*?)(?=\n\nOBSERVATION:|$)/i);
  const observationMatch = text.match(/OBSERVATION:\s*([\s\S]*?)(?=\n\nTHOUGHT:|TASK COMPLETE:|$)/i);
  const completeMatch = text.match(/TASK COMPLETE:\s*([\s\S]*?)$/i);

  if (thoughtMatch?.[1]?.trim()) {
    results.push({ type: "thought", content: thoughtMatch[1].trim() });
  }
  if (actionMatch?.[1]?.trim()) {
    results.push({ type: "action", content: actionMatch[1].trim() });
  }
  if (observationMatch?.[1]?.trim()) {
    results.push({ type: "observation", content: observationMatch[1].trim() });
  }
  if (completeMatch?.[1]?.trim()) {
    results.push({ type: "complete", content: completeMatch[1].trim() });
  }

  return results;
}

async function runAgentLoop(
  runId: number,
  task: string,
  emit: (event: string, data: unknown) => void
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const client = new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://replit.com",
      "X-Title": "ReplitReasoner",
    },
  });

  const stepHistory: Array<{ type: string; content: string }> = [];
  let cycle = 1;
  let completed = false;

  try {
    while (cycle <= MAX_CYCLES && !completed) {
      const userMessage = buildUserMessage(task, stepHistory);

      emit("cycle_start", { cycle });

      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      });

      const raw = response.choices[0]?.message?.content ?? "";
      const steps = parseStep(raw);

      for (const step of steps) {
        const [inserted] = await db
          .insert(agentStepsTable)
          .values({ runId, type: step.type, content: step.content, cycle })
          .returning();

        stepHistory.push({ type: step.type, content: step.content });
        emit("step", inserted);

        if (step.type === "complete") {
          completed = true;
        }
      }

      if (steps.length === 0) {
        const [errStep] = await db
          .insert(agentStepsTable)
          .values({ runId, type: "error", content: "Failed to parse agent response", cycle })
          .returning();
        emit("step", errStep);
        break;
      }

      cycle++;
    }

    if (!completed && cycle > MAX_CYCLES) {
      const [errStep] = await db
        .insert(agentStepsTable)
        .values({ runId, type: "complete", content: `Reached maximum ${MAX_CYCLES} cycles. Task may need more iterations.`, cycle: MAX_CYCLES })
        .returning();
      emit("step", errStep);
    }

    await db
      .update(agentRunsTable)
      .set({ status: "completed" })
      .where(eq(agentRunsTable.id, runId));

    emit("done", { status: "completed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .insert(agentStepsTable)
      .values({ runId, type: "error", content: `Agent error: ${message}`, cycle })
      .catch(() => {});
    await db
      .update(agentRunsTable)
      .set({ status: "failed" })
      .where(eq(agentRunsTable.id, runId))
      .catch(() => {});
    emit("done", { status: "failed", error: message });
  }
}

// POST /api/agent/runs
router.post("/agent/runs", async (req: Request, res: Response) => {
  const { task } = req.body as { task?: string };
  if (!task?.trim()) {
    res.status(400).json({ error: "task is required" });
    return;
  }

  const [run] = await db
    .insert(agentRunsTable)
    .values({ task: task.trim(), status: "running" })
    .returning();

  const stepCount = 0;
  res.status(201).json({ ...run, stepCount, createdAt: run.createdAt.toISOString() });

  // Fire and forget — the SSE stream will deliver live progress
  setImmediate(() => {
    // Will be picked up by SSE clients
    runAgentLoop(run.id, task.trim(), () => {}).catch(() => {});
  });
});

// GET /api/agent/runs
router.get("/agent/runs", async (_req: Request, res: Response) => {
  const runs = await db
    .select({
      id: agentRunsTable.id,
      task: agentRunsTable.task,
      status: agentRunsTable.status,
      createdAt: agentRunsTable.createdAt,
      stepCount: count(agentStepsTable.id),
    })
    .from(agentRunsTable)
    .leftJoin(agentStepsTable, eq(agentRunsTable.id, agentStepsTable.runId))
    .groupBy(agentRunsTable.id)
    .orderBy(desc(agentRunsTable.createdAt));

  res.json(
    runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), stepCount: Number(r.stepCount) }))
  );
});

// GET /api/agent/runs/stats
router.get("/agent/runs/stats", async (_req: Request, res: Response) => {
  const [stats] = await db
    .select({
      totalRuns: count(agentRunsTable.id),
      totalSteps: sql<number>`cast(count(${agentStepsTable.id}) as int)`,
    })
    .from(agentRunsTable)
    .leftJoin(agentStepsTable, eq(agentRunsTable.id, agentStepsTable.runId));

  const statusCounts = await db
    .select({ status: agentRunsTable.status, cnt: count() })
    .from(agentRunsTable)
    .groupBy(agentRunsTable.status);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row.status] = Number(row.cnt);

  res.json({
    totalRuns: Number(stats?.totalRuns ?? 0),
    completedRuns: byStatus["completed"] ?? 0,
    failedRuns: byStatus["failed"] ?? 0,
    runningRuns: byStatus["running"] ?? 0,
    totalSteps: Number(stats?.totalSteps ?? 0),
  });
});

// GET /api/agent/runs/:id
router.get("/agent/runs/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [run] = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.id, id));

  if (!run) { res.status(404).json({ error: "not found" }); return; }

  const steps = await db
    .select()
    .from(agentStepsTable)
    .where(eq(agentStepsTable.runId, id))
    .orderBy(agentStepsTable.id);

  res.json({
    ...run,
    createdAt: run.createdAt.toISOString(),
    steps: steps.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
  });
});

// DELETE /api/agent/runs/:id
router.delete("/agent/runs/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  await db.delete(agentStepsTable).where(eq(agentStepsTable.runId, id));
  await db.delete(agentRunsTable).where(eq(agentRunsTable.id, id));
  res.status(204).send();
});

// GET /api/agent/runs/:id/stream  (SSE)
router.get("/agent/runs/:id/stream", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [run] = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.id, id));

  if (!run) { res.status(404).json({ error: "not found" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send existing steps first
  const existingSteps = await db
    .select()
    .from(agentStepsTable)
    .where(eq(agentStepsTable.runId, id))
    .orderBy(agentStepsTable.id);

  for (const step of existingSteps) {
    send("step", { ...step, createdAt: step.createdAt.toISOString() });
  }

  if (run.status !== "running") {
    send("done", { status: run.status });
    res.end();
    return;
  }

  // Run agent and stream
  const task = run.task;
  await runAgentLoop(id, task, (event, data) => {
    if (event === "step") {
      const s = data as { id: number; runId: number; type: string; content: string; cycle: number; createdAt: Date };
      send("step", { ...s, createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt });
    } else {
      send(event, data);
    }
  });

  res.end();
});

export default router;
