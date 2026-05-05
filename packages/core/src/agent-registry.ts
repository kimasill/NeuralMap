import type { ComposeContextRequest, GraphNode, GraphScope, RunStatus } from "@neuralmap/schema";

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  model_profile: string;
  context_budget: number;
  permissions: string[];
  output_contract: Record<string, unknown>;
  scope?: GraphScope | undefined;
  metadata: Record<string, unknown>;
}

export interface MemoryWriteCandidate {
  node: GraphNode;
  operation?: "propose" | "upsert" | undefined;
  evidence_node_ids?: string[] | undefined;
}

export interface MemoryWriteValidation {
  accepted: MemoryWriteCandidate[];
  rejected: Array<MemoryWriteCandidate & { reason: string }>;
  requires_human_review: boolean;
}

const allowedTransitions: Record<RunStatus, RunStatus[]> = {
  planned: ["running", "failed"],
  running: ["waiting_tool", "waiting_human", "summarizing", "completed", "failed"],
  waiting_tool: ["running", "failed"],
  waiting_human: ["running", "failed"],
  summarizing: ["handoff_ready", "completed", "failed"],
  handoff_ready: ["completed", "running", "failed"],
  completed: [],
  failed: ["planned", "running"]
};

export function createDefaultAgents(): AgentDefinition[] {
  return [
    {
      id: "main-agent",
      name: "Main Agent",
      role: "generalist",
      model_profile: "balanced-agent",
      context_budget: 8000,
      permissions: ["read:graph", "write:proposed_memory", "create:handoff"],
      output_contract: {
        format: "markdown",
        must_cite_node_ids: true
      },
      metadata: {
        source: "default_registry"
      }
    },
    {
      id: "validation-agent",
      name: "Validation Agent",
      role: "validation",
      model_profile: "validation-guard",
      context_budget: 5000,
      permissions: ["read:graph", "validate:memory"],
      output_contract: {
        format: "json",
        fields: ["decision", "evidence_node_ids", "residual_risk"]
      },
      metadata: {
        source: "default_registry"
      }
    }
  ];
}

export function toAgentContextRequest(
  agent: AgentDefinition,
  input: Omit<ComposeContextRequest, "agent_id" | "token_budget"> & {
    agent_id?: string | undefined;
    token_budget?: number | undefined;
  }
): ComposeContextRequest {
  const request: ComposeContextRequest = {
    objective: input.objective,
    agent_id: agent.id,
    session_id: input.session_id,
    task_type: input.task_type ?? agent.role,
    token_budget: Math.min(input.token_budget ?? agent.context_budget, agent.context_budget),
    seed_node_ids: input.seed_node_ids ?? [],
    activation_tags: input.activation_tags ?? []
  };

  if (input.query) {
    request.query = input.query;
  }
  if (input.scope ?? agent.scope) {
    request.scope = input.scope ?? agent.scope;
  }

  return request;
}

export function canTransitionRunStatus(from: RunStatus, to: RunStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function nextRunStatus(from: RunStatus, requested: RunStatus): RunStatus {
  if (!canTransitionRunStatus(from, requested)) {
    throw new Error(`Invalid run status transition from ${from} to ${requested}.`);
  }

  return requested;
}

export function validateMemoryWrites(input: {
  agent: AgentDefinition;
  candidates: readonly MemoryWriteCandidate[];
  knownNodeIds: ReadonlySet<string>;
}): MemoryWriteValidation {
  const canWrite = input.agent.permissions.includes("write:proposed_memory");
  const accepted: MemoryWriteCandidate[] = [];
  const rejected: Array<MemoryWriteCandidate & { reason: string }> = [];

  for (const candidate of input.candidates) {
    if (!canWrite) {
      rejected.push({ ...candidate, reason: "agent_lacks_write_permission" });
      continue;
    }

    const evidenceNodeIds = candidate.evidence_node_ids ?? readEvidenceNodeIds(candidate.node);
    if (evidenceNodeIds.length === 0) {
      rejected.push({ ...candidate, reason: "missing_evidence_links" });
      continue;
    }
    if (!evidenceNodeIds.every((nodeId) => input.knownNodeIds.has(nodeId))) {
      rejected.push({ ...candidate, reason: "unknown_evidence_node" });
      continue;
    }

    accepted.push(candidate);
  }

  return {
    accepted,
    rejected,
    requires_human_review: accepted.some((candidate) => candidate.node.importance_score >= 0.9)
  };
}

function readEvidenceNodeIds(node: GraphNode): string[] {
  const raw = node.metadata.evidence_node_ids;
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}
