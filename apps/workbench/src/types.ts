import type { GraphEdge, GraphNode, TraceSpan } from "@neuralmap/schema";

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

export interface RunTrace {
  run_id: string;
  spans: TraceSpan[];
}
