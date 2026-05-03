import cors from "@fastify/cors";
import {
  cacheLayerNames,
  createCacheKey,
  createInMemoryCache,
  type CacheInspectFilter,
  type CacheLayerName,
  type CacheLayerStats,
  type CacheStore
} from "@neuralmap/cache";
import {
  composeContextPack,
  type CreateHandoffPackInput,
  createHandoffPack,
  classifyQueryIntent,
  edgeTypeIntentBoosts,
  expandGraphNeighborhood,
  listContextTemplates,
  listModelProfiles,
  rankSeedNodes,
  renderPromptSegment,
  sampleTraceSpans,
  selectContextTemplate,
  selectModelProfile,
  type SemanticSeedHint,
  type GraphMemory,
  type ModelQualitySignal,
  type ModelRouteDecision
} from "@neuralmap/core";
import type { ContextTemplate, PromptSegment } from "@neuralmap/core";
import { createDbClient, createDbTraceStore } from "@neuralmap/db";
import {
  ingestDocument,
  ingestRepository,
  ingestSimulationEvent,
  ingestTicket,
  linkCrossSourceReferences,
  simulationSessionNodeId
} from "@neuralmap/ingest";
import {
  composeContextRequestSchema,
  graphQueryRequestSchema,
  type ContextPack,
  type ComposeContextRequest,
  type GraphNeighborhood,
  type GraphEdge,
  type GraphNode,
  type HandoffPack,
  type TraceSpan
} from "@neuralmap/schema";
import { createInMemoryTraceStore, startTraceSpan, type StartTraceSpanInput, type TraceStore } from "@neuralmap/trace";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

import { createGraphDataSource } from "./data-source.js";
import { registerTraceHooks } from "./trace.js";

const handoffRequestSchema = z.object({
  from_run_id: z.string().min(1),
  to_session_id: z.string().min(1).optional(),
  context_pack_id: z.string().min(1).optional(),
  objective: z.string().min(1),
  current_status: z.string().min(1),
  open_loops: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  recommended_next_actions: z.array(z.string()).optional()
});

const linkRequestSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  weight: z.number().min(0).default(1),
  confidence: z.number().min(0).max(1).default(0.5)
});

const refreshContextPackRequestSchema = z.object({
  objective: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  task_type: z.string().min(1).optional(),
  token_budget: z.number().int().positive().optional(),
  seed_node_ids: z.array(z.string().min(1)).optional()
});

const agentRunRequestSchema = z.object({
  task: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  context_pack_id: z.string().min(1).optional(),
  model_profile: z.string().min(1).optional()
});

const modelRouteRequestSchema = z.object({
  task: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  context_pack_id: z.string().min(1).optional(),
  token_budget: z.number().int().positive().optional(),
  model_profile: z.string().min(1).optional()
});

const modelFeedbackRequestSchema = z.object({
  run_id: z.string().min(1),
  model_profile: z.string().min(1),
  score: z.number().min(0).max(1),
  signal: z.string().min(1).optional(),
  comment: z.string().min(1).optional()
});

const cacheLayerSchema = z.enum(cacheLayerNames);

const cacheEntriesQuerySchema = z.object({
  layer: cacheLayerSchema.optional(),
  key: z.string().min(1).optional(),
  key_prefix: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  tags: z.string().min(1).optional(),
  include_expired: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25)
});

const cacheInvalidateRequestSchema = z
  .object({
    layer: cacheLayerSchema.optional(),
    key: z.string().min(1).optional(),
    key_prefix: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    include_expired: z.boolean().optional()
  })
  .default({});

