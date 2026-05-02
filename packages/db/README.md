# @neuralmap/db

Postgres + pgvector schema for the NeuralMap memory backbone.

## Tables

- `graph_nodes` and `graph_edges` store durable knowledge graph memory.
- `content_chunks` stores retrievable text chunks and vector embeddings.
- `context_packs` and `handoff_packs` persist reconstructed session context.
- `trace_runs` and `trace_spans` capture runtime observability.

IDs are stable text identifiers instead of database-generated UUIDs. This keeps repository, ticket, document, Context Pack, and Handoff Pack IDs consistent across ingest, API, UI, and persisted graph state.

## Local Migration

```bash
pnpm db:migrate
```

The first migration enables `pgcrypto` and `vector`, so the target database user needs permission to create extensions.
