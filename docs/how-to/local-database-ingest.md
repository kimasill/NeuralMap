# Run Local Database Ingest

This guide shows how to move the Workbench from `Sample` mode to `Database` mode.

## Prerequisites

- Node.js and pnpm installed.
- Docker with Compose support, or an equivalent Postgres instance with the `vector` extension.

Windows note for this workstation:

- Docker Desktop may require an interactive UAC approval. If the Windows `docker` command is unavailable, use the installed WSL Ubuntu 24.04 Docker Engine.
- The root `pnpm infra:up` and `pnpm infra:down` scripts automatically use Docker Desktop when available and fall back to WSL Docker Compose on Windows.
- `pnpm infra:up` waits for Postgres and Redis health checks before returning.
- Root commands that run through `scripts/with-env.mjs` refresh a WSL-backed `DATABASE_URL` to the current WSL IP when `NEURALMAP_DATABASE_HOST_SOURCE=wsl` is set, or when the checked-in local URL already points at a WSL-like `172.16.0.0/12` address.
- Keep WSL Docker alive while the API is using the database:

```powershell
$cmd = "`$neuralmapWatch='neuralmap-wsl-docker-watch'; while (`$true) { wsl.exe -d Ubuntu-24.04 --user root -- bash -lc 'service docker start >/dev/null 2>&1 || true; cd /mnt/s/Project/NeuralMap && docker compose up -d postgres redis >/dev/null 2>&1; sleep 300' }"
Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmd) -WindowStyle Hidden
```

- Manual WSL service start, equivalent to the fallback path:

```powershell
wsl -d Ubuntu-24.04 --user root -- bash -lc "service docker start || true; cd /mnt/s/Project/NeuralMap && docker compose up -d postgres redis"
```

- If `localhost:5432` is not forwarded from WSL to Windows, prefer the automatic WSL host mode in `.env`:

```env
DATABASE_URL=postgres://neuralmap:neuralmap@localhost:5432/neuralmap
NEURALMAP_DATABASE_HOST_SOURCE=wsl
```

The root `pnpm db:*` and `pnpm dev:api` commands will replace the URL host with the current WSL IP at runtime. For manual one-off commands, set URLs to the current WSL IP:

```powershell
$wslIp = (wsl -d Ubuntu-24.04 --user root -- hostname -I).Trim().Split()[0]
$env:DATABASE_URL = "postgres://neuralmap:neuralmap@$wslIp:5432/neuralmap"
$env:REDIS_URL = "redis://$wslIp:6379"
```

## Steps

1. Start local services:

```bash
pnpm infra:up
```

2. Copy environment defaults if needed:

```bash
cp .env.example .env
```

The root DB scripts load `.env` automatically, so `DATABASE_URL` and `REDIS_URL` do not need to be exported manually when running them from the repository root.

3. Run database migrations:

```bash
pnpm db:migrate
```

4. Smoke-test DB-backed graph, Context/Handoff Pack, and trace persistence:

```bash
pnpm db:smoke:required
```

5. Ingest the current repository:

```bash
pnpm db:seed:repo
```

To inspect the repository ingest payload without writing to the database:

```bash
pnpm db:seed:repo:dry
```

6. Start the API and Workbench:

```bash
pnpm dev:api
pnpm dev:workbench
```

7. Open `http://localhost:5173`.

The Workbench source badge should show `Database` after the API can read persisted graph nodes from Postgres.

On this workstation, the verified DB URL can point to the WSL service address directly, but automatic WSL host mode avoids editing `.env` after WSL restarts:

```text
postgres://neuralmap:neuralmap@172.20.24.141:5432/neuralmap
```

## Useful Checks

```bash
curl http://localhost:4317/health
curl http://localhost:4317/workbench/graph/subgraph
pnpm db:smoke
```

If `graph_mode` is `sample`, the API is using fallback memory. Check that `DATABASE_URL` is set, migrations ran successfully, and repository ingest inserted graph nodes.
