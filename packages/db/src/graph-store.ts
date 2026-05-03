import type { ContextPack, GraphEdge, GraphNode, GraphQueryRequest, HandoffPack, SourceSystem } from "@neuralmap/schema";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { NeuralMapDatabase } from "./client.js";
import {
  createContentChunkEmbedding,
  createGraphNodeEmbedding,
  createQueryEmbedding,
  deterministicEmbeddingModel,
  toPgVectorLiteral
} from "./embedding.js";
import { contentChunks, contextPacks, graphEdges, graphNodes, handoffPacks, traceRuns } from "./schema.js";
import type {
  ContentChunkRow,
  ContextPackRow,
  GraphEdgeRow,
  GraphNodeRow,
  HandoffPackRow,
  NewContentChunkRow,
  TraceRunRow
} from "./types.js";

export interface PersistedContentChunk {
  id: string;
  node_id: string;
  source_uri: string;
  ordinal: number;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
}

export interface GraphPersistenceInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  chunks?: PersistedContentChunk[];
}

export interface PersistedGraphMemory {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VectorSeedCandidate {
  node: GraphNode;
  similarity: number;
  source: "pgvector_node" | "pgvector_chunk";
  chunk_id?: string;
}

export interface GraphStore {
  getMemory(): Promise<PersistedGraphMemory>;
  getNode(id: string): Promise<GraphNode | undefined>;
  searchVectorSeeds(request: GraphQueryRequest, limit?: number): Promise<VectorSeedCandidate[]>;
  upsertGraph(input: GraphPersistenceInput): Promise<{ nodes: number; edges: number; chunks: number }>;
  saveContextPack(pack: ContextPack): Promise<ContextPack>;
  getContextPack(id: string): Promise<ContextPack | undefined>;
  listContextPacks(limit?: number): Promise<ContextPack[]>;
  saveHandoffPack(pack: HandoffPack): Promise<HandoffPack>;
  getHandoffPack(id: string): Promise<HandoffPack | undefined>;
  listHandoffPacks(limit?: number): Promise<HandoffPack[]>;
}

export function createGraphStore(db: NeuralMapDatabase): GraphStore {
  return {
    async getMemory() {
      const [nodeRows, edgeRows] = await Promise.all([db.select().from(graphNodes), db.select().from(graphEdges)]);
      return {
        nodes: nodeRows.map(toGraphNode),
        edges: edgeRows.map(toGraphEdge)
      };
    },

    async getNode(id) {
      const [row] = await db.select().from(graphNodes).where(eq(graphNodes.id, id)).limit(1);
      return row ? toGraphNode(row) : undefined;
    },

    async searchVectorSeeds(request, limit = request.top_k) {
      return searchVectorSeeds(db, request, limit);
    },

    async upsertGraph(input) {
      if (input.nodes.length > 0) {
        await db
          .insert(graphNodes)
          .values(input.nodes.map(toGraphNodeInsert))
          .onConflictDoUpdate({
            target: graphNodes.id,
            set: {
              type: sql`excluded.type`,
              title: sql`excluded.title`,
              contentRef: sql`excluded.content_ref`,
              summary: sql`excluded.summary`,
              sourceSystem: sql`excluded.source_system`,
              trustScore: sql`excluded.trust_score`,
              freshnessScore: sql`excluded.freshness_score`,
              importanceScore: sql`excluded.importance_score`,
              embedding: sql`excluded.embedding`,
              metadata: sql`excluded.metadata`,
              updatedAt: sql`excluded.updated_at`
            }
          });
      }

      if (input.edges.length > 0) {
        await db
          .insert(graphEdges)
          .values(input.edges.map(toGraphEdgeInsert))
          .onConflictDoUpdate({
            target: graphEdges.id,
            set: {
              fromNodeId: sql`excluded.from_node_id`,
              toNodeId: sql`excluded.to_node_id`,
              type: sql`excluded.type`,
              weight: sql`excluded.weight`,
              confidence: sql`excluded.confidence`,
              sourceRunId: sql`excluded.source_run_id`,
              metadata: sql`excluded.metadata`
            }
          });
      }

      const chunks = input.chunks ?? [];
      if (chunks.length > 0) {
        await db
          .insert(contentChunks)
          .values(chunks.map(toContentChunkInsert))
          .onConflictDoUpdate({
            target: contentChunks.id,
            set: {
              nodeId: sql`excluded.node_id`,
              sourceUri: sql`excluded.source_uri`,
              ordinal: sql`excluded.ordinal`,
              content: sql`excluded.content`,
              contentHash: sql`excluded.content_hash`,
              embedding: sql`excluded.embedding`,
              metadata: sql`excluded.metadata`
            }
          });
      }

      return {
        nodes: input.nodes.length,
        edges: input.edges.length,
        chunks: chunks.length
      };
    },

    async saveContextPack(pack) {
      await db
        .insert(contextPacks)
        .values(toContextPackInsert(pack))
        .onConflictDoUpdate({
            target: contextPacks.id,
            set: {
              objective: sql`excluded.objective`,
              agentId: sql`excluded.agent_id`,
              sessionId: sql`excluded.session_id`,
              nodeIds: sql`excluded.node_ids`,
              evidence: sql`excluded.evidence`,
              decisions: sql`excluded.decisions`,
              blockers: sql`excluded.blockers`,
              templateId: sql`excluded.template_id`,
              tokenBudget: sql`excluded.token_budget`,
              metadata: sql`excluded.metadata`
            }
          });
      return pack;
    },

    async getContextPack(id) {
      const [row] = await db.select().from(contextPacks).where(eq(contextPacks.id, id)).limit(1);
      return row ? toContextPack(row) : undefined;
    },

    async listContextPacks(limit = 10) {
      const rows = await db.select().from(contextPacks).orderBy(desc(contextPacks.createdAt)).limit(limit);
      return rows.map(toContextPack);
    },

    async saveHandoffPack(pack) {
      await ensureTraceRun(db, pack.from_run_id);
      await db
        .insert(handoffPacks)
        .values(toHandoffPackInsert(pack))
        .onConflictDoUpdate({
            target: handoffPacks.id,
            set: {
            toSessionId: sql`excluded.to_session_id`,
            objective: sql`excluded.objective`,
            currentStatus: sql`excluded.current_status`,
            keyDecisions: sql`excluded.key_decisions`,
            referencedNodeIds: sql`excluded.referenced_node_ids`,
            openLoops: sql`excluded.open_loops`,
            blockers: sql`excluded.blockers`,
            constraints: sql`excluded.constraints`,
            recommendedNextActions: sql`excluded.recommended_next_actions`,
            metadata: sql`excluded.metadata`
            }
          });
      return pack;
    },

    async getHandoffPack(id) {
      const [row] = await db.select().from(handoffPacks).where(eq(handoffPacks.id, id)).limit(1);
      return row ? toHandoffPack(row) : undefined;
    },

    async listHandoffPacks(limit = 10) {
      const rows = await db.select().from(handoffPacks).orderBy(desc(handoffPacks.createdAt)).limit(limit);
      return rows.map(toHandoffPack);
    }
  };
}

function toGraphNode(row: GraphNodeRow): GraphNode {
  const node: GraphNode = {
    id: row.id,
    type: row.type,
    title: row.title,
    trust_score: row.trustScore,
    freshness_score: row.freshnessScore,
    importance_score: row.importanceScore,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    metadata: row.metadata
  };

  if (row.contentRef) {
    node.content_ref = row.contentRef;
  }
  if (row.summary) {
    node.summary = row.summary;
  }
  if (row.sourceSystem) {
    node.source_system = row.sourceSystem as SourceSystem;
  }
  if (row.embedding) {
    node.embedding_ref = `pgvector:${deterministicEmbeddingModel}:graph_nodes:${row.id}`;
  }

  return node;
}

function toGraphEdge(row: GraphEdgeRow): GraphEdge {
  const edge: GraphEdge = {
    id: row.id,
    from: row.fromNodeId,
    to: row.toNodeId,
    type: row.type,
    weight: row.weight,
    confidence: row.confidence,
    created_at: row.createdAt.toISOString(),
    metadata: row.metadata
  };

  if (row.sourceRunId) {
    edge.source_run_id = row.sourceRunId;
  }

  return edge;
}

function toGraphNodeInsert(node: GraphNode) {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    contentRef: node.content_ref ?? null,
    summary: node.summary ?? null,
    sourceSystem: node.source_system ?? null,
    trustScore: node.trust_score,
    freshnessScore: node.freshness_score,
    importanceScore: node.importance_score,
    embedding: createGraphNodeEmbedding(node),
    metadata: node.metadata,
    createdAt: new Date(node.created_at),
    updatedAt: new Date(node.updated_at)
  };
}

