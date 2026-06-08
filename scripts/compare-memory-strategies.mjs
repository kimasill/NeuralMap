import { performance } from "node:perf_hooks";

import {
  compileGraphDelta,
  composeContextPack,
  currentGraphView,
  getSynapseType,
  queryGraphNeurons,
  rankSeedNodes,
  traverseGraph,
  validateContextPack
} from "../packages/core/dist/index.js";

const eventCount = Number(process.env.NEURALMAP_MEMORY_COMPARE_EVENTS ?? 240);
const iterations = Number(process.env.NEURALMAP_MEMORY_COMPARE_ITERATIONS ?? 30);
const query = "Mina current memory and silver key trust promise";
const workload = createWorkload(eventCount);

const result = {
  ok: false,
  event_count: eventCount,
  iterations,
  query,
  ground_truth: {
    current_wearing: "navy coat",
    durable_promise: "silver key trust promise",
    predecessor_wearing: "gray raincoat"
  },
  caveats: [
    "This is a local deterministic benchmark, not a live API benchmark against commercial model providers.",
    "The prompt-cache row models provider context caching semantics: it can reduce repeated-prefix latency/cost, but it does not shrink the context window or remove stale facts.",
    "The vector-only row is a framework-style RAG analogue using the same local lexical/sparse-semantic ranker without NeuralMap current-view or synapse traversal."
  ],
  strategies: [],
  rankings: {}
};

