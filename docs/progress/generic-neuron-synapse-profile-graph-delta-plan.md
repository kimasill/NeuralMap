# Generic Neuron/Synapse Profile Graph Delta Plan

Date drafted: 2026-05-05

Source request: `S:\Project\DynamicChat\docs\neuralmap-simulation-memory-optimization-plan.md`

## Decision

Accept the direction, but implement it as a framework-level expansion, not as a DynamicChat-specific memory rewrite.

The requested architecture aligns with NeuralMap's identity if the core stays centered on generic graph primitives, retrieval, context composition, scope, redaction, trace, and cache behavior. DynamicChat should become one profile and adapter on top of the framework.

Do not rename or replace the existing public contracts in one step. Keep `GraphNode`, `GraphEdge`, `/graph/query`, `/context/compose`, and `/ingest/simulation-event` compatible while adding a generic Neuron/Synapse and profile-driven layer beside them.

## Current Fit

The current code already has useful foundations:

- Shared `GraphNode` and `GraphEdge` contracts in `packages/schema`.
- Closed `nodeTypes` and `edgeTypes` in `packages/schema/src/values.ts`.
- Postgres enum columns for graph node and edge type in `packages/db/src/schema.ts`.
- Existing graph upsert, chunk persistence, pgvector candidate search, scope filtering, redaction, and cache invalidation in `packages/db` and `apps/api`.
- Simulation continuity via `/ingest/simulation-event` and `/simulation/context`.
- Generic context composition, content modules, memory consolidation, agent registry, and memory-write validation.

The main mismatch is that domain meaning is still squeezed through closed core enums and metadata. The improvement should make metadata extension first-class without turning the core into a simulation database.

## Non-Goals

- Do not add `Character`, `Scene`, `Belief`, `Observation`, or DynamicChat-only relation types to the core enum as the primary solution.
- Do not break existing clients that use `GraphNode.type`, `GraphEdge.type`, `/graph/query`, or `/context/compose`.
- Do not migrate the DB away from existing enum columns in the first implementation slice.
- Do not add query features that require whole-graph scans in DB mode.
- Do not make profile validation a remote or per-node hot-path dependency.
- Do not change retrieval ranking in ways that reduce current graph query, context pack, or simulation continuity quality without a measured fallback.

## Architecture Guardrails

- Core primitives remain generic: node, edge, graph delta, profile, ontology, lifecycle, provenance, scope, and context policy.
- Domain semantics live in registered profiles: simulation, coding, ops, research, CRM, or app-specific profiles.
- Existing graph types remain compatibility anchors. New labels and ontology types extend them.
- Storage changes should be additive first, with JSONB-backed metadata and targeted indexes before broader table migrations.
- Query and context features must preserve cache key determinism, trace visibility, and tenant scope isolation.
- DynamicChat endpoints may remain as adapters, but their implementation should compile to generic graph deltas.

## Work Plan

### Phase A. Compatibility Schema Foundation

Add optional, additive fields to schema contracts:

- `labels: string[]`
- `ontology: { profile_id: string; type: string; version?: string }`
- `properties: Record<string, unknown>`
- `lifecycle_status`
- `valid_from` and `valid_to`
- `provenance`

Keep `type`, `metadata`, `trust_score`, `freshness_score`, and `importance_score` intact. Add helper aliases such as `Neuron` and `Synapse` only as type-level compatibility wrappers around `GraphNode` and `GraphEdge`.

Performance controls:

- Persist the new fields through existing JSONB metadata first.
- Add DB indexes only for fields used by filters: profile ID, ontology type, lifecycle status, valid-to, and current pointer key.
- Keep embeddings derived from stable title, summary, labels, ontology, and selected properties only.

Acceptance:

- Existing tests pass unchanged.
- Existing ingest endpoints still parse and persist current payloads.
- New schema fields round-trip in sample and DB modes.

### Phase B. Profile and Ontology Registry

Add a registry package or module for profile definitions:

- `GET /profiles`
- `POST /profiles` or local static registration first, depending on persistence readiness
- profile validation for neuron types, synapse types, required properties, render hints, and context templates
- cached profile lookup by `profile_id`

Start with three profiles to protect generality:

- `simulation-memory`
- `coding-context`
- `ops-incident`

DynamicChat can later extend `simulation-memory` as `dynamicchat-simulation-memory`.

Performance controls:

- Compile profile definitions into in-memory validators at startup or registration time.
- Avoid per-request schema rebuilding.
- Cap profile size and validate profile documents before activation.

Acceptance:

