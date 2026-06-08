# ADR 0004: Patch three-forcegraph to Survive Its First Animation Frame

Status: Accepted

Date: 2026-06-08

## Context

The Workbench renders the 3D graph with `react-force-graph-3d`, which wraps `3d-force-graph` and `three-forcegraph`. Under React 19 + Vite dev, the 3D view rendered a permanently blank canvas while the 2D view worked.

Root cause: `three-forcegraph`'s animation loop calls `state.layout.tick()` on its first frame, but the graph layout is initialised by a separate `graphData` digest that `kapsule` debounces by 1ms. The heavier WebGL/three init lets the first synchronous `tickFrame()` run before that digest, so `state.layout` is `undefined` and the call throws `Cannot read properties of undefined (reading 'tick')`. Because `_animationCycle` schedules its next `requestAnimationFrame` only *after* `tickFrame()`, a single throw stops the loop forever — the canvas never repaints. The 2D renderer does not tick synchronously on init, so it was unaffected.

All packages were already at their latest versions (`react-force-graph-3d@1.29.1`, `react-kapsule@2.5.7`, `three@0.184`), so there was nothing to upgrade to, and the crash happens inside the library's own init path before any application code can intervene (empty-first mount and pause/resume workarounds were tried and failed).

## Decision

Patch `three-forcegraph@1.43.4` via `pnpm patch` to guard the tick:

```js
if (state.layout) state.layout[isD3Sim ? 'tick' : 'step']();
```

The guard lets the first frame complete without throwing, so `_animationCycle` keeps scheduling frames; once the debounced digest populates `state.layout` (1–2ms later) the simulation runs and the graph renders normally. The patch is recorded in `patches/three-forcegraph@1.43.4.patch` and pinned through `pnpm.patchedDependencies`, so `pnpm install --frozen-lockfile` reapplies it in CI.

## Consequences

- The 3D Workbench view renders reliably under React 19 + Vite dev and in production builds.
- The patch must be re-validated when `three-forcegraph` / `react-force-graph-3d` is upgraded; if a future release fixes the init ordering upstream, drop the patch.
- A Playwright smoke test (`apps/workbench/e2e/graph-canvas.spec.ts`) asserts the 3D canvas renders and no `tick` error is thrown, so a regression (including an upgrade that re-breaks it) fails CI.
- Upstream follow-up: report the synchronous-first-tick / undefined-layout race to `react-force-graph` so the guard can eventually be removed.
