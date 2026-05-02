import { sampleMemory } from "@neuralmap/core";
import { createDbClient, createGraphStore, type GraphStore } from "@neuralmap/db";
import type { IngestEmission } from "@neuralmap/ingest";
import type { ContextPack, GraphEdge, GraphNode, HandoffPack } from "@neuralmap/schema";

export type DataMode = "database" | "sample";

export interface GraphDataSource {
  mode: DataMode;
  getMemory(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; generated_at: string; mode: DataMode }>;
  getNode(id: string): Promise<GraphNode | undefined>;
  persistIngest(emission: IngestEmission): Promise<{ nodes: number; edges: number; chunks: number; mode: DataMode }>;
  saveContextPack(pack: ContextPack): Promise<ContextPack>;
  getContextPack(id: string): Promise<ContextPack | undefined>;
  saveHandoffPack(pack: HandoffPack): Promise<HandoffPack>;
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
      return store.saveContextPack(pack);
    },

    async getContextPack(id) {
      return store.getContextPack(id);
    },

    async saveHandoffPack(pack) {
      return store.saveHandoffPack(pack);
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
      return pack;
    },

    async getContextPack(id) {
      return contextPacks.get(id);
    },

    async saveHandoffPack(pack) {
      handoffPacks.set(pack.id, pack);
      return pack;
    }
  };
}

function upsertById<T extends { id: string }>(items: T[], item: T): void {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
    return;
  }

  items.push(item);
}