- Core tests show that app-specific ontology types are accepted only through profiles.
- Invalid profile payloads fail before graph writes.
- No profile name appears as a hard-coded branch in core retrieval or storage code.

### Phase C. Generic Graph Delta Write Path

Add `POST /graph/deltas` as the generic batch write unit:

- upsert neurons
- upsert synapses
- temporal operations
- current pointer updates
- archive or lifecycle updates
- idempotency key
- source and provenance attachment

Keep `/ingest/simulation-event` as a compatibility adapter that emits the same underlying graph delta over time.

Performance controls:

- Execute DB writes in a transaction.
- Enforce max batch sizes for nodes, edges, and temporal operations.
- Require bounded selectors for temporal operations. Avoid broad selectors without scope, profile, label, and property constraints.
- Store idempotency keys durably before acknowledging success.
- Invalidate graph caches with existing graph tags after a successful commit only.

Acceptance:

- Replaying a delta with the same idempotency key is safe.
- Superseding a current state closes the previous active fact and creates a traceable relation.
- The sample datasource and DB datasource behave consistently.
- DB smoke covers batch upsert, temporal operations, and cache invalidation.

### Phase D. Fine-Grained Query and Current Views

Add query APIs incrementally:

- `POST /graph/neurons/query`
- `POST /graph/traverse`
- `POST /graph/views/current`

The first implementation should reuse the existing retrieval and graph expansion pipeline, then add structured filters and profile-aware ranking.

Performance controls:

- Push structured filters to DB before vector ranking where possible.
- Cap `top_k`, hops, relation fanout, and returned node count.
- Include profile, filters, scope, hops, and ranking policy in cache keys.
- Use DB indexes for lifecycle, profile, ontology type, valid-to, and current pointer queries.
- Keep sample mode simple, but ensure DB mode does not fall back to full scans for production-sized graphs.

Acceptance:

- Existing `/graph/query` behavior remains compatible.
- Current-view query excludes expired or archived state by default.
- Traversal respects scope, redaction, lifecycle, and hop limits.
- Query latency and result count are reported in trace metadata.

### Phase E. Profile-Driven Context Composer

Extend `/context/compose` without removing flat evidence:

- continue returning `evidence`
- add profile-driven `sections`
- add context policy input for ranking weights, perspective, lifecycle filtering, and template ID
- support perspective views through profile-declared relation types

Performance controls:

- Reuse ranked candidates and neighborhoods rather than recomputing per section.
- Cache rendered profile/template prompt segments.
- Apply section budgets before rendering.
- Preserve summary and response cache layers.

Acceptance:

- Existing Context Pack clients still work with `evidence`.
- Profile-specific sections are optional and metadata-driven.
- Simulation context can render current scene, canonical state, perspective state, relevant history, and open threads without DynamicChat names in core code.

### Phase F. Compatibility Adapters and Migration Docs

Document and implement adapters after generic APIs are stable:

- DynamicChat adapter from `MemoryDelta` to `GraphDelta`.
- Simulation event endpoint implemented as a compatibility facade.
- Migration guide from metadata-only simulation events to profile-backed graph deltas.
- How-to examples for simulation, coding, ops, and research profiles.

Performance controls:

- Keep adapters thin.
- Add simulation continuity eval baselines before changing adapter behavior.
- Keep old endpoints until eval parity is demonstrated.

Acceptance:

- `pnpm eval:simulation` remains at or above the existing recall behavior.
- Existing simulation continuity how-to still works.
- New DynamicChat profile examples use generic APIs only.

## Verification Gates

Before implementation starts:

- Capture baseline for `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm db:smoke:required`, `pnpm eval:simulation`, and `pnpm bench:graphrag-core`.

For every implementation phase:

- `pnpm typecheck`
- targeted unit tests for changed packages
- API tests for new endpoints
- DB smoke when persistence changes
- cache key and invalidation assertions when query or write paths change

Performance gate:

- No more than 10 percent regression in graph query, context composition, and simulation continuity benchmark latency without an explicit follow-up issue and rollback switch.
- No unbounded graph scan in DB mode for profile filters, temporal current views, or traversal.
- No extra embedding generation for unchanged nodes during idempotent delta replay.

Identity gate:

- No DynamicChat-specific type or relation is added to core enums as the primary extension path.
- At least one non-simulation profile is tested against the same APIs.
- Public docs describe NeuralMap as a generic agent context graph framework, not a simulation memory backend.

## Suggested Tracker Scope

Create one umbrella issue now:

- `Generic Neuron/Synapse profile and graph delta foundation`

