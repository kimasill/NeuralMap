# Run Local Database Ingest

This guide shows how to move the Workbench from `Sample` mode to `Database` mode.

## Prerequisites

- Node.js and pnpm installed.
- Docker with Compose support, or an equivalent Postgres instance with the `vector` extension.

## Steps

1. Start local services:

```bash
pnpm infra:up
```

2. Copy environment defaults if needed:

```bash
cp .env.example .env
```

3. Run database migrations:

```bash
pnpm db:migrate
```

4. Ingest the current repository:

```bash
pnpm db:seed:repo
```

To inspect the repository ingest payload without writing to the database:

```bash
pnpm db:seed:repo:dry
```

5. Start the API and Workbench:

```bash
pnpm dev:api
pnpm dev:workbench
```

6. Open `http://localhost:5173`.

The Workbench source badge should show `Database` after the API can read persisted graph nodes from Postgres.

## Useful Checks

```bash
curl http://localhost:4317/health
curl http://localhost:4317/workbench/graph/subgraph
```

If `graph_mode` is `sample`, the API is using fallback memory. Check that `DATABASE_URL` is set, migrations ran successfully, and repository ingest inserted graph nodes.
