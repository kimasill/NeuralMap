import type { ContextPack, HandoffPack } from "@neuralmap/schema";

import { createId, nowIso } from "./ids.js";

export interface CreateHandoffPackInput {
  fromRunId: string;
  toSessionId?: string;
  objective: string;
  currentStatus: string;
  contextPack?: ContextPack;
  openLoops?: string[];
  blockers?: string[];
  constraints?: string[];
  recommendedNextActions?: string[];
}

export function createHandoffPack(input: CreateHandoffPackInput): HandoffPack {
  const pack: HandoffPack = {
    id: createId("handoff"),
    from_run_id: input.fromRunId,
    objective: input.objective,
    current_status: input.currentStatus,
    key_decisions: input.contextPack?.decisions ?? [],
    referenced_node_ids: input.contextPack?.node_ids ?? [],
    open_loops: input.openLoops ?? [],
    blockers: input.blockers ?? input.contextPack?.blockers ?? [],
    constraints: input.constraints ?? [],
    recommended_next_actions: input.recommendedNextActions ?? [],
    created_at: nowIso()
  };

  if (input.toSessionId) {
    pack.to_session_id = input.toSessionId;
  }

  return pack;
}