Created trackers:

- Linear: [AIN-25](https://linear.app/aineuralmap/issue/AIN-25/generic-neuronsynapse-profile-and-graph-delta-foundation)
- GitHub: [#6](https://github.com/kimasill/NeuralMap/issues/6)

Break out child issues after Phase A is accepted:

- flexible schema compatibility fields
- profile registry and validators
- graph delta write path
- current views and traversal APIs
- profile-driven context sections
- DynamicChat compatibility adapter

## Implementation Status

Implemented on 2026-05-05:

- Additive schema fields for labels, ontology, properties, lifecycle status, temporal validity, and provenance.
- Built-in graph profile registry with `simulation-memory`, `coding-context`, and `ops-incident`.
- Profile validation API through `GET /profiles`, `GET /profiles/:id`, and `POST /profiles`.
- Generic `POST /graph/deltas` write path with profile validation, temporal supersede, current pointer archival, idempotent replay, and idempotency-key conflict detection.
- Durable DB idempotency foundation through `graph_delta_commits` and migration `0001_graph_delta_idempotency.sql`.
- JSONB expression indexes for profile, ontology, lifecycle, temporal, synapse type, and current pointer lookups.
- Fine-grained `POST /graph/neurons/query`, `POST /graph/traverse`, and `POST /graph/views/current` APIs.
- Optional profile-driven Context Pack `sections` while preserving flat `evidence`.

Verification:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `packages/db/drizzle/0001_graph_delta_idempotency.sql` was applied to the local WSL Postgres container with `psql`, and `graph_delta_commits` was confirmed.
- `pnpm eval:neuron-synapse`
  - 240 synthetic agent turns compiled into 249 neurons and 254 synapses.
  - Current view correctly returned Mina's active `Wearing = navy coat` and `Promise = silver key trust promise` states.
  - Context Pack used 10 evidence items and 11 graph nodes.
  - Raw transcript estimate: 6426 tokens.
  - Compressed context estimate: 384 tokens.
  - Estimated token reduction: 94.024 percent.
  - Repeated Context Pack composition p50: 4.511 ms, p95: 5.249 ms.
- `pnpm bench:graphrag-core`
  - 100 nodes: compose p50 0.98 ms.
  - 1000 nodes: compose p50 8.05 ms.
  - 5000 nodes: compose p50 40.04 ms.
- REST evals against a temporary sample-mode API on port 4321:
  - `pnpm eval:simulation`: passed, 18 events, silver key recall, compression ratio 0.595.
  - `pnpm eval:graphrag`: passed, dynamic ingest, cached graph query, Context Pack, profiled agent run, and artifact synapse relationship.
- Comparative local memory strategy eval through `pnpm eval:memory-compare`:
  - Compared raw full context, provider prompt-cache-style full context, sliding windows, keyword RAG, summary-cache snapshot, vector-only RAG, and NeuralMap graph RAG on the same 240-turn agent memory workload.
  - NeuralMap graph RAG ranked first on quality score: 1.0.
  - NeuralMap recovered all checked facts: active `navy coat`, durable `silver key trust promise`, and predecessor `gray raincoat` lineage through temporal synapses.
  - NeuralMap context estimate: 892 tokens versus 6939 tokens for raw full context / prompt-cache-style full context.
  - Vector-only RAG used 204 tokens but mixed stale current-state candidates without temporal disambiguation, quality score 0.525.
  - Summary-cache snapshot used 36 tokens and preserved current facts, but lost predecessor lineage, provenance, and synapse explainability, quality score 0.65.
  - NeuralMap repeated graph RAG p50: 4.822 ms, p95: 6.002 ms.

Resolved local environment note:

- `pnpm infra:up` now waits for Postgres and Redis health checks before returning.
- `scripts/with-env.mjs` now refreshes a WSL-backed `DATABASE_URL` to the current WSL IP at runtime when WSL Docker host mode is enabled or an existing local WSL-like `172.16.0.0/12` address is detected.
- `pnpm db:smoke` now passes after `pnpm infra:up` on this workstation.

Framework intent assessment:

- The generic profile layer preserves NeuralMap's framework identity: DynamicChat semantics are expressed as `simulation-memory` ontology labels, not core enum expansion.
- The graph delta path turns agent/domain events into generic neurons and synapses with provenance, lifecycle, temporal validity, and current-state pointers.
- Current-view and traversal APIs can recover active facts and supersession history without replaying raw transcripts.
- Context Pack composition can consume the graph, produce sectioned evidence, and reduce the agent prompt surface substantially while retaining durable state.
