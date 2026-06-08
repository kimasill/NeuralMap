import { sampleMemory } from "@neuralmap/core";
import {
  createDbClient,
  createEmbeddingProviderConfig,
  createGraphStore,
  embeddingMetadata,
  type EmbeddingBackfillInput,
  type EmbeddingBackfillResult,
  type EmbeddingHealth,
  type GraphDeltaCommitInput,
  type GraphDeltaCommitRecord,
  type GraphStore,
  type RedactGraphInput,
  type VectorSeedCandidate
} from "@neuralmap/db";
import {
  ingestContextPackArtifact,
  ingestHandoffPackArtifact,
  linkCrossSourceReferences,
  type IngestEmission
} from "@neuralmap/ingest";
import type { ContextPack, GraphEdge, GraphNode, GraphQueryRequest, GraphScope, HandoffPack } from "@neuralmap/schema";
import { attachScopeToMetadata, getScopeFromMetadata, scopeMatches } from "@neuralmap/schema";

export type DataMode = "database" | "sample";

export interface GraphDataSource {
  mode: DataMode;
  getMemory(scope?: GraphScope): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; generated_at: string; mode: DataMode }>;
  getOverviewMemory(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; generated_at: string; mode: DataMode }>;
  getNode(id: string, scope?: GraphScope): Promise<GraphNode | undefined>;
  searchVectorSeeds(request: GraphQueryRequest, limit?: number): Promise<VectorSeedCandidate[]>;
  persistIngest(
    emission: IngestEmission,
    scope?: GraphScope
  ): Promise<{ nodes: number; edges: number; chunks: number; mode: DataMode }>;
  getGraphDeltaCommit(idempotencyKey: string, scope?: GraphScope): Promise<GraphDeltaCommitRecord | undefined>;
  saveGraphDeltaCommit(
    input: GraphDeltaCommitInput,
    scope?: GraphScope
  ): Promise<GraphDeltaCommitRecord & { mode: DataMode }>;
  saveContextPack(pack: ContextPack, scope?: GraphScope): Promise<ContextPack>;
  getContextPack(id: string, scope?: GraphScope): Promise<ContextPack | undefined>;
  listContextPacks(limit?: number, scope?: GraphScope): Promise<ContextPack[]>;
  listOverviewContextPacks(limit?: number): Promise<ContextPack[]>;
  saveHandoffPack(pack: HandoffPack, scope?: GraphScope): Promise<HandoffPack>;
  getHandoffPack(id: string, scope?: GraphScope): Promise<HandoffPack | undefined>;
  listHandoffPacks(limit?: number, scope?: GraphScope): Promise<HandoffPack[]>;
  listOverviewHandoffPacks(limit?: number): Promise<HandoffPack[]>;
  getEmbeddingHealth(scope?: GraphScope): Promise<EmbeddingHealth>;
  backfillEmbeddings(input?: EmbeddingBackfillInput): Promise<EmbeddingBackfillResult>;
  redactGraph(input: RedactGraphInput): Promise<{ nodes: number; edges: number; chunks: number; mode: DataMode }>;
}

export function createGraphDataSource(): GraphDataSource {
  const defaultDataSource = createSingleGraphDataSource(process.env.DATABASE_URL, "DATABASE_URL is not configured.");
  const databaseRoutes = parseDatabaseRoutes(process.env.NEURALMAP_DATABASE_ROUTES);
  if (databaseRoutes.size === 0) {
    return defaultDataSource;
  }

  return createRoutedDataSource(defaultDataSource, databaseRoutes);
}

function createSingleGraphDataSource(connectionString: string | undefined, missingReason: string): GraphDataSource {
  if (!connectionString) {
    return createSampleDataSource(missingReason);
  }

  try {
    const { db } = createDbClient(connectionString);
    return createDatabaseDataSource(createGraphStore(db));
  } catch {
    return createSampleDataSource("Database client could not be created.");
  }
}

