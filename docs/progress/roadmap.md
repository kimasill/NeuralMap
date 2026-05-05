# Progress Roadmap

Date updated: 2026-05-04

## Active Phase

The active project phase is now **Phase 5: Multi-Agent Runtime**.

Phase 1, Phase 2, Phase 3, and Phase 4 are complete. Phase 1 graduated the Memory Backbone loop; Phase 2 graduated the Graph UX layer with Handoff relationships, Timeline/Trace inspection, repository-scale graph controls, and DB-required smoke against local Postgres/pgvector through WSL Docker. Phase 3 graduated Smart Caching with policy metadata, tagged entries, entry inspection, and targeted invalidation controls. Phase 4 graduated Dynamic Profiling with deterministic model profile policy, budget-aware routing, and quality feedback. Phase 5 now has its first framework slice: content modules, event-memory consolidation, scoped agent context, embedding backfill controls, and tenant-safe redaction.

The completed loop is:

- ingest project knowledge
- retrieve hybrid graph context
- retrieve pgvector semantic candidates in DB mode
- expand the graph neighborhood
- compose and refresh a Context Pack
- create a Handoff Pack
- persist generated artifacts as graph nodes
- inspect Context/Handoff artifact relationships
- inspect artifacts, cache policy/entries, evidence, why-included explanations, timeline, traces, and graph-density controls from the Workbench
- route agent work through dynamic model profiles with quality feedback
- preserve external simulation memory across sessions through continuity Context Packs
- isolate graph/context/artifact/trace reads by tenant scope and redact deleted knowledge
- compose per-agent Context Packs from registered agent definitions

## Phase Status

| Phase | Status | Progress Estimate | Tracking |
| --- | --- | ---: | --- |
| Phase 1: Memory Backbone | Complete | 100% | [phase-1.md](phase-1.md) |
| Phase 2: Graph UX | Complete | 100% | [phase-2.md](phase-2.md) |
| Phase 3: Smart Caching | Complete | 100% | [phase-3.md](phase-3.md) |
| Phase 4: Dynamic Profiling | Complete | 100% | [phase-4.md](phase-4.md), [AIN-11](https://linear.app/aineuralmap/issue/AIN-11/phase-4-dynamic-profiling) |
| Phase 5: Multi-Agent Runtime | Active | 38% | [phase-5.md](phase-5.md), [AIN-12](https://linear.app/aineuralmap/issue/AIN-12/content-module-metadata-and-activation-aware-retrieval), [AIN-13](https://linear.app/aineuralmap/issue/AIN-13/generic-event-salience-and-memory-consolidation), [AIN-14](https://linear.app/aineuralmap/issue/AIN-14/phase-5-generic-agent-registry-and-per-agent-context-composer), [AIN-15](https://linear.app/aineuralmap/issue/AIN-15/external-embeddings-and-vector-backfill-controls), [AIN-16](https://linear.app/aineuralmap/issue/AIN-16/tenant-safe-scoped-retrieval-and-redaction) |

## Phase Document Policy

- `phase-1.md` is now the completed Memory Backbone control board.
- `phase-2.md` is the completed Graph UX control board.
- `phase-3.md` is the completed Smart Caching control board.
- `phase-4.md` is the completed Dynamic Profiling control board.
- `phase-5.md` is the active Multi-Agent Runtime control board.

## Phase 2 Graduation Signals

Phase 2 can move toward exit once these are true:

- Done: Workbench shows handoff relationships between Context/Handoff artifacts and runs.
- Done: Workbench includes a timeline panel for node/run reference order.
- Done: Graph interactions remain legible with repository-scale ingested graphs.
- Cache, retrieval, and trace panels explain why the current graph state changed.
- Done: DB mode is smoke-tested with `pnpm db:smoke:required` against Postgres/pgvector.

## Phase 3 Graduation Signals

Phase 3 exited once these became true:

- Done: retrieval, graph-neighborhood, prompt-segment, summary, and response caches are active.
- Done: cache entries expose policy, age, expiry, tags, access count, and compact value summaries.
- Done: cache invalidation can target layer, key, key prefix, and tags.
- Done: Workbench exposes cache stats, recent entries, tag filtering, refresh, and invalidation controls.

## Phase 4 Graduation Signals

Phase 4 exited once these became true:

- Done: task classification feeds profile routing.
- Done: model profiles are explicit and inspectable.
- Done: budget-aware routing reports estimated input tokens, budget pressure, latency budget, and cost weight.
- Done: agent runs use selected model profiles.
- Done: quality feedback can be recorded and reused by the router.
- Done: Workbench exposes selected profile, routing reasons, budget pressure, and feedback controls.

## Managed Next Work

| Priority | Tracker | Work Item | Why Now |
| --- | --- | --- | --- |
| P0 | Phase 5 | Durable orchestrator execution loop | Turns registry/run-state contracts into persisted execution. |
| P1 | Phase 5 | Human approval nodes | Needed before high-risk memory writes become durable facts. |
| P1 | Phase 5 | Workbench runtime UX | Surfaces registered agents, validation queues, redaction audit, and backfill jobs. |
