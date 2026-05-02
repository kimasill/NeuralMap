import type { GraphEdge, GraphNode, TraceSpan } from "@neuralmap/schema";

const createdAt = "2026-05-02T00:00:00.000Z";

export const sampleNodes: GraphNode[] = [
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
    created_at: createdAt,
    updated_at: createdAt,
    metadata: { packageManager: "pnpm", language: "TypeScript" }
  },
  {
    id: "node_decision_ts_stack",
    type: "Decision",
    title: "MVP stack uses TypeScript and Postgres",
    summary: "ADR 0001 locks TypeScript, Fastify, React, Vite, Cytoscape.js, Postgres, pgvector, Redis, and Drizzle.",
    content_ref: "docs/adr/0001-typescript-monorepo-stack.md",
    source_system: "doc",
    trust_score: 0.98,
    freshness_score: 0.9,
    importance_score: 0.9,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: { adr: "0001" }
  },
  {
    id: "node_context_pack_contract",
    type: "Template",
    title: "Context Pack Contract",
    summary: "A compact objective, evidence, decisions, blockers, template, token budget, and node reference bundle.",
    content_ref: "packages/schema/src/context.ts",
    source_system: "repo",
    trust_score: 0.9,
    freshness_score: 0.9,
    importance_score: 0.88,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: { export: "contextPackSchema" }
  },
  {
    id: "node_graph_schema",
    type: "CodeFile",
    title: "Drizzle Graph Schema",
    summary: "Stores graph nodes, edges, chunks, context packs, handoff packs, trace runs, and trace spans.",
    content_ref: "packages/db/src/schema.ts",
    source_system: "repo",
    trust_score: 0.9,
    freshness_score: 0.9,
    importance_score: 0.86,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: { tables: ["graph_nodes", "graph_edges", "context_packs", "trace_spans"] }
  },
  {
    id: "node_track_a",
    type: "Task",
    title: "Track A: Core retrieval and context composer",
    summary: "Implement seed retrieval, graph expansion, compression policy, and Context Pack Composer.",
    content_ref: "https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer",
    source_system: "ticket",
    trust_score: 0.86,
    freshness_score: 1,
    importance_score: 0.82,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: { linear: "AIN-6", status: "In Progress" }
  },
  {
    id: "node_track_d",
    type: "Task",
    title: "Track D: Graph workbench UI",
    summary: "Implement agent panel, graph canvas, context inspector, and run trace foundation.",
    content_ref: "https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui",
    source_system: "ticket",
    trust_score: 0.86,
    freshness_score: 1,
    importance_score: 0.78,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: { linear: "AIN-9", status: "In Progress" }
  }
];

export const sampleEdges: GraphEdge[] = [
  {
    id: "edge_repo_implements_graph_schema",
    from: "node_repository_neuralmap",
    to: "node_graph_schema",
    type: "implements",
    weight: 0.9,
    confidence: 0.9,
    created_at: createdAt,
    metadata: {}
  },
  {
    id: "edge_decision_references_repo",
    from: "node_decision_ts_stack",
    to: "node_repository_neuralmap",
    type: "references",
    weight: 0.85,
    confidence: 0.92,
    created_at: createdAt,
    metadata: {}
  },
  {
    id: "edge_context_depends_graph",
    from: "node_context_pack_contract",
    to: "node_graph_schema",
    type: "depends_on",
    weight: 0.8,
    confidence: 0.86,
    created_at: createdAt,
    metadata: {}
  },
  {
    id: "edge_track_a_implements_context",
    from: "node_track_a",
    to: "node_context_pack_contract",
    type: "implements",
    weight: 0.9,
    confidence: 0.88,
    created_at: createdAt,
    metadata: {}
  },
  {
    id: "edge_track_d_references_context",
    from: "node_track_d",
    to: "node_context_pack_contract",
    type: "references",
    weight: 0.65,
    confidence: 0.78,
    created_at: createdAt,
    metadata: {}
  }
];

export const sampleTraceSpans: TraceSpan[] = [
  {
    id: "span_seed_retrieval",
    run_id: "run_sample_phase_1",
    name: "Seed Retrieval",
    kind: "retrieval",
    started_at: createdAt,
    ended_at: createdAt,
    attributes: { query: "Phase 1 Memory Backbone", topK: 8, cache: "miss" }
  },
  {
    id: "span_graph_expansion",
    run_id: "run_sample_phase_1",
    parent_span_id: "span_seed_retrieval",
    name: "Graph Expansion",
    kind: "graph_expansion",
    started_at: createdAt,
    ended_at: createdAt,
    attributes: { hops: 1, edges: sampleEdges.length }
  },
  {
    id: "span_context_pack",
    run_id: "run_sample_phase_1",
    parent_span_id: "span_graph_expansion",
    name: "Context Pack Composition",
    kind: "context_pack",
    started_at: createdAt,
    ended_at: createdAt,
    attributes: { tokenBudget: 8000, evidenceItems: 4 }
  }
];

export const sampleMemory = {
  nodes: sampleNodes,
  edges: sampleEdges
} as const;

