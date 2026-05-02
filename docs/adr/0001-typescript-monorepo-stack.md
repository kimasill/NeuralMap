# ADR 0001: TypeScript Monorepo MVP Stack

Status: Accepted

Date: 2026-05-02

## Context

The blueprint defines the core contracts in TypeScript and centers the product on shared Context Pack, Handoff Pack, graph, trace, and cache interfaces. Phase 1 needs a low-friction stack that can support the memory backbone and the first graph UX without adding multiple language runtimes.

## Decision

Use the following MVP stack:

- Backend: TypeScript, Node.js, Fastify.
- Frontend: React, Vite, TypeScript, Cytoscape.js.
- Data: Postgres, pgvector, Redis.
- ORM and migrations: Drizzle ORM.
- Monorepo: pnpm workspaces.

## Consequences

- Shared contracts can live in `packages/schema` and be consumed by API, workers, and UI without translation.
- Phase 1 can keep the operational model simple while still supporting vector search through pgvector.
- Python-first RAG frameworks are not imported directly in the MVP. When needed, they should be integrated through MCP, HTTP, or a later worker boundary.
- Turborepo is deferred until workspace task orchestration becomes a bottleneck.

## Alternatives Considered

- Python backend with FastAPI: stronger immediate access to RAG libraries, weaker shared type story for the planned TS UI and API contracts.
- Neo4j in MVP: stronger graph traversal, higher operational surface before the core product contract is proven.
- React Flow for the graph UX: good for node editors, less suitable than Cytoscape.js for larger physical graph layouts.

