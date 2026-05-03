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
