import type { GraphEdge, GraphNode } from "@neuralmap/schema";

import { chunkText } from "./chunking.js";
import type { IngestEmission, RepositoryFile, RepositorySnapshot } from "./types.js";

const IMPORT_PATTERN = /import\s+(?:.+?\s+from\s+)?["']([^"']+)["']|require\(["']([^"']+)["']\)/gu;

export function ingestRepository(snapshot: RepositorySnapshot): IngestEmission {
  const now = new Date().toISOString();
  const repositoryNode: GraphNode = {
    id: `repo:${snapshot.id}`,
    type: "Repository",
    title: snapshot.root,
    content_ref: snapshot.root,
    summary: `Repository snapshot with ${snapshot.files.length} indexed files.`,
    source_system: "repo",
    trust_score: 0.82,
    freshness_score: 0.9,
    importance_score: 0.8,
    created_at: now,
    updated_at: now,
    metadata: snapshot.metadata ?? {}
  };

  const fileNodes = snapshot.files.map((file) => toFileNode(snapshot, file, now));
  const fileNodeByPath = new Map(fileNodes.map((node) => [String(node.metadata.path), node]));
  const edges: GraphEdge[] = fileNodes.map((node) => ({
    id: `edge:${repositoryNode.id}:references:${node.id}`,
    from: repositoryNode.id,
    to: node.id,
    type: "references",
    weight: 0.7,
    confidence: 0.85,
    created_at: now,
    metadata: {}
  }));

  for (const file of snapshot.files) {
    const from = fileNodeByPath.get(file.path);
    if (!from) {
      continue;
    }

    for (const specifier of extractImportSpecifiers(file.content)) {
      const target = resolveLocalImport(file.path, specifier, fileNodeByPath);
      if (!target) {
        continue;
      }

      edges.push({
        id: `edge:${from.id}:depends_on:${target.id}`,
        from: from.id,
        to: target.id,
        type: "depends_on",
        weight: 0.65,
        confidence: 0.72,
        created_at: now,
        metadata: { import: specifier }
      });
    }
  }

  return {
    nodes: [repositoryNode, ...fileNodes],
    edges,
    chunks: snapshot.files.flatMap((file) => {
      const node = fileNodeByPath.get(file.path);
      return node ? chunkText(node.id, `${snapshot.root}/${file.path}`, file.content) : [];
    })
  };
}

function toFileNode(snapshot: RepositorySnapshot, file: RepositoryFile, now: string): GraphNode {
  return {
    id: `repo:${snapshot.id}:file:${file.path}`,
    type: "CodeFile",
    title: file.path,
    content_ref: `${snapshot.root}/${file.path}`,
    summary: summarizeFile(file),
    source_system: "repo",
    trust_score: 0.78,
    freshness_score: 0.9,
    importance_score: inferFileImportance(file.path),
    created_at: now,
    updated_at: now,
    metadata: {
      path: file.path,
      language: file.language ?? inferLanguage(file.path),
      ...(file.metadata ?? {})
    }
  };
}

function summarizeFile(file: RepositoryFile): string {
  const lineCount = file.content.split(/\r?\n/u).length;
  return `${file.path} (${lineCount} lines)`;
}

function inferFileImportance(path: string): number {
  if (/README|CLAUDE|AGENTS|package\.json|tsconfig|schema|migration/iu.test(path)) {
    return 0.86;
  }

  if (/test|spec/iu.test(path)) {
    return 0.62;
  }

  return 0.68;
}

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ?? "text";
}

function extractImportSpecifiers(content: string): string[] {
  return [...content.matchAll(IMPORT_PATTERN)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => Boolean(value));
}

function resolveLocalImport(
  fromPath: string,
  specifier: string,
  fileNodeByPath: ReadonlyMap<string, GraphNode>
): GraphNode | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const fromParts = fromPath.split("/");
  fromParts.pop();
  const normalized = normalizePath([...fromParts, specifier].join("/"));
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`
  ];

  for (const candidate of candidates) {
    const node = fileNodeByPath.get(candidate);
    if (node) {
      return node;
    }
  }

  return undefined;
}

function normalizePath(path: string): string {
  const output: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      output.pop();
      continue;
    }

    output.push(part);
  }

  return output.join("/");
}

