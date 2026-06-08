import { z } from "zod";

import { graphScopeSchema } from "./scope.js";
import { edgeTypes, nodeTypes, sourceSystems } from "./values.js";

export const metadataSchema = z.record(z.string(), z.unknown());

export const lifecycleStatusSchema = z.enum(["active", "archived", "redacted", "deprecated"]);

export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;

export const ontologyRefSchema = z.object({
  profile_id: z.string().min(1),
  type: z.string().min(1),
  version: z.string().min(1).optional()
});

export type OntologyRef = z.infer<typeof ontologyRefSchema>;

export const provenanceSchema = z.object({
  system: z.string().min(1),
  run_id: z.string().min(1).optional(),
  turn_id: z.string().min(1).optional(),
  raw_ref: z.string().min(1).optional(),
  at: z.string().min(1).optional(),
  metadata: metadataSchema.optional()
});

export type Provenance = z.infer<typeof provenanceSchema>;

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(nodeTypes),
  labels: z.array(z.string().min(1)).optional(),
  title: z.string().min(1),
  content_ref: z.string().min(1).optional(),
  summary: z.string().optional(),
  embedding_ref: z.string().min(1).optional(),
  source_system: z.enum(sourceSystems).optional(),
  trust_score: z.number().min(0).max(1).default(0.5),
  freshness_score: z.number().min(0).max(1).default(0.5),
  importance_score: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).optional(),
  lifecycle_status: lifecycleStatusSchema.optional(),
  valid_from: z.string().min(1).optional(),
  valid_to: z.string().min(1).nullable().optional(),
  ontology: ontologyRefSchema.optional(),
  properties: metadataSchema.optional(),
  provenance: z.array(provenanceSchema).optional(),
  scope: graphScopeSchema.optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  metadata: metadataSchema.default({})
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type Neuron = GraphNode;

export const graphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(edgeTypes),
  labels: z.array(z.string().min(1)).optional(),
  weight: z.number().min(0).default(1),
  confidence: z.number().min(0).max(1).default(0.5),
  lifecycle_status: lifecycleStatusSchema.optional(),
  valid_from: z.string().min(1).optional(),
  valid_to: z.string().min(1).nullable().optional(),
  ontology: ontologyRefSchema.optional(),
  properties: metadataSchema.optional(),
  provenance: z.array(provenanceSchema).optional(),
  scope: graphScopeSchema.optional(),
  created_at: z.string().datetime(),
  source_run_id: z.string().min(1).optional(),
  metadata: metadataSchema.default({})
});

export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type Synapse = GraphEdge;

export const graphQueryRequestSchema = z.object({
  query: z.string().min(1),
  node_types: z.array(z.enum(nodeTypes)).optional(),
  profile_id: z.string().min(1).optional(),
  labels: z.array(z.string().min(1)).optional(),
  filters: metadataSchema.optional(),
  top_k: z.number().int().positive().max(100).default(10),
  expand_hops: z.number().int().min(0).max(2).default(1),
  min_edge_confidence: z.number().min(0).max(1).default(0.4),
  scope: graphScopeSchema.optional(),
  activation_tags: z.array(z.string().min(1)).optional()
});

export type GraphQueryRequest = z.infer<typeof graphQueryRequestSchema>;

export const graphNeighborhoodSchema = z.object({
  seed_node_ids: z.array(z.string().min(1)),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  generated_at: z.string().datetime()
});

export type GraphNeighborhood = z.infer<typeof graphNeighborhoodSchema>;

export const graphProfileNeuronTypeSchema = z.object({
  base_labels: z.array(z.string().min(1)).default([]),
  required_properties: z.array(z.string().min(1)).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  render_hints: metadataSchema.optional()
});

export const graphProfileSynapseTypeSchema = z.object({
  from: z.array(z.string().min(1)).optional(),
  to: z.array(z.string().min(1)).optional(),
  required_properties: z.array(z.string().min(1)).optional(),
  current_pointer: z.boolean().optional(),
  perspective_edge: z.boolean().optional(),
  temporal_edge: z.boolean().optional(),
  render_hints: metadataSchema.optional()
});

export const graphProfileSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1).default("1"),
  extends: z.string().min(1).optional(),
  neuron_types: z.record(z.string(), graphProfileNeuronTypeSchema).default({}),
  synapse_types: z.record(z.string(), graphProfileSynapseTypeSchema).default({}),
  context_templates: z.record(z.string(), metadataSchema).optional(),
  render_hints: metadataSchema.optional(),
  metadata: metadataSchema.optional()
});

export type GraphProfile = z.infer<typeof graphProfileSchema>;

export const graphDeltaSourceSchema = z.object({
  system: z.string().min(1),
  run_id: z.string().min(1).optional(),
  turn_id: z.string().min(1).optional(),
  raw_ref: z.string().min(1).optional(),
  metadata: metadataSchema.optional()
});

export type GraphDeltaSource = z.infer<typeof graphDeltaSourceSchema>;

