import type { ContextPack, GraphEdge, GraphNeighborhood, GraphNode, HandoffPack, TraceSpan } from "@neuralmap/schema";

export interface AgentSummary {
  id: string;
  name: string;
  status: string;
  task: string;
  model: string;
  token_budget: number;
  cache_hit_rate: number;
}

export interface WorkbenchGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generated_at: string;
  mode?: "database" | "sample";
}

export interface GraphQueryInput {
  query: string;
  node_types?: Array<GraphNode["type"]>;
  top_k: number;
  expand_hops: number;
  min_edge_confidence: number;
}

export interface GraphQueryResult {
  seeds: Array<{
    node: GraphNode;
    score: number;
    lexical_score?: number;
    semantic_score?: number;
    quality_score?: number;
    reasons: string[];
  }>;
  neighborhood: GraphNeighborhood;
  intent: QueryIntent;
  retrieval?: {
    mode: "lexical" | "semantic" | "hybrid";
    seed_count: number;
    semantic_seed_count: number;
    vector_seed_count?: number;
    semantic_source?: "local_sparse" | "pgvector+local";
    embedding_model?: string;
  };
  cache: {
    hit: boolean;
    key: string;
  };
}

export interface ContextNodeExplanation {
  node_id: string;
  reason_kind: "direct_seed" | "retrieved_seed" | "graph_expansion";
  summary: string;
  seed_score?: number;
  seed_reasons?: string[];
  via_node_id?: string;
  via_edge_id?: string;
  via_edge_type?: string;
  via_edge_confidence?: number;
  evidence_score?: number;
}

export interface QueryIntent {
  kind:
    | "bug_investigation"
    | "code_change"
    | "documentation"
    | "design"
    | "ticket_triage"
    | "handoff"
    | "validation"
    | "general_recall";
  confidence: number;
  reasons: string[];
  preferred_node_types: Array<GraphNode["type"]>;
  preferred_edge_types: Array<GraphEdge["type"]>;
  suggested_hops: number;
}

export interface ComposeContextInput {
  objective: string;
  agent_id: string;
  session_id: string;
  task_type?: string;
  token_budget: number;
  seed_node_ids: string[];
  query?: string;
}

export interface CreateHandoffInput {
  from_run_id: string;
  to_session_id?: string;
  context_pack_id?: string;
  objective: string;
  current_status: string;
  open_loops?: string[];
  blockers?: string[];
  constraints?: string[];
  recommended_next_actions?: string[];
}

export interface RefreshContextPackInput {
  objective?: string;
  query?: string;
  task_type?: string;
  token_budget?: number;
  seed_node_ids?: string[];
}

export interface RefreshContextPackResult {
  previous_pack_id: string;
  pack: ContextPack;
}

export interface RunTrace {
  run_id: string;
  spans: TraceSpan[];
}

export interface WorkbenchTimeline {
  run_id?: string;
  events: WorkbenchTimelineEvent[];
  mode?: "database" | "sample";
  generated_at: string;
}

export interface WorkbenchTimelineEvent {
  id: string;
  kind: "context_pack" | "handoff_pack" | "artifact_relationship" | "trace_span";
  title: string;
  at: string;
  run_id?: string | undefined;
  context_pack_id?: string | undefined;
  handoff_pack_id?: string | undefined;
  relationship_id?: string | undefined;
  span_id?: string | undefined;
  span_kind?: TraceSpan["kind"] | undefined;
  parent_span_id?: string | undefined;
  node_ids: string[];
  summary?: string;
  metrics: Record<string, number | string | boolean>;
}

export interface WorkbenchArtifacts {
  context_packs: ContextPack[];
  handoff_packs: HandoffPack[];
  relationships: HandoffRelationship[];
  mode?: "database" | "sample";
  generated_at: string;
}

export interface HandoffRelationship {
  id: string;
  context_pack_id: string;
  context_artifact_id: string;
  handoff_pack_id: string;
  handoff_artifact_id: string;
  from_run_id: string;
  to_session_id?: string;
  objective: string;
  referenced_node_ids: string[];
  created_at: string;
}

export type CacheLayerName = "retrieval" | "graph_neighborhood" | "prompt_segment" | "summary" | "response";

export interface CacheLayerStats {
  name: CacheLayerName;
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  size: number;
  expired: number;
  ttl_ms?: number;
  max_entries?: number;
}

export interface CacheLayerPolicy {
  name: CacheLayerName;
  ttlMs?: number;
  maxEntries?: number;
}

export interface CacheEntryInfo {
  layer: CacheLayerName;
  key: string;
  created_at: string;
  last_accessed_at?: string;
  expires_at?: string;
  age_ms: number;
  ttl_ms?: number;
  expired: boolean;
  access_count: number;
  tags: string[];
  value_type: string;
  value_summary: string;
}

export interface CacheDashboard {
  layers: CacheLayerStats[];
  policies: CacheLayerPolicy[];
  entries: CacheEntryInfo[];
  generated_at: string;
}

export interface CacheInvalidateInput {
  layer?: CacheLayerName;
  key?: string;
  tags?: string[];
  include_expired?: boolean;
}

export interface CacheInvalidateResult {
  invalidated: boolean;
  count: number;
  entries: CacheEntryInfo[];
  scope: "database" | "sample";
}

export interface ModelProfile {
  id: string;
  name: string;
  description: string;
  model_family: string;
  reasoning_effort: "low" | "medium" | "high";
  suited_intents: QueryIntent["kind"][];
  max_input_tokens: number;
  latency_budget_ms: number;
  cost_weight: number;
  quality_floor: number;
}

export interface ModelQualitySignal {
  profile_id: string;
  average_score: number;
  feedback_count: number;
  last_score?: number;
}

export interface ModelProfilesDashboard {
  profiles: ModelProfile[];
  feedback: ModelQualitySignal[];
  generated_at: string;
}

export interface ModelRouteDecision {
  task_classification: {
    intent: QueryIntent;
    complexity: number;
    risk: number;
    urgency: number;
    token_budget: number;
    estimated_input_tokens: number;
    context_node_count: number;
    evidence_count: number;
    cache_hit_rate?: number;
    reasons: string[];
  };
  selected_profile: ModelProfile;
  alternatives: Array<{
    profile: ModelProfile;
    score: number;
    reasons: string[];
  }>;
  budget: {
    token_budget: number;
    estimated_input_tokens: number;
    budget_pressure: number;
    latency_budget_ms: number;
    cost_weight: number;
  };
  quality: {
    profile_average_score?: number;
    feedback_count: number;
    quality_floor: number;
    needs_feedback: boolean;
  };
  routing_reasons: string[];
}

export interface ModelRouteInput {
  task?: string | undefined;
  objective?: string | undefined;
  query?: string | undefined;
  context_pack_id?: string | undefined;
  token_budget?: number | undefined;
  model_profile?: string | undefined;
}

export interface ModelFeedbackInput {
  run_id: string;
  model_profile: string;
  score: number;
  signal?: string | undefined;
  comment?: string | undefined;
}

export interface ModelFeedbackResult {
  accepted: boolean;
  feedback: ModelFeedbackInput & { created_at: string };
  summaries: ModelQualitySignal[];
}

export type { ContextPack, HandoffPack };
