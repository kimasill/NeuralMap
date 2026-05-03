# Phase 2 Control Board

Date started: 2026-05-03

Blueprint: `docs/agent_context_graph_framework_blueprint.md`

## Goal

Turn the Memory Backbone into an inspectable Graph UX:

- Make Context/Handoff artifact relationships visible.
- Show reference order across runs, traces, and graph nodes.
- Keep graph exploration usable as repository ingest grows.
- Preserve the Phase 1 loop while improving explanation and debugging surfaces.

## Current Status

Phase 2 is complete as of 2026-05-03. Phase 1 delivered the graph/context/handoff/cache/trace backbone and a usable Workbench foundation. Phase 2 completed the Graph UX layer on top of it: Handoff relationships, timeline inspection, repository-scale graph controls, and DB-mode verification against Postgres/pgvector.

DB-mode verification now runs on this machine through Docker Engine in WSL Ubuntu 24.04. Docker Desktop installation required UAC and could not be completed non-interactively, so Postgres/pgvector and Redis are running from `compose.yaml` inside WSL Docker. `DATABASE_URL` is configured for the current WSL address.

| Track | Status | Owner Path | Notes |
| --- | --- | --- | --- |
| A: handoff relationships | Done | `apps/workbench`, `apps/api`, `packages/ingest` | Context/Handoff artifact continuity, source Context Pack, referenced nodes, and run linkage are visible. |
| B: timeline UX | Done | `apps/workbench`, `apps/api`, `packages/trace` | Shows Context/Handoff artifacts, artifact links, and run/span history in time order. |
| C: graph scale controls | Done | `apps/workbench` | Node type, source, artifact visibility, importance, confidence, max-node, and group-density controls are available. |
| D: DB-mode UX verification | Done | `packages/db`, `apps/api` | Required smoke, repository DB ingest, API health, graph, and timeline checks passed in database mode. |

## Starting Baseline

Already available from Phase 1:

- Cytoscape graph canvas with query highlighting.
- Context Inspector with evidence drill-down and why-included explanations.
- Context Pack composition, refresh, Handoff Pack creation, and artifact history.
- Cache stats for retrieval, graph-neighborhood, prompt-segment, summary, and response layers.
- HTTP/domain trace spans visible through Workbench trace reads.
- Generated Context/Handoff artifacts persisted as graph `Artifact` nodes.

## Completed Slice: Handoff Relationships

Completed on 2026-05-03:

- Handoff Packs now persist source Context Pack metadata via `metadata.context_pack_id`.
- Handoff artifact materialization now creates `handed_off_to` graph edges from `artifact:context:*` to `artifact:handoff:*`.
- API `/workbench/artifacts` now returns artifact relationship records.
- API `/workbench/artifacts/handoffs/:id/relationship` provides direct relationship lookup for a selected Handoff Pack.
- Workbench selection of a Handoff Pack now restores its source Context Pack, referenced nodes, and run trace context.
- Workbench includes a Handoff Relationship panel showing source artifact, handoff artifact, run/session linkage, and referenced nodes.
- API coverage verifies relationship lookup, Handoff metadata, graph artifact nodes, `references` edges, and the `handed_off_to` edge.

Verification:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache` -> 5 files, 21 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 114 files, 115 nodes, 115 edges, 321 chunks
- `pnpm db:smoke:required` -> database mode passed after local WSL Docker/Postgres setup

## Completed Slice: Timeline UX

Completed on 2026-05-03:

- API added `/workbench/timeline` to merge Context Pack, Handoff Pack, artifact relationship, and trace span events.
- Context Pack compose and refresh now record `metadata.source_run_id`, so packs appear in the run timeline before a handoff exists.
- Timeline events include artifact IDs, referenced node IDs, span IDs/kinds, run IDs, summaries, and compact metrics.
- Workbench bottom panel now shows Timeline and Run Trace side by side without adding extra fetch waterfalls.
- Timeline events are clickable: Handoff events restore the Handoff/Context relationship, Context events restore the pack, and node-bearing events jump to the referenced node.
- API coverage verifies Context Pack timeline visibility before handoff, relationship timeline events after handoff, trace span events, and descending event order.

Verification:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache apps/api/src/server.test.ts` -> 1 file, 8 tests passed
- `pnpm exec vitest run --no-cache` -> 5 files, 21 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 114 files, 115 nodes, 115 edges, 335 chunks
- `pnpm db:smoke:required` -> database mode passed after local WSL Docker/Postgres setup
- Local smoke: `GET /workbench/timeline?run_id=run_workbench_phase_1` returns timeline events in sample mode