const strategies = [
  benchmarkStrategy("raw_full_context", "Send every transcript turn on every request.", () => ({
    empirical: true,
    context: workload.transcript.map(formatTurn).join("\n")
  })),
  benchmarkStrategy("provider_prompt_cache_full_context", "Reuse the same full transcript prefix with provider prompt caching.", () => {
    const context = workload.transcript.map(formatTurn).join("\n");
    const tokens = estimateTokens(context);

    return {
      empirical: false,
      context,
      modeled_cache: {
        first_request_input_tokens: tokens,
        repeated_request_context_window_tokens: tokens,
        cached_prefix_tokens_if_exact_match: tokens >= 1024 ? tokens : 0,
        reduces_context_window_tokens: false,
        requires_exact_reused_prefix: true
      }
    };
  }),
  benchmarkStrategy("sliding_window_40", "Keep only the latest 40 transcript turns.", () => ({
    empirical: true,
    context: workload.transcript.slice(-40).map(formatTurn).join("\n")
  })),
  benchmarkStrategy("sliding_window_120", "Keep only the latest 120 transcript turns.", () => ({
    empirical: true,
    context: workload.transcript.slice(-120).map(formatTurn).join("\n")
  })),
  benchmarkStrategy("keyword_rag_top10", "Retrieve top transcript lines by query-token overlap and recency.", () => ({
    empirical: true,
    context: selectKeywordLines(workload.transcript, query, 10).map(formatTurn).join("\n")
  })),
  benchmarkStrategy("summary_cache_snapshot", "Maintain a compact rolling summary of current facts only.", () => ({
    empirical: true,
    context: createRollingSummarySnapshot(workload.transcript)
  })),
  benchmarkStrategy("vector_only_rag_top10", "Retrieve top graph nodes without current-view filtering or synapse traversal.", () => {
    const seeds = rankSeedNodes(
      {
        query,
        top_k: 10,
        expand_hops: 0,
        min_edge_confidence: 0.4
      },
      workload.memory.nodes
    );

    return {
      empirical: true,
      context: seeds.map((seed) => `${seed.node.id}: ${seed.node.summary ?? seed.node.title}`).join("\n"),
      selected_nodes: seeds.map((seed) => ({
        id: seed.node.id,
        score: seed.score,
        reasons: seed.reasons
      }))
    };
  }),
  benchmarkStrategy("neuralmap_graph_rag", "Use current-view, neuron query, synapse traversal, and Context Pack compression.", () => {
    const current = currentGraphView(
      {
        profile_id: "simulation-memory",
        label: "State",
        current_key: ["properties.owner_id", "properties.state_type"],
        filters: {
          owner_id: "char:mina"
        }
      },
      workload.memory
    );
    const currentWearing = current.items.find((item) => item.properties.state_type === "Wearing");
    const neuronQuery = queryGraphNeurons(
      {
        profile_id: "simulation-memory",
        labels: ["State"],
        query,
        top_k: 10
      },
      workload.memory
    );
    const traversal = currentWearing
      ? traverseGraph(
          {
            seed_node_ids: [currentWearing.id],
            profile_id: "simulation-memory",
            max_hops: 2,
            include_synapse_types: ["HAS_CURRENT_STATE", "SUPERSEDES"]
          },
          workload.memory
        )
      : { nodes: [], edges: [] };
    const pack = composeContextPack(
      {
        objective: "Continue the agent scene with only the state and history needed for the next turn.",
        agent_id: "compare-agent",
        session_id: "compare-memory-strategies",
        profile_id: "simulation-memory",
        query,
        token_budget: 2200,
        seed_node_ids: neuronQuery.nodes.slice(0, 3).map((node) => node.id),
        context_policy: {
          sections: ["canonical_state", "relevant_history", "open_threads"]
        }
      },
      workload.memory,
      {
        maxEvidenceItems: 10
      }
    );

    const validation = validateContextPack(pack, workload.memory.nodes);
    // A consumer that respects the pack's section structure renders history through
    // the temporally-framed relevant_history channel and does not re-dump the same
    // nodes as unframed flat evidence.
    const sectionNodeIds = new Set(
      Object.values(pack.sections ?? {})
        .flat()
        .map((item) => item.node_id)
    );

    return {
      empirical: true,
      context: [
        ...current.items.map(
          (item) =>
            `Current ${item.current_key}: ${item.node.summary ?? item.node.title}; valid_from=${item.valid_from ?? "unknown"}; valid_to=${item.valid_to ?? "null"}`
        ),
        ...traversal.edges.map((edge) => `Temporal synapse: ${edge.from} ${getSynapseType(edge)} ${edge.to}`),
        ...traversal.nodes.map((node) => `Traversed neuron ${node.id}${formatTemporalTag(node)}: ${node.summary ?? node.title}`),
        ...pack.evidence
          .filter((item) => !sectionNodeIds.has(item.node_id))
          .map((item) => `Evidence ${item.node_id}: ${item.snippet}`),
        ...Object.entries(pack.sections ?? {}).flatMap(([section, items]) =>
          items.map((item) => `Section ${section}${isHistorySection(section) ? " [historical]" : ""} ${item.node_id}: ${item.snippet}`)
        )
      ].join("\n"),
      selected_nodes: pack.node_ids,
      pack_validation: {
        ok: validation.ok,
        issue_count: validation.issues.length,
        warning_count: validation.warnings.length,
        stale_evidence_count: validation.stats.stale_evidence_count,
        conflict_count: validation.stats.conflict_count
      },
      graph: {
        current_items: current.items.length,
        queried_nodes: neuronQuery.nodes.length,
        traversed_nodes: traversal.nodes.length,
        traversed_edges: traversal.edges.length,
        context_pack_nodes: pack.node_ids.length,
        context_pack_evidence: pack.evidence.length
      }
    };
  })
];

result.strategies = strategies.map((strategy) => strategy.summary);
result.rankings = {
  quality: rankBy(result.strategies, (strategy) => strategy.quality_score),
  token_efficiency: rankBy(result.strategies, (strategy) => strategy.facts_per_1k_tokens),
  latency: rankBy(result.strategies, (strategy) => -strategy.latency_ms.p50)
};

const neuralMap = result.strategies.find((strategy) => strategy.id === "neuralmap_graph_rag");
const vectorOnly = result.strategies.find((strategy) => strategy.id === "vector_only_rag_top10");
const promptCache = result.strategies.find((strategy) => strategy.id === "provider_prompt_cache_full_context");
const summaryCache = result.strategies.find((strategy) => strategy.id === "summary_cache_snapshot");

