# Phase 1 Control Board

Date started: 2026-05-02

Blueprint: `docs/agent_context_graph_framework_blueprint.md`

## Goal

Build the first Memory Backbone slice and prepare the Graph UX foundation:

- Shared graph, Context Pack, Handoff Pack, run, and trace contracts.
- Postgres + pgvector migration and Drizzle schema.
- Documentation and Linear issue tracking for the Phase 1 work.

## Current Status

Phase 1 is complete as of 2026-05-03. The first Memory Backbone loop is implemented: ingest project knowledge, retrieve hybrid graph context, expand the neighborhood, compose a Context Pack, create a Handoff Pack, inspect artifacts/cache/trace behavior, and persist runtime artifacts as graph nodes.

Blueprint coverage estimate: full blueprint **62%**, MVP scope **93%**. See [blueprint-coverage.md](blueprint-coverage.md) and [roadmap.md](roadmap.md).

| Track | Status | Owner Path | Notes |
| --- | --- | --- | --- |
| Step 0: schema + db + ADR | Done | `packages/schema`, `packages/db`, `docs/adr` | [AIN-5](https://linear.app/aineuralmap/issue/AIN-5/step-0-bootstrap-memory-backbone-contracts) |
| A: core retrieval + context composer | Done | `packages/core` | [AIN-6](https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer) |
| B: repo/doc/ticket ingest | Done | `packages/ingest` | [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest) |
| C: Fastify API + trace middleware | Done | `apps/api` | [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware) |
| D: React workbench graph UI | Done | `apps/workbench` | [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui) |

Tracker sync note:

- Linear connection verified on 2026-05-03. Team `AINeuralMap` and issues AIN-5 through AIN-11 are reachable from the current Codex session.
- GitHub fallback issues remain useful as a mirror. Their Phase 1 substance is covered locally: [#1](https://github.com/kimasill/NeuralMap/issues/1), [#2](https://github.com/kimasill/NeuralMap/issues/2), [#3](https://github.com/kimasill/NeuralMap/issues/3), [#4](https://github.com/kimasill/NeuralMap/issues/4), and [#5](https://github.com/kimasill/NeuralMap/issues/5) are implemented; [#3](https://github.com/kimasill/NeuralMap/issues/3) is verified by `pnpm db:smoke:required` against local Postgres/pgvector.

## Decisions Locked

- TypeScript + Node.js + Fastify backend.
- React + Vite + TypeScript + Cytoscape.js frontend.
- Postgres + pgvector + Redis data layer.
- Drizzle ORM for schema and migrations.
- pnpm workspaces for the monorepo.

## Step 0 Exit Criteria

- Done: `pnpm install` completes.
- Done: `pnpm typecheck` passes for `packages/schema` and `packages/db`.
- Done: `pnpm build` passes.
- Done: Drizzle migration check passes.
- Done: ADR 0001-0003 exist.
- Done: Linear issues exist for Step 0 and Step 1 tracks.
- Done: Git repository has the Step 0 bootstrap committed locally.

## Verification

- `pnpm typecheck`
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`

## Step 1 Initial Slice

Completed on 2026-05-02:

- `packages/core`: lexical seed retrieval, graph expansion, Context Pack composition, Handoff Pack creation, and sample graph memory.
- `packages/ingest`: document, repository, and ticket ingest helpers with chunk emission and import dependency edges.
- `apps/api`: Fastify health, agent, graph, context, cache, and workbench endpoints with trace hook logging.
- `apps/workbench`: React + Cytoscape workbench with agent panel, graph canvas, inspector, and run trace.

Completed in the next persistence slice:

- `packages/db`: graph store repository for graph nodes, edges, chunks, Context Packs, and Handoff Packs.
- `packages/db`: initial migration corrected to use stable text IDs that match shared schema and ingest emissions.
- `apps/api`: DB-backed graph data source with sample fallback when `DATABASE_URL` is not configured or DB data is empty.
- `apps/api`: ingest endpoints for document, repository, and ticket snapshots.
- `apps/workbench`: graph source badge shows whether the current view is `Database` or `Sample`.

Current Workbench data note:

- `Sample` means the graph is in-memory bootstrap/fallback data.
- `Database` means graph nodes and edges are being loaded from Postgres via the API.
- As of 2026-05-03, local dev can show `Database` after starting the WSL Docker Postgres/pgvector service and running repository ingest.

Local dev URLs:

- API: `http://localhost:4317`
- Workbench: `http://localhost:5173`

Verification:

- `pnpm typecheck`
- `pnpm build`
- API `GET /health`
- Workbench `GET /`
- API `POST /ingest/ticket`
- API `POST /context/compose`

## Local Database Ingest Slice

Completed on 2026-05-02:

- Added `compose.yaml` for local Postgres + pgvector and Redis.
- Added root scripts for `infra:up`, `infra:down`, `db:seed:repo`, and `db:seed:repo:dry`.
- Added repository scanner and CLI ingest command in `packages/ingest`.
- Added local ingest how-to at `docs/how-to/local-database-ingest.md`.

Verification:

- `pnpm typecheck`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm build`
- `pnpm db:seed:repo:dry`
- API `GET /health`
- Workbench `GET /`

## Test and CI Slice

Completed on 2026-05-02:

- Added Vitest test coverage for `packages/core`, `packages/ingest`, and `apps/api`.
- Added GitHub Actions CI for install, typecheck, test, build, Drizzle migration check, and repo ingest dry-run.
- API tests cover sample-mode health and ingest-to-context composition.
- Core tests cover seed ranking, graph expansion, and Context Pack composition.
- Ingest tests cover repository import edges and filesystem scanning.

Verification:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 90 files, 91 nodes, 91 edges, 166 chunks

## Cache and Trace Slice

Completed on 2026-05-02:

- Added `packages/cache` with stable cache keys, L1-L4 layer names, in-memory storage, and hit/miss/write/eviction stats.
- Added `packages/trace` with in-memory trace storage and span recorder helpers.
- API `/graph/query` now caches repeated graph query responses and reports cache metadata.
- API `/cache/stats`, `/cache/invalidate`, and `/cache/key/:id` now use the shared cache package.
- API request tracing now records `user_request` spans through the shared trace package.
- Workbench trace endpoint can read live request spans for a run ID, with sample spans as fallback.

Verification:

- `pnpm test` -> 5 files, 12 tests passed
- `pnpm typecheck`
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 104 files, 105 nodes, 105 edges, 185 chunks
- API repeated `POST /graph/query` -> first miss, second hit
- API `GET /cache/stats`
- API `GET /workbench/runs/http-smoke/trace`

DB follow-up:

- Docker Engine now runs in WSL Ubuntu 24.04 for this machine, with Postgres/pgvector and Redis started from `compose.yaml`.
- `pnpm infra:up` and `pnpm infra:down` now fall back to WSL Docker Compose when Docker Desktop is unavailable on Windows.
- `DATABASE_URL` and `REDIS_URL` are configured for the current WSL service address.
- `pnpm db:migrate`, `pnpm db:smoke:required`, and `pnpm db:seed:repo` now switch the API and Workbench path to `Database`.

## Workbench Context Loop Slice

Completed on 2026-05-03:

- API records domain trace spans for graph cache lookup, seed retrieval, graph expansion, Context Pack composition, and Handoff Pack creation.
- API `/context/handoff` can now attach a saved `context_pack_id`, so Handoff Packs inherit decisions, blockers, and referenced node IDs from the composed Context Pack.
- Workbench graph search can execute `/graph/query`, highlight the returned neighborhood in Cytoscape, and show seed/node/edge counts plus cache hit/miss state.
- Workbench inspector can compose a Context Pack from the selected/query neighborhood and create a Handoff Pack from that saved Context Pack.
- Workbench API client sends a stable workbench run header so live trace reads include the query/context/handoff loop.
- Added API coverage for saved Context Pack to Handoff Pack creation and domain trace span recording.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 13 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 104 files, 105 nodes, 105 edges, 201 chunks

## Artifact History Slice

Completed on 2026-05-03:

- `packages/db` graph store can now list recent Context Packs and Handoff Packs and fetch a saved Handoff Pack by ID.
- API added `/workbench/artifacts` for recent Context/Handoff Pack history and `/context/handoffs/:id` for direct Handoff Pack lookup.
- Sample fallback data source keeps the same artifact listing and lookup behavior without Postgres.
- Workbench loads artifact history alongside graph, agent, and trace data, then refreshes that history after compose/handoff actions.
- Workbench inspector now includes an Artifacts list so users can reselect recent Context Packs or Handoff Packs.
- API coverage now verifies saved Handoff lookup and artifact history after a Context Pack to Handoff Pack loop.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 13 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 105 files, 106 nodes, 106 edges, 222 chunks

## Context Pack Refresh Slice

Completed on 2026-05-03:

- API added `POST /context/packs/:id/refresh`, matching the blueprint API draft.
- Refresh creates a new Context Pack from the previous pack's objective, agent, session, token budget, and node set, with optional query/objective/token/seed overrides.
- Refresh operations are recorded as `context_pack` domain trace spans.
- Workbench Context Pack panel now has a Refresh action for the selected Context Pack.
- Artifact history refreshes after Context Pack refresh, so regenerated packs remain selectable in the inspector.
- Blueprint coverage report added at `docs/progress/blueprint-coverage.md`.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 13 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 106 files, 107 nodes, 107 edges, 230 chunks

## Intent-Aware Retrieval Slice

Completed on 2026-05-03:

- Added rule-based query intent classification in `packages/core`.
- Seed retrieval now adds type-aware boosts and reasons based on query intent.
- API `/graph/query` now returns the detected intent, includes intent in trace attributes, and uses intent hints for graph expansion depth and edge-type boosts.
- Workbench graph query summary now displays the detected intent and confidence.
- Blueprint coverage report updated from 28%/46% to 29%/47%.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 14 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 107 files, 108 nodes, 108 edges, 236 chunks

## Graph Neighborhood Cache Slice

Completed on 2026-05-03:

- API graph neighborhood expansion now uses the `graph_neighborhood` cache layer.
- `GET /graph/nodes/:id/neighbors` and `POST /graph/query` share cached expansion results.
- Graph writes and ingest endpoints invalidate retrieval and graph-neighborhood caches without clearing prompt or summary layers.
- Cache trace spans now include graph-neighborhood lookup hit/miss attributes.
- API coverage verifies neighborhood cache hit/miss/write behavior and ingest invalidation.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 15 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 108 files, 109 nodes, 109 edges, 240 chunks
- API live smoke: repeated `GET /graph/nodes/:id/neighbors` records graph-neighborhood cache hits, and `POST /ingest/ticket` evicts the cached neighborhood.

## Template and Prompt Cache Slice

Completed on 2026-05-03:

- Added a versioned context template registry in `packages/core` for implementation, design, bug investigation, documentation, ticket triage, handoff, validation, and related workflow templates.
- Context Pack composition now records selected template metadata, retrieval intent metadata, and prompt-segment cache metadata.
- API added `GET /context/templates`.
- API `/context/compose` and `/context/packs/:id/refresh` now reuse the `prompt_segment` cache layer for stable rendered template prompt segments.
- Workbench Context Pack previews show the selected template and prompt segment cache hit/miss state.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 17 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 109 files, 110 nodes, 110 edges, 254 chunks
- API live smoke: `GET /health`, `GET /context/templates`, and Workbench `GET /` return 200-level responses.

## Evidence Drill-Down Slice

Completed on 2026-05-03:

- Context Pack composition now records `metadata.node_explanations` for every included node.
- Node explanations distinguish direct seed, retrieved seed, and graph expansion inclusion paths.
- Explanations include retrieval reasons, seed score, evidence score, and the graph edge/path when available.
- Workbench evidence items are now clickable source-node buttons.
- The Inspector now shows a `Why Included` panel for the selected node when a Context Pack is active.
- Workbench composition now seeds from direct selection and query seeds, allowing graph-expanded nodes to keep a meaningful expansion reason.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 17 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 109 files, 110 nodes, 110 edges, 268 chunks
- API live smoke: `POST /context/compose` returns Context Pack `metadata.node_explanations`.
- Workbench live smoke: `GET /` returns 200.

## DB Trace Store Foundation Slice

Completed on 2026-05-03:

- Added a DB-backed trace store in `packages/db` that persists trace spans into `trace_runs` and `trace_spans`.
- API trace storage now uses the DB-backed trace store when `DATABASE_URL` is configured.
- API trace storage preserves the in-memory fallback when local Postgres is unavailable.
- `/workbench/runs/:id/trace` now awaits trace store reads, allowing DB-backed trace lookup.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 17 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 110 files, 111 nodes, 111 edges, 272 chunks
- API live smoke: sample fallback trace lookup returns a recorded `user_request` span.

DB verification:

- DB-mode trace persistence now has a required smoke command: `pnpm db:smoke:required`.
- The command now passes locally against WSL Docker Postgres/pgvector and verifies graph, Context Pack, Handoff Pack, and trace persistence.

## Summary and Response Cache Foundation Slice

Completed on 2026-05-03:

- API Context Pack composition and refresh now create deterministic context summaries.
- Context summaries are cached through the `summary` cache layer using objective, template, node set, evidence, decisions, and blockers.
- Context Pack metadata now records `context_summary` and `summary_cache` hit/miss information.
- Workbench Context Pack previews now show summary cache state and the compact summary content.
- API tests verify summary-layer hit/miss/write behavior through repeated Context Pack composition.
- Added a `response` cache layer for deterministic agent runtime responses.
- `POST /agents/:id/run` now accepts an optional `context_pack_id` and caches the generated agent response.
- Agent response cache keys include agent, objective/task, model profile, Context Pack node set, evidence scores, and summary metadata.
- API tests verify repeated agent runs produce response cache miss, then hit.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 18 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 110 files, 111 nodes, 111 edges, 283 chunks
- API live smoke: repeated `POST /context/compose` returns summary cache miss, then hit.
- API live smoke: repeated `POST /agents/main-agent/run` returns response cache miss, then hit.

## Cross-Source Linker Foundation Slice

Completed on 2026-05-03:

- Added `linkCrossSourceReferences` in `packages/ingest`.
- Ticket, document, task, and artifact-like text nodes can now link to repository file/test/repository nodes when they mention paths, content refs, or node IDs.
- API document, repository, and ticket ingest endpoints now enrich emissions with cross-source edges before persistence.
- Inferred edges include confidence, weight, matched text, and `cross_source_linker` metadata.
- Unit coverage verifies ticket-to-code path mention linking.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 19 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 111 files, 112 nodes, 112 edges, 287 chunks
- API live smoke: repository ingest followed by ticket ingest creates a ticket-to-CodeFile `references` edge with `path_mention` metadata.

Follow-up completion:

- Linear [AIN-10](https://linear.app/aineuralmap/issue/AIN-10/persist-generated-contexthandoff-artifacts-as-graph-nodes) completed the generated artifact graph node follow-up.

## Runtime Artifact Graph Node Slice

Completed on 2026-05-03:

- Verified Linear connectivity for the `AINeuralMap` workspace and created [AIN-10](https://linear.app/aineuralmap/issue/AIN-10/persist-generated-contexthandoff-artifacts-as-graph-nodes) under AIN-7.
- Added runtime artifact materialization for saved Context Packs and Handoff Packs.
- Context/Handoff artifacts now persist as graph `Artifact` nodes with `references` edges to their source node set.
- The artifact materialization path runs through the existing cross-source linker, so generated artifact evidence can create code/source relationships from path mentions.
- DB-backed and sample graph data sources now share the same artifact graph persistence behavior.
- Context composition filters generated runtime artifacts unless the detected intent explicitly prefers `Artifact` nodes, preventing immediate self-pollution of repeated compose/cache flows.

Verification:

- `pnpm typecheck`
- `pnpm test` -> 5 files, 20 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 112 files, 113 nodes, 113 edges, 298 chunks

## Hybrid Retrieval and Phase 1 Graduation Slice

Completed on 2026-05-03:

- `packages/core` seed retrieval now uses a hybrid scorer: exact lexical matches plus deterministic sparse vector similarity with domain aliases for semantic-style recall.
- Seed results now include lexical, semantic, and quality score components plus retrieval reasons such as `semantic:*` and `hybrid:lexical+semantic`.
- Context Pack metadata records retrieval mode, seed count, and semantic seed count.
- API `/graph/query` now reports retrieval metadata and carries hybrid seed scores in query responses.
- Workbench graph query summary now shows the retrieval mode and semantic seed count.
- Added `pnpm db:smoke` and `pnpm db:smoke:required` to exercise DB-backed graph, Context Pack, Handoff Pack, and trace span persistence when `DATABASE_URL` is configured.
- Updated the local database ingest guide with the DB smoke step.
- Phase 1 control state is graduated to complete; Phase 2 can now become the active focus.

Verification:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache` -> 5 files, 21 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 114 files, 115 nodes, 115 edges, 310 chunks
- `pnpm db:smoke:required` -> `mode: database`, 117 graph nodes loaded, 1 trace span loaded

## Phase 1 Exit Criteria

- Done: shared graph, Context Pack, Handoff Pack, run, trace, cache, and template contracts exist.
- Done: Postgres + pgvector Drizzle schema and migration check pass.
- Done: repository, document, ticket, and runtime artifact ingest paths emit graph nodes, edges, and chunks.
- Done: hybrid retrieval, graph expansion, Context Pack composition, refresh, Handoff Pack creation, summary cache, response cache, graph-neighborhood cache, and prompt-segment cache are implemented.
- Done: Workbench can inspect graph context, artifact history, cache state, trace spans, evidence drill-down, and why-included explanations.
- Done: DB-backed graph/trace smoke harness exists and is wired into package scripts.
- Done: `pnpm db:smoke:required` passes against local WSL Docker Postgres/pgvector.
