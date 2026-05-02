import cors from "@fastify/cors";
import { createCacheKey, createInMemoryCache, type CacheLayerStats } from "@neuralmap/cache";
import {
  composeContextPack,
  createHandoffPack,
  expandGraphNeighborhood,
  rankSeedNodes,
  sampleTraceSpans
} from "@neuralmap/core";
import { ingestDocument, ingestRepository, ingestTicket } from "@neuralmap/ingest";
import {
  composeContextRequestSchema,
  graphQueryRequestSchema,
  type GraphNeighborhood,
  type GraphEdge,
  type GraphNode
} from "@neuralmap/schema";
import { createInMemoryTraceStore } from "@neuralmap/trace";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import { createGraphDataSource } from "./data-source.js";
import { registerTraceHooks } from "./trace.js";

const handoffRequestSchema = z.object({
  from_run_id: z.string().min(1),
  to_session_id: z.string().min(1).optional(),
  objective: z.string().min(1),
  current_status: z.string().min(1),
  open_loops: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  recommended_next_actions: z.array(z.string()).default([])
});

const linkRequestSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  weight: z.number().min(0).default(1),
  confidence: z.number().min(0).max(1).default(0.5)
});

export function createApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" }
  });

  const dataSource = createGraphDataSource();
  const cache = createInMemoryCache();
  const traceStore = createInMemoryTraceStore();

  void app.register(cors, {
    origin: true
  });

  registerTraceHooks(app, traceStore);

  app.get("/health", async () => ({
    ok: true,
    service: "neuralmap-api",
    graph_mode: dataSource.mode,
    time: new Date().toISOString()
  }));

  app.get("/workbench/agents", async () => ({
    agents: [
      {
        id: "main-agent",
        name: "Main Agent",
        status: "running",
        task: "Phase 1 Memory Backbone",
        model: "gpt-5",
        token_budget: 8000,
        cache_hit_rate: calculateCacheHitRate(cache.stats())
      }
    ]
  }));

  app.get("/workbench/graph/subgraph", async () => dataSource.getMemory());

  app.get("/workbench/runs/:id/trace", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const storedSpans = traceStore.listSpans(params.id);
    if (storedSpans.length > 0) {
      return {
        run_id: params.id,
        spans: storedSpans
      };
    }

    return {
      run_id: params.id,
      spans: sampleTraceSpans
    };
  });

  app.get("/graph/nodes/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const node = await dataSource.getNode(params.id);

    if (!node) {
      return reply.status(404).send({ error: "node_not_found" });
    }

    return node;
  });

  app.get("/graph/nodes/:id/neighbors", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const memory = await dataSource.getMemory();
    const node = memory.nodes.find((candidate) => candidate.id === params.id);

    if (!node) {
      return reply.status(404).send({ error: "node_not_found" });
    }

    return expandGraphNeighborhood([params.id], memory, { hops: 1, minConfidence: 0.4 });
  });

  app.post("/graph/query", async (request) => {
    const body = graphQueryRequestSchema.parse(request.body);
    const cacheKey = createCacheKey({
      layer: "graph_query",
      dataMode: dataSource.mode,
      body
    });
    const cached = cache.get<{
      seeds: ReturnType<typeof rankSeedNodes>;
      neighborhood: GraphNeighborhood;
      cache: { hit: true; key: string };
    }>("retrieval", cacheKey);

    if (cached.hit) {
      return cached.value;
    }

    const memory = await dataSource.getMemory();
    const seeds = rankSeedNodes(body, memory.nodes);
    const neighborhood = expandGraphNeighborhood(
      seeds.map((seed) => seed.node.id),
      memory,
      { hops: body.expand_hops, minConfidence: body.min_edge_confidence }
    );

    const response = {
      seeds,
      neighborhood,
      cache: {
        hit: false,
        key: cacheKey
      }
    };

    cache.set("retrieval", cacheKey, {
      ...response,
      cache: {
        hit: true,
        key: cacheKey
      }
    });

    return response;
  });

  app.post("/graph/link", async (request) => {
    const body = linkRequestSchema.parse(request.body);
    const edge: GraphEdge = {
      id: `edge_manual_${Date.now()}`,
      from: body.from,
      to: body.to,
      type: body.type as GraphEdge["type"],
      weight: body.weight,
      confidence: body.confidence,
      created_at: new Date().toISOString(),
      metadata: { source: "api" }
    };
    const persisted = await dataSource.persistIngest({
      nodes: [],
      edges: [edge],
      chunks: []
    });
    cache.clear();
    return {
      edge,
      persistence: persisted
    };
  });

  app.post("/context/compose", async (request) => {
    const body = composeContextRequestSchema.parse(request.body);
    const memory = await dataSource.getMemory();
    const pack = composeContextPack(body, memory);
    return dataSource.saveContextPack(pack);
  });

  app.get("/context/packs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const pack = await dataSource.getContextPack(params.id);
    if (!pack) {
      return reply.status(404).send({ error: "context_pack_not_found", id: params.id });
    }
    return pack;
  });

  app.post("/context/handoff", async (request) => {
    const body = handoffRequestSchema.parse(request.body);
    const input = {
      fromRunId: body.from_run_id,
      objective: body.objective,
      currentStatus: body.current_status,
      openLoops: body.open_loops,
      blockers: body.blockers,
      constraints: body.constraints,
      recommendedNextActions: body.recommended_next_actions
    };

    const pack = createHandoffPack(
      body.to_session_id
        ? {
            ...input,
            toSessionId: body.to_session_id
          }
        : input
    );
    return dataSource.saveHandoffPack(pack);
  });

  app.post("/ingest/document", async (request) => {
    const body = sourceDocumentSchema.parse(request.body);
    const emission = ingestDocument(body);
    const result = await dataSource.persistIngest(emission);
    cache.clear();
    return result;
  });

  app.post("/ingest/repository", async (request) => {
    const body = repositorySnapshotSchema.parse(request.body);
    const emission = ingestRepository(body);
    const result = await dataSource.persistIngest(emission);
    cache.clear();
    return result;
  });

  app.post("/ingest/ticket", async (request) => {
    const body = ticketSnapshotSchema.parse(request.body);
    const emission = ingestTicket(body);
    const result = await dataSource.persistIngest(emission);
    cache.clear();
    return result;
  });

  app.get("/cache/stats", async () => ({
    layers: cache.stats()
  }));

  app.post("/cache/invalidate", async () => {
    const invalidated = cache.clear();
    return {
      invalidated: true,
      count: invalidated,
      scope: dataSource.mode
    };
  });

  app.get("/cache/key/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return {
      id: params.id,
      hit: cache.stats().some((layer) => cache.has(layer.name, params.id))
    };
  });

  app.post("/agents", async (request) => ({
    id: "main-agent",
    ...(typeof request.body === "object" && request.body ? request.body : {})
  }));

  app.post("/agents/:id/run", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return {
      id: `run_${Date.now()}`,
      agent_id: params.id,
      status: "planned"
    };
  });

  app.post("/agents/:id/resume", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return {
      agent_id: params.id,
      status: "running"
    };
  });

  app.get("/agents/:id/runs/:runId", async (request) => {
    const params = z.object({ id: z.string().min(1), runId: z.string().min(1) }).parse(request.params);
    return {
      id: params.runId,
      agent_id: params.id,
      status: "running",
      objective: "Phase 1 Memory Backbone"
    };
  });

  app.get("/agents/:id/runs/:runId/references", async () => ({
    nodes: (await dataSource.getMemory()).nodes.filter((node: GraphNode) => node.importance_score >= 0.85)
  }));

  return app;
}

function calculateCacheHitRate(stats: CacheLayerStats[]): number {
  const totals = stats.reduce(
    (acc, layer) => ({
      hits: acc.hits + layer.hits,
      misses: acc.misses + layer.misses
    }),
    { hits: 0, misses: 0 }
  );
  const total = totals.hits + totals.misses;
  return total === 0 ? 0 : Number((totals.hits / total).toFixed(4));
}

const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  uri: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const repositoryFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  language: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const repositorySnapshotSchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  files: z.array(repositoryFileSchema),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const ticketSnapshotSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  body: z.string().min(1),
  status: z.string().min(1),
  labels: z.array(z.string()).optional(),
  comments: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
