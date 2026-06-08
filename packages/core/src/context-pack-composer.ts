import type { ComposeContextRequest, ContextPack, EvidenceItem, GraphNode } from "@neuralmap/schema";
import { getScopeFromMetadata, scopeMatches } from "@neuralmap/schema";

import {
  contentModuleSortScore,
  isActiveContentModule,
  isContentModuleNode,
  listIncludedContentModules
} from "./content-modules.js";
import { validateContextPack } from "./context-validation.js";
import { expandGraphNeighborhood, type GraphMemory } from "./graph-expansion.js";
import { createId, nowIso } from "./ids.js";
import { classifyQueryIntent } from "./intent.js";
import { isConsolidatedMemoryNode, isRawEventNode, rawEventsCoveredByConsolidatedMemory } from "./memory-consolidation.js";
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
  const activationTags = request.activation_tags ?? [];
  const compositionMemory = createCompositionMemory({
    memory,
    explicitSeedNodeIds: request.seed_node_ids,
    includeGeneratedArtifacts: intent.preferred_node_types.includes("Artifact"),
    activationTags,
    scope: request.scope
  });
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
    .sort((a, b) => compareEvidenceNodes(a, b, activationTags))
    .slice(0, maxEvidenceItems)
    .map(toEvidenceItem);
  const sections = createContextSections(request, neighborhood.nodes, evidence);
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
    ...(sections ? { sections } : {}),
    decisions,
    blockers,
    template_id: template.id,
    token_budget: request.token_budget,
    ...(request.scope ? { scope: request.scope } : {}),
    metadata: {
      ...(request.scope ? { scope: request.scope } : {}),
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
      ...(request.profile_id ? { profile_id: request.profile_id } : {}),
      ...(request.context_policy
        ? {
            context_policy: request.context_policy
          }
        : {}),
      content_modules: listIncludedContentModules(neighborhood.nodes, activationTags),
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

  const validation = validateContextPack(pack, neighborhood.nodes);
  pack.metadata.validation = {
    ok: validation.ok,
    issue_count: validation.issues.length,
    warning_count: validation.warnings.length,
    stale_evidence_count: validation.stats.stale_evidence_count,
    conflict_count: validation.stats.conflict_count,
    ...(validation.issues.length > 0 ? { issues: validation.issues } : {})
  };

  return pack;
}

function hasSummary(node: GraphNode): boolean {
  return Boolean(node.summary || node.content_ref);
}

/**
 * A temporal fact node is "stale" once it has been superseded (`valid_to` set) or
 * archived/deprecated. The canonical current view keeps `valid_to == null`.
 */
export function isStaleTemporalNode(node: GraphNode): boolean {
  return readValidTo(node) != null || isInactiveLifecycleNode(node);
}

function isInactiveLifecycleNode(node: GraphNode): boolean {
  const status =
    node.lifecycle_status ??
    (typeof node.metadata.lifecycle_status === "string" ? node.metadata.lifecycle_status : "active");
  return status === "archived" || status === "deprecated";
}

function readValidTo(node: GraphNode): string | null | undefined {
  if (node.valid_to !== undefined) {
    return node.valid_to;
  }
  const fromMetadata = node.metadata.valid_to;
  if (fromMetadata === null) {
    return null;
  }
  return typeof fromMetadata === "string" ? fromMetadata : undefined;
}

/** Down-weights superseded/inactive nodes so current state always outranks history. */
function freshnessPenalty(node: GraphNode): number {
  return isStaleTemporalNode(node) ? 0.35 : 0;
}

function toEvidenceItem(node: GraphNode): EvidenceItem {
  const moduleBoost = isContentModuleNode(node) ? Math.min(0.2, contentModuleSortScore(node, []) * 0.08) : 0;
  const consolidatedBoost = isConsolidatedMemoryNode(node) ? 0.12 : 0;
  const score =
    node.importance_score * 0.5 +
    node.trust_score * 0.3 +
    node.freshness_score * 0.2 +
    moduleBoost +
    consolidatedBoost -
    freshnessPenalty(node);
  return {
    node_id: node.id,
    snippet: node.summary ?? node.content_ref ?? node.title,
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4))
  };
}

