# ADR 0003: Postgres and pgvector Memory Backbone

Status: Accepted

Date: 2026-05-02

## Context

The blueprint recommends an MVP memory backbone based on durable graph nodes, graph edges, semantic retrieval, Context Packs, Handoff Packs, and trace spans. The first implementation should avoid a separate graph database until the product has proven traversal and visualization requirements.

## Decision

Use Postgres as the primary store and pgvector as the MVP semantic index.

The initial schema stores:

- `graph_nodes`: durable memory nodes with type, source, scores, metadata, and optional embedding.
- `graph_edges`: directed typed relationships with weight, confidence, source run, and metadata.
- `content_chunks`: retrievable source chunks with optional embeddings.
- `context_packs`: reconstructed context used by an agent session.
- `handoff_packs`: compact transfer state for a new session.
- `trace_runs` and `trace_spans`: execution observability.

## Consequences

- The MVP can handle metadata, graph edges, trace data, and vector search in one operational database.
- Graph traversal remains application-driven in Phase 1.
- If graph workloads outgrow Postgres traversal, Neo4j can be added in V2 as a derived graph projection.
- Embedding dimensions are fixed at 1536 for the first migration and must be revisited if the embedding model changes.

## Alternatives Considered

- Neo4j from day one: better native graph querying, larger operational and synchronization burden.
- External vector database: stronger vector scaling options, more moving parts before retrieval policy is validated.
- JSON-only event store: flexible, but too weak for graph expansion and direct UI queries.

