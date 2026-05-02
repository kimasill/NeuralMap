# Linear Issue Mirror

This file mirrors the Linear control plane for local visibility. Linear is the source for assignment and status once issues are created.

Workspace: https://linear.app/aineuralmap

| Track | Linear | Status |
| --- | --- | --- |
| Step 0: Bootstrap memory backbone contracts | [AIN-5](https://linear.app/aineuralmap/issue/AIN-5/step-0-bootstrap-memory-backbone-contracts) | Done |
| Track A: Core retrieval and context composer | [AIN-6](https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer) | Planned |
| Track B: Repository, document, and ticket ingest | [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest) | Planned |
| Track C: Fastify API and trace middleware | [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware) | Planned |
| Track D: Graph workbench UI | [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui) | Planned |

## Issue Drafts

### Step 0: Bootstrap memory backbone contracts

Linear: [AIN-5](https://linear.app/aineuralmap/issue/AIN-5/step-0-bootstrap-memory-backbone-contracts)

Create the pnpm workspace, shared schema package, Postgres + pgvector Drizzle schema, first migration, and ADR 0001-0003.

### Track A: Core retrieval and context composer

Linear: [AIN-6](https://linear.app/aineuralmap/issue/AIN-6/track-a-core-retrieval-and-context-composer)

Implement seed retrieval contracts, graph expansion rules, compression policy, and Context Pack Composer using `packages/schema` and `packages/db`.

### Track B: Repository, document, and ticket ingest

Linear: [AIN-7](https://linear.app/aineuralmap/issue/AIN-7/track-b-repository-document-and-ticket-ingest)

Implement ingest interfaces for repository, document, and ticket sources, including chunking and graph node or edge emission.

### Track C: Fastify API and trace middleware

Linear: [AIN-8](https://linear.app/aineuralmap/issue/AIN-8/track-c-fastify-api-and-trace-middleware)

Implement the initial Agent, Context, Graph, Cache, and Workbench API surfaces with trace span capture.

### Track D: Graph workbench UI

Linear: [AIN-9](https://linear.app/aineuralmap/issue/AIN-9/track-d-graph-workbench-ui)

Implement the React + Cytoscape workbench with agent panel, graph canvas, context inspector, and run trace foundation.
