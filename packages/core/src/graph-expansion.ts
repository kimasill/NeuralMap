import type { GraphEdge, GraphNeighborhood, GraphNode } from "@neuralmap/schema";

import { nowIso } from "./ids.js";

export interface GraphExpansionOptions {
  hops?: number;
  minConfidence?: number;
  edgeTypeBoosts?: Partial<Record<GraphEdge["type"], number>>;
  maxNodes?: number;
}

export interface GraphMemory {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

export function expandGraphNeighborhood(
  seedNodeIds: readonly string[],
  memory: GraphMemory,
  options: GraphExpansionOptions = {}
): GraphNeighborhood {
  const hops = options.hops ?? 1;
  const minConfidence = options.minConfidence ?? 0.4;
  const maxNodes = options.maxNodes ?? 80;
  const nodesById = new Map(memory.nodes.map((node) => [node.id, node]));
  const selectedNodeIds = new Set(seedNodeIds.filter((id) => nodesById.has(id)));
  const selectedEdgeIds = new Set<string>();
  let frontier = [...selectedNodeIds];

  for (let depth = 0; depth < hops && frontier.length > 0; depth += 1) {
    const nextFrontier: string[] = [];

    for (const edge of memory.edges) {
      if (edge.confidence < minConfidence) {
        continue;
      }

      const touchesFrontier = frontier.includes(edge.from) || frontier.includes(edge.to);
      if (!touchesFrontier) {
        continue;
      }

      const boostedWeight = edge.weight * (options.edgeTypeBoosts?.[edge.type] ?? 1);
      if (boostedWeight <= 0) {
        continue;
      }

      selectedEdgeIds.add(edge.id);

      for (const nodeId of [edge.from, edge.to]) {
        if (!selectedNodeIds.has(nodeId) && nodesById.has(nodeId) && selectedNodeIds.size < maxNodes) {
          selectedNodeIds.add(nodeId);
          nextFrontier.push(nodeId);
        }
      }
    }

    frontier = nextFrontier;
  }

  const selectedNodes = [...selectedNodeIds]
    .map((id) => nodesById.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .sort((a, b) => b.importance_score - a.importance_score);

  const selectedEdges = memory.edges.filter(
    (edge) =>
      selectedEdgeIds.has(edge.id) &&
      selectedNodeIds.has(edge.from) &&
      selectedNodeIds.has(edge.to)
  );

  return {
    seed_node_ids: [...seedNodeIds],
    nodes: selectedNodes,
    edges: selectedEdges,
    generated_at: nowIso()
  };
}

