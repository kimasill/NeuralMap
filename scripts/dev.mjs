import { spawnSync, spawn } from "node:child_process";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function step(msg) {
  process.stdout.write(`\n${BOLD}${CYAN}▶ ${msg}${RESET}\n`);
}

function shellCmd(command, args) {
  if (process.platform === "win32") {
    return { cmd: [command, ...args].join(" "), args: [], opts: { shell: true } };
  }
  return { cmd: command, args, opts: {} };
}

function runSync(command, args) {
  const { cmd, args: a, opts } = shellCmd(command, args);
  const result = spawnSync(cmd, a, { stdio: "inherit", ...opts });
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(`${RED}Command failed: ${command} ${args.join(" ")}${RESET}\n`);
    process.exit(result.status ?? 1);
  }
}

function startProcess(command, args, label, color) {
  const { cmd, args: a, opts } = shellCmd(command, args);
  const child = spawn(cmd, a, { stdio: ["ignore", "pipe", "pipe"], ...opts });

  const prefix = `${color}[${label}]${RESET} `;

  let stdoutBuf = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop();
    for (const line of lines) {
      process.stdout.write(prefix + line + "\n");
    }
  });

  child.stderr.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) process.stderr.write(prefix + line + "\n");
    }
  });

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`${RED}[${label}] process exited with code ${code}${RESET}\n`);
    }
  });

  return child;
}

// ── 1. Infra ──────────────────────────────────────────────────────────────────
step("Starting infrastructure (postgres + redis)...");
runSync("node", ["scripts/infra.mjs", "up"]);

// ── 2. DB migration ───────────────────────────────────────────────────────────
step("Running database migrations...");
runSync("node", ["scripts/with-env.mjs", "pnpm", "--filter", "@neuralmap/db", "db:migrate"]);

// ── 3. Concurrent servers ─────────────────────────────────────────────────────
step("Starting API and Workbench...\n");

const api = startProcess(
  "node",
  ["scripts/with-env.mjs", "pnpm", "--filter", "@neuralmap/api", "dev"],
  "api      ",
  CYAN
);

const workbench = startProcess(
  "pnpm",
  ["--filter", "@neuralmap/workbench", "dev"],
  "workbench",
  MAGENTA
);

process.stdout.write(`\n${YELLOW}Press Ctrl+C to stop all services.${RESET}\n\n`);

// ── 4. Database health gate ─────────────────────────────────────────────────
// The API silently falls back to in-memory sample memory when Postgres is
// unreachable (a common Windows/WSL pitfall: the WSL VM idles out and drops the
// container). Poll /health once the API is up and say plainly which mode it is
// in, so "the Workbench only shows samples" never goes unexplained again.
const API_PORT = process.env.PORT ?? "4317";
const HEALTH_URL = `http://localhost:${API_PORT}/health`;

async function reportDatabaseHealth() {
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(1000);
    let health;
    try {
      const response = await fetch(HEALTH_URL);
      if (!response.ok) continue;
      health = await response.json();
    } catch {
      continue; // API not listening yet
    }

    if (health.graph_mode === "database" && health.db_ok) {
      process.stdout.write(`\n${BOLD}${CYAN}✓ API connected to the database. Workbench will show real graph memory.${RESET}\n\n`);
    } else {
      const reason = health.db_reason || "no DATABASE_URL configured or the database is unreachable";
      process.stdout.write(
        `\n${BOLD}${YELLOW}⚠ API is serving SAMPLE memory (graph_mode=${health.graph_mode}).${RESET}\n` +
        `${YELLOW}  Reason: ${reason}${RESET}\n` +
        `${YELLOW}  The Workbench will only show sample neurons until the database is reachable.${RESET}\n` +
        `${YELLOW}  Windows/WSL: ensure 'pnpm infra:up' succeeded and the WSL Docker postgres container is still running.${RESET}\n` +
        `${YELLOW}  See docs/how-to/local-database-ingest.md for the keep-alive watch loop.${RESET}\n\n`
      );
    }
    return;
  }
  process.stdout.write(`\n${YELLOW}⚠ Could not reach ${HEALTH_URL} to confirm database health.${RESET}\n\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void reportDatabaseHealth();

function shutdown() {
  api.kill();
  workbench.kill();
}

process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