function createRoutedDataSource(
  fallback: GraphDataSource,
  routes: ReadonlyMap<string, string>
): GraphDataSource {
  const dataSourcesByUrl = new Map<string, GraphDataSource>();
  const sourceForScope = (scope: GraphScope | undefined): GraphDataSource => {
    const url = resolveDatabaseRoute(routes, scope);
    if (!url) {
      return fallback;
    }

    const cached = dataSourcesByUrl.get(url);
    if (cached) {
      return cached;
    }

    const next = createSingleGraphDataSource(url, "Routed DATABASE_URL is not configured.");
    dataSourcesByUrl.set(url, next);
    return next;
  };

  return {
    mode: fallback.mode === "database" || routes.size > 0 ? "database" : fallback.mode,

    getMemory(scope) {
      return sourceForScope(scope).getMemory(scope);
    },

    async getOverviewMemory() {
      const memories = await Promise.all(uniqueRoutedSources(fallback, routes, dataSourcesByUrl).map((source) => source.getOverviewMemory()));
      return {
        ...mergeMemories(memories),
        generated_at: new Date().toISOString(),
        mode: "database"
      };
    },

    getNode(id, scope) {
      return sourceForScope(scope).getNode(id, scope);
    },

    searchVectorSeeds(request, limit) {
      return sourceForScope(request.scope).searchVectorSeeds(request, limit);
    },

    persistIngest(emission, scope) {
      return sourceForScope(scope).persistIngest(emission, scope);
    },

    getGraphDeltaCommit(idempotencyKey, scope) {
      return sourceForScope(scope).getGraphDeltaCommit(idempotencyKey, scope);
    },

    saveGraphDeltaCommit(input, scope) {
      return sourceForScope(input.scope ?? scope).saveGraphDeltaCommit(input, scope);
    },

    saveContextPack(pack, scope) {
      return sourceForScope(pack.scope ?? scope).saveContextPack(pack, scope);
    },

    getContextPack(id, scope) {
      return sourceForScope(scope).getContextPack(id, scope);
    },

    listContextPacks(limit, scope) {
      return sourceForScope(scope).listContextPacks(limit, scope);
    },

    async listOverviewContextPacks(limit) {
      const packs = await Promise.all(
        uniqueRoutedSources(fallback, routes, dataSourcesByUrl).map((source) => source.listOverviewContextPacks(limit))
      );
      return sortByCreatedAtDesc(uniqueById(packs.flat())).slice(0, limit ?? 10);
    },

    saveHandoffPack(pack, scope) {
      return sourceForScope(pack.scope ?? scope).saveHandoffPack(pack, scope);
    },

    getHandoffPack(id, scope) {
      return sourceForScope(scope).getHandoffPack(id, scope);
    },

    listHandoffPacks(limit, scope) {
      return sourceForScope(scope).listHandoffPacks(limit, scope);
    },

    async listOverviewHandoffPacks(limit) {
      const packs = await Promise.all(
        uniqueRoutedSources(fallback, routes, dataSourcesByUrl).map((source) => source.listOverviewHandoffPacks(limit))
      );
      return sortByCreatedAtDesc(uniqueById(packs.flat())).slice(0, limit ?? 10);
    },

    getEmbeddingHealth(scope) {
      return sourceForScope(scope).getEmbeddingHealth(scope);
    },

    backfillEmbeddings(input = {}) {
      return sourceForScope(input.scope).backfillEmbeddings(input);
    },

    redactGraph(input) {
      return sourceForScope(input.scope).redactGraph(input);
    }
  };
}

function parseDatabaseRoutes(raw: string | undefined): Map<string, string> {
  const routes = new Map<string, string>();
  if (!raw?.trim()) {
    return routes;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return routes;
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim().length > 0) {
        routes.set(key.trim(), value.trim());
      }
    }
  } catch {
    return routes;
  }

  return routes;
}

function resolveDatabaseRoute(routes: ReadonlyMap<string, string>, scope: GraphScope | undefined): string | undefined {
  const keys = databaseRouteKeys(scope);
  for (const key of keys) {
    const url = routes.get(key);
    if (url) {
      return url;
    }
  }

  return routes.get("default");
}

function databaseRouteKeys(scope: GraphScope | undefined): string[] {
  if (!scope) {
    return [];
  }

  return [
    scope.project_id ? `project:${scope.project_id}` : undefined,
    scope.workspace_id ? `workspace:${scope.workspace_id}` : undefined,
    scope.tenant_id ? `tenant:${scope.tenant_id}` : undefined,
    scope.owner_scope ? `owner:${scope.owner_scope}` : undefined
  ].filter((key): key is string => Boolean(key));
}

