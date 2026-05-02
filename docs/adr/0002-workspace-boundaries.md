# ADR 0002: Workspace Package Boundaries

Status: Accepted

Date: 2026-05-02

## Context

The blueprint separates durable graph memory, retrieval, ingest, cache, trace, API, and graph workbench concerns. Phase 1 needs package boundaries that allow parallel work without file conflicts while keeping the contracts centralized.

## Decision

Use this monorepo structure:

```text
packages/
  schema/    Shared TypeScript and Zod contracts.
  db/        Postgres, pgvector, Drizzle schema, migrations.
  core/      Retrieval, graph expansion, Context Pack Composer.
  ingest/    Repository, document, and ticket ingest pipelines.
  cache/     L1-L4 cache adapters and invalidation policy.
  trace/     Trace helpers and observability adapters.
apps/
  api/       Fastify API surface.
  workbench/ React + Cytoscape graph UX.
docs/
  adr/       Architecture decision records.
```

Step 0 creates `packages/schema`, `packages/db`, and ADRs. Later Step 1 tracks can fill `core`, `ingest`, `api`, and `workbench` in parallel.

## Consequences

- `packages/schema` is the source of truth for shared runtime contracts.
- `packages/db` owns persistence shape and migration history.
- API and UI code should import shared contracts instead of redefining request and response shapes.
- Future workers should own disjoint package or app paths to avoid merge conflicts.

## Alternatives Considered

- Single backend package: faster first commit, weaker parallelization and higher coupling.
- App-first folder layout: natural for a product UI, less clear for a framework whose core contracts must be reused by multiple runtimes.