## Completed Slice: Repository-Scale Graph Controls

Completed on 2026-05-03:

- Workbench now derives a filtered `visibleGraph` from the loaded graph without changing the API fetch path.
- Graph controls support node type filters, source-system filters, artifact visibility, minimum node importance, minimum edge confidence, and maximum visible node count.
- Group mode supports type/source/none views with compact density summaries and click-to-filter group rows.
- Query highlighting and selection now operate against the visible graph while preserving full-graph node metadata for inspector labels.
- Mobile layout keeps controls in-flow instead of overlaying the graph canvas.

Verification:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache apps/api/src/server.test.ts` -> 1 file, 8 tests passed
- Local environment check: Docker Engine is installed in WSL Ubuntu 24.04; `DATABASE_URL` points to the running WSL Postgres/pgvector service.

## Completed Slice: DB-Mode UX Verification

Completed on 2026-05-03:

- Installed WSL Ubuntu 24.04 and Docker Engine with Compose support after Docker Desktop installation was blocked by UAC.
- Installed Windows Docker CLI and Docker Compose CLI aliases; the daemon path for this workstation is WSL Docker.
- Updated `pnpm infra:up` and `pnpm infra:down` to use Docker Desktop when available and fall back to WSL Docker Compose on Windows.
- Started Postgres/pgvector and Redis from `compose.yaml` inside WSL Docker.
- Configured `.env`, user `DATABASE_URL`, and user `REDIS_URL` for the current WSL service address.
- Ran Drizzle migrations against Postgres/pgvector.
- Ran the required DB smoke for graph, Context Pack, Handoff Pack, and trace persistence.
- Seeded the current repository into Postgres and restarted the API with `DATABASE_URL`.
- Verified API `GET /health` reports `graph_mode: database`.
- Verified API `GET /workbench/graph/subgraph` returns database graph data: 117 nodes and 116 edges.
- Verified API `GET /workbench/timeline?run_id=phase1-db-smoke-run` returns DB-backed timeline events.

Verification:

- WSL Docker: `Docker version 29.1.3`; `Docker Compose version 2.40.3`
- Windows CLI: `Docker version 29.4.2`; `Docker Compose version v5.1.3`
- `pnpm infra:up` -> WSL Docker fallback starts/reuses Postgres and Redis
- `docker compose up -d postgres redis` from WSL -> both services healthy
- `pnpm db:migrate` -> migrations applied successfully
- `pnpm db:smoke:required` -> `mode: database`, 117 graph nodes loaded, 1 trace span loaded
- `pnpm db:seed:repo` -> 114 files, 115 nodes, 115 edges, 347 chunks
- API `GET /health` -> `graph_mode: database`
- API `GET /workbench/graph/subgraph` -> `mode: database`, 117 nodes, 116 edges
- API `GET /workbench/timeline?run_id=phase1-db-smoke-run` -> 4 events

## Phase 2 Exit

Phase 2 Graph UX is complete in this repository:

- Handoff relationships are visible and queryable.
- Timeline and run trace are inspectable together.
- Graph density controls are available for larger repository graphs.
- DB-mode verification passes against local Postgres/pgvector through `pnpm db:smoke:required`.

Follow-up:

- Phase 3 Smart Caching is now complete in [phase-3.md](phase-3.md).

Final verification:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache` -> 5 files, 21 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 114 files, 115 nodes, 115 edges, 347 chunks
- `pnpm db:smoke:required` -> `mode: database`, 117 graph nodes loaded, 1 trace span loaded
- Local smoke: API `GET /workbench/graph/subgraph` returns 200; Workbench `GET /` returns 200

## Verification Baseline

Carry forward for every Phase 2 slice:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache`
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry`

DB-mode:

- `pnpm db:smoke:required`
