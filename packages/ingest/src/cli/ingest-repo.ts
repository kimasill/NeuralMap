import { createDbClient, createGraphStore } from "@neuralmap/db";

import { ingestRepository } from "../repository.js";
import { scanRepositorySnapshot } from "../repo-scanner.js";

interface CliOptions {
  root: string;
  id: string;
  dryRun: boolean;
  maxFileBytes?: number;
}

const options = parseArgs(process.argv.slice(2));
const scanOptions = {
  root: options.root,
  id: options.id
};
const snapshot = await scanRepositorySnapshot(
  options.maxFileBytes === undefined
    ? scanOptions
    : {
        ...scanOptions,
        maxFileBytes: options.maxFileBytes
      }
);
const emission = ingestRepository(snapshot);

if (options.dryRun) {
  printJson({
    mode: "dry-run",
    root: snapshot.root,
    files: snapshot.files.length,
    nodes: emission.nodes.length,
    edges: emission.edges.length,
    chunks: emission.chunks.length
  });
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Use --dry-run to inspect without persisting.");
}

const { db, client } = createDbClient(databaseUrl);
try {
  const store = createGraphStore(db);
  const result = await store.upsertGraph(emission);
  printJson({
    mode: "database",
    root: snapshot.root,
    files: snapshot.files.length,
    ...result
  });
} finally {
  await client.end();
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    root: process.env.INIT_CWD ?? process.cwd(),
    id: "local-repo",
    dryRun: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--root":
        options.root = requireValue(arg, next);
        index += 1;
        break;
      case "--id":
        options.id = requireValue(arg, next);
        index += 1;
        break;
      case "--max-file-bytes":
        options.maxFileBytes = Number(requireValue(arg, next));
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
