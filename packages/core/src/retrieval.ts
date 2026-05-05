import type { GraphNode, GraphQueryRequest } from "@neuralmap/schema";

import { classifyQueryIntent, nodeTypeIntentBoost, type QueryIntent } from "./intent.js";

export type RetrievalMode = "lexical" | "semantic" | "hybrid";

export interface SeedRetrievalCandidate {
  node: GraphNode;
  score: number;
  lexical_score: number;
  semantic_score: number;
  quality_score: number;
  reasons: string[];
}

export interface SemanticSeedHint {
  node_id: string;
  similarity: number;
  source?: string;
  rank?: number;
}

export interface SeedRetrievalOptions {
  intent?: QueryIntent;
  mode?: RetrievalMode;
  semanticSeedHints?: readonly SemanticSeedHint[];
}

const TOKEN_PATTERN = /[\p{L}\p{N}_./-]+/gu;
const VECTOR_DIMENSIONS = 128;
const SEMANTIC_THRESHOLD = 0.08;

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

export function tokenize(input: string): string[] {
  return [...input.toLowerCase().matchAll(TOKEN_PATTERN)]
    .map((match) => normalizeToken(match[0]))
    .filter(Boolean);
}

export function rankSeedNodes(
  request: GraphQueryRequest,
  nodes: readonly GraphNode[],
  options: SeedRetrievalOptions = {}
): SeedRetrievalCandidate[] {
  const tokens = unique(tokenize(request.query));
  const allowedTypes = new Set(request.node_types ?? []);
  const intent = options.intent ?? classifyQueryIntent(request.query);
  const mode = options.mode ?? "hybrid";
  const queryVector = createSparseVector(expandQueryTokens(tokens, intent));
  const semanticHints = new Map((options.semanticSeedHints ?? []).map((hint) => [hint.node_id, hint]));

  return nodes
    .filter((node) => allowedTypes.size === 0 || allowedTypes.has(node.type))
    .map((node) => scoreNode(node, tokens, queryVector, intent, mode, semanticHints.get(node.id)))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.node.importance_score - a.node.importance_score)
    .slice(0, request.top_k);
}

function scoreNode(
  node: GraphNode,
  queryTokens: readonly string[],
  queryVector: SparseVector,
  intent: QueryIntent,
  mode: RetrievalMode,
  semanticHint: SemanticSeedHint | undefined
): SeedRetrievalCandidate {
  const searchable = searchableText(node);
  const reasons: string[] = [];
  const lexicalScore = mode === "semantic" ? 0 : calculateLexicalScore(node, searchable, queryTokens, reasons);
  const semanticSimilarity =
    mode === "lexical" ? 0 : cosineSimilarity(queryVector, createSparseVector(expandNodeTokens(node)));
  const localSemanticScore = semanticSimilarity >= SEMANTIC_THRESHOLD ? semanticSimilarity * 4 : 0;
  const hintedSimilarity = semanticHint ? Math.max(0, Math.min(1, semanticHint.similarity)) : 0;
  const hintedSemanticScore = mode === "lexical" ? 0 : hintedSimilarity * 4;
  const semanticScore = Math.max(localSemanticScore, hintedSemanticScore);

  if (localSemanticScore > 0) {
    reasons.push(`semantic:${semanticSimilarity.toFixed(3)}`);
  }
  if (hintedSemanticScore > 0) {
    const source = semanticHint?.source ?? "semantic_hint";
    reasons.push(`${source}:${hintedSimilarity.toFixed(3)}`);
  }

  const qualityScore = node.trust_score * 0.25 + node.freshness_score * 0.25 + node.importance_score * 0.5;
  const baseScore = lexicalScore + semanticScore;
  const intentBoost = nodeTypeIntentBoost(node, intent);
  const intentScore = baseScore > 0 && intentBoost > 0 ? intentBoost : 0;
  if (intentScore > 0) {
    reasons.push(`intent:${intent.kind}:${node.type}`);
  }
  if (lexicalScore > 0 && semanticScore > 0) {
    reasons.push("hybrid:lexical+semantic");
  }

  const score = baseScore === 0 ? 0 : baseScore + intentScore + qualityScore;

  return {
    node,
    score: Number(score.toFixed(4)),
    lexical_score: Number(lexicalScore.toFixed(4)),
    semantic_score: Number(semanticScore.toFixed(4)),
    quality_score: Number(qualityScore.toFixed(4)),
    reasons
  };
}

function calculateLexicalScore(
  node: GraphNode,
  searchable: string,
  queryTokens: readonly string[],
  reasons: string[]
): number {
  let lexicalScore = 0;
  const normalizedTitle = node.title.toLowerCase();

  for (const token of queryTokens) {
    if (normalizedTitle.includes(token)) {
      lexicalScore += 3;
      reasons.push(`title:${token}`);
      continue;
    }

    if (searchable.includes(token)) {
      lexicalScore += 1;
      reasons.push(`content:${token}`);
    }
  }

  return lexicalScore;
}

type SparseVector = Map<number, number>;

function createSparseVector(tokens: readonly string[]): SparseVector {
  const vector: SparseVector = new Map();

  for (const token of tokens) {
    const index = hashToken(token) % VECTOR_DIMENSIONS;
    vector.set(index, (vector.get(index) ?? 0) + tokenWeight(token));
  }

  return vector;
}

function cosineSimilarity(a: SparseVector, b: SparseVector): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (const value of a.values()) {
    aNorm += value * value;
  }
  for (const [index, value] of b) {
    bNorm += value * value;
    dot += value * (a.get(index) ?? 0);
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function expandQueryTokens(tokens: readonly string[], intent: QueryIntent): string[] {
  return unique([
    ...tokens,
    intent.kind,
    ...intent.preferred_node_types.map((type) => type.toLowerCase()),
    ...intent.preferred_edge_types,
    ...tokens.flatMap((token) => semanticAliases[token] ?? [])
  ]);
}

function expandNodeTokens(node: GraphNode): string[] {
  const tokens = tokenize(searchableText(node));
  return unique([
    ...tokens,
    node.type.toLowerCase(),
    ...(node.labels ?? []).map((label) => label.toLowerCase()),
    ...(node.ontology ? [node.ontology.profile_id, node.ontology.type] : []),
    ...(node.source_system ? [node.source_system] : []),
    ...tokens.flatMap((token) => semanticAliases[token] ?? [])
  ]);
}

function searchableText(node: GraphNode): string {
  return [
    node.id,
    node.type,
    node.title,
    node.summary ?? "",
    node.content_ref ?? "",
    ...(node.labels ?? []),
    node.ontology?.profile_id ?? "",
    node.ontology?.type ?? "",
    JSON.stringify(node.properties ?? {}),
    JSON.stringify(node.metadata)
  ]
    .join(" ")
    .toLowerCase();
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
