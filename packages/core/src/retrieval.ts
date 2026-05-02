import type { GraphNode, GraphQueryRequest } from "@neuralmap/schema";

export interface SeedRetrievalCandidate {
  node: GraphNode;
  score: number;
  reasons: string[];
}

const TOKEN_PATTERN = /[\p{L}\p{N}_./-]+/gu;

export function tokenize(input: string): string[] {
  return [...input.toLowerCase().matchAll(TOKEN_PATTERN)].map((match) => match[0]);
}

export function rankSeedNodes(request: GraphQueryRequest, nodes: readonly GraphNode[]): SeedRetrievalCandidate[] {
  const tokens = tokenize(request.query);
  const allowedTypes = new Set(request.node_types ?? []);

  return nodes
    .filter((node) => allowedTypes.size === 0 || allowedTypes.has(node.type))
    .map((node) => scoreNode(node, tokens))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.node.importance_score - a.node.importance_score)
    .slice(0, request.top_k);
}

function scoreNode(node: GraphNode, tokens: readonly string[]): SeedRetrievalCandidate {
  const searchable = [
    node.title,
    node.summary ?? "",
    node.content_ref ?? "",
    JSON.stringify(node.metadata)
  ].join(" ").toLowerCase();
  const reasons: string[] = [];
  let lexicalScore = 0;

  for (const token of tokens) {
    if (node.title.toLowerCase().includes(token)) {
      lexicalScore += 3;
      reasons.push(`title:${token}`);
      continue;
    }

    if (searchable.includes(token)) {
      lexicalScore += 1;
      reasons.push(`content:${token}`);
    }
  }

  const qualityScore = node.trust_score * 0.25 + node.freshness_score * 0.25 + node.importance_score * 0.5;
  const score = lexicalScore === 0 ? 0 : lexicalScore + qualityScore;

  return {
    node,
    score: Number(score.toFixed(4)),
    reasons
  };
}