result.verdict = {
  neuralmap_quality_leads_empirical_strategies:
    neuralMap?.quality_score === Math.max(...result.strategies.filter((strategy) => strategy.empirical).map((strategy) => strategy.quality_score)),
  neuralmap_beats_vector_only_quality: (neuralMap?.quality_score ?? 0) > (vectorOnly?.quality_score ?? 0),
  neuralmap_uses_fewer_context_tokens_than_prompt_cache: (neuralMap?.context_tokens ?? Infinity) < (promptCache?.context_tokens ?? 0),
  summary_cache_is_cheaper_but_loses_lineage: Boolean(
    summaryCache &&
      neuralMap &&
      summaryCache.context_tokens < neuralMap.context_tokens &&
      summaryCache.facts.predecessor_lineage === false &&
      neuralMap.facts.predecessor_lineage === true
  ),
  neuralmap_pack_has_no_stale_conflicts:
    neuralMap?.stale_conflicts.length === 0 &&
    Boolean(neuralMap?.pack_validation?.ok) &&
    neuralMap?.pack_validation?.stale_evidence_count === 0
};
result.ok = Object.values(result.verdict).every(Boolean);

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

function benchmarkStrategy(id, description, buildContext) {
  const first = timed(() => buildContext());
  const repeated = [];

  for (let index = 0; index < iterations; index += 1) {
    repeated.push(timed(() => buildContext()).ms);
  }

  repeated.sort((a, b) => a - b);

  const context = first.value.context;
  const score = scoreContext(context);
  const contextTokens = estimateTokens(context);
  const factsFound = Object.values(score.facts).filter(Boolean).length;

  return {
    id,
    summary: {
      id,
      description,
      empirical: first.value.empirical,
      context_tokens: contextTokens,
      facts: score.facts,
      stale_conflicts: score.stale_conflicts,
      has_temporal_disambiguation: score.has_temporal_disambiguation,
      recall_score: score.recall_score,
      precision_score: score.precision_score,
      lineage_score: score.lineage_score,
      quality_score: score.quality_score,
      facts_per_1k_tokens: rounded((factsFound / Math.max(1, contextTokens)) * 1000),
      latency_ms: {
        first: first.ms,
        p50: rounded(percentile(repeated, 0.5)),
        p95: rounded(percentile(repeated, 0.95))
      },
      ...(first.value.modeled_cache ? { modeled_cache: first.value.modeled_cache } : {}),
      ...(first.value.selected_nodes ? { selected_nodes: first.value.selected_nodes } : {}),
      ...(first.value.pack_validation ? { pack_validation: first.value.pack_validation } : {}),
      ...(first.value.graph ? { graph: first.value.graph } : {})
    }
  };
}

function createWorkload(count) {
  const memory = {
    nodes: [],
    edges: []
  };
  const transcript = [];

  seedCharacter(memory);
  for (let index = 1; index <= count; index += 1) {
    applyTurn(memory, transcript, index);
  }

  return {
    memory,
    transcript
  };
}