function uniqueRoutedSources(
  fallback: GraphDataSource,
  routes: ReadonlyMap<string, string>,
  cachedSources: Map<string, GraphDataSource>
): GraphDataSource[] {
  const sources = new Map<string, GraphDataSource>([["fallback", fallback]]);
  for (const url of new Set(routes.values())) {
    const cached = cachedSources.get(url);
    if (cached) {
      sources.set(url, cached);
      continue;
    }

    const source = createSingleGraphDataSource(url, "Routed DATABASE_URL is not configured.");
    cachedSources.set(url, source);
    sources.set(url, source);
  }
  return [...sources.values()];
}

function createDatabaseDataSource(store: GraphStore): GraphDataSource {
  const sample = createSampleDataSource("Database unavailable.");

  return {
    mode: "database",

    async getMemory(scope) {
      try {
        const memory = await store.getMemory();
        return {
          ...filterMemory(memory, scope),
          generated_at: new Date().toISOString(),
          mode: "database"
        };
      } catch {
        return sample.getMemory(scope);
      }
    },

    async getOverviewMemory() {
      try {
        const memory = await store.getMemory();
        return {
          ...filterOverviewMemory(memory),
          generated_at: new Date().toISOString(),
          mode: "database"
        };
      } catch {
        return sample.getOverviewMemory();
      }
    },

    async getNode(id, scope) {
      try {
        const node = (await store.getNode(id)) ?? (await sample.getNode(id, scope));
        return node && isVisibleNode(node, scope) ? node : undefined;
      } catch {
        return sample.getNode(id, scope);
      }
    },

    async searchVectorSeeds(request, limit) {
      try {
        return await store.searchVectorSeeds(request, limit);
      } catch {
        return [];
      }
    },

    async persistIngest(emission, scope) {
      try {
        const scopedEmission = applyScopeToEmission(emission, scope);
        const result = await store.upsertGraph({
          nodes: scopedEmission.nodes,
          edges: scopedEmission.edges,
          chunks: scopedEmission.chunks
        });
        return {
          ...result,
          mode: "database"
        };
      } catch {
        return sample.persistIngest(emission, scope);
      }
    },

    async getGraphDeltaCommit(idempotencyKey, scope) {
      try {
        const commit = await store.getGraphDeltaCommit(idempotencyKey);
        if (!commit || !scopeMatches(commit.scope, scope)) {
          return undefined;
        }
        return commit;
      } catch {
        return sample.getGraphDeltaCommit(idempotencyKey, scope);
      }
    },

    async saveGraphDeltaCommit(input, scope) {
      try {
        const saved = await store.saveGraphDeltaCommit({
          ...input,
          scope: input.scope ?? scope
        });
        return {
          ...saved,
          mode: "database"
        };
      } catch {
        return sample.saveGraphDeltaCommit(input, scope);
      }
    },

    async saveContextPack(pack, scope) {
      try {
        const scopedPack = applyScopeToContextPack(pack, scope);
        const saved = await store.saveContextPack(scopedPack);
        await persistLinkedArtifact(
          () => store.getMemory(),
          (emission) =>
            store.upsertGraph({
              nodes: emission.nodes,
              edges: emission.edges,
              chunks: emission.chunks
            }),
          ingestContextPackArtifact(saved)
        );
        return saved;
      } catch {
        return sample.saveContextPack(pack, scope);
      }
    },

    async getContextPack(id, scope) {
      try {
        const pack = await store.getContextPack(id);
        if (!pack || !scopeMatches(pack.scope ?? getScopeFromMetadata(pack.metadata), scope)) {
          return undefined;
        }

        return sanitizeContextPack(pack, await visibleNodeIdsFromStore(store, scope));
      } catch {
        return sample.getContextPack(id, scope);
      }
    },

    async listContextPacks(limit, scope) {
      try {
        const packs = await store.listContextPacks(limit);
        const visibleIds = await visibleNodeIdsFromStore(store, scope);
        return packs
          .filter((pack) => scopeMatches(pack.scope ?? getScopeFromMetadata(pack.metadata), scope))
          .map((pack) => sanitizeContextPack(pack, visibleIds));
      } catch {
        return sample.listContextPacks(limit, scope);
      }
    },

    async listOverviewContextPacks(limit = 10) {
      try {
        const packs = await store.listContextPacks(limit);
        const visibleIds = await overviewNodeIdsFromStore(store);
        return packs.map((pack) => sanitizeContextPack(pack, visibleIds));
      } catch {
        return sample.listOverviewContextPacks(limit);
      }
    },

    async saveHandoffPack(pack, scope) {
      try {
        const scopedPack = applyScopeToHandoffPack(pack, scope);
        const saved = await store.saveHandoffPack(scopedPack);
        await persistLinkedArtifact(
          () => store.getMemory(),
          (emission) =>
            store.upsertGraph({
              nodes: emission.nodes,
              edges: emission.edges,
              chunks: emission.chunks
            }),
          ingestHandoffPackArtifact(saved)
        );
        return saved;
      } catch {
        return sample.saveHandoffPack(pack, scope);
      }
    },

    async getHandoffPack(id, scope) {
      try {
        const pack = await store.getHandoffPack(id);
        if (!pack || !scopeMatches(pack.scope ?? getScopeFromMetadata(pack.metadata), scope)) {
          return undefined;
        }

        return sanitizeHandoffPack(pack, await visibleNodeIdsFromStore(store, scope));
      } catch {
        return sample.getHandoffPack(id, scope);
      }
    },

    async listHandoffPacks(limit, scope) {
      try {
        const packs = await store.listHandoffPacks(limit);
        const visibleIds = await visibleNodeIdsFromStore(store, scope);
        return packs
          .filter((pack) => scopeMatches(pack.scope ?? getScopeFromMetadata(pack.metadata), scope))
          .map((pack) => sanitizeHandoffPack(pack, visibleIds));
      } catch {
        return sample.listHandoffPacks(limit, scope);
      }
    },

    async listOverviewHandoffPacks(limit = 10) {
      try {
        const packs = await store.listHandoffPacks(limit);
        const visibleIds = await overviewNodeIdsFromStore(store);
        return packs.map((pack) => sanitizeHandoffPack(pack, visibleIds));
      } catch {
        return sample.listOverviewHandoffPacks(limit);
      }
    },

    async getEmbeddingHealth(scope) {
      try {
        return await store.getEmbeddingHealth(scope);
      } catch {
        return sample.getEmbeddingHealth(scope);
      }
    },

    async backfillEmbeddings(input = {}) {
      try {
        return await store.backfillEmbeddings(input);
      } catch {
        return sample.backfillEmbeddings(input);
      }
    },

    async redactGraph(input) {
      try {
        const result = await store.redactGraph(input);
        return {
          ...result,
          mode: "database"
        };
      } catch {
        return sample.redactGraph(input);
      }
    }
  };
}