function toGraphEdgeInsert(edge: GraphEdge) {
  return {
    id: edge.id,
    fromNodeId: edge.from,
    toNodeId: edge.to,
    type: edge.type,
    weight: edge.weight,
    confidence: edge.confidence,
    sourceRunId: edge.source_run_id ?? null,
    metadata: edge.metadata ?? {},
    createdAt: new Date(edge.created_at)
  };
}

function toContentChunkInsert(chunk: PersistedContentChunk): NewContentChunkRow {
  return {
    id: chunk.id,
    nodeId: chunk.node_id,
    sourceUri: chunk.source_uri,
    ordinal: chunk.ordinal,
    content: chunk.content,
    contentHash: chunk.content_hash,
    embedding: createContentChunkEmbedding(chunk),
    metadata: chunk.metadata
  };
}

async function searchVectorSeeds(
  db: NeuralMapDatabase,
  request: GraphQueryRequest,
  limit: number
): Promise<VectorSeedCandidate[]> {
  const queryVector = toPgVectorLiteral(createQueryEmbedding(request.query));
  const nodeTypes = request.node_types ?? [];
  const nodeConditions = [isNotNull(graphNodes.embedding)];
  const chunkConditions = [isNotNull(contentChunks.embedding)];
  const clampedLimit = Math.max(1, Math.min(limit, 100));

  if (nodeTypes.length > 0) {
    nodeConditions.push(inArray(graphNodes.type, nodeTypes));
    chunkConditions.push(inArray(graphNodes.type, nodeTypes));
  }

  const nodeDistance = sql<number>`${graphNodes.embedding} <=> ${queryVector}::vector`;
  const chunkDistance = sql<number>`${contentChunks.embedding} <=> ${queryVector}::vector`;
  const [nodeRows, chunkRows] = await Promise.all([
    db
      .select({
        id: graphNodes.id,
        type: graphNodes.type,
        title: graphNodes.title,
        contentRef: graphNodes.contentRef,
        summary: graphNodes.summary,
        sourceSystem: graphNodes.sourceSystem,
        trustScore: graphNodes.trustScore,
        freshnessScore: graphNodes.freshnessScore,
        importanceScore: graphNodes.importanceScore,
        embedding: graphNodes.embedding,
        metadata: graphNodes.metadata,
        createdAt: graphNodes.createdAt,
        updatedAt: graphNodes.updatedAt,
        similarity: sql<number>`1 - (${nodeDistance})`
      })
      .from(graphNodes)
      .where(and(...nodeConditions))
      .orderBy(nodeDistance)
      .limit(clampedLimit),
    db
      .select({
        id: graphNodes.id,
        type: graphNodes.type,
        title: graphNodes.title,
        contentRef: graphNodes.contentRef,
        summary: graphNodes.summary,
        sourceSystem: graphNodes.sourceSystem,
        trustScore: graphNodes.trustScore,
        freshnessScore: graphNodes.freshnessScore,
        importanceScore: graphNodes.importanceScore,
        embedding: graphNodes.embedding,
        metadata: graphNodes.metadata,
        createdAt: graphNodes.createdAt,
        updatedAt: graphNodes.updatedAt,
        chunkId: contentChunks.id,
        similarity: sql<number>`1 - (${chunkDistance})`
      })
      .from(contentChunks)
      .innerJoin(graphNodes, eq(contentChunks.nodeId, graphNodes.id))
      .where(and(...chunkConditions))
      .orderBy(chunkDistance)
      .limit(clampedLimit)
  ]);
  const candidates = new Map<string, VectorSeedCandidate>();

  for (const row of nodeRows) {
    addVectorCandidate(candidates, {
      node: toGraphNode(row),
      similarity: normalizeSimilarity(row.similarity),
      source: "pgvector_node"
    });
  }

  for (const row of chunkRows) {
    addVectorCandidate(candidates, {
      node: toGraphNode(row),
      similarity: normalizeSimilarity(row.similarity),
      source: "pgvector_chunk",
      chunk_id: row.chunkId
    });
  }

  return [...candidates.values()]
    .sort((a, b) => b.similarity - a.similarity || b.node.importance_score - a.node.importance_score)
    .slice(0, clampedLimit);
}

