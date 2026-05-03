# GraphRAG Evaluation Report

Date tested: 2026-05-03

## Verdict

NeuralMap performs the current MVP GraphRAG loop:

- Dynamic graph memory can change at runtime through ingest and generated artifacts.
- Retrieval starts from hybrid lexical plus deterministic sparse vector-style semantic seed ranking.
- In DB mode, graph nodes and content chunks are embedded into pgvector columns and `/graph/query` uses pgvector candidates before graph expansion.
- Graph expansion follows relationship edges from the selected seeds.
- Context Packs preserve evidence, node inclusion explanations, template/cache metadata, and summaries.
- Handoff Packs create runtime artifact relationships that add new graph nodes and edges.
- External callers can use the framework through the Fastify REST API.
- External simulation platforms can stream session events and later request a continuity Context Pack for a new session.

It is not yet equivalent to a commercial or mature GraphRAG platform:

- No external learned embedding provider is configured yet; current embeddings are deterministic local sparse-hash vectors.
- pgvector SQL retrieval is active, but ranking still blends pgvector candidates with in-process lexical/sparse scoring.
- No LLM-based entity/relationship extraction, community detection, or global graph summaries exist yet.
- Agent output is deterministic and cached; it is not a real model call.
- Multi-agent runtime, durable orchestration state, ACL/redaction, hosted deployment, and external source connectors remain future work.

## Commands Run

```bash
pnpm db:seed:repo
pnpm eval:graphrag
$env:NEURALMAP_API_URL='http://127.0.0.1:4318'; pnpm eval:graphrag
pnpm build
pnpm bench:graphrag-core
pnpm db:smoke:required
pnpm eval:simulation
```

The 4318 API was started temporarily with `DATABASE_URL` loaded from `.env` and reported `graph_mode: database`.

## DB-Mode External API Evaluation

The `scripts/evaluate-graphrag.mjs` script behaves like an external program: it uses HTTP calls only.

| Check | Result |
| --- | --- |
| Health | Pass, `graph_mode: database` |
| Dynamic ingest | Pass, wrote 1 node, 2 edges, 1 chunk |
| Graph mutation | Pass, graph changed from 133 nodes / 172 edges to 134 nodes / 174 edges |
| GraphRAG query | Pass, 6 seeds, 6 semantic seeds, 12 pgvector seeds, `semantic_source: pgvector+local`, 80 neighborhood nodes, 120 neighborhood edges |
| Cache behavior | Pass, first graph query miss, repeated graph query hit |
| Context Pack | Pass, 10 nodes, 8 evidence items, 2 graph-expansion explanations |
| Dynamic profile route | Pass, route and agent run selected `balanced-agent` |
| Handoff artifact relationship | Pass, Context/Handoff relationship created |
| Runtime artifact mutation | Pass, final graph reached 136 nodes / 195 edges |

DB smoke also verifies pgvector directly:

- `pnpm db:smoke:required` -> `vector_seed_count: 20`
- `vector_seed_sources`: `pgvector_node`, `pgvector_chunk`

Latency from the DB-mode live HTTP smoke:

| Operation | Latency |
| --- | ---: |
| Ticket ingest | 22.63 ms |
| Cold graph query | 21.89 ms |
| Warm graph query | 2.74 ms |
| Context Pack compose | 31.40 ms |
| Model route | 2.61 ms |
| Agent run | 3.03 ms |
| Handoff + artifact lookup | 26.51 ms |

Repeated DB-mode HTTP benchmark:

| Path | Iterations | p50 | p95 | Avg |
| --- | ---: | ---: | ---: | ---: |
| Cached graph query | 30 | 2.37 ms | 3.55 ms | 2.79 ms |
| Model route | 20 | 1.92 ms | 2.54 ms | 1.99 ms |
| Cached agent run | 20 | 2.22 ms | 2.81 ms | 2.29 ms |

## Synthetic Core Graph Benchmark

This benchmark isolates the in-process TypeScript GraphRAG algorithms and does not write to Postgres.

| Synthetic Graph | Seed Ranking p50 | Expansion p50 | Context Compose p50 |
| --- | ---: | ---: | ---: |
| 100 nodes / 197 edges | 1.02 ms | 0.07 ms | 1.04 ms |
| 1,000 nodes / 2,042 edges | 8.28 ms | 0.33 ms | 8.23 ms |
| 5,000 nodes / 10,242 edges | 39.45 ms | 1.62 ms | 40.28 ms |

Observed scaling:

