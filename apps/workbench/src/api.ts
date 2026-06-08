import { fallbackAgents, fallbackGraph, fallbackTrace } from "./fallback.js";
import type {
  AgentSummary,
  CacheDashboard,
  CacheInvalidateInput,
  CacheInvalidateResult,
  ComposeContextInput,
  ContextPack,
  CreateHandoffInput,
  GraphQueryInput,
  GraphQueryResult,
  HandoffPack,
  HandoffRelationship,
  ModelFeedbackInput,
  ModelFeedbackResult,
  ModelProfilesDashboard,
  ModelRouteDecision,
  ModelRouteInput,
  RefreshContextPackInput,
  RefreshContextPackResult,
  RunTrace,
  WorkbenchArtifacts,
  WorkbenchGraph,
  WorkbenchTimeline
} from "./types.js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4317";
export const WORKBENCH_RUN_ID = "run_workbench_phase_1";
export const WORKBENCH_SCOPE = readWorkbenchScope();
const fallbackContextPacks: ContextPack[] = [];
const fallbackHandoffPacks: HandoffPack[] = [];

export type WorkbenchScopeField = "tenant_id" | "workspace_id" | "project_id" | "owner_scope";

export interface WorkbenchScope {
  label: string;
  routeLabel: string;
  headers: Record<string, string>;
  fields: Record<WorkbenchScopeField, string>;
}

export async function fetchWorkbenchGraph(): Promise<WorkbenchGraph> {
  return fetchJson<WorkbenchGraph>("/workbench/graph/subgraph", fallbackGraph);
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const response = await fetchJson<{ agents: AgentSummary[] }>("/workbench/agents", { agents: fallbackAgents });
  return response.agents;
}

export async function fetchRunTrace(runId: string): Promise<RunTrace> {
  return fetchJson<RunTrace>(`/workbench/runs/${runId}/trace`, fallbackTrace);
}

export async function fetchWorkbenchTimeline(runId: string): Promise<WorkbenchTimeline> {
  return fetchJson<WorkbenchTimeline>(`/workbench/timeline?run_id=${encodeURIComponent(runId)}&limit=40`, createFallbackTimeline(runId));
}

export async function fetchWorkbenchArtifacts(): Promise<WorkbenchArtifacts> {
  return fetchJson<WorkbenchArtifacts>("/workbench/artifacts?limit=8", createFallbackArtifacts());
}

export async function fetchCacheDashboard(): Promise<CacheDashboard> {
  const [stats, entries] = await Promise.all([
    fetchJson<Omit<CacheDashboard, "entries">>("/cache/stats", {
      layers: [],
      policies: [],
      generated_at: new Date().toISOString()
    }),
    fetchJson<Pick<CacheDashboard, "entries" | "generated_at">>("/cache/entries?limit=12", {
      entries: [],
      generated_at: new Date().toISOString()
    })
  ]);

  return {
    layers: stats.layers,
    policies: stats.policies,
    entries: entries.entries,
    generated_at: stats.generated_at || entries.generated_at
  };
}

export async function fetchModelProfiles(): Promise<ModelProfilesDashboard> {
  return fetchJson<ModelProfilesDashboard>("/model/profiles", {
    profiles: [],
    feedback: [],
    generated_at: new Date().toISOString()
  });
}

