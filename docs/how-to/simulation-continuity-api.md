# Use NeuralMap For Session Continuity

This guide shows how an external chat, game, workflow, tutoring, simulation, or agent platform can use NeuralMap as a persistent context-graph memory layer.

## Goal

Instead of sending an entire previous transcript, log, or task history to an agent, the platform streams important events into NeuralMap. When a new session starts, the platform asks NeuralMap for a compact Context Pack built from the persistent graph.

## Flow

1. Send simulation events as they happen.
2. NeuralMap stores a Session node, event Task nodes, Person nodes, chunks, embeddings, and graph edges.
3. On a later session, request simulation continuity context.
4. Pass the returned Context Pack ID into an agent run or external model call.

The endpoint names use `simulation` because the first validated scenario is a session simulation, but the stored event graph is generic enough for product sessions, tutoring traces, operations handoffs, game state, and long-running agent work.

Continuity retrieval is scoped by `simulation_id` by default, so separate products, characters, tenants, or scenarios do not share session memory unless the caller explicitly uses another endpoint to compose broader context.

## Ingest An Event

```bash
curl -X POST http://localhost:4317/ingest/simulation-event \
  -H "content-type: application/json" \
  -d '{
    "simulation_id": "character-chat",
    "session_id": "scene-1",
    "event_id": "turn-1",
    "actor_id": "aria",
    "actor_name": "Aria",
    "content": "Aria promises to remember the silver key hidden under the old fountain.",
    "importance": 0.92,
    "tags": ["promise", "memory"],
    "participants": [
      { "id": "user", "name": "Traveler", "role": "player" }
    ]
  }'
```

This creates graph memory like:

- `Session`: `simulation:character-chat:session:scene-1`
- `Task`: `simulation:character-chat:event:turn-1`
- `Person`: `simulation:character-chat:person:aria`
- `references` and `mentions` edges
- retrievable chunks and, in DB mode, pgvector embeddings

## Continue In A New Session

```bash
curl -X POST http://localhost:4317/simulation/context \
  -H "content-type: application/json" \
  -d '{
    "simulation_id": "character-chat",
    "session_id": "scene-1",
    "new_session_id": "scene-2",
    "agent_id": "character-agent",
    "query": "What must Aria remember about the silver key?",
    "token_budget": 2200
  }'
```

The response contains:

- `source_session_id`: previous simulation session
- `target_session_id`: new session to continue into
- `pack`: compact Context Pack with evidence and node IDs
- `pack.metadata.simulation_continuity`: continuity metadata

## Run An Agent With The Pack

```bash
curl -X POST http://localhost:4317/agents/main-agent/run \
  -H "content-type: application/json" \
  -d '{
    "task": "Continue the session while preserving prior durable memory.",
    "context_pack_id": "<pack.id>"
  }'
```

## Verification

Run the external-client simulation smoke:

```bash
pnpm eval:simulation
```

For DB mode:

```powershell
$env:NEURALMAP_API_URL='http://127.0.0.1:4318'
pnpm eval:simulation
```

Latest DB-mode result:

- 18 simulation events ingested through HTTP.
- New session `scene-2` received a continuity Context Pack from source session `scene-1`.
- Context Pack recalled the silver key memory.
- Raw transcript estimate: 1021 tokens.
- Continuity context estimate: 607 tokens.
- Estimated saved tokens: 414.
- Compression ratio: 0.595.

## Current Limits

- This is an API-level continuity layer, not a full hosted character chat backend.
- Importance is currently supplied or inferred by rules, not a learned salience model.
- External embedding providers are not configured yet; DB mode uses deterministic local embeddings as a fallback.
- Auth, tenant isolation, redaction, and rate limiting are still required before public deployment.
