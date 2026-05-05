import { z } from "zod";

import { graphScopeSchema } from "./scope.js";
import { runStatuses } from "./values.js";

export const agentRunSchema = z.object({
  id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  objective: z.string().min(1),
  status: z.enum(runStatuses),
  context_pack_id: z.string().min(1).optional(),
  scope: graphScopeSchema.optional(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export type AgentRun = z.infer<typeof agentRunSchema>;

export const traceSpanSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  parent_span_id: z.string().min(1).optional(),
  name: z.string().min(1),
  kind: z.enum([
    "user_request",
    "orchestration",
    "context_pack",
    "retrieval",
    "graph_expansion",
    "model_call",
    "cache",
    "validation",
    "handoff"
  ]),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  scope: graphScopeSchema.optional(),
  attributes: z.record(z.string(), z.unknown()).default({})
});

export type TraceSpan = z.infer<typeof traceSpanSchema>;