function createSampleDataSource(reason: string): GraphDataSource {
  const nodes = [...sampleMemory.nodes];
  const edges = [...sampleMemory.edges];
  const contextPacks = new Map<string, ContextPack>();
  const handoffPacks = new Map<string, HandoffPack>();
  const graphDeltaCommits = new Map<string, GraphDeltaCommitRecord>();
  const redactedNodeIds = new Set<string>();

  return {
    mode: "sample",

    async getMemory(scope) {
      return {
        ...filterMemory({ nodes, edges }, scope, redactedNodeIds),
        generated_at: new Date().toISOString(),
        mode: "sample"
      };
    },

    async getOverviewMemory() {
      return {
        ...filterOverviewMemory({ nodes, edges }, redactedNodeIds),
        generated_at: new Date().toISOString(),
        mode: "sample"
      };
    },

    async getNode(id, scope) {
      const node = nodes.find((candidate) => candidate.id === id);
      return node && isVisibleNode(node, scope, redactedNodeIds) ? node : undefined;
    },

    async searchVectorSeeds() {
      return [];
    },

    async persistIngest(emission, scope) {
      const scopedEmission = applyScopeToEmission(emission, scope);
      for (const node of scopedEmission.nodes) {
        upsertById(nodes, node);
      }
      for (const edge of scopedEmission.edges) {
        upsertById(edges, edge);
      }

      return {
        nodes: scopedEmission.nodes.length,
        edges: scopedEmission.edges.length,
        chunks: scopedEmission.chunks.length,
        mode: "sample"
      };
    },

    async getGraphDeltaCommit(idempotencyKey, scope) {
      const commit = graphDeltaCommits.get(idempotencyKey);
      if (!commit || !scopeMatches(commit.scope, scope)) {
        return undefined;
      }
      return commit;
    },

    async saveGraphDeltaCommit(input, scope) {
      const now = new Date().toISOString();
      const record: GraphDeltaCommitRecord = {
        idempotency_key: input.idempotency_key,
        request_hash: input.request_hash,
        response: input.response,
        metadata: input.metadata ?? {},
        created_at: now
      };
      const nextScope = input.scope ?? scope;
      if (input.profile_id) {
        record.profile_id = input.profile_id;
      }
      if (nextScope) {
        record.scope = nextScope;
      }
      graphDeltaCommits.set(record.idempotency_key, record);
      return {
        ...record,
        mode: "sample"
      };
    },

    async saveContextPack(pack, scope) {
      const scopedPack = applyScopeToContextPack(pack, scope);
      contextPacks.set(scopedPack.id, scopedPack);
      await persistLinkedArtifact(
        async () => ({ nodes, edges }),
        async (emission) => {
          persistSampleEmission({ nodes, edges }, applyScopeToEmission(emission, scopedPack.scope));
        },
        ingestContextPackArtifact(scopedPack)
      );
      return scopedPack;
    },

    async getContextPack(id, scope) {
      const pack = contextPacks.get(id);
      if (!pack || !scopeMatches(pack.scope ?? getScopeFromMetadata(pack.metadata), scope)) {
        return undefined;
      }

      return sanitizeContextPack(pack, new Set(nodes.filter((node) => isVisibleNode(node, scope, redactedNodeIds)).map((node) => node.id)));
    },

    async listContextPacks(limit = 10, scope) {
      const visibleIds = new Set(nodes.filter((node) => isVisibleNode(node, scope, redactedNodeIds)).map((node) => node.id));
      return sortByCreatedAtDesc([...contextPacks.values()])
        .filter((pack) => scopeMatches(pack.scope ?? getScopeFromMetadata(pack.metadata), scope))
        .map((pack) => sanitizeContextPack(pack, visibleIds))
        .slice(0, limit);
    },

    async listOverviewContextPacks(limit = 10) {
      const visibleIds = new Set(filterOverviewMemory({ nodes, edges }, redactedNodeIds).nodes.map((node) => node.id));
      return sortByCreatedAtDesc([...contextPacks.values()])
        .map((pack) => sanitizeContextPack(pack, visibleIds))
        .slice(0, limit);
    },

    async saveHandoffPack(pack, scope) {
      const scopedPack = applyScopeToHandoffPack(pack, scope);
      handoffPacks.set(scopedPack.id, scopedPack);
      await persistLinkedArtifact(
        async () => ({ nodes, edges }),
        async (emission) => {
          persistSampleEmission({ nodes, edges }, applyScopeToEmission(emission, scopedPack.scope));
        },
        ingestHandoffPackArtifact(scopedPack)
      );
      return scopedPack;
    },

    async getHandoffPack(id, scope) {
      const pack = handoffPacks.get(id);
      if (!pack || !scopeMatches(pack.scope ?? getScopeFromMetadata(pack.metadata), scope)) {
        return undefined;
      }

      return sanitizeHandoffPack(pack, new Set(nodes.filter((node) => isVisibleNode(node, scope, redactedNodeIds)).map((node) => node.id)));
    },

    async listHandoffPacks(limit = 10, scope) {
      const visibleIds = new Set(nodes.filter((node) => isVisibleNode(node, scope, redactedNodeIds)).map((node) => node.id));
      return sortByCreatedAtDesc([...handoffPacks.values()])
        .filter((pack) => scopeMatches(pack.scope ?? getScopeFromMetadata(pack.metadata), scope))
        .map((pack) => sanitizeHandoffPack(pack, visibleIds))
        .slice(0, limit);
    },

    async listOverviewHandoffPacks(limit = 10) {
      const visibleIds = new Set(filterOverviewMemory({ nodes, edges }, redactedNodeIds).nodes.map((node) => node.id));
      return sortByCreatedAtDesc([...handoffPacks.values()])
        .map((pack) => sanitizeHandoffPack(pack, visibleIds))
        .slice(0, limit);
    },

    async getEmbeddingHealth(scope) {
      const visibleNodes = nodes.filter((node) => isVisibleNode(node, scope, redactedNodeIds));
      const embedded = visibleNodes.filter((node) => Boolean(node.embedding_ref) || node.metadata.embedding_version).length;
      const health: EmbeddingHealth = {
        provider: createEmbeddingProviderConfig(),
        nodes: {
          total: visibleNodes.length,
          embedded,
          coverage: visibleNodes.length === 0 ? 1 : Number((embedded / visibleNodes.length).toFixed(4))
        },
        chunks: {
          total: 0,
          embedded: 0,
          coverage: 1
        }
      };

      if (scope) {
        health.scope = scope;
      }

      return health;
    },

    async backfillEmbeddings(input = {}) {
      const provider = createEmbeddingProviderConfig();
      const scopedNodes = nodes
        .filter((node) => isVisibleNode(node, input.scope, redactedNodeIds))
        .slice(0, input.limit ?? 250);
      if (!input.dry_run) {
        for (const node of scopedNodes) {
          node.embedding_ref = `${provider.provider}:${provider.model}:${node.id}`;
          node.metadata = {
            ...node.metadata,
            ...embeddingMetadata(provider)
          };
        }
      }

      const result: EmbeddingBackfillResult = {
        provider,
        dry_run: input.dry_run ?? false,
        nodes_backfilled: scopedNodes.length,
        chunks_backfilled: 0,
        validated: true
      };

      if (input.scope) {
        result.scope = input.scope;
      }

      return result;
    },

    async redactGraph(input) {
      const now = new Date().toISOString();
      const scopedNodeIds = input.node_ids.filter((nodeId) => {
        const node = nodes.find((candidate) => candidate.id === nodeId);
        return node ? isVisibleNode(node, input.scope, redactedNodeIds) : false;
      });

      for (const nodeId of scopedNodeIds) {
        redactedNodeIds.add(nodeId);
        const node = nodes.find((candidate) => candidate.id === nodeId);
        if (node) {
          node.summary = "[redacted]";
          delete node.content_ref;
          node.trust_score = 0;
          node.importance_score = 0;
          node.metadata = {
            ...node.metadata,
            redacted: true,
            lifecycle_status: "redacted",
            redaction_reason: input.reason ?? "user_requested",
            redacted_at: now
          };
        }
      }

      let redactedEdges = 0;
      for (const edge of edges) {
        if (scopedNodeIds.includes(edge.from) || scopedNodeIds.includes(edge.to)) {
          edge.confidence = 0;
          edge.metadata = {
            ...edge.metadata,
            redacted: true,
            lifecycle_status: "redacted",
            redacted_at: now
          };
          redactedEdges += 1;
        }
      }

      return {
        nodes: scopedNodeIds.length,
        edges: redactedEdges,
        chunks: 0,
        mode: "sample"
      };
    }
  };
}

