import { spawnSync } from "node:child_process";

const action = process.argv[2];
const wslDistro = process.env.NEURALMAP_WSL_DISTRO ?? "Ubuntu-24.04";

if (!["up", "down"].includes(action)) {
  console.error("Usage: node scripts/infra.mjs <up|down>");
  process.exit(1);
}

if (canUseLocalDockerCompose()) {
  const args = action === "up" ? ["compose", "up", "-d", "postgres", "redis"] : ["compose", "down"];
  run("docker", args);
}

if (process.platform === "win32" && canUseWslDockerCompose()) {
  const command =
    action === "up"
      ? "service docker start >/dev/null 2>&1 || true; docker compose up -d postgres redis"
      : "docker compose down";
  run("wsl.exe", ["-d", wslDistro, "--user", "root", "--cd", process.cwd(), "--", "bash", "-lc", command]);
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
  process.exit(result.status ?? 1);
}