export function createApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" }
  });

  const dataSource = createGraphDataSource();
  const cache = createInMemoryCache();
  const traceStore = createApiTraceStore();
  const profileFeedback = createProfileFeedbackStore();

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

  app.get("/model/profiles", async () => ({
    profiles: listModelProfiles(),
    feedback: profileFeedback.summaries(),
    generated_at: new Date().toISOString()
  }));

  app.post("/model/route", async (request, reply) => {
    const body = modelRouteRequestSchema.parse(request.body ?? {});
    const contextPack = body.context_pack_id ? await dataSource.getContextPack(body.context_pack_id) : undefined;

    if (body.context_pack_id && !contextPack) {
      return reply.status(404).send({
        error: "context_pack_not_found",
        id: body.context_pack_id
      });
    }

    return createModelRouteDecision({
      body,
      contextPack,
      cacheStats: cache.stats(),
      feedbackSignals: profileFeedback.signals()
    });
  });

  app.post("/model/feedback", async (request) => {
    const body = modelFeedbackRequestSchema.parse(request.body ?? {});
    const feedback = profileFeedback.add(body);
    return {
      accepted: true,
      feedback,
      summaries: profileFeedback.summaries()
    };
  });

  app.get("/workbench/runs/:id/trace", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const storedSpans = await traceStore.listSpans(params.id);
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

  app.get("/workbench/artifacts", async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(50).default(10)
      })
      .parse(request.query);
    const [contextPacks, handoffPacks] = await Promise.all([
      dataSource.listContextPacks(query.limit),
      dataSource.listHandoffPacks(query.limit)
    ]);

    return {
      context_packs: contextPacks,
      handoff_packs: handoffPacks,
      relationships: createHandoffRelationships(contextPacks, handoffPacks),
      mode: dataSource.mode,
      generated_at: new Date().toISOString()
    };
  });

  app.get("/workbench/artifacts/handoffs/:id/relationship", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const handoffPack = await dataSource.getHandoffPack(params.id);

    if (!handoffPack) {
      return reply.status(404).send({ error: "handoff_pack_not_found", id: params.id });
    }

    const contextPackId = getSourceContextPackId(handoffPack);
    if (contextPackId && (await dataSource.getContextPack(contextPackId))) {
      return toHandoffRelationship(contextPackId, handoffPack);
    }

    const [relationship] = createHandoffRelationships(await dataSource.listContextPacks(50), [handoffPack]);
    if (!relationship) {
      return reply.status(404).send({ error: "handoff_relationship_not_found", id: params.id });
    }

    return relationship;
  });

  app.get("/workbench/timeline", async (request) => {
    const query = z
      .object({
        run_id: z.string().min(1).optional(),
        limit: z.coerce.number().int().positive().max(100).default(40)
      })
      .parse(request.query);
    const artifactLimit = Math.max(query.limit, 50);
    const [contextPacks, handoffPacks, spans] = await Promise.all([
      dataSource.listContextPacks(artifactLimit),
      dataSource.listHandoffPacks(artifactLimit),
      query.run_id ? traceStore.listSpans(query.run_id) : Promise.resolve(sampleTraceSpans)
    ]);
    const relationships = createHandoffRelationships(contextPacks, handoffPacks);

    return {
      run_id: query.run_id,
      events: createTimelineEvents({
        contextPacks,
        handoffPacks,
        relationships,
        spans,
        runId: query.run_id,
        limit: query.limit
      }),
      mode: dataSource.mode,
      generated_at: new Date().toISOString()
    };
  });

  app.get("/context/templates", async () => ({
    templates: listContextTemplates()
  }));

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

    return getCachedNeighborhood({
      cache,
      traceStore,
      request,
      dataMode: dataSource.mode,
      memory,
      seedNodeIds: [params.id],
      hops: 1,
      minConfidence: 0.4
    });
  });

  app.post("/graph/query", async (request) => {
    const body = graphQueryRequestSchema.parse(request.body);
    const intent = classifyQueryIntent(body.query);
    const expandHops = Math.min(2, Math.max(body.expand_hops, intent.suggested_hops));
    const cacheKey = createCacheKey({
      layer: "graph_query",
      dataMode: dataSource.mode,
      body: {
        ...body,
        expand_hops: expandHops,
        intent: intent.kind
      }
    });
    const cached = cache.get<{
      seeds: ReturnType<typeof rankSeedNodes>;
      neighborhood: GraphNeighborhood;
      intent: ReturnType<typeof classifyQueryIntent>;
      retrieval: {
        mode: "hybrid";
        seed_count: number;
        semantic_seed_count: number;
        vector_seed_count: number;
        semantic_source: "local_sparse" | "pgvector+local";
        embedding_model?: string;
      };
      cache: { hit: true; key: string };
    }>("retrieval", cacheKey);

    await runTracedSpan(traceStore, request, {
      name: "Graph Query Cache Lookup",
      kind: "cache",
      attributes: {
        layer: "retrieval",
        key: cacheKey,
        hit: cached.hit,
        intent: intent.kind
      }
    });

    if (cached.hit) {
      return cached.value;
    }

    const [memory, vectorSeeds] = await Promise.all([
      dataSource.getMemory(),
      dataSource.searchVectorSeeds(body, Math.max(body.top_k * 2, 10))
    ]);
    const semanticSeedHints = vectorSeeds.map(toSemanticSeedHint);
    const seeds = await runTracedSpan(
      traceStore,
      request,
      {
        name: "Seed Retrieval",
        kind: "retrieval",
        attributes: {
          query: body.query,
          topK: body.top_k,
          mode: "hybrid",
          semanticSource: dataSource.mode === "database" ? "pgvector+local" : "local_sparse",
          vectorSeedCount: vectorSeeds.length,
          intent: intent.kind,
          intentConfidence: intent.confidence
        }
      },
      () => rankSeedNodes(body, memory.nodes, { intent, semanticSeedHints })
    );
    const neighborhood = await getCachedNeighborhood({
      cache,
      traceStore,
      request,
      dataMode: dataSource.mode,
      memory,
      seedNodeIds: seeds.map((seed) => seed.node.id),
      hops: expandHops,
      minConfidence: body.min_edge_confidence,
      edgeTypeBoosts: edgeTypeIntentBoosts(intent),
      attributes: {
        intent: intent.kind
      }
    });

    const response = {
      seeds,
      neighborhood,
      intent,
      retrieval: {
        mode: "hybrid" as const,
        seed_count: seeds.length,
        semantic_seed_count: seeds.filter((seed) => seed.semantic_score > 0).length,
        vector_seed_count: vectorSeeds.length,
        semantic_source: dataSource.mode === "database" ? "pgvector+local" as const : "local_sparse" as const,
        embedding_model: dataSource.mode === "database" ? "deterministic-sparse-hash-v1" : undefined
      },
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
    }, {
      tags: createCacheTags("graph", "retrieval", `intent:${intent.kind}`, `mode:${dataSource.mode}`)
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
    invalidateGraphCaches(cache);
    return {
      edge,
      persistence: persisted
    };
  });

  app.post("/context/compose", async (request) => {
    const body = composeContextRequestSchema.parse(request.body);
    const template = selectContextTemplate(body);
    const promptSegment = await getCachedPromptSegment({
      cache,
      traceStore,
      request,
      template
    });
    const memory = await dataSource.getMemory();
    const pack = await runTracedSpan(
      traceStore,
      request,
      {
        name: "Context Pack Composition",
        kind: "context_pack",
        attributes: {
          objective: body.objective,
          query: body.query,
          templateId: template.id,
          promptSegmentCacheHit: promptSegment.cache.hit,
          seedNodeCount: body.seed_node_ids.length,
          tokenBudget: body.token_budget
        }
      },
      () =>
        composeContextPack(body, memory, {
          template,
          promptSegmentCache: promptSegment.cache
        })
    );
    const summary = await getCachedContextSummary({
      cache,
      traceStore,
      request,
      pack
    });
    const saved = await dataSource.saveContextPack(withContextSummary(withRunMetadata(pack, request), summary));
    invalidateGraphCaches(cache);
    return saved;
  });

  app.get("/context/packs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const pack = await dataSource.getContextPack(params.id);
    if (!pack) {
      return reply.status(404).send({ error: "context_pack_not_found", id: params.id });
    }
    return pack;
  });

  app.post("/context/packs/:id/refresh", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = refreshContextPackRequestSchema.parse(request.body ?? {});
    const existing = await dataSource.getContextPack(params.id);

    if (!existing) {
      return reply.status(404).send({ error: "context_pack_not_found", id: params.id });
    }

    const input: ComposeContextRequest = {
      objective: body.objective ?? existing.objective,
      agent_id: existing.agent_id,
      session_id: existing.session_id,
      token_budget: body.token_budget ?? existing.token_budget,
      seed_node_ids: body.seed_node_ids ?? existing.node_ids
    };
    const taskType = body.task_type ?? existing.template_id?.split(":")[0];
    if (taskType) {
      input.task_type = taskType;
    }
    input.query = body.query ?? existing.objective;

    const template = selectContextTemplate(input);
    const promptSegment = await getCachedPromptSegment({
      cache,
      traceStore,
      request,
      template
    });
    const memory = await dataSource.getMemory();
    const pack = await runTracedSpan(
      traceStore,
      request,
      {
        name: "Context Pack Refresh",
        kind: "context_pack",
        attributes: {
          previousPackId: existing.id,
          objective: input.objective,
          query: input.query,
          templateId: template.id,
          promptSegmentCacheHit: promptSegment.cache.hit,
          seedNodeCount: input.seed_node_ids.length,
          tokenBudget: input.token_budget
        }
      },
      () =>
        composeContextPack(input, memory, {
          template,
          promptSegmentCache: promptSegment.cache
        })
    );
    const summary = await getCachedContextSummary({
      cache,
      traceStore,
      request,
      pack
    });
    const saved = await dataSource.saveContextPack(withContextSummary(withRunMetadata(pack, request), summary));
    invalidateGraphCaches(cache);

    return {
      previous_pack_id: existing.id,
      pack: saved
    };
  });

  app.get("/context/handoffs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const pack = await dataSource.getHandoffPack(params.id);
    if (!pack) {
      return reply.status(404).send({ error: "handoff_pack_not_found", id: params.id });
    }
    return pack;
  });

  app.post("/context/handoff", async (request, reply) => {
    const body = handoffRequestSchema.parse(request.body);
    const contextPack = body.context_pack_id ? await dataSource.getContextPack(body.context_pack_id) : undefined;

    if (body.context_pack_id && !contextPack) {
      return reply.status(404).send({ error: "context_pack_not_found", id: body.context_pack_id });
    }

    const input: CreateHandoffPackInput = {
      fromRunId: body.from_run_id,
      objective: body.objective,
      currentStatus: body.current_status
    };

    if (body.to_session_id) {
      input.toSessionId = body.to_session_id;
    }
    if (contextPack) {
      input.contextPack = contextPack;
    }
    if (body.open_loops) {
      input.openLoops = body.open_loops;
    }
    if (body.blockers) {
      input.blockers = body.blockers;
    }
    if (body.constraints) {
      input.constraints = body.constraints;
    }
    if (body.recommended_next_actions) {
      input.recommendedNextActions = body.recommended_next_actions;
    }

    const pack = await runTracedSpan(
      traceStore,
      request,
      {
        name: "Handoff Pack Creation",
        kind: "handoff",
        attributes: {
          objective: body.objective,
          contextPackId: body.context_pack_id,
          referencedNodeCount: contextPack?.node_ids.length ?? 0
        }
      },
      () => createHandoffPack(input)
    );
    const saved = await dataSource.saveHandoffPack(pack);
    invalidateGraphCaches(cache);
    return saved;
  });

  app.post("/ingest/document", async (request) => {
    const body = sourceDocumentSchema.parse(request.body);
    const emission = ingestDocument(body);
    const linkedEmission = linkCrossSourceReferences(emission, await dataSource.getMemory());
    const result = await dataSource.persistIngest(linkedEmission);
    invalidateGraphCaches(cache);
    return result;
  });

  app.post("/ingest/repository", async (request) => {
    const body = repositorySnapshotSchema.parse(request.body);
    const emission = ingestRepository(body);
    const linkedEmission = linkCrossSourceReferences(emission, await dataSource.getMemory());
    const result = await dataSource.persistIngest(linkedEmission);
    invalidateGraphCaches(cache);
    return result;
  });

  app.post("/ingest/ticket", async (request) => {
    const body = ticketSnapshotSchema.parse(request.body);
    const emission = ingestTicket(body);
    const linkedEmission = linkCrossSourceReferences(emission, await dataSource.getMemory());
    const result = await dataSource.persistIngest(linkedEmission);
    invalidateGraphCaches(cache);
    return result;
  });

  app.post("/ingest/simulation-event", async (request) => {
    const body = simulationEventSchema.parse(request.body);
    const emission = ingestSimulationEvent(body);
    const linkedEmission = linkCrossSourceReferences(emission, await dataSource.getMemory());
    const result = await dataSource.persistIngest(linkedEmission);
    invalidateGraphCaches(cache);
    return {
      ...result,
      session_node_id: simulationSessionNodeId(body.simulation_id, body.session_id)
    };
  });

  app.post("/simulation/context", async (request) => {
    const body = simulationContextRequestSchema.parse(request.body);
    const sessionNodeId = simulationSessionNodeId(body.simulation_id, body.session_id);
    const targetSessionId = body.new_session_id ?? body.session_id;
    const objective =
      body.objective ?? `Continue simulation ${body.simulation_id} from session ${body.session_id}`;
    const query =
      body.query ??
      [
        "simulation continuity",
        body.simulation_id,
        body.session_id,
        "character memory relationship promise conflict"
      ].join(" ");
    const template = selectContextTemplate({
      objective,
      task_type: "handoff",
      query
    });
    const promptSegment = await getCachedPromptSegment({
      cache,
      traceStore,
      request,
      template
    });
    const memory = filterSimulationMemory(await dataSource.getMemory(), body.simulation_id, sessionNodeId);
    const pack = await runTracedSpan(
      traceStore,
      request,
      {
        name: "Simulation Continuity Context",
        kind: "context_pack",
        attributes: {
          simulationId: body.simulation_id,
          sourceSessionId: body.session_id,
          targetSessionId,
          tokenBudget: body.token_budget
        }
      },
      () =>
        composeContextPack(
          {
            objective,
            agent_id: body.agent_id,
            session_id: targetSessionId,
            task_type: "handoff",
            token_budget: body.token_budget,
            seed_node_ids: [sessionNodeId],
            query
          },
          memory,
          {
            template,
            promptSegmentCache: promptSegment.cache
          }
        )
    );
    const continuityPack: ContextPack = {
      ...pack,
      metadata: {
        ...pack.metadata,
        simulation_continuity: {
          simulation_id: body.simulation_id,
          source_session_id: body.session_id,
          target_session_id: targetSessionId,
          session_node_id: sessionNodeId
        }
      }
    };
    const summary = await getCachedContextSummary({
      cache,
      traceStore,
      request,
      pack: continuityPack
    });
    const saved = await dataSource.saveContextPack(withContextSummary(withRunMetadata(continuityPack, request), summary));
    invalidateGraphCaches(cache);

    return {
      session_node_id: sessionNodeId,
      source_session_id: body.session_id,
      target_session_id: targetSessionId,
      pack: saved,
      mode: dataSource.mode
    };
  });

  app.get("/cache/stats", async () => ({
    layers: cache.stats(),
    policies: cache.policies(),
    generated_at: new Date().toISOString()
  }));

  app.get("/cache/entries", async (request) => {
    const query = cacheEntriesQuerySchema.parse(request.query);
    const filter = createCacheFilter({
      layer: query.layer,
      key: query.key,
      keyPrefix: query.key_prefix,
      tags: parseCacheTags(query.tags ?? query.tag),
      includeExpired: query.include_expired === "true",
      limit: query.limit
    });

    return {
      entries: cache.listEntries(filter),
      filters: filter,
      generated_at: new Date().toISOString()
    };
  });

  app.post("/cache/invalidate", async (request) => {
    const body = cacheInvalidateRequestSchema.parse(request.body ?? {});
    const result = cache.invalidate(
      createCacheFilter({
        layer: body.layer,
        key: body.key,
        keyPrefix: body.key_prefix,
        tags: body.tags,
        includeExpired: body.include_expired
      })
    );
    return {
      invalidated: true,
      count: result.count,
      entries: result.entries,
      scope: dataSource.mode
    };
  });

  app.get("/cache/key/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        layer: cacheLayerSchema.optional(),
        include_expired: z.enum(["true", "false"]).optional()
      })
      .parse(request.query);
    const layers: CacheLayerName[] = query.layer ? [query.layer] : [...cacheLayerNames];
    const entries = layers
      .map((layer) => cache.inspect(layer, params.id, query.include_expired === "true"))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return {
      id: params.id,
      hit: entries.some((entry) => !entry.expired),
      entries
    };
  });

  app.post("/agents", async (request) => ({
    id: "main-agent",
    ...(typeof request.body === "object" && request.body ? request.body : {})
  }));

  app.post("/agents/:id/run", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = agentRunRequestSchema.parse(request.body ?? {});
    const contextPack = body.context_pack_id ? await dataSource.getContextPack(body.context_pack_id) : undefined;

    if (body.context_pack_id && !contextPack) {
      return {
        error: "context_pack_not_found",
        id: body.context_pack_id
      };
    }

    const objective = body.objective ?? body.task ?? contextPack?.objective ?? "Run agent task";
    const profileDecision = createModelRouteDecision({
      body: {
        objective,
        task: body.task,
        token_budget: contextPack?.token_budget,
        model_profile: body.model_profile
      },
      contextPack,
      cacheStats: cache.stats(),
      feedbackSignals: profileFeedback.signals()
    });
    const response = await getCachedAgentResponse({
      cache,
      traceStore,
      request,
      agentId: params.id,
      objective,
      task: body.task,
      modelProfile: profileDecision.selected_profile.id,
      contextPack,
      profileDecision
    });

    return {
      id: response.value.run_id,
      agent_id: params.id,
      status: "completed",
      objective,
      response: response.value,
      cache: response.cache,
      profile: profileDecision
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

function createModelRouteDecision(input: {
  body: {
    objective?: string | undefined;
    task?: string | undefined;
    query?: string | undefined;
    token_budget?: number | undefined;
    model_profile?: string | undefined;
  };
  contextPack?: ContextPack | undefined;
  cacheStats: CacheLayerStats[];
  feedbackSignals: Record<string, ModelQualitySignal>;
}): ModelRouteDecision {
  const objective = input.body.objective ?? input.body.task ?? input.contextPack?.objective ?? "Route model profile";

  return selectModelProfile({
    objective,
    task: input.body.task,
    query: input.body.query,
    requested_profile_id: input.body.model_profile,
    token_budget: input.body.token_budget ?? input.contextPack?.token_budget,
    context_pack: input.contextPack,
    cache_hit_rate: calculateCacheHitRate(input.cacheStats),
    quality_signals: input.feedbackSignals
  });
}

function toSemanticSeedHint(candidate: {
  node: GraphNode;
  similarity: number;
  source: string;
  chunk_id?: string | undefined;
}): SemanticSeedHint {
  return {
    node_id: candidate.node.id,
    similarity: candidate.similarity,
    source: candidate.source,
    ...(candidate.chunk_id ? { rank: 0 } : {})
  };
}

interface ProfileFeedbackInput {
  run_id: string;
  model_profile: string;
  score: number;
  signal?: string | undefined;
  comment?: string | undefined;
}

interface ProfileFeedbackRecord extends ProfileFeedbackInput {
  created_at: string;
}

function createProfileFeedbackStore() {
  const records: ProfileFeedbackRecord[] = [];

  return {
    add(input: ProfileFeedbackInput) {
      const record: ProfileFeedbackRecord = {
        ...input,
        created_at: new Date().toISOString()
      };
      records.unshift(record);
      records.splice(100);
      return record;
    },

    summaries(): ModelQualitySignal[] {
      return Object.values(this.signals());
    },

    signals(): Record<string, ModelQualitySignal> {
      const grouped = new Map<string, ProfileFeedbackRecord[]>();
      for (const record of records) {
        grouped.set(record.model_profile, [...(grouped.get(record.model_profile) ?? []), record]);
      }

      return Object.fromEntries(
        [...grouped.entries()].map(([profileId, profileRecords]) => {
          const averageScore = profileRecords.reduce((sum, record) => sum + record.score, 0) / profileRecords.length;
          const signal: ModelQualitySignal = {
            profile_id: profileId,
            average_score: Number(averageScore.toFixed(4)),
            feedback_count: profileRecords.length
          };
          if (profileRecords[0]) {
            signal.last_score = profileRecords[0].score;
          }
          return [
            profileId,
            signal
          ];
        })
      );
    }
  };
}

function createApiTraceStore(): TraceStore {
  const memoryTraceStore = createInMemoryTraceStore();

  if (!process.env.DATABASE_URL) {
    return memoryTraceStore;
  }

  try {
    const { db } = createDbClient(process.env.DATABASE_URL);
    return createDbTraceStore(db, memoryTraceStore);
  } catch {
    return memoryTraceStore;
  }
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

interface CachedNeighborhoodInput {
  cache: CacheStore;
  traceStore: TraceStore;
  request: FastifyRequest;
  dataMode: string;
  memory: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] };
  seedNodeIds: string[];
  hops: number;
  minConfidence: number;
  edgeTypeBoosts?: Partial<Record<GraphEdge["type"], number>>;
  attributes?: Record<string, unknown>;
}

interface CachedPromptSegmentInput {
  cache: CacheStore;
  traceStore: TraceStore;
  request: FastifyRequest;
  template: ContextTemplate;
}

interface CachedContextSummaryInput {
  cache: CacheStore;
  traceStore: TraceStore;
  request: FastifyRequest;
  pack: {
    objective: string;
    template_id?: string | undefined;
    node_ids: string[];
    evidence: Array<{ node_id: string; snippet: string; score: number }>;
    decisions: string[];
    blockers: string[];
  };
}

interface CachedContextSummary {
  value: {
    title: string;
    content: string;
    evidence_node_ids: string[];
    decision_count: number;
    blocker_count: number;
  };
  cache: {
    key: string;
    hit: boolean;
  };
}

interface CachedAgentResponseInput {
  cache: CacheStore;
  traceStore: TraceStore;
  request: FastifyRequest;
  agentId: string;
  objective: string;
  task?: string | undefined;
  modelProfile: string;
  contextPack?: ContextPack | undefined;
  profileDecision?: ModelRouteDecision | undefined;
}

interface CachedAgentResponse {
  value: {
    run_id: string;
    content: string;
    referenced_node_ids: string[];
    context_pack_id?: string;
    model_profile: string;
    profile_reasoning_effort?: string;
  };
  cache: {
    layer: "response";
    key: string;
    hit: boolean;
  };
}

interface HandoffRelationship {
  id: string;
  context_pack_id: string;
  context_artifact_id: string;
  handoff_pack_id: string;
  handoff_artifact_id: string;
  from_run_id: string;
  to_session_id?: string | undefined;
  objective: string;
  referenced_node_ids: string[];
  created_at: string;
}

interface TimelineEvent {
  id: string;
  kind: "context_pack" | "handoff_pack" | "artifact_relationship" | "trace_span";
  title: string;
  at: string;
  run_id?: string | undefined;
  context_pack_id?: string | undefined;
  handoff_pack_id?: string | undefined;
  relationship_id?: string | undefined;
  span_id?: string | undefined;
  span_kind?: TraceSpan["kind"] | undefined;
  parent_span_id?: string | undefined;
  node_ids: string[];
  summary?: string | undefined;
  metrics: Record<string, number | string | boolean>;
}

async function getCachedPromptSegment(input: CachedPromptSegmentInput): Promise<{
  segment: PromptSegment;
  cache: {
    key: string;
    hit: boolean;
  };
}> {
  const key = createCacheKey({
    layer: "prompt_segment",
    templateId: input.template.id,
    templateVersion: input.template.version
  });
  const cached = input.cache.get<PromptSegment>("prompt_segment", key);

  await runTracedSpan(input.traceStore, input.request, {
    name: "Prompt Segment Cache Lookup",
    kind: "cache",
    attributes: {
      layer: "prompt_segment",
      key,
      hit: cached.hit,
      templateId: input.template.id,
      templateVersion: input.template.version
    }
  });

  if (cached.hit) {
    return {
      segment: cached.value,
      cache: {
        key,
        hit: true
      }
    };
  }

  const segment = renderPromptSegment(input.template);
  input.cache.set("prompt_segment", key, segment, {
    tags: createCacheTags("prompt", "template", `template:${input.template.id}`, `template_version:${input.template.version}`)
  });

  return {
    segment,
    cache: {
      key,
      hit: false
    }
  };
}

async function getCachedAgentResponse(input: CachedAgentResponseInput): Promise<CachedAgentResponse> {
  const key = createCacheKey({
    layer: "response",
    agentId: input.agentId,
    objective: input.objective,
    task: input.task,
    modelProfile: input.modelProfile,
    contextPack: input.contextPack
      ? {
          id: input.contextPack.id,
          templateId: input.contextPack.template_id,
          nodeIds: input.contextPack.node_ids,
          evidence: input.contextPack.evidence.map((item) => ({
            nodeId: item.node_id,
            score: item.score
          })),
          summary: asCacheSafeRecord(input.contextPack.metadata.context_summary)
        }
      : undefined
  });
  const cached = input.cache.get<CachedAgentResponse["value"]>("response", key);

  await runTracedSpan(input.traceStore, input.request, {
    name: "Agent Response Cache Lookup",
    kind: "cache",
    attributes: {
      layer: "response",
      key,
      hit: cached.hit,
      agentId: input.agentId,
      contextPackId: input.contextPack?.id,
      modelProfile: input.modelProfile,
      reasoningEffort: input.profileDecision?.selected_profile.reasoning_effort
    }
  });

  if (cached.hit) {
    return {
      value: cached.value,
      cache: {
        layer: "response",
        key,
        hit: true
      }
    };
  }

  const value = await runTracedSpan(
    input.traceStore,
    input.request,
    {
      name: "Agent Runtime Response",
      kind: "model_call",
      attributes: {
        agentId: input.agentId,
        contextPackId: input.contextPack?.id,
        modelProfile: input.modelProfile,
        reasoningEffort: input.profileDecision?.selected_profile.reasoning_effort,
        budgetPressure: input.profileDecision?.budget.budget_pressure,
        deterministic: true
      }
    },
    () => createAgentResponse(input)
  );
  input.cache.set("response", key, value, {
    tags: createCacheTags(
      "response",
      "agent",
      `agent:${input.agentId}`,
      `model:${input.modelProfile}`,
      input.contextPack ? `context_pack:${input.contextPack.id}` : undefined,
      ...(input.contextPack?.node_ids.map((nodeId) => `node:${nodeId}`) ?? [])
    )
  });

  return {
    value,
    cache: {
      layer: "response",
      key,
      hit: false
    }
  };
}

function createAgentResponse(input: CachedAgentResponseInput): CachedAgentResponse["value"] {
  const runId = createCacheKey({
    run: "agent_response",
    agentId: input.agentId,
    objective: input.objective,
    contextPackId: input.contextPack?.id,
    modelProfile: input.modelProfile
  }).slice(0, 16);
  const summary = asCacheSafeRecord(input.contextPack?.metadata.context_summary);
  const summaryContent = typeof summary?.content === "string" ? summary.content : undefined;
  const evidencePreview = input.contextPack?.evidence
    .slice(0, 3)
    .map((item) => `${item.node_id}: ${item.snippet}`)
    .join("\n");
  const content = [
    `Objective: ${input.objective}`,
    `Agent: ${input.agentId}`,
    `Model profile: ${input.modelProfile}`,
    input.profileDecision ? `Reasoning effort: ${input.profileDecision.selected_profile.reasoning_effort}` : undefined,
    input.profileDecision ? `Routing reasons: ${input.profileDecision.routing_reasons.slice(0, 5).join(", ")}` : undefined,
    summaryContent ? `Context summary:\n${summaryContent}` : undefined,
    evidencePreview ? `Evidence preview:\n${evidencePreview}` : undefined
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  const response: CachedAgentResponse["value"] = {
    run_id: `run_${runId}`,
    content,
    referenced_node_ids: input.contextPack?.node_ids ?? [],
    model_profile: input.modelProfile
  };

  if (input.contextPack) {
    response.context_pack_id = input.contextPack.id;
  }
  if (input.profileDecision) {
    response.profile_reasoning_effort = input.profileDecision.selected_profile.reasoning_effort;
  }

  return response;
}

async function getCachedContextSummary(input: CachedContextSummaryInput): Promise<CachedContextSummary> {
  const key = createCacheKey({
    layer: "summary",
    objective: input.pack.objective,
    templateId: input.pack.template_id,
    nodeIds: input.pack.node_ids,
    evidence: input.pack.evidence.map((item) => ({
      nodeId: item.node_id,
      score: item.score,
      snippet: item.snippet
    })),
    decisions: input.pack.decisions,
    blockers: input.pack.blockers
  });
  const cached = input.cache.get<CachedContextSummary["value"]>("summary", key);

  await runTracedSpan(input.traceStore, input.request, {
    name: "Context Summary Cache Lookup",
    kind: "cache",
    attributes: {
      layer: "summary",
      key,
      hit: cached.hit,
      templateId: input.pack.template_id,
      nodeCount: input.pack.node_ids.length,
      evidenceCount: input.pack.evidence.length
    }
  });

  if (cached.hit) {
    return {
      value: cached.value,
      cache: {
        key,
        hit: true
      }
    };
  }

  const value = createContextSummary(input.pack);
  input.cache.set("summary", key, value, {
    tags: createCacheTags(
      "summary",
      "context",
      input.pack.template_id ? `template:${input.pack.template_id}` : undefined,
      ...input.pack.node_ids.map((nodeId) => `node:${nodeId}`)
    )
  });

  return {
    value,
    cache: {
      key,
      hit: false
    }
  };
}

function createContextSummary(pack: CachedContextSummaryInput["pack"]): CachedContextSummary["value"] {
  const topEvidence = pack.evidence.slice(0, 3);
  const evidenceText = topEvidence.map((item) => `${item.node_id}: ${item.snippet}`).join(" | ");
  const content = [
    `Objective: ${pack.objective}`,
    `Template: ${pack.template_id ?? "none"}`,
    `Nodes: ${pack.node_ids.length}`,
    `Evidence: ${evidenceText || "none"}`,
    `Decisions: ${pack.decisions.length}`,
    `Blockers: ${pack.blockers.length}`
  ].join("\n");

  return {
    title: `Summary for ${pack.objective}`,
    content,
    evidence_node_ids: topEvidence.map((item) => item.node_id),
    decision_count: pack.decisions.length,
    blocker_count: pack.blockers.length
  };
}

function withContextSummary<T extends { metadata: Record<string, unknown> }>(
  pack: T,
  summary: CachedContextSummary
): T {
  return {
    ...pack,
    metadata: {
      ...pack.metadata,
      context_summary: summary.value,
      summary_cache: {
        layer: "summary",
        key: summary.cache.key,
        hit: summary.cache.hit
      }
    }
  };
}

function createHandoffRelationships(
  contextPacks: readonly ContextPack[],
  handoffPacks: readonly HandoffPack[]
): HandoffRelationship[] {
  const contextsById = new Map(contextPacks.map((pack) => [pack.id, pack]));
  return handoffPacks.flatMap((handoffPack) => {
    const contextPackId = getSourceContextPackId(handoffPack) ?? inferSourceContextPackId(handoffPack, contextPacks);
    if (!contextPackId || !contextsById.has(contextPackId)) {
      return [];
    }

    return [toHandoffRelationship(contextPackId, handoffPack)];
  });
}

function inferSourceContextPackId(
  handoffPack: HandoffPack,
  contextPacks: readonly ContextPack[]
): string | undefined {
  const referencedNodeIds = new Set(handoffPack.referenced_node_ids);
  return contextPacks.find(
    (pack) =>
      pack.objective === handoffPack.objective &&
      handoffPack.referenced_node_ids.length > 0 &&
      handoffPack.referenced_node_ids.every((nodeId) => pack.node_ids.includes(nodeId)) &&
      pack.created_at <= handoffPack.created_at &&
      referencedNodeIds.size <= pack.node_ids.length
  )?.id;
}

function getSourceContextPackId(pack: HandoffPack): string | undefined {
  const contextPackId = pack.metadata.context_pack_id;
  return typeof contextPackId === "string" && contextPackId.length > 0 ? contextPackId : undefined;
}

function toHandoffRelationship(contextPackId: string, handoffPack: HandoffPack): HandoffRelationship {
  const relationship: HandoffRelationship = {
    id: `relationship:${contextPackId}:handoff:${handoffPack.id}`,
    context_pack_id: contextPackId,
    context_artifact_id: `artifact:context:${contextPackId}`,
    handoff_pack_id: handoffPack.id,
    handoff_artifact_id: `artifact:handoff:${handoffPack.id}`,
    from_run_id: handoffPack.from_run_id,
    objective: handoffPack.objective,
    referenced_node_ids: handoffPack.referenced_node_ids,
    created_at: handoffPack.created_at
  };

  if (handoffPack.to_session_id) {
    relationship.to_session_id = handoffPack.to_session_id;
  }

  return relationship;
}

function createTimelineEvents(input: {
  contextPacks: readonly ContextPack[];
  handoffPacks: readonly HandoffPack[];
  relationships: readonly HandoffRelationship[];
  spans: readonly TraceSpan[];
  runId: string | undefined;
  limit: number;
}): TimelineEvent[] {
  const relationshipContextIds = new Set(
    input.relationships
      .filter((relationship) => !input.runId || relationship.from_run_id === input.runId)
      .map((relationship) => relationship.context_pack_id)
  );
  const contextRunIds = new Map(
    input.relationships.map((relationship) => [relationship.context_pack_id, relationship.from_run_id])
  );
  const contextEvents = input.contextPacks
    .filter((pack) => !input.runId || getContextSourceRunId(pack) === input.runId || relationshipContextIds.has(pack.id))
    .map((pack) => toContextTimelineEvent(pack, getContextSourceRunId(pack) ?? contextRunIds.get(pack.id)));
  const handoffEvents = input.handoffPacks
    .filter((pack) => !input.runId || pack.from_run_id === input.runId)
    .map(toHandoffTimelineEvent);
  const relationshipEvents = input.relationships
    .filter((relationship) => !input.runId || relationship.from_run_id === input.runId)
    .map(toRelationshipTimelineEvent);
  const spanEvents = input.spans.map(toSpanTimelineEvent);

  return [...contextEvents, ...handoffEvents, ...relationshipEvents, ...spanEvents]
    .sort((a, b) => b.at.localeCompare(a.at) || eventKindRank(a.kind) - eventKindRank(b.kind))
    .slice(0, input.limit);
}

function toContextTimelineEvent(pack: ContextPack, runId: string | undefined): TimelineEvent {
  return {
    id: `timeline:context:${pack.id}`,
    kind: "context_pack",
    title: "Context Pack",
    at: pack.created_at,
    run_id: runId,
    context_pack_id: pack.id,
    node_ids: pack.node_ids,
    summary: pack.objective,
    metrics: {
      nodes: pack.node_ids.length,
      evidence: pack.evidence.length,
      budget: pack.token_budget
    }
  };
}

function toHandoffTimelineEvent(pack: HandoffPack): TimelineEvent {
  return {
    id: `timeline:handoff:${pack.id}`,
    kind: "handoff_pack",
    title: "Handoff Pack",
    at: pack.created_at,
    run_id: pack.from_run_id,
    context_pack_id: getSourceContextPackId(pack),
    handoff_pack_id: pack.id,
    node_ids: pack.referenced_node_ids,
    summary: pack.current_status,
    metrics: {
      refs: pack.referenced_node_ids.length,
      actions: pack.recommended_next_actions.length,
      loops: pack.open_loops.length
    }
  };
}

function toRelationshipTimelineEvent(relationship: HandoffRelationship): TimelineEvent {
  return {
    id: `timeline:${relationship.id}`,
    kind: "artifact_relationship",
    title: "Artifact Link",
    at: relationship.created_at,
    run_id: relationship.from_run_id,
    context_pack_id: relationship.context_pack_id,
    handoff_pack_id: relationship.handoff_pack_id,
    relationship_id: relationship.id,
    node_ids: relationship.referenced_node_ids,
    summary: relationship.objective,
    metrics: {
      refs: relationship.referenced_node_ids.length,
      edge: "handed_off_to"
    }
  };
}

function toSpanTimelineEvent(span: TraceSpan): TimelineEvent {
  const event: TimelineEvent = {
    id: `timeline:span:${span.id}`,
    kind: "trace_span",
    title: span.name,
    at: span.started_at,
    run_id: span.run_id,
    span_id: span.id,
    span_kind: span.kind,
    node_ids: extractStringList(span.attributes.nodeIds ?? span.attributes.seedNodeIds ?? span.attributes.referenced_node_ids),
    metrics: {
      kind: span.kind,
      ok: span.attributes.ok !== false
    }
  };

  if (span.parent_span_id) {
    event.parent_span_id = span.parent_span_id;
  }

  return event;
}

function withRunMetadata<T extends { metadata: Record<string, unknown> }>(pack: T, request: FastifyRequest): T {
  return {
    ...pack,
    metadata: {
      ...pack.metadata,
      source_run_id: getRequestRunId(request)
    }
  };
}

function getRequestRunId(request: FastifyRequest): string {
  return String(request.headers["x-neuralmap-run-id"] ?? "http");
}

function getContextSourceRunId(pack: ContextPack): string | undefined {
  const sourceRunId = pack.metadata.source_run_id;
  return typeof sourceRunId === "string" && sourceRunId.length > 0 ? sourceRunId : undefined;
}

function eventKindRank(kind: TimelineEvent["kind"]): number {
  switch (kind) {
    case "trace_span":
      return 0;
    case "context_pack":
      return 1;
    case "artifact_relationship":
      return 2;
    case "handoff_pack":
      return 3;
  }
}

function extractStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseCacheTags(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const tags = createCacheTags(...value.split(","));
  return tags.length > 0 ? tags : undefined;
}

function createCacheTags(...tags: Array<string | undefined>): string[] {
  return [...new Set(tags.map((tag) => tag?.trim()).filter((tag): tag is string => Boolean(tag)))].sort();
}

function createCacheFilter(input: {
  layer?: CacheLayerName | undefined;
  key?: string | undefined;
  keyPrefix?: string | undefined;
  tags?: string[] | undefined;
  includeExpired?: boolean | undefined;
  limit?: number | undefined;
}): CacheInspectFilter {
  const filter: CacheInspectFilter = {};

  if (input.layer) {
    filter.layer = input.layer;
  }
  if (input.key) {
    filter.key = input.key;
  }
  if (input.keyPrefix) {
    filter.keyPrefix = input.keyPrefix;
  }
  if (input.tags?.length) {
    filter.tags = createCacheTags(...input.tags);
  }
  if (input.includeExpired !== undefined) {
    filter.includeExpired = input.includeExpired;
  }
  if (input.limit !== undefined) {
    filter.limit = input.limit;
  }

  return filter;
}

function asCacheSafeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

async function getCachedNeighborhood(input: CachedNeighborhoodInput): Promise<GraphNeighborhood> {
  const key = createCacheKey({
    layer: "graph_neighborhood",
    dataMode: input.dataMode,
    seedNodeIds: input.seedNodeIds,
    hops: input.hops,
    minConfidence: input.minConfidence,
    edgeTypeBoosts: input.edgeTypeBoosts ?? {}
  });
  const cached = input.cache.get<GraphNeighborhood>("graph_neighborhood", key);

  await runTracedSpan(input.traceStore, input.request, {
    name: "Graph Neighborhood Cache Lookup",
    kind: "cache",
    attributes: {
      layer: "graph_neighborhood",
      key,
      hit: cached.hit,
      ...(input.attributes ?? {})
    }
  });

  if (cached.hit) {
    return cached.value;
  }

  const neighborhood = await runTracedSpan(
    input.traceStore,
    input.request,
    {
      name: "Graph Expansion",
      kind: "graph_expansion",
      attributes: {
        seedCount: input.seedNodeIds.length,
        hops: input.hops,
        minEdgeConfidence: input.minConfidence,
        ...(input.attributes ?? {})
      }
    },
    () =>
      expandGraphNeighborhood(input.seedNodeIds, input.memory, createExpansionOptions(input))
  );

  input.cache.set("graph_neighborhood", key, neighborhood, {
    tags: createCacheTags(
      "graph",
      "neighborhood",
      `mode:${input.dataMode}`,
      ...input.seedNodeIds.map((nodeId) => `node:${nodeId}`)
    )
  });
  return neighborhood;
}

function createExpansionOptions(input: CachedNeighborhoodInput) {
  const options: {
    hops: number;
    minConfidence: number;
    edgeTypeBoosts?: Partial<Record<GraphEdge["type"], number>>;
  } = {
    hops: input.hops,
    minConfidence: input.minConfidence
  };

  if (input.edgeTypeBoosts) {
    options.edgeTypeBoosts = input.edgeTypeBoosts;
  }

  return options;
}

function invalidateGraphCaches(cache: CacheStore): number {
  return cache.invalidate({ tags: ["graph"] }).count;
}

function filterSimulationMemory(memory: GraphMemory, simulationId: string, sessionNodeId: string): GraphMemory {
  const simulationPrefix = sessionNodeId.replace(/:session:.+$/u, "");
  const nodeIds = new Set<string>();
  const nodes = memory.nodes.filter((node) => {
    const metadataSimulationId = getMetadataString(node.metadata, "simulation_id");
    const belongsToSimulation = metadataSimulationId === simulationId || node.id.startsWith(`${simulationPrefix}:`);

    if (belongsToSimulation) {
      nodeIds.add(node.id);
    }

    return belongsToSimulation;
  });

  if (nodes.length === 0) {
    return { nodes: memory.nodes.filter((node) => node.id === sessionNodeId), edges: [] };
  }

  return {
    nodes,
    edges: memory.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  };
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

async function runTracedSpan<T>(
  traceStore: TraceStore,
  request: FastifyRequest,
  input: {
    name: string;
    kind: TraceSpan["kind"];
    attributes?: Record<string, unknown>;
  },
  operation: () => T | Promise<T> = () => undefined as T
): Promise<T> {
  const traceInput: StartTraceSpanInput = {
    runId: String(request.headers["x-neuralmap-run-id"] ?? "http"),
    name: input.name,
    kind: input.kind
  };
  if (request.neuralMapTraceHandle?.spanId) {
    traceInput.parentSpanId = request.neuralMapTraceHandle.spanId;
  }
  if (input.attributes) {
    traceInput.attributes = input.attributes;
  }

  const span = startTraceSpan(traceStore, traceInput);

  try {
    const result = await operation();
    span.end({ ok: true });
    return result;
  } catch (error) {
    span.end({
      ok: false,
      error: error instanceof Error ? error.message : "unknown_error"
    });
    throw error;
  }
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

const simulationEventSchema = z.object({
  simulation_id: z.string().min(1),
  session_id: z.string().min(1),
  event_id: z.string().min(1),
  content: z.string().min(1),
  actor_id: z.string().min(1).optional(),
  actor_name: z.string().min(1).optional(),
  previous_event_id: z.string().min(1).optional(),
  occurred_at: z.string().datetime().optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  participants: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        role: z.string().min(1).optional()
      })
    )
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const simulationContextRequestSchema = z.object({
  simulation_id: z.string().min(1),
  session_id: z.string().min(1),
  new_session_id: z.string().min(1).optional(),
  agent_id: z.string().min(1).default("simulation-agent"),
  objective: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  token_budget: z.number().int().positive().default(4000)
});
