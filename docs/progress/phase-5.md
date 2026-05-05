# Phase 5 Control Board

Date started: 2026-05-04

Blueprint: `docs/agent_context_graph_framework_blueprint.md`

## Goal

Turn the single-agent shell into a reusable runtime foundation:

- Register generic agents with model profile preferences, context budgets, permissions, and output contracts.
- Compose scoped Context Packs per agent/role.
- Validate proposed memory writes before they become durable graph memory.
- Keep tenant scopes, redaction, embedding provider metadata, and memory consolidation framework-level and product-neutral.

## Current Status

Phase 5 is now partially implemented as of 2026-05-04. The first runtime slice covers Linear todo items [AIN-12](https://linear.app/aineuralmap/issue/AIN-12/content-module-metadata-and-activation-aware-retrieval), [AIN-13](https://linear.app/aineuralmap/issue/AIN-13/generic-event-salience-and-memory-consolidation), [AIN-14](https://linear.app/aineuralmap/issue/AIN-14/phase-5-generic-agent-registry-and-per-agent-context-composer), [AIN-15](https://linear.app/aineuralmap/issue/AIN-15/external-embeddings-and-vector-backfill-controls), and [AIN-16](https://linear.app/aineuralmap/issue/AIN-16/tenant-safe-scoped-retrieval-and-redaction).

| Track | Status | Owner Path | Notes |
| --- | --- | --- | --- |
| A: content modules | Done | `packages/ingest`, `packages/core`, `apps/api` | Generic metadata convention, activation-aware retrieval, disabled/versioned modules, parent-child expansion. |
| B: memory consolidation | Done | `packages/core`, `apps/api` | Event streams consolidate into durable Summary/Decision memory with evidence links and raw-event suppression. |
| C: agent registry | Partial | `packages/core`, `apps/api` | Generic registry, per-agent context composition, run transition validation, memory-write validation. |
| D: embeddings/backfill | Partial | `packages/db`, `apps/api` | Provider metadata and health/backfill controls are in place; real external network provider adapters remain. |
| E: tenant/redaction safety | Partial | `packages/schema`, `packages/db`, `apps/api` | Scope propagation, scoped retrieval/artifacts/traces/cache keys, API auth/rate-limit hooks, redaction workflow. |

## Completed Slice: Linear Todo Foundation

Completed on 2026-05-04:

- Added shared graph scope contracts for tenant/workspace/project/owner boundaries.
- Added content-module ingest and API endpoints for save, read, and activation-aware query.
- Context Pack composition now filters disabled/redacted/out-of-scope modules, records included module explanations, and expands parent-child module relationships.
- Added generic event-memory consolidation for session/workflow event streams, producing durable Summary/Decision memory with `summarizes`, `derived_from`, and `contradicts` evidence edges.
- Context composition now prefers consolidated memory nodes over covered raw event nodes.
- Added generic agent definitions, registry endpoints, per-agent context composer, run state transition validation, and proposed memory-write validation.
- Added embedding provider metadata, health endpoint, and backfill controls for nodes/chunks.
- Added scoped graph/context/artifact/trace filtering, cache scope keys/tags, API key hooks, per-scope rate-limit hooks, and redaction workflow.

## Verification

- `pnpm test` -> 6 files, 36 tests passed
- `pnpm typecheck`
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 133 files, 134 nodes, 134 edges, 510 chunks

## Remaining Phase 5 Work

- Real orchestrator execution loop with durable run persistence.
- Human approval nodes for high-risk memory writes.
- External embedding provider adapters beyond deterministic fallback-compatible metadata.
- Workbench UX for agent registry, memory validation queues, redaction audit history, and embedding backfill jobs.
