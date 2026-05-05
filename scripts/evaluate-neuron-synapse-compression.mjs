import { performance } from "node:perf_hooks";

import {
  compileGraphDelta,
  composeContextPack,
  currentGraphView,
  queryGraphNeurons,
  traverseGraph
} from "../packages/core/dist/index.js";

const eventCount = Number(process.env.NEURALMAP_NEURON_EVAL_EVENTS ?? 240);
const iterations = Number(process.env.NEURALMAP_NEURON_EVAL_ITERATIONS ?? 25);
const now = new Date().toISOString();
const memory = {
  nodes: [],
  edges: []
};
const transcript = [];
const result = {
  ok: false,
  event_count: eventCount,
  iterations,
  checks: {},
  token_estimate: {},
  graph: {},
  performance: {}
};

const startedBuild = performance.now();
seedCharacter();
for (let index = 1; index <= eventCount; index += 1) {
  applyTurn(index);
}
result.performance.graph_build_ms = rounded(performance.now() - startedBuild);

const currentView = timedSync("current_view", () =>
  currentGraphView(
    {
      profile_id: "simulation-memory",
      label: "State",
      current_key: ["properties.owner_id", "properties.state_type"],
      filters: {
        owner_id: "char:mina"
      }
    },
    memory
  )
);
const neuronQuery = timedSync("neuron_query", () =>
  queryGraphNeurons(
    {
      profile_id: "simulation-memory",
      labels: ["State"],
      query: "Mina current navy coat silver key promise trust",
      top_k: 12
    },
    memory
  )
);
const traversal = timedSync("traverse", () =>
  traverseGraph(
    {
      seed_node_ids: ["state:mina:wearing:240"],
      profile_id: "simulation-memory",
      max_hops: 2,
      include_synapse_types: ["HAS_CURRENT_STATE", "SUPERSEDES"]
    },
    memory
  )
);
const contextPackTiming = timedSync("context_compose", () =>
  composeContextPack(
    {
      objective: "Continue the agent scene while preserving current canonical state and durable promises.",
      agent_id: "simulation-agent",
      session_id: "eval-neuron-synapse",
      profile_id: "simulation-memory",
      query: "What should the agent remember about Mina, the current coat, the silver key, and trust?",
      token_budget: 2200,
      seed_node_ids: [],
      context_policy: {
        sections: ["canonical_state", "relevant_history", "open_threads"]
      }
    },
    memory,
    {
      maxEvidenceItems: 10
    }
  )
);
const contextPack = contextPackTiming.value;

const rawTranscript = transcript.map((turn) => `${turn.actor}: ${turn.text}`).join("\n");
const compressedContext = [
  contextPack.objective,
  ...contextPack.evidence.map((item) => item.snippet),
  ...Object.entries(contextPack.sections ?? {}).flatMap(([section, items]) =>
    items.map((item) => `${section}: ${item.snippet}`)
  )
].join("\n");
const rawTokens = estimateTokens(rawTranscript);
const contextTokens = estimateTokens(compressedContext);
const currentItems = currentView.value.items;
const stateItems = currentItems.filter((item) => item.properties.state_type);
const currentWearing = stateItems.find((item) => item.properties.state_type === "Wearing");
const currentPromise = stateItems.find((item) => item.properties.state_type === "Promise");
const evidenceText = contextPack.evidence.map((item) => item.snippet).join("\n").toLowerCase();

