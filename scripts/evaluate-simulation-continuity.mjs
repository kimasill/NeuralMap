const baseUrl = process.env.NEURALMAP_API_URL ?? process.argv[2] ?? "http://localhost:4317";
const runId = `eval-simulation-${Date.now()}`;
const simulationId = `character-chat-${Date.now()}`;
const sourceSessionId = "scene-1";
const targetSessionId = "scene-2";
const headers = {
  "content-type": "application/json",
  "x-neuralmap-run-id": runId
};
const transcript = createTranscript();
const result = {
  base_url: baseUrl,
  run_id: runId,
  simulation_id: simulationId,
  ok: false,
  checks: {},
  token_estimate: {}
};

try {
  const health = await request("GET", "/health");
  result.checks.health = {
    ok: health.ok === true,
    graph_mode: health.graph_mode
  };

  let previousEventId;
  for (const event of transcript) {
    await request("POST", "/ingest/simulation-event", {
      simulation_id: simulationId,
      session_id: sourceSessionId,
      event_id: event.id,
      previous_event_id: previousEventId,
      actor_id: event.actor_id,
      actor_name: event.actor_name,
      content: event.content,
      importance: event.importance,
      tags: event.tags,
      participants: event.participants
    });
    previousEventId = event.id;
  }
  result.checks.event_ingest = {
    ok: true,
    events: transcript.length
  };

  const continuity = await request("POST", "/simulation/context", {
    simulation_id: simulationId,
    session_id: sourceSessionId,
    new_session_id: targetSessionId,
    agent_id: "character-agent",
    query: "What must Aria remember about the silver key, the fountain promise, and the player's trust?",
    token_budget: 2200
  });
  const pack = continuity.pack;
  const evidenceText = pack.evidence.map((item) => item.snippet).join("\n");

  result.checks.session_continuity = {
    ok:
      continuity.source_session_id === sourceSessionId &&
      continuity.target_session_id === targetSessionId &&
      pack.session_id === targetSessionId,
    source_session_id: continuity.source_session_id,
    target_session_id: continuity.target_session_id,
    pack_session_id: pack.session_id
  };
  result.checks.memory_recall = {
    ok:
      pack.node_ids.includes(`simulation:${simulationId}:session:${sourceSessionId}`) &&
      pack.node_ids.includes(`simulation:${simulationId}:person:aria`) &&
      evidenceText.toLowerCase().includes("silver key"),
    nodes: pack.node_ids.length,
    evidence: pack.evidence.length,
    includes_silver_key: evidenceText.toLowerCase().includes("silver key")
  };

  const agentRun = await request("POST", "/agents/main-agent/run", {
    task: "Continue the session while preserving prior durable memory.",
    context_pack_id: pack.id
  });
  result.checks.agent_usable_context = {
    ok: agentRun.response.context_pack_id === pack.id && agentRun.response.referenced_node_ids.length > 0,
    referenced_nodes: agentRun.response.referenced_node_ids.length,
    cache_hit: agentRun.cache.hit
  };

  const rawTranscript = transcript.map((event) => `${event.actor_name}: ${event.content}`).join("\n");
  const contextText = [
    pack.objective,
    ...pack.evidence.map((item) => item.snippet),
    ...(pack.metadata.context_summary ? [pack.metadata.context_summary.content] : [])
  ].join("\n");
  const rawTokens = estimateTokens(rawTranscript);
  const contextTokens = estimateTokens(contextText);
  result.token_estimate = {
    raw_transcript_tokens: rawTokens,
    continuity_context_tokens: contextTokens,
    estimated_saved_tokens: Math.max(0, rawTokens - contextTokens),
    compression_ratio: Number((contextTokens / rawTokens).toFixed(3))
  };

  result.ok = Object.values(result.checks).every((check) => check.ok !== false);
} catch (error) {
  result.error = error instanceof Error ? error.message : "unknown_error";
}

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

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

function createTranscript() {
  const sharedParticipants = [
    {
      id: "user",
      name: "Traveler",
      role: "player"
    },
    {
      id: "aria",
      name: "Aria",
      role: "character"
    }
  ];
  const events = [];

  for (let index = 1; index <= 18; index += 1) {
    const isMemoryEvent = index === 5 || index === 12;
    events.push({
      id: `turn-${index}`,
      actor_id: index % 2 === 0 ? "user" : "aria",
      actor_name: index % 2 === 0 ? "Traveler" : "Aria",
      importance: isMemoryEvent ? 0.94 : 0.55 + (index % 5) * 0.04,
      tags: isMemoryEvent ? ["promise", "memory", "silver-key"] : ["scene", "dialogue"],
      participants: sharedParticipants,
      content: isMemoryEvent
        ? "Aria quietly promises the Traveler that she will remember the silver key hidden under the old fountain. She says the secret matters because it proves the Traveler trusted her before the storm and she must carry that trust into the next meeting."
        : `The conversation continues through market noise, weather, small jokes, and local rumors. Turn ${index} adds atmosphere and character tone but should not outweigh the persistent promise memory when the next session begins.`
    });
  }

  return events;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