async function persistLinkedArtifact(
  getMemory: () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>,
  persist: (emission: IngestEmission) => Promise<unknown>,
  emission: IngestEmission
): Promise<void> {
  const memory = await getMemory();
  const linkedEmission = linkCrossSourceReferences(emission, memory);
  await persist(linkedEmission);
}

function persistSampleEmission(memory: { nodes: GraphNode[]; edges: GraphEdge[] }, emission: IngestEmission): void {
  for (const node of emission.nodes) {
    upsertById(memory.nodes, node);
  }
  for (const edge of emission.edges) {
    upsertById(memory.edges, edge);
  }
}

function upsertById<T extends { id: string }>(items: T[], item: T): void {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
    return;
  }

  items.push(item);
}

function mergeMemories(memories: Array<{ nodes: GraphNode[]; edges: GraphEdge[] }>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: uniqueById(memories.flatMap((memory) => memory.nodes)),
    edges: uniqueById(memories.flatMap((memory) => memory.edges))
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function filterOverviewMemory(
  memory: { nodes: GraphNode[]; edges: GraphEdge[] },
  redactedNodeIds: ReadonlySet<string> = new Set()
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = memory.nodes.filter((node) => !redactedNodeIds.has(node.id) && !isRedactedNode(node));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: memory.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && !isRedactedEdge(edge))
  };
}