result.graph = {
  nodes: memory.nodes.length,
  edges: memory.edges.length,
  current_items: currentItems.length,
  context_pack_nodes: contextPack.node_ids.length,
  context_pack_evidence: contextPack.evidence.length,
  section_names: Object.keys(contextPack.sections ?? {})
};
result.token_estimate = {
  raw_transcript_tokens: rawTokens,
  compressed_context_tokens: contextTokens,
  estimated_saved_tokens: rawTokens - contextTokens,
  compression_ratio: rounded(contextTokens / rawTokens),
  token_reduction_percent: rounded(((rawTokens - contextTokens) / rawTokens) * 100)
};
result.checks.current_view = {
  ok: currentWearing?.properties.value === "navy coat" && currentPromise?.properties.value === "silver key trust promise",
  current_wearing: currentWearing?.properties.value,
  current_promise: currentPromise?.properties.value,
  active_state_count: stateItems.length
};
result.checks.neuron_query = {
  ok: neuronQuery.value.nodes.some((node) => node.id === "state:mina:wearing:240"),
  returned_nodes: neuronQuery.value.nodes.length,
  top_node_id: neuronQuery.value.nodes[0]?.id
};
result.checks.synapse_traversal = {
  ok:
    traversal.value.nodes.some((node) => node.id === "state:mina:wearing:200") &&
    traversal.value.edges.some((edge) => edge.metadata.synapse_type === "SUPERSEDES"),
  nodes: traversal.value.nodes.length,
  edges: traversal.value.edges.length
};
result.checks.context_pack = {
  ok:
    contextPack.evidence.length > 0 &&
    evidenceText.includes("navy coat") &&
    evidenceText.includes("silver key") &&
    Boolean(contextPack.sections?.canonical_state?.length),
  evidence: contextPack.evidence.length,
  canonical_state_items: contextPack.sections?.canonical_state?.length ?? 0,
  includes_navy_coat: evidenceText.includes("navy coat"),
  includes_silver_key: evidenceText.includes("silver key")
};
result.checks.token_optimization = {
  ok: contextTokens < rawTokens * 0.35,
  raw_tokens: rawTokens,
  compressed_tokens: contextTokens,
  compression_ratio: result.token_estimate.compression_ratio
};
result.performance.current_view_ms = currentView.ms;
result.performance.neuron_query_ms = neuronQuery.ms;
result.performance.traverse_ms = traversal.ms;
result.performance.context_compose_ms = contextPackTiming.ms;
result.performance.repeated_context_compose = benchmark(iterations, () =>
  composeContextPack(
    {
      objective: "Continue the agent scene while preserving current canonical state and durable promises.",
      agent_id: "simulation-agent",
      session_id: "eval-neuron-synapse",
      profile_id: "simulation-memory",
      query: "Mina silver key navy coat trust",
      token_budget: 2200,
      seed_node_ids: [],
      context_policy: {
        sections: ["canonical_state", "relevant_history", "open_threads"]
      }
    },
    memory,
    {
      maxEvidenceItems: 10
    }
  )
);

result.ok = Object.values(result.checks).every((check) => check.ok !== false);
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

function seedCharacter() {
  applyDelta({
    idempotency_key: "eval:seed:v1",
    profile_id: "simulation-memory",
    source: {
      system: "eval"
    },
    upsert_neurons: [
      {
        id: "char:mina",
        labels: ["Character"],
        ontology: {
          profile_id: "simulation-memory",
          type: "Character"
        },
        title: "Mina",
        summary: "Mina is the active simulation character.",
        properties: {
          name: "Mina"
        }
      }
    ]
  });
}

