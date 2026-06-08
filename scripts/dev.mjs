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

function shutdown() {
  api.kill();
  workbench.kill();
}

process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
