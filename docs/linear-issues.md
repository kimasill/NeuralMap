# Linear Issue Mirror

This file mirrors the Linear control plane for local visibility. Linear is the source for assignment and status once issues are created.

Workspace: https://linear.app/aineuralmap

| Track | Linear | Status |
| --- | --- | --- |
| Step 0: Bootstrap memory backbone contracts | [AIN-5](https://linear.app/aineuralmap/issue/AIN-5/step-0-bootstrap-memory-backbone-contracts) | Done |
| Track A: Core retrieval and context composer | [AIN-6](https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer) | In Progress |
| Track B: Repository, document, and ticket ingest | [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest) | In Progress |
| Track C: Fastify API and trace middleware | [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware) | In Progress |
| Track D: Graph workbench UI | [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui) | In Progress |

## Issue Drafts

### Step 0: Bootstrap memory backbone contracts

Linear: [AIN-5](https://linear.app/aineuralmap/issue/AIN-5/step-0-bootstrap-memory-backbone-contracts)

Create the pnpm workspace, shared schema package, Postgres + pgvector Drizzle schema, first migration, and ADR 0001-0003.

### Track A: Core retrieval and context composer

Linear: [AIN-6](https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer)

Implement seed retrieval contracts, graph expansion rules, compression policy, and Context Pack Composer using `packages/schema` and `packages/db`.

Initial slice:

- `packages/core` provides lexical seed ranking, 1-hop graph expansion, Context Pack composition, Handoff Pack creation, and sample graph memory.

Persistence slice:

- API context composition now saves packs through the graph data source when Postgres is configured.

### Track B: Repository, document, and ticket ingest

Linear: [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest)

Implement ingest interfaces for repository, document, and ticket sources, including chunking and graph node or edge emission.

Initial slice:

- `packages/ingest` provides document, repository, and ticket ingestion helpers with chunk drafts and import dependency edge emission.

Persistence slice:

- API endpoints accept document, repository, and ticket snapshots and persist emitted nodes, edges, and chunks through the DB graph store.

### Track C: Fastify API and trace middleware

Linear: [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware)

Implement the initial Agent, Context, Graph, Cache, and Workbench API surfaces with trace span capture.

Initial slice:

- `apps/api` exposes health, agent, graph, context, handoff, cache, and workbench endpoints backed by sample graph memory.

Persistence slice:

- API now uses a DB-backed graph data source with sample fallback and exposes ingest endpoints.

### Track D: Graph workbench UI

Linear: [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui)

Implement the React + Cytoscape workbench with agent panel, graph canvas, context inspector, and run trace foundation.

Initial slice:

- `apps/workbench` renders the agent panel, Cytoscape graph canvas, context inspector, and trace panel with API-backed data and local fallbacks.

Persistence slice:

- Workbench shows a source badge so users can tell whether the graph is coming from `Database` or `Sample` data.