function seedCharacter(memory) {
  applyDelta(memory, {
    idempotency_key: "compare:seed:v1",
    profile_id: "simulation-memory",
    source: {
      system: "compare"
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

function applyTurn(memory, transcript, index) {
  const isPromiseTurn = index === 40 || index === 160;
  const isStateTurn = index % 40 === 0;
  const wearing = index < 120 ? "old hoodie" : index < 200 ? "gray raincoat" : "navy coat";
  const text = isPromiseTurn
    ? "Mina promises to remember that the silver key under the old fountain represents the Traveler's trust."
    : isStateTurn
      ? `Mina updates her current outfit state and is now wearing a ${wearing}.`
      : `Turn ${index} adds ambient market dialogue, weather, jokes, and scene texture that should compress away.`;

  transcript.push({
    turn: index,
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

  applyDelta(memory, {
    idempotency_key: `compare:turn:${index}:v1`,
    profile_id: "simulation-memory",
    source: {
      system: "compare",
      turn_id: `turn-${index}`
    },
    upsert_neurons,
    upsert_synapses,
    temporal_operations
  });
}

function applyDelta(memory, delta) {
  const compiled = compileGraphDelta(delta, memory);
  for (const node of compiled.nodes) {
    upsertById(memory.nodes, node);
  }
  for (const edge of compiled.edges) {
    upsertById(memory.edges, edge);
  }
}

function selectKeywordLines(transcript, searchQuery, limit) {
  const queryTokens = unique(tokenize(searchQuery));

  return transcript
    .map((turn) => {
      const text = formatTurn(turn).toLowerCase();
      const overlap = queryTokens.filter((token) => text.includes(token)).length;
      const recencyBoost = turn.turn / transcript.length;

      return {
        turn,
        score: overlap * 10 + recencyBoost
      };
    })
    .filter((item) => item.score >= 10)
    .sort((a, b) => b.score - a.score || b.turn.turn - a.turn.turn)
    .slice(0, limit)
    .sort((a, b) => a.turn.turn - b.turn.turn)
    .map((item) => item.turn);
}

function createRollingSummarySnapshot(transcript) {
  let currentWearing = "";
  let durablePromise = "";

  for (const turn of transcript) {
    const wearingMatch = turn.text.match(/wearing a ([^.]+)\./i);
    if (wearingMatch) {
      currentWearing = wearingMatch[1];
    }
    if (turn.text.toLowerCase().includes("silver key") && turn.text.toLowerCase().includes("trust")) {
      durablePromise = "silver key trust promise";
    }
  }

  return [
    "Rolling summary cache snapshot:",
    currentWearing ? `Current wearing: Mina is wearing a ${currentWearing}.` : "",
    durablePromise ? `Durable promise: Mina must remember the ${durablePromise}.` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

// A stale value is flagged per-line: a non-current wearing value only counts as a
// stale conflict when the line that asserts it lacks any temporal disambiguation
// marker. This is stricter than a single global flag and actually detects state
// that leaks into context without historical framing.
function scoreContext(context) {
  const temporalMarker = /valid_to|supersed|previous|predecessor|historical|temporal synapse/u;
  const currentWearingValue = "navy coat";
  const staleWearingValues = ["old hoodie", "gray raincoat"];
  const lower = context.toLowerCase();
  const lines = lower.split("\n");
  const staleConflicts = [];
  let lineageMarked = false;

  for (const line of lines) {
    const marked = temporalMarker.test(line);
    for (const value of staleWearingValues) {
      if (!line.includes(value)) {
        continue;
      }
      if (marked) {
        if (value === "gray raincoat") {
          lineageMarked = true;
        }
      } else {
        staleConflicts.push(`${value} asserted without temporal disambiguation: "${line.trim().slice(0, 90)}"`);
      }
    }
  }

  const hasTemporalDisambiguation = temporalMarker.test(lower);
  const facts = {
    current_wearing: lower.includes(currentWearingValue),
    durable_promise: lower.includes("silver key") && lower.includes("trust"),
    predecessor_lineage: lineageMarked
  };

  const recallScore = Object.values(facts).filter(Boolean).length / Object.keys(facts).length;
  const precisionScore = Math.max(0, 1 - staleConflicts.length * 0.25);
  const lineageScore = facts.predecessor_lineage ? 1 : 0;

  return {
    facts,
    stale_conflicts: staleConflicts,
    has_temporal_disambiguation: hasTemporalDisambiguation,
    recall_score: rounded(recallScore),
    precision_score: rounded(precisionScore),
    lineage_score: lineageScore,
    quality_score: rounded(recallScore * 0.6 + precisionScore * 0.25 + lineageScore * 0.15)
  };
}

function isHistorySection(section) {
  return /history|event|loop|thread/u.test(section.toLowerCase());
}

function formatTemporalTag(node) {
  const validTo = node.valid_to ?? node.metadata?.valid_to ?? null;
  const status = node.lifecycle_status ?? node.metadata?.lifecycle_status ?? "active";
  if (validTo != null) {
    return ` [superseded; historical; valid_to=${validTo}]`;
  }
  if (status === "archived" || status === "deprecated") {
    return ` [${status}; historical]`;
  }
  return "";
}

function timed(operation) {
  const started = performance.now();
  const value = operation();

  return {
    value,
    ms: rounded(performance.now() - started)
  };
}

function formatTurn(turn) {
  return `Turn ${turn.turn} ${turn.actor}: ${turn.text}`;
}

function upsertById(items, item) {
  const existingIndex = items.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex >= 0) {
    items[existingIndex] = item;
    return;
  }
  items.push(item);
}

function tokenize(input) {
  return input
    .toLowerCase()
    .match(/[\p{L}\p{N}_./-]+/gu)
    ?.map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean) ?? [];
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function percentile(values, ratio) {
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index] ?? 0;
}

function rankBy(items, score) {
  return [...items]
    .sort((a, b) => score(b) - score(a))
    .map((item, index) => ({
      rank: index + 1,
      id: item.id,
      score: rounded(score(item))
    }));
}

function rounded(value) {
  return Number(value.toFixed(3));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
