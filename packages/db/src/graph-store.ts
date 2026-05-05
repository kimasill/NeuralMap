import type {
  ContextPack,
  GraphEdge,
  GraphNode,
  GraphQueryRequest,
  GraphScope,
  HandoffPack,
  LifecycleStatus,
  OntologyRef,
  Provenance,
  SourceSystem
} from "@neuralmap/schema";
import { attachScopeToMetadata, getScopeFromMetadata, scopeMatches } from "@neuralmap/schema";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { NeuralMapDatabase } from "./client.js";
import {
  createContentChunkEmbedding,
  createGraphNodeEmbedding,
  createQueryEmbedding,
  deterministicEmbeddingModel,
  toPgVectorLiteral
} from "./embedding.js";
import { createEmbeddingProviderConfig, embeddingMetadata } from "./embedding-provider.js";
import { contentChunks, contextPacks, graphDeltaCommits, graphEdges, graphNodes, handoffPacks, traceRuns } from "./schema.js";
import type {
  ContentChunkRow,
  ContextPackRow,
  GraphDeltaCommitRow,
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

export interface GraphDeltaCommitInput {
  idempotency_key: string;
  request_hash: string;
  response: Record<string, unknown>;
  profile_id?: string | undefined;
  scope?: GraphScope | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface GraphDeltaCommitRecord {
  idempotency_key: string;
  request_hash: string;
  response: Record<string, unknown>;
  profile_id?: string | undefined;
  scope?: GraphScope | undefined;
  metadata: Record<string, unknown>;
  created_at: string;
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

export interface EmbeddingHealth {
  provider: ReturnType<typeof createEmbeddingProviderConfig>;
  nodes: {
    total: number;
    embedded: number;
    coverage: number;
  };
  chunks: {
    total: number;
    embedded: number;
    coverage: number;
  };
  scope?: GraphScope | undefined;
}

export interface EmbeddingBackfillInput {
  scope?: GraphScope | undefined;
  dry_run?: boolean | undefined;
  limit?: number | undefined;
}

export interface EmbeddingBackfillResult {
  provider: ReturnType<typeof createEmbeddingProviderConfig>;
  dry_run: boolean;
  nodes_backfilled: number;
  chunks_backfilled: number;
  validated: boolean;
  scope?: GraphScope | undefined;
}

export interface RedactGraphInput {
  node_ids: string[];
  scope?: GraphScope | undefined;
  reason?: string | undefined;
}

export interface GraphStore {
  getMemory(): Promise<PersistedGraphMemory>;
  getNode(id: string): Promise<GraphNode | undefined>;
  searchVectorSeeds(request: GraphQueryRequest, limit?: number): Promise<VectorSeedCandidate[]>;
  upsertGraph(input: GraphPersistenceInput): Promise<{ nodes: number; edges: number; chunks: number }>;
  getGraphDeltaCommit(idempotencyKey: string): Promise<GraphDeltaCommitRecord | undefined>;
  saveGraphDeltaCommit(input: GraphDeltaCommitInput): Promise<GraphDeltaCommitRecord>;
  getEmbeddingHealth(scope?: GraphScope): Promise<EmbeddingHealth>;
  backfillEmbeddings(input?: EmbeddingBackfillInput): Promise<EmbeddingBackfillResult>;
  redactGraph(input: RedactGraphInput): Promise<{ nodes: number; edges: number; chunks: number }>;
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
      return (await searchVectorSeeds(db, request, limit)).filter((candidate) =>
        scopeMatches(candidate.node.scope ?? getScopeFromMetadata(candidate.node.metadata), request.scope)
      );
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

    async getGraphDeltaCommit(idempotencyKey) {
      const [row] = await db
        .select()
        .from(graphDeltaCommits)
        .where(eq(graphDeltaCommits.idempotencyKey, idempotencyKey))
        .limit(1);
      return row ? toGraphDeltaCommit(row) : undefined;
    },

    async saveGraphDeltaCommit(input) {
      const [row] = await db
        .insert(graphDeltaCommits)
        .values(toGraphDeltaCommitInsert(input))
        .onConflictDoUpdate({
          target: graphDeltaCommits.idempotencyKey,
          set: {
            requestHash: sql`excluded.request_hash`,
            profileId: sql`excluded.profile_id`,
            scope: sql`excluded.scope`,
            response: sql`excluded.response`,
            metadata: sql`excluded.metadata`
          }
        })
        .returning();

      if (!row) {
        throw new Error(`Failed to save graph delta commit ${input.idempotency_key}.`);
      }

      return toGraphDeltaCommit(row);
    },

    async getEmbeddingHealth(scope) {
      const [nodeRows, chunkRows] = await Promise.all([db.select().from(graphNodes), db.select().from(contentChunks)]);
      const scopedNodes = nodeRows.filter((row) => scopeMatches(getScopeFromMetadata(row.metadata), scope));
      const scopedChunks = chunkRows.filter((row) => scopeMatches(getScopeFromMetadata(row.metadata), scope));
      const embeddedNodes = scopedNodes.filter((row) => row.embedding !== null).length;
      const embeddedChunks = scopedChunks.filter((row) => row.embedding !== null).length;
      const health: EmbeddingHealth = {
        provider: createEmbeddingProviderConfig(),
        nodes: {
          total: scopedNodes.length,
          embedded: embeddedNodes,
          coverage: coverage(embeddedNodes, scopedNodes.length)
        },
        chunks: {
          total: scopedChunks.length,
          embedded: embeddedChunks,
          coverage: coverage(embeddedChunks, scopedChunks.length)
        }
      };

      if (scope) {
        health.scope = scope;
      }

      return health;
    },

    async backfillEmbeddings(input = {}) {
      const provider = createEmbeddingProviderConfig();
      const limit = input.limit ?? 250;
      const [nodeRows, chunkRows] = await Promise.all([db.select().from(graphNodes), db.select().from(contentChunks)]);
      const scopedNodes = nodeRows.filter((row) => scopeMatches(getScopeFromMetadata(row.metadata), input.scope)).slice(0, limit);
      const scopedChunks = chunkRows.filter((row) => scopeMatches(getScopeFromMetadata(row.metadata), input.scope)).slice(0, limit);

      if (!input.dry_run) {
        for (const row of scopedNodes) {
          const node = toGraphNode(row);
          await db
            .update(graphNodes)
            .set({
              embedding: createGraphNodeEmbedding(node),
              metadata: {
                ...row.metadata,
                ...embeddingMetadata(provider)
              },
              updatedAt: new Date()
            })
            .where(eq(graphNodes.id, row.id));
        }

        for (const row of scopedChunks) {
          await db
            .update(contentChunks)
            .set({
              embedding: createContentChunkEmbedding({
                id: row.id,
                node_id: row.nodeId,
                source_uri: row.sourceUri,
                ordinal: row.ordinal,
                content: row.content,
                content_hash: row.contentHash,
                metadata: row.metadata
              }),
              metadata: {
                ...row.metadata,
                ...embeddingMetadata(provider)
              }
            })
            .where(eq(contentChunks.id, row.id));
        }
      }

      const result: EmbeddingBackfillResult = {
        provider,
        dry_run: input.dry_run ?? false,
        nodes_backfilled: scopedNodes.length,
        chunks_backfilled: scopedChunks.length,
        validated: true
      };

      if (input.scope) {
        result.scope = input.scope;
      }

      return result;
    },

    async redactGraph(input) {
      const now = new Date();
      const nodeRows = input.node_ids.length
        ? await db.select().from(graphNodes).where(inArray(graphNodes.id, input.node_ids))
        : [];
      const scopedNodeRows = nodeRows.filter((row) => scopeMatches(getScopeFromMetadata(row.metadata), input.scope));
      const scopedNodeIds = scopedNodeRows.map((row) => row.id);

      for (const row of scopedNodeRows) {
        await db
          .update(graphNodes)
          .set({
            contentRef: null,
            summary: "[redacted]",
            trustScore: 0,
            importanceScore: 0,
            metadata: {
              ...row.metadata,
              redacted: true,
              lifecycle_status: "redacted",
              redaction_reason: input.reason ?? "user_requested",
              redacted_at: now.toISOString()
            },
            updatedAt: now
          })
          .where(eq(graphNodes.id, row.id));
      }

      const edgeRows = await db.select().from(graphEdges);
      const scopedEdgeRows = edgeRows.filter(
        (row) =>
          (scopedNodeIds.includes(row.fromNodeId) || scopedNodeIds.includes(row.toNodeId)) &&
          scopeMatches(getScopeFromMetadata(row.metadata), input.scope)
      );
      for (const row of scopedEdgeRows) {
        await db
          .update(graphEdges)
          .set({
            confidence: 0,
            metadata: {
              ...row.metadata,
              redacted: true,
              lifecycle_status: "redacted",
              redacted_at: now.toISOString()
            }
          })
          .where(eq(graphEdges.id, row.id));
      }

      const chunkRows = scopedNodeIds.length
        ? await db.select().from(contentChunks).where(inArray(contentChunks.nodeId, scopedNodeIds))
        : [];
      for (const row of chunkRows.filter((candidate) => scopeMatches(getScopeFromMetadata(candidate.metadata), input.scope))) {
        await db
          .update(contentChunks)
          .set({
            content: "[redacted]",
            metadata: {
              ...row.metadata,
              redacted: true,
              lifecycle_status: "redacted",
              redacted_at: now.toISOString()
            }
          })
          .where(eq(contentChunks.id, row.id));
      }

      return {
        nodes: scopedNodeRows.length,
        edges: scopedEdgeRows.length,
        chunks: chunkRows.length
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

  hydrateNodeExtensions(node);
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
  const scope = getScopeFromMetadata(row.metadata);
  if (scope) {
    node.scope = scope;
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

  hydrateEdgeExtensions(edge);
  if (row.sourceRunId) {
    edge.source_run_id = row.sourceRunId;
  }
  const scope = getScopeFromMetadata(row.metadata);
  if (scope) {
    edge.scope = scope;
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
    metadata: {
      ...attachScopeToMetadata(withNodeExtensionMetadata(node), node.scope),
      ...embeddingMetadata()
    },
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
    metadata: attachScopeToMetadata(withEdgeExtensionMetadata(edge), edge.scope),
    createdAt: new Date(edge.created_at)
  };
}

function hydrateNodeExtensions(node: GraphNode): void {
  const labels = readStringArray(node.metadata.labels);
  const ontology = readOntology(node.metadata.ontology);
  const properties = readRecord(node.metadata.properties);
  const provenance = readProvenance(node.metadata.provenance);
  const lifecycleStatus = readLifecycleStatus(node.metadata.lifecycle_status);
  const validFrom = readString(node.metadata.valid_from);
  const validTo = readStringOrNull(node.metadata.valid_to);
  const confidence = readNumber(node.metadata.confidence);

  if (labels.length > 0) {
    node.labels = labels;
  }
  if (ontology) {
    node.ontology = ontology;
  }
  if (Object.keys(properties).length > 0) {
    node.properties = properties;
  }
  if (provenance.length > 0) {
    node.provenance = provenance;
  }
  if (lifecycleStatus) {
    node.lifecycle_status = lifecycleStatus;
  }
  if (validFrom) {
    node.valid_from = validFrom;
  }
  if (validTo !== undefined) {
    node.valid_to = validTo;
  }
  if (confidence !== undefined) {
    node.confidence = confidence;
  }
}

function hydrateEdgeExtensions(edge: GraphEdge): void {
  const labels = readStringArray(edge.metadata.labels);
  const ontology = readOntology(edge.metadata.ontology);
  const properties = readRecord(edge.metadata.properties);
  const provenance = readProvenance(edge.metadata.provenance);
  const lifecycleStatus = readLifecycleStatus(edge.metadata.lifecycle_status);
  const validFrom = readString(edge.metadata.valid_from);
  const validTo = readStringOrNull(edge.metadata.valid_to);

  if (labels.length > 0) {
    edge.labels = labels;
  }
  if (ontology) {
    edge.ontology = ontology;
  }
  if (Object.keys(properties).length > 0) {
    edge.properties = properties;
  }
  if (provenance.length > 0) {
    edge.provenance = provenance;
  }
  if (lifecycleStatus) {
    edge.lifecycle_status = lifecycleStatus;
  }
  if (validFrom) {
    edge.valid_from = validFrom;
  }
  if (validTo !== undefined) {
    edge.valid_to = validTo;
  }
}

function withNodeExtensionMetadata(node: GraphNode): Record<string, unknown> {
  return withExtensionMetadata(node.metadata, {
    labels: node.labels,
    ontology: node.ontology,
    properties: node.properties,
    lifecycle_status: node.lifecycle_status,
    valid_from: node.valid_from,
    valid_to: node.valid_to,
    provenance: node.provenance,
    confidence: node.confidence
  });
}

function withEdgeExtensionMetadata(edge: GraphEdge): Record<string, unknown> {
  return withExtensionMetadata(edge.metadata ?? {}, {
    labels: edge.labels,
    ontology: edge.ontology,
    properties: edge.properties,
    lifecycle_status: edge.lifecycle_status,
    valid_from: edge.valid_from,
    valid_to: edge.valid_to,
    provenance: edge.provenance
  });
}

function withExtensionMetadata(
  metadata: Record<string, unknown>,
  extensions: {
    labels?: string[] | undefined;
    ontology?: OntologyRef | undefined;
    properties?: Record<string, unknown> | undefined;
    lifecycle_status?: LifecycleStatus | undefined;
    valid_from?: string | undefined;
    valid_to?: string | null | undefined;
    provenance?: Provenance[] | undefined;
    confidence?: number | undefined;
  }
): Record<string, unknown> {
  return {
    ...metadata,
    ...(extensions.labels?.length ? { labels: extensions.labels } : {}),
    ...(extensions.ontology ? { ontology: extensions.ontology } : {}),
    ...(extensions.properties ? { properties: extensions.properties } : {}),
    ...(extensions.lifecycle_status ? { lifecycle_status: extensions.lifecycle_status } : {}),
    ...(extensions.valid_from ? { valid_from: extensions.valid_from } : {}),
    ...(extensions.valid_to !== undefined ? { valid_to: extensions.valid_to } : {}),
    ...(extensions.provenance?.length ? { provenance: extensions.provenance } : {}),
    ...(extensions.confidence !== undefined ? { confidence: extensions.confidence } : {})
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return readString(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readLifecycleStatus(value: unknown): LifecycleStatus | undefined {
  switch (value) {
    case "active":
    case "archived":
    case "redacted":
    case "deprecated":
      return value;
    default:
      return undefined;
  }
}

function readOntology(value: unknown): OntologyRef | undefined {
  const record = readRecord(value);
  if (typeof record.profile_id !== "string" || typeof record.type !== "string") {
    return undefined;
  }
  const ontology: OntologyRef = {
    profile_id: record.profile_id,
    type: record.type
  };
  if (typeof record.version === "string") {
    ontology.version = record.version;
  }
  return ontology;
}

function readProvenance(value: unknown): Provenance[] {
  return Array.isArray(value)
    ? value.filter((item): item is Provenance => {
        const record = readRecord(item);
        return typeof record.system === "string";
      })
    : [];
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
    metadata: {
      ...attachScopeToMetadata(chunk.metadata, getScopeFromMetadata(chunk.metadata)),
      ...embeddingMetadata()
    }
  };
}

function toGraphDeltaCommit(row: GraphDeltaCommitRow): GraphDeltaCommitRecord {
  const record: GraphDeltaCommitRecord = {
    idempotency_key: row.idempotencyKey,
    request_hash: row.requestHash,
    response: row.response,
    metadata: row.metadata,
    created_at: row.createdAt.toISOString()
  };

  if (row.profileId) {
    record.profile_id = row.profileId;
  }
  const scope = normalizeStoredScope(row.scope);
  if (scope) {
    record.scope = scope;
  }

  return record;
}

function toGraphDeltaCommitInsert(input: GraphDeltaCommitInput) {
  return {
    idempotencyKey: input.idempotency_key,
    requestHash: input.request_hash,
    profileId: input.profile_id ?? null,
    scope: input.scope ?? {},
    response: input.response,
    metadata: input.metadata ?? {}
  };
}

function normalizeStoredScope(value: Record<string, unknown>): GraphScope | undefined {
  const scope: GraphScope = {};
  for (const key of ["tenant_id", "workspace_id", "project_id", "owner_scope"] as const) {
    const stored = value[key];
    if (typeof stored === "string" && stored.length > 0) {
      scope[key] = stored;
    }
  }
  return Object.keys(scope).length > 0 ? scope : undefined;
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
    metadata: attachScopeToMetadata(pack.metadata, pack.scope),
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
  const scope = getScopeFromMetadata(row.metadata);
  if (scope) {
    pack.scope = scope;
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
    metadata: attachScopeToMetadata(pack.metadata, pack.scope),
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
  const scope = getScopeFromMetadata(row.metadata);
  if (scope) {
    pack.scope = scope;
  }

  return pack;
}

function coverage(embedded: number, total: number): number {
  return total === 0 ? 1 : Number((embedded / total).toFixed(4));
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
