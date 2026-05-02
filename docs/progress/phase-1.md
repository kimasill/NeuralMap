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

Local dev URLs:

- API: `http://localhost:4317`
- Workbench: `http://localhost:5173`

Verification:

- `pnpm typecheck`
- `pnpm build`
- API `GET /health`
- Workbench `GET /`
