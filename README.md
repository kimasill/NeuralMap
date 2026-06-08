# NeuralMap

NeuralMap is a TypeScript monorepo for the agent context graph framework described in:

`S:\Project\AIControlPlane\agent_context_graph_framework_blueprint.md`

The product direction is simple: keep sessions short, keep durable memory in the framework, and rebuild only the context an agent needs.

## What NeuralMap Does

NeuralMap stores agent memory as a typed knowledge graph. A user, task, file, decision, runtime event, or simulation state becomes a graph node. A dependency, reference, current-state pointer, supersession, artifact relation, or handoff becomes a graph edge.

The framework then uses retrieval, graph traversal, current views, and Context Pack composition to build a small prompt surface for the next agent action. The goal is not to replay every transcript token. The goal is to activate the relevant neuron neighborhood and pass only the evidence, state, and lineage that the agent needs.

Core capabilities:

- Generic graph primitives through `GraphNode` and `GraphEdge`.
- Additive Neuron/Synapse compatibility fields: `labels`, `ontology`, `properties`, lifecycle status, temporal validity, provenance, and scope.
- Profile-driven semantics for domains such as `simulation-memory`, `coding-context`, and `ops-incident`.
- Generic Graph Delta writes for batched neuron/synapse updates, temporal supersede, archive operations, and idempotent replay.
- Current views for active state, for example "the current outfit state for Mina".
- Traversal APIs for opening the graph around a concern while respecting hop limits, lifecycle, scope, and redaction.
- Context Pack composition with flat `evidence` plus optional profile-driven sections such as `canonical_state`, `relevant_history`, and `open_threads`.
- Postgres + pgvector persistence for graph memory, chunks, artifacts, traces, context packs, handoff packs, and graph delta commits.
- Local and DB-backed modes so the API can run with sample memory during development and Postgres in integration flows.

## Workbench

The Workbench is a local UI for inspecting agent memory as a living neuron/synapse network. It renders the graph in an interactive 3D (or 2D) force layout, with node-type colouring, importance-scaled neurons, synapse highlighting, a Context Inspector, run/activity timeline, and scope-aware filtering.

![NeuralMap Workbench — interactive 3D neuron/synapse graph with Context Inspector](docs/assets/workbench-3d.png)

Run `pnpm dev` to start Postgres + Redis, apply migrations, and launch the API and Workbench together, then open `http://localhost:3001`. The source badge reads `Database` once the API can read persisted graph nodes, or `Sample` when it falls back to in-memory sample memory.

## Why Neuron/Synapse Graph Memory

Provider prompt caching can reduce repeated-prefix latency and input-token cost when a prompt prefix is reused, but it does not decide which facts are current, remove stale state, or shrink the context window by itself.

NeuralMap sits before the model call. It converts ongoing agent activity into durable graph state, then answers "what should be remembered now?" by combining:

- current-state selection;
- semantic and lexical seed retrieval;
- synapse traversal around the selected concern;
- temporal lineage such as `SUPERSEDES`;
- profile-specific Context Pack sections;
- token-budgeted evidence selection.

This makes NeuralMap complementary to provider caching. NeuralMap reduces and structures the prompt. Provider caching can still cache stable prompt segments after that.

## Repository Layout

```text
apps/api                  HTTP API, sample/DB data sources, GraphRAG endpoints
apps/workbench            Local UI for graph and runtime inspection
packages/schema           Shared TypeScript/Zod contracts
packages/core             Retrieval, graph expansion, profiles, deltas, Context Packs
packages/db               Drizzle/Postgres/pgvector persistence
packages/ingest           Repository, ticket, document, artifact, and simulation ingest helpers
packages/cache            In-memory cache primitives
packages/trace            Trace span recording
scripts                   Local eval, benchmark, infra, and environment helpers
docs                      ADRs, how-to guides, progress notes, and implementation plans
```

## Main APIs

Graph and profile APIs:

- `GET /profiles`
- `GET /profiles/:id`
- `POST /profiles`
- `POST /graph/query`
- `POST /graph/deltas`
- `POST /graph/neurons/query`
- `POST /graph/traverse`
- `POST /graph/views/current`

Context and agent APIs:

- `POST /context/compose`
- `POST /context/handoff`
- `POST /model/route`
- `POST /agents/main-agent/run`

Compatibility and ingest APIs:

- `POST /ingest/ticket`
- `POST /ingest/simulation-event`
- `POST /simulation/context`

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm infra:up
pnpm db:migrate
pnpm db:smoke
```

Copy `.env.example` to `.env` before running database commands locally.

## Local Database Ingest

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed:repo
pnpm dev:api
pnpm dev:workbench
```

