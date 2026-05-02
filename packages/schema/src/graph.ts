import { z } from "zod";

import { edgeTypes, nodeTypes, sourceSystems } from "./values.js";

export const metadataSchema = z.record(z.string(), z.unknown());

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(nodeTypes),
  title: z.string().min(1),
  content_ref: z.string().min(1).optional(),
  summary: z.string().optional(),
  embedding_ref: z.string().min(1).optional(),
  source_system: z.enum(sourceSystems).optional(),
  trust_score: z.number().min(0).max(1).default(0.5),
  freshness_score: z.number().min(0).max(1).default(0.5),
  importance_score: z.number().min(0).max(1).default(0.5),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  metadata: metadataSchema.default({})
});

export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(edgeTypes),
  weight: z.number().min(0).default(1),
  confidence: z.number().min(0).max(1).default(0.5),
  created_at: z.string().datetime(),
  source_run_id: z.string().min(1).optional(),
  metadata: metadataSchema.default({})
});

export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphQueryRequestSchema = z.object({
  query: z.string().min(1),
  node_types: z.array(z.enum(nodeTypes)).optional(),
  top_k: z.number().int().positive().max(100).default(10),
  expand_hops: z.number().int().min(0).max(2).default(1),
  min_edge_confidence: z.number().min(0).max(1).default(0.4)
});

export type GraphQueryRequest = z.infer<typeof graphQueryRequestSchema>;

export const graphNeighborhoodSchema = z.object({
  seed_node_ids: z.array(z.string().min(1)),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  generated_at: z.string().datetime()
});

export type GraphNeighborhood = z.infer<typeof graphNeighborhoodSchema>;

