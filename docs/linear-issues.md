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

Local DB ingest slice:

- `db:seed:repo` can now persist repository-derived graph nodes into Postgres, which gives the composer live graph memory once DB mode is active.

Cache and trace slice:

- Repeated graph queries are now cached through `packages/cache`, giving the composer/API path measurable hit and miss behavior.

### Track B: Repository, document, and ticket ingest

Linear: [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest)

Implement ingest interfaces for repository, document, and ticket sources, including chunking and graph node or edge emission.

Initial slice:

- `packages/ingest` provides document, repository, and ticket ingestion helpers with chunk drafts and import dependency edge emission.

Persistence slice:

- API endpoints accept document, repository, and ticket snapshots and persist emitted nodes, edges, and chunks through the DB graph store.

Local DB ingest slice:

- `packages/ingest` now includes a filesystem scanner and CLI for ingesting the current repository. Latest dry-run result on this repo: 104 files, 105 nodes, 105 edges, 185 chunks.

### Track C: Fastify API and trace middleware

Linear: [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware)

Implement the initial Agent, Context, Graph, Cache, and Workbench API surfaces with trace span capture.

Initial slice:

- `apps/api` exposes health, agent, graph, context, handoff, cache, and workbench endpoints backed by sample graph memory.

Persistence slice:

- API now uses a DB-backed graph data source with sample fallback and exposes ingest endpoints.

Local DB ingest slice:

- Root scripts and local infrastructure config now cover Postgres/pgvector, Redis, migrations, and repository seeding. This machine lacks Docker/Postgres, so API remains in `sample` mode locally until services are available.

Cache and trace slice:

- `packages/cache` and `packages/trace` now back the API cache stats and request trace hooks. Repeated `POST /graph/query` calls show first miss, second hit, and `/workbench/runs/:id/trace` can return live request spans.

### Track D: Graph workbench UI

Linear: [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui)

Implement the React + Cytoscape workbench with agent panel, graph canvas, context inspector, and run trace foundation.

Initial slice:

- `apps/workbench` renders the agent panel, Cytoscape graph canvas, context inspector, and trace panel with API-backed data and local fallbacks.

Persistence slice:

- Workbench shows a source badge so users can tell whether the graph is coming from `Database` or `Sample` data.

Local DB ingest slice:

- Workbench is ready to switch to `Database` once the API reads persisted graph nodes. Current local verification still shows `Sample` because Postgres is unavailable on this machine.

Cache and trace slice:

- Workbench trace endpoints can now display live API request spans when called with a recorded run ID, while preserving sample trace fallback for the default demo run.
