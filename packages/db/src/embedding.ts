import type { GraphNode } from "@neuralmap/schema";

import type { PersistedContentChunk } from "./graph-store.js";
import { createEmbeddingProviderConfig, storageEmbeddingDimensions } from "./embedding-provider.js";

export const deterministicEmbeddingModel = createEmbeddingProviderConfig().model;
export const embeddingDimensions = storageEmbeddingDimensions;

const TOKEN_PATTERN = /[\p{L}\p{N}_./-]+/gu;

const semanticAliases: Record<string, string[]> = {
  agent: ["runtime", "session", "handoff", "orchestrator"],
  artifact: ["context", "handoff", "summary", "evidence"],
  cache: ["retrieval", "prompt", "summary", "response", "reuse", "hit", "miss"],
  code: ["repository", "file", "symbol", "module", "implementation"],
  context: ["pack", "handoff", "session", "summary", "evidence", "memory"],
  database: ["postgres", "pgvector", "drizzle", "schema", "storage", "persistence"],
  db: ["postgres", "pgvector", "drizzle", "schema", "storage", "persistence"],
  document: ["doc", "section", "guide", "readme", "adr"],
  graph: ["node", "edge", "neighborhood", "synapse", "relationship", "schema"],
  handoff: ["resume", "session", "summary", "artifact", "continuation"],
  ingest: ["index", "repository", "document", "ticket", "chunk", "connector"],
  issue: ["ticket", "linear", "task", "triage"],
  memory: ["context", "graph", "state", "persistence", "backbone"],
  model: ["router", "profile", "budget", "latency", "cost"],
  node: ["graph", "edge", "neighborhood", "relationship"],
  postgres: ["database", "pgvector", "drizzle", "schema", "storage", "persistence"],
  resume: ["handoff", "session", "summary", "continuation"],
  search: ["retrieval", "semantic", "keyword", "vector", "seed"],
  semantic: ["retrieval", "search", "vector", "similarity", "meaning"],
  session: ["handoff", "resume", "context", "run"],
  ticket: ["issue", "linear", "task", "triage"],
  trace: ["span", "observability", "run", "timeline", "inspection"],
  vector: ["semantic", "retrieval", "search", "similarity", "embedding"]
};

export function createGraphNodeEmbedding(node: GraphNode): number[] {
  return createTextEmbedding(
    [
      node.id,
      node.type,
      node.title,
      node.summary ?? "",
      node.content_ref ?? "",
      node.source_system ?? "",
      ...(node.labels ?? []),
      node.ontology?.profile_id ?? "",
      node.ontology?.type ?? "",
      JSON.stringify(node.properties ?? {}),
      JSON.stringify(node.metadata)
    ].join(" ")
  );
}

export function createContentChunkEmbedding(chunk: PersistedContentChunk): number[] {
  return createTextEmbedding([chunk.source_uri, chunk.content, JSON.stringify(chunk.metadata)].join(" "));
}

export function createQueryEmbedding(query: string): number[] {
  return createTextEmbedding(query);
}

export function toPgVectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => value.toFixed(6)).join(",")}]`;
}

function createTextEmbedding(input: string): number[] {
  const vector = new Array<number>(embeddingDimensions).fill(0);
  const tokens = expandTokens(tokenize(input));

  for (const token of tokens) {
    const index = hashToken(token) % embeddingDimensions;
    vector[index] = (vector[index] ?? 0) + tokenWeight(token);
  }

  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }

  if (norm === 0) {
    return vector;
  }

  const divisor = Math.sqrt(norm);
  return vector.map((value) => Number((value / divisor).toFixed(6)));
}

function tokenize(input: string): string[] {
  return [...input.toLowerCase().matchAll(TOKEN_PATTERN)]
    .map((match) => normalizeToken(match[0]))
    .filter(Boolean);
}

function expandTokens(tokens: readonly string[]): string[] {
  return unique([...tokens, ...tokens.flatMap((token) => semanticAliases[token] ?? [])]);
}

function normalizeToken(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function tokenWeight(token: string): number {
  if (token.length <= 2) {
    return 0.45;
  }
  if (token.includes("/") || token.includes(".")) {
    return 1.35;
  }
  return 1;
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
