import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, parse } from "node:path";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/with-env.mjs <command> [...args]");
  process.exit(1);
}

const loadedEnv = loadNearestDotEnv(process.cwd());
const childEnv = { ...process.env, ...loadedEnv };
normalizeRuntimeEnv(childEnv);
const result = spawnSync(command, args, {
  env: childEnv,
  shell: process.platform === "win32",
  stdio: "inherit"
});

process.exit(result.status ?? 1);

function loadNearestDotEnv(startDir) {
  const env = {};
  const root = parse(startDir).root;
  let current = startDir;

  while (true) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) {
      return parseDotEnv(readFileSync(candidate, "utf8"));
    }

    if (current === root) {
      return env;
    }

    current = dirname(current);
  }
}

function parseDotEnv(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }

    env[key] = unquote(value);
  }

  return env;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeRuntimeEnv(env) {
  normalizeWslDatabaseUrl(env);
}

function normalizeWslDatabaseUrl(env) {
  if (process.platform !== "win32" || process.env.DATABASE_URL || !env.DATABASE_URL) {
    return;
  }

  if (env.NEURALMAP_DATABASE_HOST_SOURCE === "static") {
    return;
  }

  const databaseUrl = parseUrl(env.DATABASE_URL);
  if (!databaseUrl || !shouldRefreshWslHost(databaseUrl.hostname, env)) {
    return;
  }

  const wslIp = detectWslIp(env.NEURALMAP_WSL_DISTRO ?? "Ubuntu-24.04");
  if (!wslIp || wslIp === databaseUrl.hostname) {
    return;
  }

  databaseUrl.hostname = wslIp;
  env.DATABASE_URL = databaseUrl.toString();
}

function shouldRefreshWslHost(hostname, env) {
  if (env.NEURALMAP_DATABASE_HOST_SOURCE === "wsl") {
    return true;
  }

  return isPrivateWslLikeIpv4(hostname) && canUseWslDocker(env.NEURALMAP_WSL_DISTRO ?? "Ubuntu-24.04");
}

function isPrivateWslLikeIpv4(hostname) {
  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
}

function canUseWslDocker(wslDistro) {
  return succeeds("wsl.exe", [
    "-d",
    wslDistro,
    "--user",
    "root",
    "--",
    "bash",
    "-lc",
    "command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx neuralmap-postgres"
  ]);
}

function detectWslIp(wslDistro) {
  const result = spawnSync("wsl.exe", ["-d", wslDistro, "--", "hostname", "-I"], {
    encoding: "utf8"
  });

  if ((result.status ?? 1) !== 0) {
    return undefined;
  }

  return result.stdout
    .trim()
    .split(/\s+/)
    .find((candidate) => isPrivateWslLikeIpv4(candidate));
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function succeeds(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return (result.status ?? 1) === 0;
}
