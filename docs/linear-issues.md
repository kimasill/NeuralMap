# Linear Issue Mirror

This file mirrors the Linear control plane for local visibility. Linear is the source for assignment and status once issues are created.

Workspace: https://linear.app/aineuralmap

## External Tracker Sync

- Linear live sync: verified on 2026-05-03. Team `AINeuralMap` and issues AIN-5 through AIN-11 are reachable from this Codex session.
- GitHub fallback tracker: still mirrored at https://github.com/kimasill/NeuralMap/issues. Existing GitHub issues #1 through #5 were checked on 2026-05-03; no Phase 4 GitHub issue exists yet. `gh` CLI is not installed on this machine, so issue lookup used the GitHub connector.
- Last tracker sync: 2026-05-03.

| Track | Linear | Status |
| --- | --- | --- |
| Step 0: Bootstrap memory backbone contracts | [AIN-5](https://linear.app/aineuralmap/issue/AIN-5/step-0-bootstrap-memory-backbone-contracts) | Done |
| Track A: Core retrieval and context composer | [AIN-6](https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer) | Done |
| Track B: Repository, document, and ticket ingest | [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest) | Done |
| Track B follow-up: Generated artifact graph nodes | [AIN-10](https://linear.app/aineuralmap/issue/AIN-10/persist-generated-contexthandoff-artifacts-as-graph-nodes) | Done |
| Track C: Fastify API and trace middleware | [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware) | Done |
| Track D: Graph workbench UI | [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui) | Done |
| Phase 4: Dynamic Profiling | [AIN-11](https://linear.app/aineuralmap/issue/AIN-11/phase-4-dynamic-profiling) | Done |

## Phase 2 Local Progress

Phase 2 does not yet have dedicated Linear issues in this mirror. The first local Graph UX slice is complete:

- Handoff Packs retain `metadata.context_pack_id`.
- Context and Handoff artifacts are linked with `handed_off_to` graph edges.
- API exposes relationship records through `/workbench/artifacts` and direct lookup through `/workbench/artifacts/handoffs/:id/relationship`.
- Workbench shows the source Context Pack, Handoff Pack, referenced nodes, and run linkage in the Handoff Relationship panel.
- API exposes `/workbench/timeline`, and Workbench shows Context/Handoff/artifact-link/trace events in a Timeline panel.
- Workbench includes repository-scale graph filters for node type, source, artifact visibility, importance, confidence, max nodes, and type/source grouping.

## Phase 3 Local Progress

Phase 3 does not yet have dedicated Linear issues in this mirror. The local Smart Caching slice is complete:

- Cache entries now carry policy metadata, tags, expiry, access counts, and compact value summaries.
- API exposes cache stats, entry listing, non-mutating key inspection, and targeted invalidation.
- Cache writes are tagged across retrieval, graph-neighborhood, prompt-segment, summary, and response layers.
- Graph writes invalidate entries tagged `graph`.
- Workbench includes cache stats, recent entries, tag filtering, refresh, and layer/tag/all invalidation controls.

## Phase 4 Local Progress

Linear [AIN-11](https://linear.app/aineuralmap/issue/AIN-11/phase-4-dynamic-profiling) tracks the completed Dynamic Profiling slice:

- Core model profiles now cover `fast-context`, `balanced-agent`, `deep-reasoning`, and `validation-guard`.
- Task classification feeds profile selection with complexity, risk, urgency, token budget, cache state, and quality feedback.
- API exposes `/model/profiles`, `/model/route`, and `/model/feedback`.
- Agent runs now use selected profile decisions and include profile metadata in cached responses and traces.
- Workbench shows Dynamic Profile decisions, routing reasons, budget pressure, reasoning effort, and feedback controls.

## Issue Drafts

### Step 0: Bootstrap memory backbone contracts

Linear: [AIN-5](https://linear.app/aineuralmap/issue/AIN-5/step-0-bootstrap-memory-backbone-contracts)

Create the pnpm workspace, shared schema package, Postgres + pgvector Drizzle schema, first migration, and ADR 0001-0003.

### Track A: Core retrieval and context composer

Linear: [AIN-6](https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer)

Implement seed retrieval contracts, graph expansion rules, compression policy, and Context Pack Composer using `packages/schema` and `packages/db`.

Initial slice:

- `packages/core` provides lexical seed ranking, 1-hop graph expansion, Context Pack composition, Handoff Pack creation, and sample graph memory.

Persistence slice:

- API context composition now saves packs through the graph data source when Postgres is configured.

Local DB ingest slice:

- `db:seed:repo` can now persist repository-derived graph nodes into Postgres, which gives the composer live graph memory once DB mode is active.

Cache and trace slice:

- Repeated graph queries are now cached through `packages/cache`, giving the composer/API path measurable hit and miss behavior.

Workbench context loop slice:

- Workbench can now execute graph queries, compose Context Packs from the selected neighborhood, and create Handoff Packs from saved Context Packs.

Artifact history slice:

- Recent Context Packs and Handoff Packs can be listed for the workbench loop, and saved Handoff Packs can be fetched by ID.

Context refresh slice:

- Saved Context Packs can now be refreshed into a new pack from the existing node set and optional query overrides.

Intent-aware retrieval slice:

- Seed retrieval now classifies query intent and applies node-type boosts before graph expansion.

Graph neighborhood cache slice:

- Graph expansion now reuses the `graph_neighborhood` cache for node neighbor and graph query paths.

Template and prompt cache slice:

- `packages/core` now includes a versioned context template registry and Context Packs record selected template/intent metadata.
- API Context Pack composition and refresh now use the `prompt_segment` cache layer for stable template prompt segments.

Summary and response cache foundation slice:

- API Context Pack composition and refresh now cache deterministic summaries in the `summary` cache layer.
- Context Pack metadata now records summary cache hit/miss state and compact summary content.
- API agent runs now cache deterministic responses in the `response` cache layer.

Hybrid retrieval graduation slice:

- Seed retrieval now uses hybrid lexical plus deterministic sparse vector similarity scoring.
- Context Pack metadata records retrieval mode, seed count, and semantic seed count.
- GitHub issue [#4](https://github.com/kimasill/NeuralMap/issues/4) is implemented locally for the Phase 1 scope.

### Track B: Repository, document, and ticket ingest

Linear: [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest)

Implement ingest interfaces for repository, document, and ticket sources, including chunking and graph node or edge emission.

Initial slice:

- `packages/ingest` provides document, repository, and ticket ingestion helpers with chunk drafts and import dependency edge emission.

Persistence slice:

- API endpoints accept document, repository, and ticket snapshots and persist emitted nodes, edges, and chunks through the DB graph store.

Local DB ingest slice:

- `packages/ingest` now includes a filesystem scanner and CLI for ingesting the current repository. Latest dry-run result on this repo: 114 files, 115 nodes, 115 edges, 310 chunks.

Graph neighborhood cache slice:

- Ingest endpoints now invalidate retrieval and graph-neighborhood caches after graph memory changes.

Cross-source linker foundation slice:

- API ingest endpoints now enrich document, repository, and ticket emissions with inferred cross-source edges.
- Ticket-to-code path mentions now create `references` edges with confidence, weight, matched text, and linker metadata.

Runtime artifact graph node slice:

- Linear [AIN-10](https://linear.app/aineuralmap/issue/AIN-10/persist-generated-contexthandoff-artifacts-as-graph-nodes) tracks and completes the artifact/source relationship follow-up mirrored in GitHub issue [#5](https://github.com/kimasill/NeuralMap/issues/5).
- Saved Context Packs and Handoff Packs now materialize graph `Artifact` nodes.
- Artifact nodes get `references` edges to their source node sets in both DB-backed and sample graph data sources.
- Artifact materialization runs through the existing cross-source linker so generated evidence can connect to repository paths and code nodes.

### Track C: Fastify API and trace middleware

Linear: [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware)

Implement the initial Agent, Context, Graph, Cache, and Workbench API surfaces with trace span capture.

Initial slice:

- `apps/api` exposes health, agent, graph, context, handoff, cache, and workbench endpoints backed by sample graph memory.

Persistence slice:

- API now uses a DB-backed graph data source with sample fallback and exposes ingest endpoints.

Local DB ingest slice:

- Root scripts and local infrastructure config now cover Postgres/pgvector, Redis, migrations, repository seeding, and Windows fallback to WSL Docker Compose. This machine now runs Postgres/pgvector through WSL Docker, and the API verifies `database` mode locally.

Cache and trace slice:

- `packages/cache` and `packages/trace` now back the API cache stats and request trace hooks. Repeated `POST /graph/query` calls show first miss, second hit, and `/workbench/runs/:id/trace` can return live request spans.

Workbench context loop slice:

- API records domain spans for cache lookup, retrieval, graph expansion, context composition, and handoff creation. `/context/handoff` now accepts `context_pack_id`.

Artifact history slice:

- API exposes `/workbench/artifacts` and `/context/handoffs/:id`, backed by both DB and sample data sources.

Context refresh slice:

- API exposes `POST /context/packs/:id/refresh` and records refresh operations as `context_pack` trace spans.

Intent-aware retrieval slice:

- API `/graph/query` returns query intent, records it in trace attributes, and uses it to tune expansion depth and edge boosts.

Graph neighborhood cache slice:

- API `GET /graph/nodes/:id/neighbors` and `POST /graph/query` now use the `graph_neighborhood` cache, while graph writes and ingest endpoints invalidate retrieval and neighborhood caches.

Template and prompt cache slice:

- API exposes `/context/templates` and records prompt-segment cache hit/miss spans during Context Pack composition and refresh.

DB trace store foundation slice:

- API trace storage now uses a DB-backed trace store when `DATABASE_URL` is configured and keeps in-memory fallback otherwise.
- DB-mode trace persistence is verified locally with `pnpm db:smoke:required` against WSL Docker Postgres/pgvector.

Summary and response cache foundation slice:

- API compose and refresh paths now record summary-cache spans and update `/cache/stats` through the `summary` layer.
- API agent run path now records response-cache spans and updates `/cache/stats` through the `response` layer.

DB smoke graduation slice:

- Added `pnpm db:smoke` and `pnpm db:smoke:required` for DB-backed graph, Context Pack, Handoff Pack, and trace persistence verification.
- Local WSL Docker Postgres/pgvector and `DATABASE_URL` are configured; `pnpm db:smoke:required` now passes in `database` mode.

### Track D: Graph workbench UI

Linear: [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui)

Implement the React + Cytoscape workbench with agent panel, graph canvas, context inspector, and run trace foundation.

Initial slice:

- `apps/workbench` renders the agent panel, Cytoscape graph canvas, context inspector, and trace panel with API-backed data and local fallbacks.

Persistence slice:

- Workbench shows a source badge so users can tell whether the graph is coming from `Database` or `Sample` data.

Local DB ingest slice:

- Workbench switches to `Database` once the API reads persisted graph nodes. Current local verification shows DB-backed API graph data after WSL Docker Postgres/pgvector is started and repository ingest runs.

Cache and trace slice:

- Workbench trace endpoints can now display live API request spans when called with a recorded run ID, while preserving sample trace fallback for the default demo run.

Workbench context loop slice:

- Workbench can query the graph, highlight returned neighborhoods, show cache hit/miss state, compose Context Packs, create Handoff Packs, and refresh the live run trace for the same workbench run ID.

Artifact history slice:

- Workbench now shows recent Context/Handoff artifacts and lets users reselect them from the inspector.

Context refresh slice:

- Workbench Context Pack panel now lets users refresh the selected pack and reload artifact history afterward.

Intent-aware retrieval slice:

- Workbench graph query summary now displays detected intent and confidence.

Template and prompt cache slice:

- Workbench Context Pack previews now show the selected template and prompt segment cache hit/miss state.

Evidence drill-down slice:

- Context Pack metadata now records node inclusion explanations.
- Workbench evidence items can jump to source nodes, and the Inspector shows why the selected node was included.

Summary and response cache foundation slice:

- Workbench Context Pack previews now show summary cache hit/miss state and compact summary content.

Phase 1 completion:

- AIN-9 is complete for Phase 1; handoff relationship and timeline overlays are now Phase 2 work.

### Phase 4: Dynamic Profiling

Linear: [AIN-11](https://linear.app/aineuralmap/issue/AIN-11/phase-4-dynamic-profiling)

Complete the Dynamic Profiling phase for NeuralMap.

Completed slice:

- `packages/core` defines deterministic model profile policy and route classification.
- `apps/api` exposes profile dashboard, route decision, and feedback endpoints.
- `POST /agents/:id/run` routes through selected model profiles and preserves deterministic response caching.
- `apps/workbench` surfaces selected profile, route reasons, budget pressure, reasoning effort, and Good/Weak feedback.
- Phase 4 docs and blueprint coverage now mark Dynamic Profiling complete.

Verification:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache` -> 6 files, 28 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 119 files, 120 nodes, 120 edges, 404 chunks
- `pnpm db:smoke:required` -> `mode: database`, 117 graph nodes loaded, 1 trace span loaded
- API live smoke: model profile dashboard, route, agent run, and feedback endpoints return the expected Dynamic Profile loop.

## GitHub Follow-Up Issues

| GitHub | Track | Status |
| --- | --- | --- |
| [#1](https://github.com/kimasill/NeuralMap/issues/1) | Track D: Workbench evidence drill-down and why-this-node UX | Done |
| [#2](https://github.com/kimasill/NeuralMap/issues/2) | Track A/C: Summary and response cache foundation | Done |
| [#3](https://github.com/kimasill/NeuralMap/issues/3) | Track C: Persist trace spans in DB-backed trace store | Done |
| [#4](https://github.com/kimasill/NeuralMap/issues/4) | Track A/B: Hybrid keyword/vector retrieval path | Done |
| [#5](https://github.com/kimasill/NeuralMap/issues/5) | Track B: Cross-source linker for repository, tickets, and artifacts | Artifact follow-up done in AIN-10 |