export async function routeModelProfile(input: ModelRouteInput): Promise<ModelRouteDecision | null> {
  return fetchJson<ModelRouteDecision | null>("/model/route", null, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function sendModelFeedback(input: ModelFeedbackInput): Promise<ModelFeedbackResult | null> {
  return fetchJson<ModelFeedbackResult | null>("/model/feedback", null, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function invalidateCache(input: CacheInvalidateInput = {}): Promise<CacheInvalidateResult> {
  return fetchJson<CacheInvalidateResult>(
    "/cache/invalidate",
    {
      invalidated: false,
      count: 0,
      entries: [],
      scope: "sample"
    },
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function queryGraph(input: GraphQueryInput): Promise<GraphQueryResult> {
  return fetchJson<GraphQueryResult>("/graph/query", createFallbackGraphQuery(input), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function composeContextPack(input: ComposeContextInput): Promise<ContextPack> {
  const pack = await fetchJson<ContextPack>("/context/compose", createFallbackContextPack(input), {
    method: "POST",
    body: JSON.stringify(input)
  });
  rememberById(fallbackContextPacks, pack);
  return pack;
}

export async function createHandoffPack(input: CreateHandoffInput): Promise<HandoffPack> {
  const pack = await fetchJson<HandoffPack>("/context/handoff", createFallbackHandoffPack(input), {
    method: "POST",
    body: JSON.stringify(input)
  });
  rememberById(fallbackHandoffPacks, pack);
  return pack;
}

export async function refreshContextPack(
  id: string,
  input: RefreshContextPackInput = {}
): Promise<RefreshContextPackResult> {
  const result = await fetchJson<RefreshContextPackResult>(
    `/context/packs/${id}/refresh`,
    createFallbackRefreshContextPack(id, input),
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
  rememberById(fallbackContextPacks, result.pack);
  return result;
}

async function fetchJson<T>(path: string, fallback: T, init: RequestInit = {}): Promise<T> {
  try {
    const headers = new Headers(init.headers);
    headers.set("x-neuralmap-run-id", WORKBENCH_RUN_ID);
    for (const [name, value] of Object.entries(WORKBENCH_SCOPE.headers)) {
      headers.set(name, value);
    }
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers
    });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export function applyWorkbenchScope(fields: Record<WorkbenchScopeField, string>): void {
  if (typeof window === "undefined") {
    return;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hasScopeValue = scopeFields.some((key) => fields[key].trim().length > 0);
  for (const key of scopeFields) {
    const value = fields[key].trim();
    if (value.length > 0) {
      searchParams.set(key, value);
    } else if (!hasScopeValue) {
      searchParams.set(key, "");
    } else {
      searchParams.delete(key);
    }
  }

  const search = searchParams.toString();
  window.location.assign(`${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
}

const scopeFields = ["tenant_id", "workspace_id", "project_id", "owner_scope"] as const;

function readWorkbenchScope(): WorkbenchScope {
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const fields = [
    ["tenant_id", "x-neuralmap-tenant-id", import.meta.env.VITE_NEURALMAP_TENANT_ID],
    ["workspace_id", "x-neuralmap-workspace-id", import.meta.env.VITE_NEURALMAP_WORKSPACE_ID],
    ["project_id", "x-neuralmap-project-id", import.meta.env.VITE_NEURALMAP_PROJECT_ID],
    ["owner_scope", "x-neuralmap-owner-scope", import.meta.env.VITE_NEURALMAP_OWNER_SCOPE]
  ] as const;
  const headers: Record<string, string> = {};
  const values: Record<WorkbenchScopeField, string> = {
    tenant_id: "",
    workspace_id: "",
    project_id: "",
    owner_scope: ""
  };
  const labels: string[] = [];

  for (const [param, header, fallback] of fields) {
    const value = searchParams.has(param) ? searchParams.get(param) : fallback;
    if (!value?.trim()) {
      continue;
    }
    const normalized = value.trim();
    values[param] = normalized;
    headers[header] = normalized;
    labels.push(`${param}=${normalized}`);
  }

  return {
    label: labels.length > 0 ? labels.join(" / ") : "unscoped",
    routeLabel: routeLabelFromScope(values),
    fields: values,
    headers
  };
}

function routeLabelFromScope(fields: Record<WorkbenchScopeField, string>): string {
  if (fields.project_id) {
    return `project:${fields.project_id}`;
  }
  if (fields.workspace_id) {
    return `workspace:${fields.workspace_id}`;
  }
  if (fields.tenant_id) {
    return `tenant:${fields.tenant_id}`;
  }
  if (fields.owner_scope) {
    return `owner:${fields.owner_scope}`;
  }
  return "default";
}

function createFallbackGraphQuery(input: GraphQueryInput): GraphQueryResult {
  const normalized = input.query.toLowerCase();
  const seeds = fallbackGraph.nodes
    .map((node) => {
      const searchable = `${node.title} ${node.summary ?? ""} ${node.content_ref ?? ""}`.toLowerCase();
      const score = searchable.includes(normalized) ? 1 : tokenScore(normalized, searchable);
      return {
        node,
        score,
        reasons: score > 0 ? ["fallback"] : []
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.node.importance_score - a.node.importance_score)
    .slice(0, input.top_k);
  const seedNodeIds = seeds.map((seed) => seed.node.id);
  const expandedNodeIds = new Set(seedNodeIds);

  for (const edge of fallbackGraph.edges) {
    if (edge.confidence < input.min_edge_confidence) {
      continue;
    }

    if (seedNodeIds.includes(edge.from)) {
      expandedNodeIds.add(edge.to);
    }
    if (seedNodeIds.includes(edge.to)) {
      expandedNodeIds.add(edge.from);
    }
  }

  const nodes = fallbackGraph.nodes.filter((node) => expandedNodeIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = fallbackGraph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  return {
    seeds,
    neighborhood: {
      seed_node_ids: seedNodeIds,
      nodes,
      edges,
      generated_at: new Date().toISOString()
    },
    intent: {
      kind: "general_recall",
      confidence: 0.25,
      reasons: ["fallback:general"],
      preferred_node_types: ["Decision", "Document", "CodeFile", "Ticket", "Task"],
      preferred_edge_types: ["references", "related_to", "depends_on"],
      suggested_hops: 1
    },
    cache: {
      hit: false,
      key: "fallback"
    }
  };
}

function createFallbackArtifacts(): WorkbenchArtifacts {
  return {
    context_packs: [...fallbackContextPacks],
    handoff_packs: [...fallbackHandoffPacks],
    relationships: createFallbackHandoffRelationships(),
    mode: "sample",
    generated_at: new Date().toISOString()
  };
}

function createFallbackTimeline(runId: string): WorkbenchTimeline {
  const relationships = createFallbackHandoffRelationships();
  const relationshipContextIds = new Set(
    relationships.filter((relationship) => relationship.from_run_id === runId).map((relationship) => relationship.context_pack_id)
  );
  const events: WorkbenchTimeline["events"] = [
    ...fallbackContextPacks
      .filter((pack) => getContextSourceRunId(pack) === runId || relationshipContextIds.has(pack.id))
      .map((pack) => ({
        id: `timeline:context:${pack.id}`,
        kind: "context_pack" as const,
        title: "Context Pack",
        at: pack.created_at,
        run_id: getContextSourceRunId(pack) ?? runId,
        context_pack_id: pack.id,
        node_ids: pack.node_ids,
        summary: pack.objective,
        metrics: {
          nodes: pack.node_ids.length,
          evidence: pack.evidence.length,
          budget: pack.token_budget
        }
      })),
    ...fallbackHandoffPacks
      .filter((pack) => pack.from_run_id === runId)
      .map((pack) => ({
        id: `timeline:handoff:${pack.id}`,
        kind: "handoff_pack" as const,
        title: "Handoff Pack",
        at: pack.created_at,
        run_id: pack.from_run_id,
        context_pack_id: getSourceContextPackId(pack),
        handoff_pack_id: pack.id,
        node_ids: pack.referenced_node_ids,
        summary: pack.current_status,
        metrics: {
          refs: pack.referenced_node_ids.length,
          actions: pack.recommended_next_actions.length
        }
      })),
    ...relationships
      .filter((relationship) => relationship.from_run_id === runId)
      .map((relationship) => ({
        id: `timeline:${relationship.id}`,
        kind: "artifact_relationship" as const,
        title: "Artifact Link",
        at: relationship.created_at,
        run_id: relationship.from_run_id,
        context_pack_id: relationship.context_pack_id,
        handoff_pack_id: relationship.handoff_pack_id,
        relationship_id: relationship.id,
        node_ids: relationship.referenced_node_ids,
        summary: relationship.objective,
        metrics: {
          refs: relationship.referenced_node_ids.length,
          edge: "handed_off_to"
        }
      })),
    ...fallbackTrace.spans.map((span) => ({
      id: `timeline:span:${span.id}`,
      kind: "trace_span" as const,
      title: span.name,
      at: span.started_at,
      run_id: runId,
      span_id: span.id,
      span_kind: span.kind,
      parent_span_id: span.parent_span_id,
      node_ids: [],
      metrics: {
        kind: span.kind,
        ok: true
      }
    }))
  ];

  return {
    run_id: runId,
    events: events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40),
    mode: "sample",
    generated_at: new Date().toISOString()
  };
}

function createFallbackContextPack(input: ComposeContextInput): ContextPack {
  const nodeIds = input.seed_node_ids.length > 0 ? input.seed_node_ids : fallbackGraph.nodes.map((node) => node.id);
  const nodes = fallbackGraph.nodes.filter((node) => nodeIds.includes(node.id));

  const pack: ContextPack = {
    id: `ctx_fallback_${Date.now()}`,
    objective: input.objective,
    agent_id: input.agent_id,
    session_id: input.session_id,
    node_ids: nodes.map((node) => node.id),
    evidence: nodes.slice(0, 6).map((node) => ({
      node_id: node.id,
      snippet: node.summary ?? node.content_ref ?? node.title,
      score: node.importance_score
    })),
    decisions: [],
    blockers: [],
    template_id: input.task_type ? `${input.task_type}:default` : "general_recall:default",
    token_budget: input.token_budget,
    metadata: {
      template: {
        id: input.task_type ? `${input.task_type}:default` : "general_recall:default",
        name: input.task_type ? `${input.task_type} template` : "General Recall",
        version: 1,
        slots: ["goal", "evidence", "next_actions"]
      },
      prompt_segment_cache: {
        layer: "prompt_segment",
        key: "fallback",
        hit: false
      },
      context_summary: {
        title: `Summary for ${input.objective}`,
        content: `Objective: ${input.objective}`,
        evidence_node_ids: nodes.slice(0, 3).map((node) => node.id),
        decision_count: 0,
        blocker_count: 0
      },
      summary_cache: {
        layer: "summary",
        key: "fallback",
        hit: false
      },
      source_run_id: WORKBENCH_RUN_ID,
      node_explanations: Object.fromEntries(
        nodes.map((node) => [
          node.id,
          {
            node_id: node.id,
            reason_kind: input.seed_node_ids.includes(node.id) ? "direct_seed" : "graph_expansion",
            summary: input.seed_node_ids.includes(node.id)
              ? "Included because it was selected directly as a seed node."
              : "Included by fallback graph context.",
            evidence_score: node.importance_score
          }
        ])
      )
    },
    created_at: new Date().toISOString()
  };

  return pack;
}

function createFallbackRefreshContextPack(
  id: string,
  input: RefreshContextPackInput = {}
): RefreshContextPackResult {
  const existing = fallbackContextPacks.find((pack) => pack.id === id);
  const composeInput: ComposeContextInput = {
    objective: input.objective ?? existing?.objective ?? "Refresh context pack",
    agent_id: existing?.agent_id ?? "main-agent",
    session_id: existing?.session_id ?? "workbench-session",
    token_budget: input.token_budget ?? existing?.token_budget ?? 8000,
    seed_node_ids: input.seed_node_ids ?? existing?.node_ids ?? fallbackGraph.nodes.map((node) => node.id)
  };

  const taskType = input.task_type ?? existing?.template_id?.split(":")[0];
  if (taskType) {
    composeInput.task_type = taskType;
  }
  if (input.query) {
    composeInput.query = input.query;
  }

  return {
    previous_pack_id: id,
    pack: createFallbackContextPack(composeInput)
  };
}

function createFallbackHandoffPack(input: CreateHandoffInput): HandoffPack {
  const contextPack = input.context_pack_id
    ? fallbackContextPacks.find((pack) => pack.id === input.context_pack_id)
    : undefined;
  const pack: HandoffPack = {
    id: `handoff_fallback_${Date.now()}`,
    from_run_id: input.from_run_id,
    objective: input.objective,
    current_status: input.current_status,
    key_decisions: contextPack?.decisions ?? [],
    referenced_node_ids: contextPack?.node_ids ?? [],
    open_loops: input.open_loops ?? [],
    blockers: input.blockers ?? contextPack?.blockers ?? [],
    constraints: input.constraints ?? [],
    recommended_next_actions: input.recommended_next_actions ?? [],
    metadata: input.context_pack_id
      ? {
          context_pack_id: input.context_pack_id,
          context_pack_created_at: contextPack?.created_at
        }
      : {},
    created_at: new Date().toISOString()
  };

  if (input.to_session_id) {
    pack.to_session_id = input.to_session_id;
  }

  return pack;
}

function createFallbackHandoffRelationships(): HandoffRelationship[] {
  const contextsById = new Map(fallbackContextPacks.map((pack) => [pack.id, pack]));
  return fallbackHandoffPacks.flatMap((handoffPack) => {
    const contextPackId = getSourceContextPackId(handoffPack);
    if (!contextPackId || !contextsById.has(contextPackId)) {
      return [];
    }

    const relationship: HandoffRelationship = {
      id: `relationship:${contextPackId}:handoff:${handoffPack.id}`,
      context_pack_id: contextPackId,
      context_artifact_id: `artifact:context:${contextPackId}`,
      handoff_pack_id: handoffPack.id,
      handoff_artifact_id: `artifact:handoff:${handoffPack.id}`,
      from_run_id: handoffPack.from_run_id,
      objective: handoffPack.objective,
      referenced_node_ids: handoffPack.referenced_node_ids,
      created_at: handoffPack.created_at
    };

    if (handoffPack.to_session_id) {
      relationship.to_session_id = handoffPack.to_session_id;
    }

    return [relationship];
  });
}

function getSourceContextPackId(pack: HandoffPack): string | undefined {
  const contextPackId = pack.metadata.context_pack_id;
  return typeof contextPackId === "string" && contextPackId.length > 0 ? contextPackId : undefined;
}

function getContextSourceRunId(pack: ContextPack): string | undefined {
  const sourceRunId = pack.metadata.source_run_id;
  return typeof sourceRunId === "string" && sourceRunId.length > 0 ? sourceRunId : undefined;
}

function rememberById<T extends { id: string; created_at: string }>(items: T[], item: T): void {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.unshift(item);
  }

  items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  items.splice(8);
}

function tokenScore(query: string, searchable: string): number {
  return query
    .split(/\s+/u)
    .filter(Boolean)
    .reduce((score, token) => (searchable.includes(token) ? score + 0.5 : score), 0);
}
