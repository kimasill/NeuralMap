import { z } from "zod";

export const evidenceItemSchema = z.object({
  node_id: z.string().min(1),
  snippet: z.string().min(1),
  score: z.number().min(0).max(1)
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const contextPackSchema = z.object({
  id: z.string().min(1),
  objective: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  node_ids: z.array(z.string().min(1)),
  evidence: z.array(evidenceItemSchema),
  decisions: z.array(z.string().min(1)).default([]),
  blockers: z.array(z.string().min(1)).default([]),
  template_id: z.string().min(1).optional(),
  token_budget: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime()
});

export type ContextPack = z.infer<typeof contextPackSchema>;

export const composeContextRequestSchema = z.object({
  objective: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  task_type: z.string().min(1).optional(),
  token_budget: z.number().int().positive().default(8000),
  seed_node_ids: z.array(z.string().min(1)).default([]),
  query: z.string().min(1).optional()
});

export type ComposeContextRequest = z.infer<typeof composeContextRequestSchema>;

export const handoffPackSchema = z.object({
  id: z.string().min(1),
  from_run_id: z.string().min(1),
  to_session_id: z.string().min(1).optional(),
  objective: z.string().min(1),
  current_status: z.string().min(1),
  key_decisions: z.array(z.string().min(1)),
  referenced_node_ids: z.array(z.string().min(1)),
  open_loops: z.array(z.string().min(1)),
  blockers: z.array(z.string().min(1)),
  constraints: z.array(z.string().min(1)),
  recommended_next_actions: z.array(z.string().min(1)),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime()
});

export type HandoffPack = z.infer<typeof handoffPackSchema>;
