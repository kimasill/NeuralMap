import type { AgentSummary, RunTrace, WorkbenchGraph } from "./types.js";

const generatedAt = "2026-05-02T00:00:00.000Z";

export const fallbackGraph: WorkbenchGraph = {
  generated_at: generatedAt,
  nodes: [
    {
      id: "node_repository_neuralmap",
      type: "Repository",
      title: "NeuralMap Repository",
      summary: "TypeScript monorepo for graph memory, context reconstruction, agent traces, and workbench UI.",
      content_ref: "S:/Project/NeuralMap",
      source_system: "repo",
      trust_score: 0.95,
      freshness_score: 0.92,
      importance_score: 0.95,
      created_at: generatedAt,
      updated_at: generatedAt,
      metadata: { packageManager: "pnpm" }
    },
    {
      id: "node_context_pack_contract",
      type: "Template",
      title: "Context Pack Contract",
      summary: "Objective, evidence, decisions, blockers, template, token budget, and node references.",
      content_ref: "packages/schema/src/context.ts",
      source_system: "repo",
      trust_score: 0.9,
      freshness_score: 0.9,
      importance_score: 0.88,
      created_at: generatedAt,
      updated_at: generatedAt,
      metadata: { export: "contextPackSchema" }
    }
  ],
  edges: [
    {
      id: "edge_repo_references_context",
      from: "node_repository_neuralmap",
      to: "node_context_pack_contract",
      type: "references",
      weight: 0.8,
      confidence: 0.86,
      created_at: generatedAt,
      metadata: {}
    }
  ]
};

export const fallbackAgents: AgentSummary[] = [
  {
    id: "main-agent",
    name: "Main Agent",
    status: "running",
    task: "Phase 1 Memory Backbone",
    model: "gpt-5",
    token_budget: 8000,
    cache_hit_rate: 0.18
  }
];

export const fallbackTrace: RunTrace = {
  run_id: "run_sample_phase_1",
  spans: [
    {
      id: "span_seed_retrieval",
      run_id: "run_sample_phase_1",
      name: "Seed Retrieval",
      kind: "retrieval",
      started_at: generatedAt,
      ended_at: generatedAt,
      attributes: { topK: 8 }
    },
    {
      id: "span_graph_expansion",
      run_id: "run_sample_phase_1",
      parent_span_id: "span_seed_retrieval",
      name: "Graph Expansion",
      kind: "graph_expansion",
      started_at: generatedAt,
      ended_at: generatedAt,
      attributes: { hops: 1 }
    }
  ]
};

