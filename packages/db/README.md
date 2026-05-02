# @neuralmap/db

Postgres + pgvector schema for the NeuralMap memory backbone.

## Tables

- `graph_nodes` and `graph_edges` store durable knowledge graph memory.
- `content_chunks` stores retrievable text chunks and vector embeddings.
- `context_packs` and `handoff_packs` persist reconstructed session context.
- `trace_runs` and `trace_spans` capture runtime observability.

## Local Migration

```bash
pnpm db:migrate
```

The first migration enables `pgcrypto` and `vector`, so the target database user needs permission to create extensions.

