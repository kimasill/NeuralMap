import type { ContextPack, GraphEdge, GraphNode, HandoffPack, TraceSpan } from "@neuralmap/schema";

import { createDbClient } from "../client.js";
import { createGraphStore } from "../graph-store.js";
import { createDbTraceStore, persistTraceSpan, type DbTraceStore } from "../trace-store.js";

const requireDatabase = process.argv.includes("--require");

if (!process.env.DATABASE_URL) {
  const result = {
    ok: false,
    skipped: true,
    reason: "DATABASE_URL is not configured."
  };
  console.log(JSON.stringify(result, null, 2));

  if (requireDatabase) {
    process.exitCode = 1;
  }
} else {
  const { db, client } = createDbClient();

  try {
    const result = await runSmoke(db);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          skipped: false,
          error: error instanceof Error ? error.message : "unknown_error"
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

async function runSmoke(db: ReturnType<typeof createDbClient>["db"]): Promise<Record<string, unknown>> {
  const store = createGraphStore(db);
  const fallback = createEmptyTraceStore();
  const traceStore = createDbTraceStore(db, fallback);
  const now = new Date().toISOString();
  const runId = "phase1-db-smoke-run";
  const repositoryNode: GraphNode = {
    id: "smoke:phase1:repository",
    type: "Repository",
    title: "Phase 1 DB Smoke Repository",
    content_ref: "smoke://phase1/repository",
    summary: "Verifies DB-backed graph memory can persist and reload repository context.",
    source_system: "runtime",
    trust_score: 0.9,
    freshness_score: 1,
    importance_score: 0.8,
    created_at: now,
    updated_at: now,
    metadata: {
      smoke: true,
      phase: "phase-1"
    }
  };
  const contextNode: GraphNode = {
    id: "smoke:phase1:context",
    type: "Artifact",
    title: "Phase 1 DB Smoke Context",
    content_ref: "smoke://phase1/context",
    summary: "Verifies Context and Handoff Pack source nodes can be read from Postgres.",
    source_system: "runtime",
    trust_score: 0.86,
    freshness_score: 1,
    importance_score: 0.75,
    created_at: now,
    updated_at: now,
    metadata: {
      smoke: true,
      phase: "phase-1"
    }
  };
  const edge: GraphEdge = {
    id: "edge:smoke:phase1:repository:references:context",
    from: repositoryNode.id,
    to: contextNode.id,
    type: "references",
    weight: 0.75,
    confidence: 0.9,
    created_at: now,
    metadata: {
      smoke: true
    }
  };

  await store.upsertGraph({
    nodes: [repositoryNode, contextNode],
    edges: [edge],
    chunks: [
      {
        id: "smoke:phase1:context:chunk:0",
        node_id: contextNode.id,
        source_uri: contextNode.content_ref ?? contextNode.id,
        ordinal: 0,
        content: contextNode.summary ?? contextNode.title,
        content_hash: "phase1-db-smoke-context",
        metadata: {
          smoke: true
        }
      }
    ]
  });

  const contextPack: ContextPack = {
    id: "ctx_phase1_db_smoke",
    objective: "Verify Phase 1 DB-backed memory loop",
    agent_id: "db-smoke-agent",
    session_id: "db-smoke-session",
    node_ids: [repositoryNode.id, contextNode.id],
    evidence: [
      {
        node_id: contextNode.id,
        snippet: contextNode.summary ?? contextNode.title,
        score: 0.86
      }
    ],
    decisions: ["DB-backed graph memory smoke is runnable."],
    blockers: [],
    template_id: "validation:default",
    token_budget: 1200,
    metadata: {
      smoke: true
    },
    created_at: now
  };
  const handoffPack: HandoffPack = {
    id: "handoff_phase1_db_smoke",
    from_run_id: runId,
    to_session_id: "db-smoke-next-session",
    objective: contextPack.objective,
    current_status: "DB-backed graph, context, handoff, and trace persistence were exercised.",
    key_decisions: contextPack.decisions,
    referenced_node_ids: contextPack.node_ids,
    open_loops: [],
    blockers: [],
    constraints: ["Keep source node references attached."],
    recommended_next_actions: ["Run API and Workbench against DATABASE_URL."],
    metadata: {
      smoke: true,
      context_pack_id: contextPack.id
    },
    created_at: now
  };
  const span: TraceSpan = {
    id: "span_phase1_db_smoke",
    run_id: runId,
    name: "Phase 1 DB Smoke",
    kind: "validation",
    started_at: now,
    ended_at: now,
    attributes: {
      smoke: true,
      nodes: contextPack.node_ids.length
    }
  };

  await store.saveContextPack(contextPack);
  await store.saveHandoffPack(handoffPack);
  await store.saveGraphDeltaCommit({
    idempotency_key: "smoke:phase1:graph-delta:v1",
    request_hash: "smoke-request-hash",
    profile_id: "simulation-memory",
    response: {
      accepted: true,
      idempotency_key: "smoke:phase1:graph-delta:v1",
      request_hash: "smoke-request-hash"
    },
    scope: {
      tenant_id: "smoke"
    },
    metadata: {
      smoke: true
    }
  });
  await persistTraceSpan(db, span);

  const [memory, loadedContextPack, loadedHandoffPack, loadedGraphDeltaCommit, spans] = await Promise.all([
    store.getMemory(),
    store.getContextPack(contextPack.id),
    store.getHandoffPack(handoffPack.id),
    store.getGraphDeltaCommit("smoke:phase1:graph-delta:v1"),
    traceStore.listSpans(runId)
  ]);
  const vectorSeeds = await store.searchVectorSeeds(
    {
      query: "Phase 1 DB Smoke Context",
      top_k: 20,
      expand_hops: 1,
      min_edge_confidence: 0.4
    },
    20
  );
  const nodeIds = new Set(memory.nodes.map((node) => node.id));

  assert(nodeIds.has(repositoryNode.id), "repository smoke node was not loaded from DB");
  assert(nodeIds.has(contextNode.id), "context smoke node was not loaded from DB");
  assert(Boolean(loadedContextPack), "context pack was not loaded from DB");
  assert(Boolean(loadedHandoffPack), "handoff pack was not loaded from DB");
  assert(Boolean(loadedGraphDeltaCommit), "graph delta commit was not loaded from DB");
  assert(loadedGraphDeltaCommit?.request_hash === "smoke-request-hash", "graph delta commit request hash did not round-trip");
  assert(spans.some((candidate) => candidate.id === span.id), "trace span was not loaded from DB");
  assert(vectorSeeds.some((candidate) => candidate.node.id === contextNode.id), "pgvector seed search did not return smoke context node");

  return {
    ok: true,
    skipped: false,
    mode: "database",
    graph_nodes_loaded: memory.nodes.length,
    context_pack_id: loadedContextPack?.id,
    handoff_pack_id: loadedHandoffPack?.id,
    graph_delta_commit_id: loadedGraphDeltaCommit?.idempotency_key,
    trace_spans_loaded: spans.length,
    vector_seed_count: vectorSeeds.length,
    vector_seed_sources: [...new Set(vectorSeeds.map((candidate) => candidate.source))]
  };
}

function createEmptyTraceStore(): DbTraceStore {
  return {
    addSpan() {
      return undefined;
    },
    updateSpan() {
      return undefined;
    },
    listSpans() {
      return [];
    },
    clear() {
      return 0;
    }
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