- In sample/in-process mode, seed ranking and Context Pack composition are linear over all nodes because seed retrieval scans the node set.
- In DB mode, pgvector now preselects semantic candidates, but the final hybrid ranking still loads graph memory and scans nodes.
- Graph expansion is fast for bounded `maxNodes` neighborhoods, but it still scans edges per hop.
- This is acceptable for the current small-to-mid MVP graph, but it needs indexed retrieval and adjacency maps before larger production graphs.

## Simulation Continuity Evaluation

The `scripts/evaluate-simulation-continuity.mjs` script behaves like a character chat platform:

1. It streams 18 simulation events to `/ingest/simulation-event`.
2. It opens a new session through `/simulation/context`.
3. It runs the agent with the returned Context Pack.

Sample-mode result:

| Check | Result |
| --- | --- |
| Events ingested | 18 |
| Source session | `scene-1` |
| Target session | `scene-2` |
| Context Pack nodes | 21 |
| Evidence items | 8 |
| Key memory recalled | silver key promise |
| Raw transcript estimate | 1021 tokens |
| Continuity context estimate | 607 tokens |
| Estimated saved tokens | 414 |
| Compression ratio | 0.595 |

DB-mode result:

| Check | Result |
| --- | --- |
| Events ingested | 18 |
| Source session | `scene-1` |
| Target session | `scene-2` |
| Context Pack nodes | 21 |
| Evidence items | 8 |
| Key memory recalled | silver key promise |
| Raw transcript estimate | 1021 tokens |
| Continuity context estimate | 607 tokens |
| Estimated saved tokens | 414 |
| Compression ratio | 0.595 |

This confirms the intended session-continuity pattern at the API level: an external platform does not need to resend the full transcript, log, or task history when a session changes; it can ask NeuralMap for a compact persistent memory pack. Character chat is only one validation scenario for this pattern.

`/simulation/context` scopes retrieval to the requested `simulation_id`, so multiple external products or scenarios can share the same NeuralMap instance without continuity packs bleeding across simulations by default.

## Commercial Framework Comparison

| Framework | Stronger Than NeuralMap Today | NeuralMap Advantage |
| --- | --- | --- |
| Microsoft GraphRAG | LLM graph extraction, community hierarchy, community summaries, Local/Global/DRIFT/Basic query modes. | Smaller custom TypeScript stack, runtime artifacts and Workbench are tailored to agent context handoff. |
| Neo4j GraphRAG | First-party Neo4j package, KG builder pipeline, graph/vector retrievers, provider integrations. | Postgres/pgvector MVP has lower operational overhead than adding a separate graph DB. |
| Amazon Bedrock Knowledge Bases GraphRAG | Fully managed GraphRAG with Neptune Analytics graph/vector storage and automatic relationship extraction. | Self-hostable and source-controllable; avoids managed-service lock-in. |
| LlamaIndex PropertyGraph / GraphRAG | Mature ingestion, LLM extractors, Neo4j property graph support, query engines. | NeuralMap owns graph contracts, Context/Handoff Pack lifecycle, and agent-workbench UX. |
| LangGraph | Durable state checkpoints, thread memory, human-in-the-loop, replay/time travel, fault tolerance. | NeuralMap is focused on knowledge/context graph memory rather than full agent workflow orchestration, though Phase 5 should close part of this gap. |

## External Program Readiness

External usage is viable through REST:

- `GET /health`
- `POST /ingest/document`
- `POST /ingest/repository`
- `POST /ingest/ticket`
- `POST /ingest/simulation-event`
- `POST /graph/query`
- `POST /context/compose`
- `POST /context/handoff`
- `POST /simulation/context`
- `GET /workbench/artifacts`
- `POST /model/route`
- `POST /agents/:id/run`

Current integration limitations:

- There is no published SDK package.
- REST schemas are validated by Zod but not exported as OpenAPI yet.
- Auth, tenants, ACL, rate limiting, and redaction are not implemented.
- Hosted deployment and secret management are not ready.

## Recommendation

The framework is ready for local and internal prototype use as a context-graph memory layer. It is not ready to claim production-grade commercial GraphRAG parity.

Next highest-impact work:

1. Add optional external embedding providers and backfill jobs while keeping deterministic embeddings as a local fallback.
2. Replace final scan-based hybrid ranking and graph expansion with adjacency indexes in memory and SQL traversal options in DB mode.
3. Add OpenAPI output and a tiny external client SDK.
4. Add LLM/entity relationship extraction for documents and tickets.
5. Start Phase 5 runtime: agent registry, per-agent context composer, validation/merge pipeline, and human approval checkpoints.