Use `pnpm db:seed:repo:dry` to inspect the repository ingest payload without writing to Postgres.

See [Run Local Database Ingest](docs/how-to/local-database-ingest.md) for the full flow.

On Windows, `pnpm infra:up` uses Docker Desktop when available and falls back to the configured WSL Docker engine. It waits for Postgres and Redis health checks before returning. Root commands that go through `scripts/with-env.mjs` can also refresh a WSL-backed `DATABASE_URL` to the current WSL IP at runtime.

## Scope And Database Routing

NeuralMap stays generic by treating product boundaries as graph scope, not as DynamicChat-specific core types. API calls can carry any of these scope fields in the JSON body, HTTP headers, or Workbench query string:

- `tenant_id` / `x-neuralmap-tenant-id`
- `workspace_id` / `x-neuralmap-workspace-id`
- `project_id` / `x-neuralmap-project-id`
- `owner_scope` / `x-neuralmap-owner-scope`

For a single shared database, scope filtering keeps separate tenants, workspaces, projects, and simulations from seeing each other's scoped graph memory. The Workbench can inspect a scoped graph with a URL such as:

```text
http://localhost:3001/?tenant_id=dynamicchat&project_id=simulation-a
```

When physical database isolation is required, set `NEURALMAP_DATABASE_ROUTES` to a JSON object that maps scope route keys to Postgres URLs:

```bash
NEURALMAP_DATABASE_ROUTES='{
  "project:simulation-a": "postgres://neuralmap:neuralmap@localhost:5432/neuralmap_sim_a",
  "project:simulation-b": "postgres://neuralmap:neuralmap@localhost:5432/neuralmap_sim_b",
  "default": "postgres://neuralmap:neuralmap@localhost:5432/neuralmap"
}'
```

Route precedence is `project:<project_id>`, then `workspace:<workspace_id>`, `tenant:<tenant_id>`, `owner:<owner_scope>`, then `default`. Routed databases must already exist and have NeuralMap migrations applied. A connected empty database returns an empty database graph; sample graph fallback is reserved for missing or unavailable database connections.

## Evaluation and Benchmarks

```bash
pnpm eval:simulation
pnpm eval:graphrag
pnpm eval:neuron-synapse
pnpm eval:memory-compare
pnpm bench:graphrag-core
```

Recent local verification from the generic neuron/synapse implementation:

- `pnpm typecheck` passed.
- `pnpm test` passed: 38 tests.
- `pnpm build` passed.
- `pnpm db:smoke` passed against the local WSL Postgres container after `pnpm infra:up`.
- `pnpm eval:neuron-synapse` passed on 240 synthetic agent turns.
  - Graph built: 249 neurons, 254 synapses.
  - Current view recovered `Wearing = navy coat`.
  - Current view recovered `Promise = silver key trust promise`.
  - Raw transcript estimate: 6426 tokens.
  - Compressed context estimate: 384 tokens.
  - Estimated token reduction: 94.024 percent.
  - Repeated Context Pack composition p95: about 5.4 ms locally.
- `pnpm eval:memory-compare` compared raw full context, provider prompt-cache-style full context, sliding windows, keyword RAG, summary-cache snapshot, vector-only RAG, and NeuralMap graph RAG.
  - NeuralMap graph RAG ranked first on quality score: 1.0.
  - NeuralMap recovered active state, durable promise, and predecessor temporal lineage.
  - NeuralMap context estimate: 892 tokens versus 6939 tokens for raw full context / prompt-cache-style full context.
  - Vector-only RAG used fewer tokens but mixed stale current-state candidates without temporal disambiguation.
  - Summary-cache snapshot used the fewest tokens but lost predecessor lineage, provenance, and synapse explainability.

## Implementation Status

The current implementation includes the generic neuron/synapse profile and graph delta foundation tracked in:

- [Generic Neuron/Synapse Profile Graph Delta Plan](docs/progress/generic-neuron-synapse-profile-graph-delta-plan.md)
- Linear: [AIN-25](https://linear.app/aineuralmap/issue/AIN-25/generic-neuronsynapse-profile-and-graph-delta-foundation)
- GitHub: [#6](https://github.com/kimasill/NeuralMap/issues/6)

The work keeps NeuralMap generic. Simulation memory is expressed as a `simulation-memory` profile on top of the framework rather than as DynamicChat-specific core enums.