function createContextSections(
  request: ComposeContextRequest,
  nodes: readonly GraphNode[],
  evidence: readonly EvidenceItem[]
): Record<string, EvidenceItem[]> | undefined {
  const sectionNames = request.context_policy?.sections;
  if (!sectionNames?.length) {
    return undefined;
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const sections: Record<string, EvidenceItem[]> = {};

  for (const section of sectionNames) {
    sections[section] = evidence.filter((item) => belongsToSection(nodesById.get(item.node_id), section));
  }

  return sections;
}

function belongsToSection(node: GraphNode | undefined, section: string): boolean {
  if (!node) {
    return false;
  }

  const labels = getNodeLabels(node);
  const ontologyType = node.ontology?.type ?? readMetadataString(node.metadata.ontology, "type");
  const kind = typeof node.metadata.kind === "string" ? node.metadata.kind : "";
  const sectionKey = section.toLowerCase();

  if (sectionKey.includes("scene")) {
    return labels.includes("Scene") || ontologyType === "Scene" || node.type === "Session";
  }
  if (sectionKey.includes("state")) {
    return labels.includes("State") || ontologyType === "State" || kind.includes("state");
  }
  if (sectionKey.includes("perspective") || sectionKey.includes("knowledge")) {
    return labels.some((label) => ["Perspective", "Observation", "Belief"].includes(label)) ||
      ["Observation", "Belief"].includes(ontologyType ?? "");
  }
  if (sectionKey.includes("history") || sectionKey.includes("event")) {
    return labels.includes("Event") || ontologyType === "Event" || node.type === "Task" || kind.endsWith("_event");
  }
  if (sectionKey.includes("open") || sectionKey.includes("thread") || sectionKey.includes("loop")) {
    return kind.includes("open_loop") || labels.includes("OpenThread");
  }

  return true;
}

function compareEvidenceNodes(a: GraphNode, b: GraphNode, activationTags: readonly string[]): number {
  const aConsolidated = isConsolidatedMemoryNode(a) ? 0.18 : 0;
  const bConsolidated = isConsolidatedMemoryNode(b) ? 0.18 : 0;
  const aModule = isContentModuleNode(a) ? contentModuleSortScore(a, activationTags) : a.importance_score;
  const bModule = isContentModuleNode(b) ? contentModuleSortScore(b, activationTags) : b.importance_score;

  const aRank = a.importance_score + aModule + aConsolidated - freshnessPenalty(a);
  const bRank = b.importance_score + bModule + bConsolidated - freshnessPenalty(b);
  return bRank - aRank;
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

function createCompositionMemory(input: {
  memory: GraphMemory;
  explicitSeedNodeIds: readonly string[];
  includeGeneratedArtifacts: boolean;
  activationTags: readonly string[];
  scope: ComposeContextRequest["scope"];
}): GraphMemory {
  const explicitSeeds = new Set(input.explicitSeedNodeIds);
  const coveredRawEventIds = rawEventsCoveredByConsolidatedMemory(input.memory);
  const excludedNodeIds = new Set<string>();

  for (const node of input.memory.nodes) {
    if (!explicitSeeds.has(node.id) && !scopeMatches(node.scope ?? getScopeFromMetadata(node.metadata), input.scope)) {
      excludedNodeIds.add(node.id);
      continue;
    }

    if (!explicitSeeds.has(node.id) && isRedactedNode(node)) {
      excludedNodeIds.add(node.id);
      continue;
    }

    if (!input.includeGeneratedArtifacts && isGeneratedRuntimeArtifact(node) && !explicitSeeds.has(node.id)) {
      excludedNodeIds.add(node.id);
      continue;
    }

    if (isContentModuleNode(node) && !explicitSeeds.has(node.id) && !isActiveContentModule(node)) {
      excludedNodeIds.add(node.id);
      continue;
    }

    if (isRawEventNode(node) && coveredRawEventIds.has(node.id) && !explicitSeeds.has(node.id)) {
      excludedNodeIds.add(node.id);
      continue;
    }

    if (!explicitSeeds.has(node.id) && isStaleTemporalNode(node)) {
      excludedNodeIds.add(node.id);
    }
  }

  if (excludedNodeIds.size === 0) {
    return input.memory;
  }

  return {
    nodes: input.memory.nodes.filter((node) => !excludedNodeIds.has(node.id)),
    edges: input.memory.edges.filter((edge) => {
      const edgeScope = edge.scope ?? getScopeFromMetadata(edge.metadata);
      return (
        !excludedNodeIds.has(edge.from) &&
        !excludedNodeIds.has(edge.to) &&
        scopeMatches(edgeScope, input.scope) &&
        !isRedactedEdge(edge)
      );
    })
  };
}

function isGeneratedRuntimeArtifact(node: GraphNode): boolean {
  return node.type === "Artifact" && node.source_system === "runtime" && isArtifactSourceMetadata(node.metadata.source);
}

function isRedactedNode(node: GraphNode): boolean {
  return node.metadata.redacted === true || node.metadata.deleted === true || node.metadata.lifecycle_status === "redacted";
}

function isRedactedEdge(edge: { metadata: Record<string, unknown> }): boolean {
  return edge.metadata.redacted === true || edge.metadata.deleted === true || edge.metadata.lifecycle_status === "redacted";
}

function getNodeLabels(node: GraphNode): string[] {
  if (node.labels) {
    return node.labels;
  }
  const labels = node.metadata.labels;
  return Array.isArray(labels) ? labels.filter((item): item is string => typeof item === "string") : [];
}

function readMetadataString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const recordValue = (value as Record<string, unknown>)[key];
  return typeof recordValue === "string" ? recordValue : undefined;
}

function isArtifactSourceMetadata(value: unknown): value is { kind: string; id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.kind === "string" && typeof candidate.id === "string";
}
