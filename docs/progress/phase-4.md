# Phase 4 Control Board

Date started: 2026-05-03

Blueprint: `docs/agent_context_graph_framework_blueprint.md`

## Goal

Add Dynamic Profiling so the framework can choose an execution profile from task context:

- Classify task intent beyond retrieval-only use.
- Select model/runtime profiles by complexity, risk, urgency, budget, cache state, and quality feedback.
- Route agent runs through the selected profile.
- Record quality feedback so profile policy can improve over time.
- Surface profile decisions in the Workbench.

## Current Status

Phase 4 is complete as of 2026-05-03. The system now has deterministic model profile policy, budget-aware route decisions, API endpoints for profile routing and feedback, agent-run integration, and Workbench visibility for selected profiles and feedback.

Tracker: [AIN-11](https://linear.app/aineuralmap/issue/AIN-11/phase-4-dynamic-profiling)

| Track | Status | Owner Path | Notes |
| --- | --- | --- | --- |
| A: task classification | Done | `packages/core` | Existing intent classification now feeds profile decisions with complexity, risk, urgency, and budget signals. |
| B: model profile policy | Done | `packages/core`, `apps/api` | Profiles cover fast context, balanced agent, deep reasoning, and validation guard modes. |
| C: budget-aware routing | Done | `packages/core`, `apps/api` | Route decisions include estimated input tokens, budget pressure, latency budget, cost weight, and alternatives. |
| D: quality feedback loop | Done | `apps/api`, `apps/workbench` | Feedback is recorded per profile and surfaced in subsequent route decisions. |
| E: Workbench profiling UX | Done | `apps/workbench` | Dynamic Profile panel shows selected profile, complexity, risk, budget pressure, routing reasons, and feedback controls. |

## Completed Slice: Profile Policy

Completed on 2026-05-03:

- Added `packages/core/src/model-profiles.ts`.
- Added four deterministic profiles: `fast-context`, `balanced-agent`, `deep-reasoning`, and `validation-guard`.
- Profile selection considers intent fit, task complexity, risk, urgency, estimated token load, cache hit rate, budget fit, and quality feedback.
- Requested profile overrides are honored when they match a known profile.
- Core tests cover deep reasoning selection, fast handoff selection, and requested profile override behavior.

## Completed Slice: API Routing

Completed on 2026-05-03:

- Added `GET /model/profiles`.
- Added `POST /model/route`.
- Added `POST /model/feedback`.
- `POST /agents/:id/run` now routes through the profile policy and returns the selected profile decision.
- Agent response content includes profile and routing context while preserving deterministic response caching.
- Trace spans include selected model profile, reasoning effort, and budget pressure.

## Completed Slice: Workbench Dynamic Profile UX

Completed on 2026-05-03:

- Workbench initial load fetches profile dashboard data in parallel with graph, agents, trace, artifacts, timeline, and cache data.
- Context Workbench includes a Dynamic Profile panel.
- The panel shows selected profile, reasoning effort, model family, complexity, risk, budget pressure, intent, quality score/floor, and routing reasons.
- The panel supports rerouting and lightweight Good/Weak profile feedback.
- Context Pack compose/refresh triggers route refresh, keeping profile decisions aligned with current context.

## Phase 4 Exit

Phase 4 Dynamic Profiling is complete for the current framework scope:

- Task classification drives runtime profile policy.
- Model/runtime profiles are explicit and inspectable.
- Budget pressure and latency/cost tradeoffs are visible in route decisions.
- Agent runs use the selected profile instead of a fixed default.
- Profile quality feedback can be captured and reused by the router.

Recommended next phase:

- Phase 5: multi-agent runtime, agent registry, per-agent context composer, merge/validation pipeline, and human approval nodes.

Final verification:

- `pnpm typecheck`
- `pnpm exec vitest run --no-cache` -> 6 files, 28 tests passed
- `pnpm build`
- `pnpm --filter @neuralmap/db exec drizzle-kit check --config drizzle.config.ts`
- `pnpm db:seed:repo:dry` -> 119 files, 120 nodes, 120 edges, 404 chunks
- `pnpm db:smoke:required` -> `mode: database`, 117 graph nodes loaded, 1 trace span loaded
- API live smoke: `GET /model/profiles`, `POST /model/route`, `POST /agents/main-agent/run`, and `POST /model/feedback` return the expected Dynamic Profile decision/feedback loop.