function addVectorCandidate(
  candidates: Map<string, VectorSeedCandidate>,
  candidate: VectorSeedCandidate
): void {
  const existing = candidates.get(candidate.node.id);
  if (!existing || candidate.similarity > existing.similarity) {
    candidates.set(candidate.node.id, candidate);
  }
}

function normalizeSimilarity(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(Math.max(0, Math.min(1, parsed)).toFixed(4));
}

function toContextPackInsert(pack: ContextPack) {
  return {
    id: pack.id,
    objective: pack.objective,
    agentId: pack.agent_id,
    sessionId: pack.session_id,
    nodeIds: pack.node_ids,
    evidence: pack.evidence,
    decisions: pack.decisions,
    blockers: pack.blockers,
    templateId: pack.template_id ?? null,
    tokenBudget: pack.token_budget,
    metadata: pack.metadata,
    createdAt: new Date(pack.created_at)
  };
}

function toContextPack(row: ContextPackRow): ContextPack {
  const pack: ContextPack = {
    id: row.id,
    objective: row.objective,
    agent_id: row.agentId,
    session_id: row.sessionId,
    node_ids: row.nodeIds,
    evidence: row.evidence,
    decisions: row.decisions,
    blockers: row.blockers,
    token_budget: row.tokenBudget,
    metadata: row.metadata,
    created_at: row.createdAt.toISOString()
  };

  if (row.templateId) {
    pack.template_id = row.templateId;
  }

  return pack;
}

