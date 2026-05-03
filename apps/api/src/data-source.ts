import { sampleMemory } from "@neuralmap/core";
import { createDbClient, createGraphStore, type GraphStore, type VectorSeedCandidate } from "@neuralmap/db";
import {
  ingestContextPackArtifact,
  ingestHandoffPackArtifact,
  linkCrossSourceReferences,
  type IngestEmission
} from "@neuralmap/ingest";
import type { ContextPack, GraphEdge, GraphNode, GraphQueryRequest, HandoffPack } from "@neuralmap/schema";

export type DataMode = "database" | "sample";

export interface GraphDataSource {
  mode: DataMode;
  getMemory(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; generated_at: string; mode: DataMode }>;
  getNode(id: string): Promise<GraphNode | undefined>;
  searchVectorSeeds(request: GraphQueryRequest, limit?: number): Promise<VectorSeedCandidate[]>;
  persistIngest(emission: IngestEmission): Promise<{ nodes: number; edges: number; chunks: number; mode: DataMode }>;
  saveContextPack(pack: ContextPack): Promise<ContextPack>;
  getContextPack(id: string): Promise<ContextPack | undefined>;
  listContextPacks(limit?: number): Promise<ContextPack[]>;
  saveHandoffPack(pack: HandoffPack): Promise<HandoffPack>;
  getHandoffPack(id: string): Promise<HandoffPack | undefined>;
  listHandoffPacks(limit?: number): Promise<HandoffPack[]>;
}

export function createGraphDataSource(): GraphDataSource {
  if (!process.env.DATABASE_URL) {
    return createSampleDataSource("DATABASE_URL is not configured.");
  }

  try {
    const { db } = createDbClient(process.env.DATABASE_URL);
    return createDatabaseDataSource(createGraphStore(db));
  } catch {
    return createSampleDataSource("Database client could not be created.");
  }
}

function createDatabaseDataSource(store: GraphStore): GraphDataSource {
  const sample = createSampleDataSource("Database unavailable.");

  return {
    mode: "database",

    async getMemory() {
      try {
        const memory = await store.getMemory();
        if (memory.nodes.length === 0) {
          return sample.getMemory();
        }

        return {
          ...memory,
          generated_at: new Date().toISOString(),
          mode: "database"
        };
      } catch {
        return sample.getMemory();
      }
    },

    async getNode(id) {
      try {
        return (await store.getNode(id)) ?? sample.getNode(id);
      } catch {
        return sample.getNode(id);
      }
    },

    async searchVectorSeeds(request, limit) {
      try {
        return await store.searchVectorSeeds(request, limit);
      } catch {
        return [];
      }
    },

    async persistIngest(emission) {
      const result = await store.upsertGraph({
        nodes: emission.nodes,
        edges: emission.edges,
        chunks: emission.chunks
      });
      return {
        ...result,
        mode: "database"
      };
    },

    async saveContextPack(pack) {
      const saved = await store.saveContextPack(pack);
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
    },

    async getContextPack(id) {
      return store.getContextPack(id);
    },

    async listContextPacks(limit) {
      return store.listContextPacks(limit);
    },

    async saveHandoffPack(pack) {
      const saved = await store.saveHandoffPack(pack);
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
    },

    async getHandoffPack(id) {
      return store.getHandoffPack(id);
    },

    async listHandoffPacks(limit) {
      return store.listHandoffPacks(limit);
    }
  };
}

function createSampleDataSource(reason: string): GraphDataSource {
  const nodes = [...sampleMemory.nodes];
  const edges = [...sampleMemory.edges];
  const contextPacks = new Map<string, ContextPack>();
  const handoffPacks = new Map<string, HandoffPack>();

  return {
    mode: "sample",

    async getMemory() {
      return {
        nodes,
        edges,
        generated_at: new Date().toISOString(),
        mode: "sample"
      };
    },

    async getNode(id) {
      return nodes.find((node) => node.id === id);
    },

    async searchVectorSeeds() {
      return [];
    },

    async persistIngest(emission) {
      for (const node of emission.nodes) {
        upsertById(nodes, node);
      }
      for (const edge of emission.edges) {
        upsertById(edges, edge);
      }

      return {
        nodes: emission.nodes.length,
        edges: emission.edges.length,
        chunks: emission.chunks.length,
        mode: "sample"
      };
    },

    async saveContextPack(pack) {
      contextPacks.set(pack.id, pack);
      await persistLinkedArtifact(
        async () => ({ nodes, edges }),
        async (emission) => {
          persistSampleEmission({ nodes, edges }, emission);
        },
        ingestContextPackArtifact(pack)
      );
      return pack;
    },

    async getContextPack(id) {
      return contextPacks.get(id);
    },

    async listContextPacks(limit = 10) {
      return sortByCreatedAtDesc([...contextPacks.values()]).slice(0, limit);
    },

    async saveHandoffPack(pack) {
      handoffPacks.set(pack.id, pack);
      await persistLinkedArtifact(
        async () => ({ nodes, edges }),
        async (emission) => {
          persistSampleEmission({ nodes, edges }, emission);
        },
        ingestHandoffPackArtifact(pack)
      );
      return pack;
    },

    async getHandoffPack(id) {
      return handoffPacks.get(id);
    },

    async listHandoffPacks(limit = 10) {
      return sortByCreatedAtDesc([...handoffPacks.values()]).slice(0, limit);
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

function sortByCreatedAtDesc<T extends { created_at: string }>(items: T[]): T[] {
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