function applyTurn(index) {
  const isPromiseTurn = index === 40 || index === 160;
  const isStateTurn = index % 40 === 0;
  const wearing = index < 120 ? "old hoodie" : index < 200 ? "gray raincoat" : "navy coat";
  const text = isPromiseTurn
    ? "Mina promises to remember that the silver key under the old fountain represents the Traveler's trust."
    : isStateTurn
      ? `Mina updates her current outfit state and is now wearing a ${wearing}.`
      : `Turn ${index} adds ambient market dialogue, weather, jokes, and scene texture that should compress away.`;

  transcript.push({
    actor: index % 2 === 0 ? "Traveler" : "Mina",
    text
  });

  const upsert_neurons = [
    {
      id: `event:turn:${index}`,
      labels: ["Event", "TemporalFact"],
      ontology: {
        profile_id: "simulation-memory",
        type: "Event"
      },
      title: `Turn ${index}`,
      summary: text,
      importance_score: isPromiseTurn || isStateTurn ? 0.88 : 0.35,
      properties: {
        source_turn_id: `turn-${index}`,
        turn_index: index
      }
    }
  ];
  const upsert_synapses = [
    {
      from: "char:mina",
      to: `event:turn:${index}`,
      type: "ACTOR_OF",
      ontology: {
        profile_id: "simulation-memory",
        type: "ACTOR_OF"
      }
    }
  ];
  const temporal_operations = [];

  if (isStateTurn) {
    const stateId = `state:mina:wearing:${index}`;
    upsert_neurons.push({
      id: stateId,
      labels: ["State", "TemporalFact"],
      ontology: {
        profile_id: "simulation-memory",
        type: "State"
      },
      title: "Mina wearing state",
      summary: `Mina is currently wearing a ${wearing}.`,
      valid_from: `turn-${index}`,
      valid_to: null,
      importance_score: 0.92,
      properties: {
        owner_id: "char:mina",
        state_type: "Wearing",
        value: wearing
      }
    });
    upsert_synapses.push({
      from: "char:mina",
      to: stateId,
      type: "HAS_CURRENT_STATE",
      ontology: {
        profile_id: "simulation-memory",
        type: "HAS_CURRENT_STATE"
      },
      properties: {
        current_pointer_key: "char:mina:Wearing"
      }
    });
    temporal_operations.push({
      operation: "supersede_current",
      selector: {
        label: "State",
        properties: {
          owner_id: "char:mina",
          state_type: "Wearing"
        }
      },
      valid_to: `turn-${index}`,
      superseded_by: stateId
    });
  }

  if (isPromiseTurn) {
    const stateId = `state:mina:promise:${index}`;
    upsert_neurons.push({
      id: stateId,
      labels: ["State", "TemporalFact"],
      ontology: {
        profile_id: "simulation-memory",
        type: "State"
      },
      title: "Mina promise state",
      summary: "Mina must remember the silver key trust promise.",
      valid_from: `turn-${index}`,
      valid_to: null,
      importance_score: 0.98,
      properties: {
        owner_id: "char:mina",
        state_type: "Promise",
        value: "silver key trust promise"
      }
    });
    upsert_synapses.push({
      from: "char:mina",
      to: stateId,
      type: "HAS_CURRENT_STATE",
      ontology: {
        profile_id: "simulation-memory",
        type: "HAS_CURRENT_STATE"
      },
      properties: {
        current_pointer_key: "char:mina:Promise"
      }
    });
    temporal_operations.push({
      operation: "supersede_current",
      selector: {
        label: "State",
        properties: {
          owner_id: "char:mina",
          state_type: "Promise"
        }
      },
      valid_to: `turn-${index}`,
      superseded_by: stateId
    });
  }

  applyDelta({
    idempotency_key: `eval:turn:${index}:v1`,
    profile_id: "simulation-memory",
    source: {
      system: "eval",
      turn_id: `turn-${index}`
    },
    upsert_neurons,
    upsert_synapses,
    temporal_operations
  });
}

function applyDelta(delta) {
  const compiled = compileGraphDelta(delta, memory);
  for (const node of compiled.nodes) {
    upsertById(memory.nodes, node);
  }
  for (const edge of compiled.edges) {
    upsertById(memory.edges, edge);
  }
}

function timedSync(name, operation) {
  const started = performance.now();
  const value = operation();
  return {
    name,
    value,
    ms: rounded(performance.now() - started)
  };
}

function benchmark(count, operation) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    operation();
    values.push(performance.now() - started);
  }
  values.sort((a, b) => a - b);
  return {
    iterations: count,
    min_ms: rounded(values[0]),
    p50_ms: rounded(percentile(values, 0.5)),
    p95_ms: rounded(percentile(values, 0.95)),
    max_ms: rounded(values[values.length - 1]),
    avg_ms: rounded(values.reduce((sum, value) => sum + value, 0) / values.length)
  };
}

function upsertById(items, item) {
  const existingIndex = items.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex >= 0) {
    items[existingIndex] = item;
    return;
  }
  items.push(item);
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function percentile(values, ratio) {
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index];
}

function rounded(value) {
  return Number(value.toFixed(3));
}