function toHandoffPackInsert(pack: HandoffPack) {
  return {
    id: pack.id,
    fromRunId: pack.from_run_id,
    toSessionId: pack.to_session_id ?? null,
    objective: pack.objective,
    currentStatus: pack.current_status,
    keyDecisions: pack.key_decisions,
    referencedNodeIds: pack.referenced_node_ids,
    openLoops: pack.open_loops,
    blockers: pack.blockers,
    constraints: pack.constraints,
    recommendedNextActions: pack.recommended_next_actions,
    metadata: pack.metadata,
    createdAt: new Date(pack.created_at)
  };
}

function toHandoffPack(row: HandoffPackRow): HandoffPack {
  const pack: HandoffPack = {
    id: row.id,
    from_run_id: row.fromRunId,
    objective: row.objective,
    current_status: row.currentStatus,
    key_decisions: row.keyDecisions,
    referenced_node_ids: row.referencedNodeIds,
    open_loops: row.openLoops,
    blockers: row.blockers,
    constraints: row.constraints,
    recommended_next_actions: row.recommendedNextActions,
    metadata: row.metadata,
    created_at: row.createdAt.toISOString()
  };

  if (row.toSessionId) {
    pack.to_session_id = row.toSessionId;
  }

  return pack;
}

async function ensureTraceRun(db: NeuralMapDatabase, id: string): Promise<TraceRunRow> {
  const [existing] = await db.select().from(traceRuns).where(eq(traceRuns.id, id)).limit(1);
  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(traceRuns)
    .values({
      id,
      agentId: "unknown",
      sessionId: "unknown",
      objective: "Implicit run for handoff persistence",
      status: "handoff_ready"
    })
    .returning();

  if (!created) {
    throw new Error(`Failed to create trace run ${id}.`);
  }

  return created;
}
