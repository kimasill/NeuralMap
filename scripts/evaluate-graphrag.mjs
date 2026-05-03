import { performance } from "node:perf_hooks";

const baseUrl = process.env.NEURALMAP_API_URL ?? process.argv[2] ?? "http://localhost:4317";
const runId = `eval-graphrag-${Date.now()}`;
const headers = {
  "content-type": "application/json",
  "x-neuralmap-run-id": runId
};

const result = {
  base_url: baseUrl,
  run_id: runId,
  ok: false,
  checks: {},
  performance: {},
  observations: []
};

try {
  const health = await timed("health", () => request("GET", "/health"));
  result.checks.health = {
    ok: health.value.ok === true,
    graph_mode: health.value.graph_mode,
    latency_ms: health.ms
  };

  const beforeGraph = await timed("graph_before", () => request("GET", "/workbench/graph/subgraph"));
  const beforeNodes = beforeGraph.value.nodes.length;
  const beforeEdges = beforeGraph.value.edges.length;

  const ticketId = `external-eval-${Date.now()}`;
  const ingestPayload = {
    id: ticketId,
    title: "External GraphRAG evaluation ticket",
    url: `eval://tickets/${ticketId}`,
    status: "open",
    labels: ["eval", "blocking"],
    body: [
      "Evaluate whether NeuralMap can mutate graph memory for a GraphRAG query.",
      "The test references packages/core/src/retrieval.ts and docs/progress/phase-4.md.",
      "A successful run should create a ticket neuron and reference synapses to code or docs nodes."
    ].join(" ")
  };
  const ingest = await timed("ingest_ticket", () => request("POST", "/ingest/ticket", ingestPayload));
  result.checks.dynamic_ingest = {
    ok: ingest.value.nodes >= 1,
    nodes_written: ingest.value.nodes,
    edges_written: ingest.value.edges,
    chunks_written: ingest.value.chunks,
    latency_ms: ingest.ms
  };

  const afterGraph = await timed("graph_after_ingest", () => request("GET", "/workbench/graph/subgraph"));
  const afterIngestNodes = afterGraph.value.nodes.length;
  const afterIngestEdges = afterGraph.value.edges.length;
  result.checks.graph_mutation = {
    ok: afterIngestNodes > beforeNodes && afterIngestEdges >= beforeEdges,
    before_nodes: beforeNodes,
    before_edges: beforeEdges,
    after_nodes: afterIngestNodes,
    after_edges: afterIngestEdges
  };

  const queryPayload = {
    query: "GraphRAG retrieval semantic vector synapse external evaluation",
    top_k: 6,
    expand_hops: 2,
    min_edge_confidence: 0.4
  };
  const coldQuery = await timed("graph_query_cold", () => request("POST", "/graph/query", queryPayload));
  const warmQuery = await timed("graph_query_warm", () => request("POST", "/graph/query", queryPayload));
  result.checks.graphrag_query = {
    ok: coldQuery.value.seeds.length > 0 && coldQuery.value.neighborhood.nodes.length >= coldQuery.value.seeds.length,
    cold_cache_hit: coldQuery.value.cache.hit,
    warm_cache_hit: warmQuery.value.cache.hit,
    seed_count: coldQuery.value.seeds.length,
    semantic_seed_count: coldQuery.value.retrieval.semantic_seed_count,
    vector_seed_count: coldQuery.value.retrieval.vector_seed_count ?? 0,
    semantic_source: coldQuery.value.retrieval.semantic_source ?? "unknown",
    neighborhood_nodes: coldQuery.value.neighborhood.nodes.length,
    neighborhood_edges: coldQuery.value.neighborhood.edges.length,
    intent: coldQuery.value.intent.kind,
    cold_latency_ms: coldQuery.ms,
    warm_latency_ms: warmQuery.ms
  };

  const composePayload = {
    objective: "Evaluate dynamic GraphRAG context assembly",
    agent_id: "external-client",
    session_id: runId,
    seed_node_ids: coldQuery.value.seeds.slice(0, 2).map((seed) => seed.node.id),
    query: queryPayload.query,
    token_budget: 9000
  };
  const context = await timed("context_compose", () => request("POST", "/context/compose", composePayload));
  const explanations = context.value.metadata?.node_explanations ?? {};
  result.checks.context_pack = {
    ok: context.value.node_ids.length > 0 && Object.keys(explanations).length > 0,
    id: context.value.id,
    nodes: context.value.node_ids.length,
    evidence: context.value.evidence.length,
    graph_expansion_explanations: Object.values(explanations).filter(
      (item) => item?.reason_kind === "graph_expansion"
    ).length,
    semantic_seed_count: context.value.metadata?.retrieval?.semantic_seed_count,
    latency_ms: context.ms
  };

  const route = await timed("model_route", () =>
    request("POST", "/model/route", {
      objective: composePayload.objective,
      task: "Judge external GraphRAG readiness and risk",
      context_pack_id: context.value.id
    })
  );
  const agentRun = await timed("agent_run", () =>
    request("POST", "/agents/main-agent/run", {
      task: "Judge external GraphRAG readiness and risk",
      context_pack_id: context.value.id
    })
  );
  result.checks.profiled_agent_run = {
    ok: Boolean(agentRun.value.profile?.selected_profile?.id),
    route_profile: route.value.selected_profile?.id,
    agent_profile: agentRun.value.profile?.selected_profile?.id,
    reasoning_effort: agentRun.value.profile?.selected_profile?.reasoning_effort,
    route_latency_ms: route.ms,
    agent_latency_ms: agentRun.ms
  };

  const handoff = await timed("handoff", () =>
    request("POST", "/context/handoff", {
      from_run_id: agentRun.value.id,
      context_pack_id: context.value.id,
      objective: composePayload.objective,
      current_status: "External evaluation completed",
      recommended_next_actions: ["Use REST API integration for external callers."]
    })
  );
  const artifacts = await timed("artifacts", () => request("GET", "/workbench/artifacts?limit=10"));
  const relationship = artifacts.value.relationships.find(
    (item) => item.context_pack_id === context.value.id && item.handoff_pack_id === handoff.value.id
  );
  result.checks.artifact_synapse = {
    ok: Boolean(relationship),
    handoff_id: handoff.value.id,
    relationship_id: relationship?.id,
    latency_ms: handoff.ms + artifacts.ms
  };

  result.performance.graph_query_cached = await benchmark(30, () => request("POST", "/graph/query", queryPayload));
  result.performance.model_route = await benchmark(20, () =>
    request("POST", "/model/route", {
      objective: composePayload.objective,
      task: "Small readiness check",
      context_pack_id: context.value.id
    })
  );
  result.performance.agent_run_cached = await benchmark(20, () =>
    request("POST", "/agents/main-agent/run", {
      task: "Judge external GraphRAG readiness and risk",
      context_pack_id: context.value.id
    })
  );

  const finalGraph = await request("GET", "/workbench/graph/subgraph");
  result.checks.runtime_artifact_mutation = {
    ok: finalGraph.nodes.length > afterIngestNodes,
    after_ingest_nodes: afterIngestNodes,
    final_nodes: finalGraph.nodes.length,
    final_edges: finalGraph.edges.length
  };

  result.ok = Object.values(result.checks).every((check) => check.ok !== false);
} catch (error) {
  result.error = error instanceof Error ? error.message : "unknown_error";
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  }

  return value;
}

async function timed(name, operation) {
  const started = performance.now();
  const value = await operation();
  const ms = performance.now() - started;

  result.observations.push({
    name,
    ms: Number(ms.toFixed(2))
  });

  return {
    value,
    ms: Number(ms.toFixed(2))
  };
}

async function benchmark(iterations, operation) {
  const values = [];

  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    values.push(performance.now() - started);
  }

  values.sort((a, b) => a - b);
  return {
    iterations,
    min_ms: rounded(values[0]),
    p50_ms: rounded(percentile(values, 0.5)),
    p95_ms: rounded(percentile(values, 0.95)),
    max_ms: rounded(values[values.length - 1]),
    avg_ms: rounded(values.reduce((sum, value) => sum + value, 0) / values.length)
  };
}

function percentile(values, ratio) {
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index];
}

function rounded(value) {
  return Number(value.toFixed(2));
}
