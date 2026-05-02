import cors from "@fastify/cors";
import {
  composeContextPack,
  createHandoffPack,
  expandGraphNeighborhood,
  rankSeedNodes,
  sampleMemory,
  sampleTraceSpans
} from "@neuralmap/core";
import {
  composeContextRequestSchema,
  graphQueryRequestSchema,
  type GraphEdge,
  type GraphNode
} from "@neuralmap/schema";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

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
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  const memory = {
    nodes: [...sampleMemory.nodes],
    edges: [...sampleMemory.edges]
  };

  void app.register(cors, {
    origin: true
  });

  registerTraceHooks(app);

  app.get("/health", async () => ({
    ok: true,
    service: "neuralmap-api",
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
        cache_hit_rate: 0.18
      }
    ]
  }));

  app.get("/workbench/graph/subgraph", async () => ({
    nodes: memory.nodes,
    edges: memory.edges,
    generated_at: new Date().toISOString()
  }));

  app.get("/workbench/runs/:id/trace", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return {
      run_id: params.id,
      spans: sampleTraceSpans
    };
  });

  app.get("/graph/nodes/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const node = memory.nodes.find((candidate) => candidate.id === params.id);

    if (!node) {
      return reply.status(404).send({ error: "node_not_found" });
    }

    return node;
  });

  app.get("/graph/nodes/:id/neighbors", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const node = memory.nodes.find((candidate) => candidate.id === params.id);

    if (!node) {
      return reply.status(404).send({ error: "node_not_found" });
    }

    return expandGraphNeighborhood([params.id], memory, { hops: 1, minConfidence: 0.4 });
  });

  app.post("/graph/query", async (request) => {
    const body = graphQueryRequestSchema.parse(request.body);
    const seeds = rankSeedNodes(body, memory.nodes);
    const neighborhood = expandGraphNeighborhood(
      seeds.map((seed) => seed.node.id),
      memory,
      { hops: body.expand_hops, minConfidence: body.min_edge_confidence }
    );

    return {
      seeds,
      neighborhood
    };
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
    memory.edges.push(edge);
    return edge;
  });

  app.post("/context/compose", async (request) => {
    const body = composeContextRequestSchema.parse(request.body);
    return composeContextPack(body, memory);
  });

  app.get("/context/packs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return reply.status(501).send({
      error: "not_persisted_yet",
      id: params.id,
      detail: "Context pack persistence lands with the database-backed API slice."
    });
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

    return createHandoffPack(
      body.to_session_id
        ? {
            ...input,
            toSessionId: body.to_session_id
          }
        : input
    );
  });

  app.get("/cache/stats", async () => ({
    layers: [
      { name: "retrieval", hits: 0, misses: 1 },
      { name: "graph_neighborhood", hits: 0, misses: 1 },
      { name: "prompt_segment", hits: 0, misses: 0 },
      { name: "summary", hits: 0, misses: 0 }
    ]
  }));

  app.post("/cache/invalidate", async () => ({
    invalidated: true,
    scope: "sample-memory"
  }));

  app.get("/cache/key/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return {
      id: params.id,
      hit: false
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
    nodes: memory.nodes.filter((node: GraphNode) => node.importance_score >= 0.85)
  }));

  return app;
}
