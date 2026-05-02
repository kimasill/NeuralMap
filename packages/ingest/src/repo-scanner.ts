import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { RepositoryFile, RepositorySnapshot } from "./types.js";

export interface ScanRepositoryOptions {
  root: string;
  id: string;
  maxFileBytes?: number;
  includeExtensions?: string[];
  ignoreDirectories?: string[];
  ignoreFiles?: string[];
}

const defaultIncludeExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const defaultIgnoreDirectories = new Set([
  ".git",
  ".logs",
  ".pnpm-store",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "dist-types",
  "node_modules"
]);

const defaultIgnoreFiles = new Set(["pnpm-lock.yaml"]);

export async function scanRepositorySnapshot(options: ScanRepositoryOptions): Promise<RepositorySnapshot> {
  const root = path.resolve(options.root);
  const maxFileBytes = options.maxFileBytes ?? 256_000;
  const includeExtensions = new Set(options.includeExtensions ?? [...defaultIncludeExtensions]);
  const ignoreDirectories = new Set(options.ignoreDirectories ?? [...defaultIgnoreDirectories]);
  const ignoreFiles = new Set(options.ignoreFiles ?? [...defaultIgnoreFiles]);
  const files: RepositoryFile[] = [];

  await walk(root, root, files, {
    includeExtensions,
    ignoreDirectories,
    ignoreFiles,
    maxFileBytes
  });

  return {
    id: options.id,
    root,
    files,
    metadata: {
      scanner: "local-filesystem",
      maxFileBytes,
      fileCount: files.length
    }
  };
}

interface WalkContext {
  includeExtensions: ReadonlySet<string>;
  ignoreDirectories: ReadonlySet<string>;
  ignoreFiles: ReadonlySet<string>;
  maxFileBytes: number;
}

async function walk(root: string, current: string, files: RepositoryFile[], context: WalkContext): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (context.ignoreDirectories.has(entry.name)) {
        continue;
      }

      await walk(root, path.join(current, entry.name), files, context);
      continue;
    }

    if (!entry.isFile() || context.ignoreFiles.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(current, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    if (!context.includeExtensions.has(extension)) {
      continue;
    }

    const info = await stat(absolutePath);
    if (info.size > context.maxFileBytes) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    if (content.includes("\u0000")) {
      continue;
    }

    files.push({
      path: toPosixPath(path.relative(root, absolutePath)),
      content,
      language: inferLanguage(extension),
      metadata: {
        size: info.size,
        modifiedAt: info.mtime.toISOString()
      }
    });
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function inferLanguage(extension: string): string {
  switch (extension) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "jsx";
    case ".md":
      return "markdown";
    case ".sql":
      return "sql";
    case ".yaml":
    case ".yml":
      return "yaml";
    default:
      return extension.replace(/^\./u, "") || "text";
  }
}

