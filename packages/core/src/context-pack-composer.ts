import type { ComposeContextRequest, ContextPack, EvidenceItem, GraphNode } from "@neuralmap/schema";

import { expandGraphNeighborhood, type GraphMemory } from "./graph-expansion.js";
import { createId, nowIso } from "./ids.js";
import { classifyQueryIntent } from "./intent.js";
import { rankSeedNodes } from "./retrieval.js";
import type { SeedRetrievalCandidate } from "./retrieval.js";
import { selectContextTemplate, type ContextTemplate } from "./templates.js";

export interface ContextNodeExplanation {
  node_id: string;
  reason_kind: "direct_seed" | "retrieved_seed" | "graph_expansion";
  summary: string;
  seed_score?: number;
  seed_reasons?: string[];
  via_node_id?: string;
  via_edge_id?: string;
  via_edge_type?: string;
  via_edge_confidence?: number;
  evidence_score?: number;
}

export interface ContextCompositionOptions {
  maxEvidenceItems?: number;
  template?: ContextTemplate;
  promptSegmentCache?: {
    key: string;
    hit: boolean;
  };
}

export function composeContextPack(
  request: ComposeContextRequest,
  memory: GraphMemory,
  options: ContextCompositionOptions = {}
): ContextPack {
  const intent = classifyQueryIntent(request.query ?? request.objective);
  const compositionMemory = createCompositionMemory(memory, request.seed_node_ids, intent.preferred_node_types.includes("Artifact"));
  const template = options.template ?? selectContextTemplate(request, intent);
  const rankedSeeds = request.query
    ? rankSeedNodes(
        {
          query: request.query,
          top_k: Math.max(request.seed_node_ids.length, 8),
          expand_hops: 1,
          min_edge_confidence: 0.4
        },
        compositionMemory.nodes,
        { intent }
      )
    : [];

  const seedNodeIds = unique([...request.seed_node_ids, ...rankedSeeds.map((candidate) => candidate.node.id)]);
  const neighborhood = expandGraphNeighborhood(seedNodeIds, compositionMemory, {
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
  const evidenceScores = new Map(evidence.map((item) => [item.node_id, item.score]));
  const nodeExplanations = createNodeExplanations({
    requestedSeedNodeIds: request.seed_node_ids,
    rankedSeeds,
    neighborhoodNodeIds: neighborhood.nodes.map((node) => node.id),
    neighborhoodEdges: neighborhood.edges,
    evidenceScores
  });

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
    template_id: template.id,
    token_budget: request.token_budget,
    metadata: {
      intent: {
        kind: intent.kind,
        confidence: intent.confidence,
        reasons: intent.reasons
      },
      retrieval: {
        mode: "hybrid",
        seed_count: rankedSeeds.length,
        semantic_seed_count: rankedSeeds.filter((candidate) => candidate.semantic_score > 0).length
      },
      template: {
        id: template.id,
        name: template.name,
        version: template.version,
        slots: template.slots
      },
      node_explanations: nodeExplanations,
      ...(options.promptSegmentCache
        ? {
            prompt_segment_cache: {
              layer: "prompt_segment",
              key: options.promptSegmentCache.key,
              hit: options.promptSegmentCache.hit
            }
          }
        : {})
    },
    created_at: nowIso()
  };

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

function createNodeExplanations(input: {
  requestedSeedNodeIds: readonly string[];
  rankedSeeds: readonly SeedRetrievalCandidate[];
  neighborhoodNodeIds: readonly string[];
  neighborhoodEdges: readonly {
    id: string;
    from: string;
    to: string;
    type: string;
    confidence: number;
  }[];
  evidenceScores: ReadonlyMap<string, number>;
}): Record<string, ContextNodeExplanation> {
  const requestedSeeds = new Set(input.requestedSeedNodeIds);
  const seedCandidates = new Map(input.rankedSeeds.map((candidate) => [candidate.node.id, candidate]));
  const allSeedNodeIds = new Set([...requestedSeeds, ...seedCandidates.keys()]);
  const explanations: Record<string, ContextNodeExplanation> = {};

  for (const nodeId of input.neighborhoodNodeIds) {
    const seed = seedCandidates.get(nodeId);
    const evidenceScore = input.evidenceScores.get(nodeId);

    if (requestedSeeds.has(nodeId)) {
      explanations[nodeId] = withEvidenceScore(
        {
          node_id: nodeId,
          reason_kind: "direct_seed",
          summary: seed
            ? "Included because it was selected directly and also matched the retrieval query."
            : "Included because it was selected directly as a seed node.",
          ...(seed
            ? {
                seed_score: seed.score,
                seed_reasons: seed.reasons
              }
            : {})
        },
        evidenceScore
      );
      continue;
    }

    if (seed) {
      explanations[nodeId] = withEvidenceScore(
        {
          node_id: nodeId,
          reason_kind: "retrieved_seed",
          summary: "Included because seed retrieval ranked it as relevant to the query.",
          seed_score: seed.score,
          seed_reasons: seed.reasons
        },
        evidenceScore
      );
      continue;
    }

    const viaEdge = input.neighborhoodEdges.find(
      (edge) =>
        (allSeedNodeIds.has(edge.from) && edge.to === nodeId) ||
        (allSeedNodeIds.has(edge.to) && edge.from === nodeId)
    );

    if (viaEdge) {
      const viaNodeId = allSeedNodeIds.has(viaEdge.from) ? viaEdge.from : viaEdge.to;
      explanations[nodeId] = withEvidenceScore(
        {
          node_id: nodeId,
          reason_kind: "graph_expansion",
          summary: `Included through a ${viaEdge.type} edge from a seed node.`,
          via_node_id: viaNodeId,
          via_edge_id: viaEdge.id,
          via_edge_type: viaEdge.type,
          via_edge_confidence: viaEdge.confidence
        },
        evidenceScore
      );
      continue;
    }

    explanations[nodeId] = withEvidenceScore(
      {
        node_id: nodeId,
        reason_kind: "graph_expansion",
        summary: "Included by graph neighborhood expansion."
      },
      evidenceScore
    );
  }

  return explanations;
}

function withEvidenceScore(
  explanation: ContextNodeExplanation,
  evidenceScore: number | undefined
): ContextNodeExplanation {
  if (evidenceScore === undefined) {
    return explanation;
  }

  return {
    ...explanation,
    evidence_score: evidenceScore
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function createCompositionMemory(
  memory: GraphMemory,
  explicitSeedNodeIds: readonly string[],
  includeGeneratedArtifacts: boolean
): GraphMemory {
  if (includeGeneratedArtifacts) {
    return memory;
  }

  const explicitSeeds = new Set(explicitSeedNodeIds);
  const excludedNodeIds = new Set(
    memory.nodes
      .filter((node) => isGeneratedRuntimeArtifact(node) && !explicitSeeds.has(node.id))
      .map((node) => node.id)
  );

  if (excludedNodeIds.size === 0) {
    return memory;
  }

  return {
    nodes: memory.nodes.filter((node) => !excludedNodeIds.has(node.id)),
    edges: memory.edges.filter((edge) => !excludedNodeIds.has(edge.from) && !excludedNodeIds.has(edge.to))
  };
}

function isGeneratedRuntimeArtifact(node: GraphNode): boolean {
  return node.type === "Artifact" && node.source_system === "runtime" && isArtifactSourceMetadata(node.metadata.source);
}

function isArtifactSourceMetadata(value: unknown): value is { kind: string; id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.kind === "string" && typeof candidate.id === "string";
}
