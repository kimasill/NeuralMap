import { spawnSync } from "node:child_process";

const action = process.argv[2];
const wslDistro = process.env.NEURALMAP_WSL_DISTRO ?? "Ubuntu-24.04";
const serviceContainers = ["neuralmap-postgres", "neuralmap-redis"];

if (!["up", "down"].includes(action)) {
  console.error("Usage: node scripts/infra.mjs <up|down>");
  process.exit(1);
}

if (canUseLocalDockerCompose()) {
  const args = action === "up" ? ["compose", "up", "-d", "postgres", "redis"] : ["compose", "down"];
  run("docker", args);
  if (action === "up") {
    waitForHealthyServices("docker", []);
  }
  process.exit(0);
}

if (process.platform === "win32" && canUseWslDockerCompose()) {
  const command =
    action === "up"
      ? "service docker start >/dev/null 2>&1 || true; docker compose up -d postgres redis"
      : "docker compose down";
  const wslArgs = ["-d", wslDistro, "--user", "root", "--cd", process.cwd(), "--", "bash", "-lc"];
  run("wsl.exe", [...wslArgs, command]);
  if (action === "up") {
    waitForHealthyServices("wsl.exe", [
      "-d",
      wslDistro,
      "--user",
      "root",
      "--cd",
      process.cwd(),
      "--",
      "bash",
      "-lc"
    ]);
  }
  process.exit(0);
}

console.error(
  "No usable Docker Compose backend found. Install Docker Desktop, or install Docker Engine in WSL Ubuntu 24.04."
);
process.exit(1);

function canUseLocalDockerCompose() {
  return succeeds("docker", ["info"]) && succeeds("docker", ["compose", "version"]);
}

function canUseWslDockerCompose() {
  return succeeds("wsl.exe", [
    "-d",
    wslDistro,
    "--user",
    "root",
    "--",
    "bash",
    "-lc",
    "command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1"
  ]);
}

function succeeds(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function waitForHealthyServices(command, prefixArgs) {
  const timeoutMs = Number(process.env.NEURALMAP_INFRA_WAIT_MS ?? 60_000);
  const intervalMs = 1_000;
  const deadline = Date.now() + timeoutMs;

  process.stdout.write("Waiting for NeuralMap infra health checks");

  while (Date.now() < deadline) {
    const statuses = serviceContainers.map((container) => getContainerStatus(command, prefixArgs, container));
    const ready = statuses.every((status) => status === "healthy" || status === "running");

    if (ready) {
      process.stdout.write("\nNeuralMap infra is ready.\n");
      return;
    }

    process.stdout.write(".");
    sleep(intervalMs);
  }

  process.stdout.write("\n");
  console.error(`Timed out waiting for NeuralMap infra after ${timeoutMs}ms.`);
  process.exit(1);
}

function getContainerStatus(command, prefixArgs, container) {
  const inspectCommand = `docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ${container}`;
  const args = command === "wsl.exe" ? [...prefixArgs, inspectCommand] : ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", container];
  const result = spawnSync(command, args, { encoding: "utf8" });

  if ((result.status ?? 1) !== 0) {
    return "missing";
  }

  return result.stdout.trim();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
