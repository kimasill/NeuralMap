# Phase 3 Control Board

Date started: 2026-05-03

Blueprint: `docs/agent_context_graph_framework_blueprint.md`

## Goal

Make the cache layer explainable and controllable:

- Keep retrieval, graph-neighborhood, prompt-segment, summary, and response caches active.
- Add policy metadata for TTL and max-entry behavior.
- Add targeted invalidation rules for layers, keys, prefixes, and tags.
- Expose cache inspection through API and Workbench UX.

## Current Status

Phase 3 is complete as of 2026-05-03. The existing Phase 1 cache layers now have Smart Caching controls: policy metadata, entry inspection, tags, TTL/max-entry rules, and targeted invalidation. Workbench can inspect cache layers, recent entries, hit rate, expired entries, and invalidate by layer, tag, or all entries.

| Track | Status | Owner Path | Notes |
| --- | --- | --- | --- |
| A: cache policy metadata | Done | `packages/cache` | Per-layer TTL and max-entry policy metadata is exposed through the cache store. |
| B: cache entry inspection | Done | `packages/cache`, `apps/api` | Entries expose key, layer, tags, age, TTL, expiry, access count, type, and compact value summary. |
| C: targeted invalidation rules | Done | `packages/cache`, `apps/api` | Invalidation supports layer, key, key prefix, tags, and expired-entry inclusion. |
| D: cache Workbench UX | Done | `apps/workbench` | Cache panel shows hit rate, layer stats, recent entries, tag filter, refresh, and invalidation controls. |

## Completed Slice: Smart Cache Store

Completed on 2026-05-03:

- `CacheStore.set` now accepts write options while preserving the previous TTL shorthand.
- Cache entries track creation time, last access, access count, tags, expiry, value type, and value summary.
- Per-layer default policies are defined for retrieval, graph neighborhood, prompt segment, summary, and response caches.
- Cache stats include expired entry count, TTL policy, and max-entry policy.
- Cache inspection is non-mutating, so looking up a key does not inflate hit counters.
- Cache invalidation can target layer, exact key, key prefix, and tag intersections.
- Graph writes now invalidate entries tagged `graph` instead of hard-clearing only fixed layers.

## Completed Slice: Cache API

Completed on 2026-05-03:

- `GET /cache/stats` returns layer stats, policy metadata, and generation time.
- `GET /cache/entries` lists inspectable entries with layer, key, tag, expiry, and limit filters.
- `GET /cache/key/:id` returns matching entries across layers without mutating cache stats.
- `POST /cache/invalidate` accepts targeted filters and returns invalidated entry metadata.
- Retrieval, graph-neighborhood, prompt-segment, summary, and response writes now attach tags such as `graph`, `retrieval`, `summary`, `response`, `node:*`, `template:*`, `agent:*`, and `context_pack:*`.

## Completed Slice: Workbench Cache UX

Completed on 2026-05-03:

- Workbench initial load fetches cache stats and recent entries in parallel with graph, agents, trace, artifacts, and timeline.
- The agent panel now includes a Cache panel with hit rate, entry count, hits, expired count, layer stats, recent entries, and tag filter.
- Cache controls can refresh stats, invalidate the selected layer, invalidate the active tag, or invalidate all cache entries.
- Query, Context Pack compose/refresh, and Handoff actions refresh cache state after execution.

## Phase 3 Exit

Phase 3 Smart Caching is complete for the current framework scope:

- Retrieval cache is active and inspectable.
- Graph-neighborhood cache is active, tagged, and invalidated by graph writes.
- Prompt-segment cache is active and tied to template IDs/versions.
- Summary cache is active and tagged by context/template/node references.
- Response cache is active and tagged by agent/model/context/node references.
- Cache invalidation rules are available through API and Workbench.

Follow-up:

- Phase 4 Dynamic Profiling is now complete in [phase-4.md](phase-4.md).

Final verification:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache` -> 5 files, 24 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 116 files, 117 nodes, 117 edges, 377 chunks
- `pnpm db:smoke:required` -> `mode: database`, 117 graph nodes loaded, 1 trace span loaded
- API live smoke: `GET /cache/stats`, `GET /cache/entries?tag=graph`, `GET /cache/key/:id`, and targeted `POST /cache/invalidate` return expected database-mode cache metadata.
