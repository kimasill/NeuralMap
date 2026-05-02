# Phase 1 Control Board

Date started: 2026-05-02

Blueprint: `S:\Project\AIControlPlane\agent_context_graph_framework_blueprint.md`

## Goal

Build the first Memory Backbone slice and prepare the Graph UX foundation:

- Shared graph, Context Pack, Handoff Pack, run, and trace contracts.
- Postgres + pgvector migration and Drizzle schema.
- Documentation and Linear issue tracking for the Phase 1 work.

## Current Status

Step 0 is complete. Step 1 is in progress with initial slices implemented for all four tracks.

| Track | Status | Owner Path | Notes |
| --- | --- | --- | --- |
| Step 0: schema + db + ADR | Done | `packages/schema`, `packages/db`, `docs/adr` | [AIN-5](https://linear.app/aineuralmap/issue/AIN-5/step-0-bootstrap-memory-backbone-contracts) |
| A: core retrieval + context composer | In Progress | `packages/core` | [AIN-6](https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer) |
| B: repo/doc/ticket ingest | In Progress | `packages/ingest` | [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest) |
| C: Fastify API + trace middleware | In Progress | `apps/api` | [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware) |
| D: React workbench graph UI | In Progress | `apps/workbench` | [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui) |

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
- As of this slice, local dev is still showing `Sample` unless Postgres is configured and ingest data is persisted.

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

Environment note:

- Docker and local Postgres are not available on this machine, so `pnpm db:migrate` cannot connect to `localhost:5432`.
- Current local API still reports `graph_mode: sample`.
- Once Postgres is available, run `pnpm infra:up`, `pnpm db:migrate`, and `pnpm db:seed:repo` to switch the Workbench badge to `Database`.