function filterMemory(
  memory: { nodes: GraphNode[]; edges: GraphEdge[] },
  scope: GraphScope | undefined,
  redactedNodeIds: ReadonlySet<string> = new Set()
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = memory.nodes.filter((node) => isVisibleNode(node, scope, redactedNodeIds));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: memory.edges.filter(
      (edge) =>
        nodeIds.has(edge.from) &&
        nodeIds.has(edge.to) &&
        scopeMatches(edge.scope ?? getScopeFromMetadata(edge.metadata), scope) &&
        !isRedactedEdge(edge)
    )
  };
}

function isVisibleNode(
  node: GraphNode,
  scope: GraphScope | undefined,
  redactedNodeIds: ReadonlySet<string> = new Set()
): boolean {
  return (
    !redactedNodeIds.has(node.id) &&
    !isRedactedNode(node) &&
    scopeMatches(node.scope ?? getScopeFromMetadata(node.metadata), scope)
  );
}

function isRedactedNode(node: GraphNode): boolean {
  return node.metadata.redacted === true || node.metadata.deleted === true || node.metadata.lifecycle_status === "redacted";
}

function isRedactedEdge(edge: GraphEdge): boolean {
  return edge.metadata.redacted === true || edge.metadata.deleted === true || edge.metadata.lifecycle_status === "redacted";
}

