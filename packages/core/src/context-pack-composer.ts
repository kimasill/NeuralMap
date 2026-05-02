import type { ComposeContextRequest, ContextPack, EvidenceItem, GraphNode } from "@neuralmap/schema";

import { expandGraphNeighborhood, type GraphMemory } from "./graph-expansion.js";
import { createId, nowIso } from "./ids.js";
import { rankSeedNodes } from "./retrieval.js";

export interface ContextCompositionOptions {
  maxEvidenceItems?: number;
}

export function composeContextPack(
  request: ComposeContextRequest,
  memory: GraphMemory,
  options: ContextCompositionOptions = {}
): ContextPack {
  const rankedSeeds = request.query
    ? rankSeedNodes(
        {
          query: request.query,
          top_k: Math.max(request.seed_node_ids.length, 8),
          expand_hops: 1,
          min_edge_confidence: 0.4
        },
        memory.nodes
      )
    : [];

  const seedNodeIds = unique([...request.seed_node_ids, ...rankedSeeds.map((candidate) => candidate.node.id)]);
  const neighborhood = expandGraphNeighborhood(seedNodeIds, memory, {
    hops: 1,
    minConfidence: 0.4,
    edgeTypeBoosts: {
      references: 1.2,
      depends_on: 1.1,
      validated_by: 1.25,
      blocks: 1.3
    }
  });

  const maxEvidenceItems = options.maxEvidenceItems ?? 8;
  const evidence = neighborhood.nodes
    .filter(hasSummary)
    .sort((a, b) => b.importance_score - a.importance_score)
    .slice(0, maxEvidenceItems)
    .map(toEvidenceItem);

  const decisions = neighborhood.nodes
    .filter((node) => node.type === "Decision")
    .map((node) => node.summary ?? node.title)
    .slice(0, 8);

  const blockers = neighborhood.edges
    .filter((edge) => edge.type === "blocks")
    .map((edge) => {
      const from = neighborhood.nodes.find((node) => node.id === edge.from);
      const to = neighborhood.nodes.find((node) => node.id === edge.to);
      return `${from?.title ?? edge.from} blocks ${to?.title ?? edge.to}`;
    })
    .slice(0, 8);

  const pack: ContextPack = {
    id: createId("ctx"),
    objective: request.objective,
    agent_id: request.agent_id,
    session_id: request.session_id,
    node_ids: neighborhood.nodes.map((node) => node.id),
    evidence,
    decisions,
    blockers,
    token_budget: request.token_budget,
    created_at: nowIso()
  };

  if (request.task_type) {
    pack.template_id = `${request.task_type}:default`;
  }

  return pack;
}

function hasSummary(node: GraphNode): boolean {
  return Boolean(node.summary || node.content_ref);
}

function toEvidenceItem(node: GraphNode): EvidenceItem {
  return {
    node_id: node.id,
    snippet: node.summary ?? node.content_ref ?? node.title,
    score: Number((node.importance_score * 0.5 + node.trust_score * 0.3 + node.freshness_score * 0.2).toFixed(4))
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

