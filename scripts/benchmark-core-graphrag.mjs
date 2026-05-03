import { performance } from "node:perf_hooks";

import {
  composeContextPack,
  expandGraphNeighborhood,
  rankSeedNodes
} from "../packages/core/dist/index.js";

const sizes = [100, 1000, 5000];
const iterations = Number(process.env.NEURALMAP_BENCH_ITERATIONS ?? 20);
const query = "semantic graph context vector retrieval synapse";
const output = {
  ok: true,
  iterations,
  sizes: []
};

for (const size of sizes) {
  const memory = createSyntheticMemory(size);
  const seedRequest = {
    query,
    top_k: 8,
    expand_hops: 2,
    min_edge_confidence: 0.4
  };
  const composeRequest = {
    objective: "Benchmark GraphRAG context composition",
    agent_id: "bench-agent",
    session_id: `bench-${size}`,
    seed_node_ids: ["node:0"],
    query,
    token_budget: 12000
  };

  const rank = await benchmark(iterations, () => rankSeedNodes(seedRequest, memory.nodes));
  const seeds = rankSeedNodes(seedRequest, memory.nodes).map((candidate) => candidate.node.id);
  const expand = await benchmark(iterations, () =>
    expandGraphNeighborhood(seeds, memory, {
      hops: 2,
      minConfidence: 0.4
    })
  );
  const compose = await benchmark(iterations, () => composeContextPack(composeRequest, memory));
  const neighborhood = expandGraphNeighborhood(seeds, memory, {
    hops: 2,
    minConfidence: 0.4
  });
  const pack = composeContextPack(composeRequest, memory);

  output.sizes.push({
    nodes: memory.nodes.length,
    edges: memory.edges.length,
    rank_seed_nodes_ms: rank,
    expand_graph_neighborhood_ms: expand,
    compose_context_pack_ms: compose,
    selected_seed_count: seeds.length,
    neighborhood_nodes: neighborhood.nodes.length,
    neighborhood_edges: neighborhood.edges.length,
    context_pack_nodes: pack.node_ids.length,
    context_pack_evidence: pack.evidence.length
  });
}

console.log(JSON.stringify(output, null, 2));

async function benchmark(count, operation) {
  const values = [];

  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    operation();
    values.push(performance.now() - started);
  }

  values.sort((a, b) => a - b);
  return {
    min: rounded(values[0]),
    p50: rounded(percentile(values, 0.5)),
    p95: rounded(percentile(values, 0.95)),
    max: rounded(values[values.length - 1]),
    avg: rounded(values.reduce((sum, value) => sum + value, 0) / values.length)
  };
}

function createSyntheticMemory(size) {
  const now = new Date().toISOString();
  const nodes = Array.from({ length: size }, (_, index) => {
    const type = index % 11 === 0 ? "Ticket" : index % 7 === 0 ? "Decision" : index % 5 === 0 ? "Document" : "CodeFile";
    const isRelevant = index % 13 === 0 || index < 20;

    return {
      id: `node:${index}`,
      type,
      title: `${type} ${index}${isRelevant ? " semantic graph context vector retrieval" : ""}`,
      content_ref: `bench://node/${index}`,
      summary: isRelevant
        ? `Synthetic neuron ${index} for graph context retrieval with vector semantic synapse hints.`
        : `Synthetic neuron ${index} with supporting project metadata.`,
      source_system: index % 3 === 0 ? "repo" : "ticket",
      trust_score: 0.75 + (index % 10) / 100,
      freshness_score: 0.78 + (index % 8) / 100,
      importance_score: 0.6 + (index % 20) / 100,
      created_at: now,
      updated_at: now,
      metadata: {
        path: `synthetic/${index}.ts`
      }
    };
  });
  const edges = [];

  for (let index = 0; index < size; index += 1) {
    addEdge(edges, index, (index + 1) % size, "references", now);
    if (index + 7 < size) {
      addEdge(edges, index, index + 7, "depends_on", now);
    }
    if (index % 20 === 0 && index + 20 < size) {
      addEdge(edges, index, index + 20, "blocks", now);
    }
  }

  return {
    nodes,
    edges
  };
}

function addEdge(edges, from, to, type, now) {
  edges.push({
    id: `edge:${from}:${type}:${to}`,
    from: `node:${from}`,
    to: `node:${to}`,
    type,
    weight: type === "blocks" ? 0.9 : 0.65,
    confidence: type === "depends_on" ? 0.72 : 0.84,
    created_at: now,
    metadata: {}
  });
}

function percentile(values, ratio) {
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index];
}

function rounded(value) {
  return Number(value.toFixed(2));
}