export const graphDeltaNeuronSchema = z.object({
  id: z.string().min(1),
  type: z.enum(nodeTypes).optional(),
  labels: z.array(z.string().min(1)).optional(),
  title: z.string().min(1),
  content_ref: z.string().min(1).optional(),
  body_ref: z.string().min(1).optional(),
  summary: z.string().optional(),
  source_system: z.enum(sourceSystems).optional(),
  trust_score: z.number().min(0).max(1).optional(),
  freshness_score: z.number().min(0).max(1).optional(),
  importance_score: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  lifecycle_status: lifecycleStatusSchema.optional(),
  valid_from: z.string().min(1).optional(),
  valid_to: z.string().min(1).nullable().optional(),
  ontology: ontologyRefSchema.optional(),
  properties: metadataSchema.optional(),
  provenance: z.array(provenanceSchema).optional(),
  scope: graphScopeSchema.optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  metadata: metadataSchema.optional()
});

export type GraphDeltaNeuron = z.infer<typeof graphDeltaNeuronSchema>;

export const graphDeltaSynapseSchema = z.object({
  id: z.string().min(1).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  edge_type: z.enum(edgeTypes).optional(),
  labels: z.array(z.string().min(1)).optional(),
  weight: z.number().min(0).optional(),
  confidence: z.number().min(0).max(1).optional(),
  lifecycle_status: lifecycleStatusSchema.optional(),
  valid_from: z.string().min(1).optional(),
  valid_to: z.string().min(1).nullable().optional(),
  ontology: ontologyRefSchema.optional(),
  properties: metadataSchema.optional(),
  provenance: z.array(provenanceSchema).optional(),
  scope: graphScopeSchema.optional(),
  created_at: z.string().datetime().optional(),
  source_run_id: z.string().min(1).optional(),
  metadata: metadataSchema.optional()
});

export type GraphDeltaSynapse = z.infer<typeof graphDeltaSynapseSchema>;

export const graphDeltaSelectorSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  ontology_type: z.string().min(1).optional(),
  profile_id: z.string().min(1).optional(),
  properties: metadataSchema.optional()
});

export type GraphDeltaSelector = z.infer<typeof graphDeltaSelectorSchema>;

export const graphDeltaTemporalOperationSchema = z.object({
  operation: z.enum(["supersede_current"]),
  selector: graphDeltaSelectorSchema,
  valid_to: z.string().min(1),
  superseded_by: z.string().min(1)
});

export type GraphDeltaTemporalOperation = z.infer<typeof graphDeltaTemporalOperationSchema>;

export const graphDeltaArchiveOperationSchema = z.object({
  selector: graphDeltaSelectorSchema,
  lifecycle_status: lifecycleStatusSchema.default("archived")
});

export type GraphDeltaArchiveOperation = z.infer<typeof graphDeltaArchiveOperationSchema>;

export const graphDeltaRequestSchema = z.object({
  idempotency_key: z.string().min(1),
  profile_id: z.string().min(1).optional(),
  source: graphDeltaSourceSchema.optional(),
  scope: graphScopeSchema.optional(),
  upsert_neurons: z.array(graphDeltaNeuronSchema).default([]),
  upsert_synapses: z.array(graphDeltaSynapseSchema).default([]),
  temporal_operations: z.array(graphDeltaTemporalOperationSchema).default([]),
  archive: z.array(graphDeltaArchiveOperationSchema).default([]),
  delete: z.array(graphDeltaSelectorSchema).default([])
});

export type GraphDeltaRequest = z.infer<typeof graphDeltaRequestSchema>;

export const graphNeuronQueryRequestSchema = z.object({
  query: z.string().min(1),
  profile_id: z.string().min(1).optional(),
  labels: z.array(z.string().min(1)).optional(),
  node_types: z.array(z.enum(nodeTypes)).optional(),
  filters: metadataSchema.optional(),
  top_k: z.number().int().positive().max(100).default(10),
  include_superseded: z.boolean().optional(),
  scope: graphScopeSchema.optional()
});

export type GraphNeuronQueryRequest = z.infer<typeof graphNeuronQueryRequestSchema>;

export const graphTraverseRequestSchema = z.object({
  seed_node_ids: z.array(z.string().min(1)).min(1),
  profile_id: z.string().min(1).optional(),
  max_hops: z.number().int().min(0).max(4).default(2),
  include_synapse_types: z.array(z.string().min(1)).optional(),
  exclude_if: metadataSchema.optional(),
  scope: graphScopeSchema.optional()
});

export type GraphTraverseRequest = z.infer<typeof graphTraverseRequestSchema>;

export const graphCurrentViewRequestSchema = z.object({
  profile_id: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  current_key: z.array(z.string().min(1)).min(1),
  filters: metadataSchema.optional(),
  scope: graphScopeSchema.optional()
});

export type GraphCurrentViewRequest = z.infer<typeof graphCurrentViewRequestSchema>;
