# NeuralMap

NeuralMap is a TypeScript monorepo for the agent context graph framework described in:

`S:\Project\AIControlPlane\agent_context_graph_framework_blueprint.md`

The product direction is simple: keep sessions short, keep durable memory in the framework, and rebuild only the context an agent needs.

## Phase 1 Scope

- Shared graph, context pack, handoff pack, run, and trace contracts.
- Postgres + pgvector schema for the memory backbone.
- ADRs for the initial architecture decisions.
- Project progress mirrored in docs and Linear issues.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm db:migrate
```

Copy `.env.example` to `.env` before running database commands locally.

