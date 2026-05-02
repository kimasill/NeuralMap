import { edgeTypes, nodeTypes, runStatuses, sourceSystems } from "@neuralmap/schema";
import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector
} from "drizzle-orm/pg-core";

export const sourceSystemEnum = pgEnum("source_system", sourceSystems);
export const nodeTypeEnum = pgEnum("node_type", nodeTypes);
export const edgeTypeEnum = pgEnum("edge_type", edgeTypes);
export const runStatusEnum = pgEnum("run_status", runStatuses);

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: text("id").primaryKey(),
    type: nodeTypeEnum("type").notNull(),
    title: text("title").notNull(),
    contentRef: text("content_ref"),
    summary: text("summary"),
    sourceSystem: sourceSystemEnum("source_system"),
    trustScore: real("trust_score").notNull().default(0.5),
    freshnessScore: real("freshness_score").notNull().default(0.5),
    importanceScore: real("importance_score").notNull().default(0.5),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("graph_nodes_type_idx").on(table.type),
    index("graph_nodes_source_idx").on(table.sourceSystem),
    index("graph_nodes_updated_at_idx").on(table.updatedAt),
    index("graph_nodes_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))
  ]
);

export const traceRuns = pgTable(
  "trace_runs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    sessionId: text("session_id").notNull(),
    objective: text("objective").notNull(),
    status: runStatusEnum("status").notNull().default("planned"),
    contextPackId: text("context_pack_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("trace_runs_agent_idx").on(table.agentId),
    index("trace_runs_session_idx").on(table.sessionId),
    index("trace_runs_status_idx").on(table.status),
    index("trace_runs_created_at_idx").on(table.createdAt)
  ]
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    id: text("id").primaryKey(),
    fromNodeId: text("from_node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    toNodeId: text("to_node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    type: edgeTypeEnum("type").notNull(),
    weight: real("weight").notNull().default(1),
    confidence: real("confidence").notNull().default(0.5),
    sourceRunId: text("source_run_id").references(() => traceRuns.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("graph_edges_from_idx").on(table.fromNodeId),
    index("graph_edges_to_idx").on(table.toNodeId),
    index("graph_edges_type_idx").on(table.type),
    index("graph_edges_confidence_idx").on(table.confidence),
    uniqueIndex("graph_edges_unique_directed_idx").on(table.fromNodeId, table.toNodeId, table.type)
  ]
);

export const contentChunks = pgTable(
  "content_chunks",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    sourceUri: text("source_uri").notNull(),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("content_chunks_node_idx").on(table.nodeId),
    uniqueIndex("content_chunks_source_ordinal_idx").on(table.sourceUri, table.ordinal),
    index("content_chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))
  ]
);

export const contextPacks = pgTable(
  "context_packs",
  {
    id: text("id").primaryKey(),
    objective: text("objective").notNull(),
    agentId: text("agent_id").notNull(),
    sessionId: text("session_id").notNull(),
    nodeIds: jsonb("node_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    evidence: jsonb("evidence")
      .$type<Array<{ node_id: string; snippet: string; score: number }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    decisions: jsonb("decisions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    blockers: jsonb("blockers").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    templateId: text("template_id"),
    tokenBudget: integer("token_budget").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("context_packs_agent_idx").on(table.agentId),
    index("context_packs_session_idx").on(table.sessionId),
    index("context_packs_created_at_idx").on(table.createdAt)
  ]
);

export const handoffPacks = pgTable(
  "handoff_packs",
  {
    id: text("id").primaryKey(),
    fromRunId: text("from_run_id")
      .notNull()
      .references(() => traceRuns.id, { onDelete: "cascade" }),
    toSessionId: text("to_session_id"),
    objective: text("objective").notNull(),
    currentStatus: text("current_status").notNull(),
    keyDecisions: jsonb("key_decisions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    referencedNodeIds: jsonb("referenced_node_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    openLoops: jsonb("open_loops").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    blockers: jsonb("blockers").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    constraints: jsonb("constraints").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    recommendedNextActions: jsonb("recommended_next_actions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("handoff_packs_from_run_idx").on(table.fromRunId),
    index("handoff_packs_created_at_idx").on(table.createdAt)
  ]
);

export const traceSpans = pgTable(
  "trace_spans",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => traceRuns.id, { onDelete: "cascade" }),
    parentSpanId: text("parent_span_id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true })
  },
  (table) => [
    index("trace_spans_run_idx").on(table.runId),
    index("trace_spans_parent_idx").on(table.parentSpanId),
    index("trace_spans_kind_idx").on(table.kind),
    index("trace_spans_started_at_idx").on(table.startedAt)
  ]
);

export const graphNodesRelations = relations(graphNodes, ({ many }) => ({
  outgoingEdges: many(graphEdges, { relationName: "outgoing_edges" }),
  incomingEdges: many(graphEdges, { relationName: "incoming_edges" }),
  chunks: many(contentChunks)
}));

export const graphEdgesRelations = relations(graphEdges, ({ one }) => ({
  fromNode: one(graphNodes, {
    fields: [graphEdges.fromNodeId],
    references: [graphNodes.id],
    relationName: "outgoing_edges"
  }),
  toNode: one(graphNodes, {
    fields: [graphEdges.toNodeId],
    references: [graphNodes.id],
    relationName: "incoming_edges"
  }),
  sourceRun: one(traceRuns, {
    fields: [graphEdges.sourceRunId],
    references: [traceRuns.id]
  })
}));

export const traceRunsRelations = relations(traceRuns, ({ many, one }) => ({
  spans: many(traceSpans),
  handoffPacks: many(handoffPacks),
  contextPack: one(contextPacks, {
    fields: [traceRuns.contextPackId],
    references: [contextPacks.id]
  })
}));

export const contentChunksRelations = relations(contentChunks, ({ one }) => ({
  node: one(graphNodes, {
    fields: [contentChunks.nodeId],
    references: [graphNodes.id]
  })
}));

export const handoffPacksRelations = relations(handoffPacks, ({ one }) => ({
  fromRun: one(traceRuns, {
    fields: [handoffPacks.fromRunId],
    references: [traceRuns.id]
  })
}));

export const traceSpansRelations = relations(traceSpans, ({ one }) => ({
  run: one(traceRuns, {
    fields: [traceSpans.runId],
    references: [traceRuns.id]
  })
}));