function applyScopeToEmission(emission: IngestEmission, scope: GraphScope | undefined): IngestEmission {
  if (!scope) {
    return emission;
  }

  return {
    nodes: emission.nodes.map((node) => ({
      ...node,
      scope: node.scope ?? scope,
      metadata: attachScopeToMetadata(node.metadata, node.scope ?? scope)
    })),
    edges: emission.edges.map((edge) => ({
      ...edge,
      scope: edge.scope ?? scope,
      metadata: attachScopeToMetadata(edge.metadata ?? {}, edge.scope ?? scope)
    })),
    chunks: emission.chunks.map((chunk) => ({
      ...chunk,
      metadata: attachScopeToMetadata(chunk.metadata, getScopeFromMetadata(chunk.metadata) ?? scope)
    }))
  };
}

function applyScopeToContextPack(pack: ContextPack, scope: GraphScope | undefined): ContextPack {
  const nextScope = pack.scope ?? scope;
  if (!nextScope) {
    return pack;
  }

  return {
    ...pack,
    scope: nextScope,
    metadata: attachScopeToMetadata(pack.metadata, nextScope)
  };
}

function applyScopeToHandoffPack(pack: HandoffPack, scope: GraphScope | undefined): HandoffPack {
  const nextScope = pack.scope ?? scope;
  if (!nextScope) {
    return pack;
  }

  return {
    ...pack,
    scope: nextScope,
    metadata: attachScopeToMetadata(pack.metadata, nextScope)
  };
}

function sanitizeContextPack(pack: ContextPack, visibleIds: ReadonlySet<string>): ContextPack {
  return {
    ...pack,
    node_ids: pack.node_ids.filter((nodeId) => visibleIds.has(nodeId)),
    evidence: pack.evidence.filter((item) => visibleIds.has(item.node_id))
  };
}

function sanitizeHandoffPack(pack: HandoffPack, visibleIds: ReadonlySet<string>): HandoffPack {
  return {
    ...pack,
    referenced_node_ids: pack.referenced_node_ids.filter((nodeId) => visibleIds.has(nodeId))
  };
}

async function visibleNodeIdsFromStore(store: GraphStore, scope: GraphScope | undefined): Promise<ReadonlySet<string>> {
  const memory = filterMemory(await store.getMemory(), scope);
  return new Set(memory.nodes.map((node) => node.id));
}

async function overviewNodeIdsFromStore(store: GraphStore): Promise<ReadonlySet<string>> {
  const memory = filterOverviewMemory(await store.getMemory());
  return new Set(memory.nodes.map((node) => node.id));
}

function sortByCreatedAtDesc<T extends { created_at: string }>(items: T[]): T[] {
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
