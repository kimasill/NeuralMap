# Blueprint Coverage Report

Date assessed: 2026-05-04

Source blueprint: `docs/agent_context_graph_framework_blueprint.md`

## Overall Estimate

NeuralMap is roughly **74% complete against the full blueprint**.

Against the narrower MVP scope in section 20 of the blueprint, it is roughly **96% complete**. The current system has a complete Phase 1 Memory Backbone, completed Phase 2 Graph UX, completed Phase 3 Smart Caching, completed Phase 4 Dynamic Profiling, a partial Phase 5 runtime foundation, an initial pgvector-backed retrieval path, and an external simulation continuity API: DB schema, ingest basics, DB migrations and smoke against Postgres/pgvector, repository DB ingest, deterministic node/chunk embeddings, provider metadata and backfill controls, hybrid keyword/vector-style retrieval, pgvector semantic candidate search in DB mode, scoped content modules, event-memory consolidation, tenant-safe graph/context/artifact/trace filtering, redaction workflow, simulation event ingest, session continuity Context Packs, Context/Handoff Pack loop, refreshable artifacts, generated artifact graph nodes, Handoff artifact relationship edges, run timeline events, graph-density controls, retrieval, graph-neighborhood, prompt-segment, summary, and response cache usage, cache policy metadata, tagged cache entries, targeted invalidation rules, trace foundations, DB trace persistence verification, a versioned template registry, cross-source ticket-to-code/artifact linking, deterministic model profile policy, budget-aware profile routing, quality feedback capture, generic agent registry/per-agent context composition, and a usable graph workbench with evidence drill-down, node inclusion explanations, Handoff relationship inspection, Timeline/Trace views, repository-scale filtering, cache inspection controls, and Dynamic Profile inspection. The largest remaining gaps are full durable multi-agent orchestration, human approval workflow UX, hosted deployment, true external embedding network adapters, and external connector depth.

These percentages are engineering estimates, not product acceptance metrics.

## Phase Coverage

| Blueprint Area | Estimate | Current State |
| --- | ---: | --- |
| Phase 1: Memory Backbone | 100% | Shared schemas, Postgres/pgvector schema, ingest basics, cross-source linking, generated artifact graph nodes, hybrid retrieval, Context Pack Composer, template registry, Handoff Packs, refreshable Context Packs, DB/sample fallback, artifact history, node inclusion explanations, DB trace store foundation, summary cache, response cache foundation, and DB smoke harness are complete for Phase 1. |
| Phase 2: Graph UX | 100% | Complete: Cytoscape graph, source badge, inspector, query highlight, query intent display, trace panel, timeline panel/API, context refresh, context/handoff/artifact loop, template/cache badges on Context Packs, evidence drill-down, why-this-node inspector, Handoff relationship panel/API lookup, repository-scale graph controls, and DB-mode smoke against Postgres/pgvector. |
| Phase 3: Smart Caching | 100% | Retrieval, graph-neighborhood, prompt-segment, summary, and response caches are active with stable keys, per-layer TTL/max-entry policies, tagged entries, inspection APIs, key/layer/tag/prefix invalidation, ingest/write invalidation for graph caches, and Workbench cache controls. |
| Phase 4: Dynamic Profiling | 100% | Query intent classification feeds deterministic model profile policy, budget-aware routing, agent-run profile selection, quality feedback capture, and Workbench profile inspection. |
| Phase 5: Multi-Agent Runtime | 38% | Generic agent registry, per-agent Context Pack composition, run state transition validation, proposed memory-write validation, content modules, event-memory consolidation, scope/redaction controls, and embedding backfill controls exist. Missing durable orchestrator execution, human approval nodes, Workbench runtime management UX, and real external model execution. |

## Component Coverage

| Component | Estimate | Notes |
| --- | ---: | --- |
| Graph schema and storage | 90% | Core graph/context/handoff/trace tables, shared contracts, generated artifact graph nodes, scope metadata, redaction marking, local Postgres/pgvector execution, and DB smoke verification exist. Object storage and hosted DB execution remain. |
| Repo/doc/ticket/simulation ingest | 70% | Local repo scanner, document/ticket helpers, content-module ingest, simulation event ingest, memory consolidation, ticket-to-code cross-source linking, and generated artifact-to-source linking exist. External connectors, symbol extraction, PR/commit/error linking remain. |
| Retrieval and context composition | 82% | Hybrid lexical/vector-style seed retrieval, pgvector node/chunk semantic candidate search, intent boosts, graph expansion, evidence selection, node inclusion explanations, activation-aware content modules, consolidated-memory preference, template selection, context refresh, context/handoff generation exist. True external embedding providers and scan-free final ranking remain. |
| Cache layer | 82% | Shared package, retrieval cache, graph-neighborhood cache, prompt-segment cache, summary cache, deterministic response cache, policy metadata, tag-aware invalidation, entry inspection, and Workbench cache controls are live. Durable/distributed cache backends remain. |
| Trace and observability | 62% | HTTP and domain spans are visible in Workbench, DB-backed trace store wiring exists, DB smoke verifies trace persistence against Postgres/pgvector, and agent response spans include profile, reasoning effort, and budget pressure metadata. Deeper model/tool span coverage remains. |
| Workbench UX | 90% | Usable product skeleton exists; Context Packs show template/prompt cache state, evidence source buttons, why-this-node explanations, Handoff relationship/source/run linkage, Timeline/Trace views, graph-density controls, DB-backed graph mode, cache inspection/invalidation controls, and Dynamic Profile routing controls. Remaining UX work belongs to later orchestration phases. |
| Agent gateway/orchestrator | 42% | Endpoint shell, deterministic run responses, response cache, profile-aware runs, simulation continuity Context Pack API, agent registry, per-agent context composer, run transition validation, and proposed memory-write validation exist. Durable runtime execution engine remains. |
| Model router/dynamic profiling | 70% | Deterministic profile policy, task classification, budget-aware routing, route APIs, feedback capture, and Workbench profile controls exist. Real provider/model execution and adaptive policy learning remain. |
| Security/reliability | 38% | Zod validation, source scores, tenant/workspace/project scope filtering, cache scope keys/tags, API key hooks, rate-limit hooks, redaction workflow, trace filtering, and memory-write validators exist. Full audit history and hosted secret posture remain. |

## MVP Checklist

| MVP Item | Status |
| --- | --- |
| Single main agent mode | Partial |
| Repo/document/ticket ingest | Partial |
| Semantic search | Partial |
| Minimal graph storage | Done |
| Handoff Pack generation | Done |
| Graph UI basic view | Done |
| Retrieval/prompt/summary cache | Done |
| Trace view | Done |

## Recommended Next Work

1. Add durable orchestrator execution and run persistence for Phase 5.
2. Add human approval nodes and Workbench validation queues.
3. Add real external embedding provider adapters behind the new provider interface.
4. Extend source relationships beyond artifacts into PR/commit/error linking.
5. Prepare hosted deployment and secret handling for persistent Postgres/pgvector.
