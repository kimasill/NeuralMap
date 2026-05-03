import type { GraphEdge, GraphNode } from "@neuralmap/schema";

import type { IngestEmission } from "./types.js";

export interface CrossSourceMemory {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

const textSourceTypes = new Set<GraphNode["type"]>(["Ticket", "Document", "DocSection", "Task", "Artifact"]);
const codeTargetTypes = new Set<GraphNode["type"]>(["CodeFile", "TestCase", "Repository"]);

export function linkCrossSourceReferences(
  emission: IngestEmission,
  memory: CrossSourceMemory,
  now = new Date().toISOString()
): IngestEmission {
  const changedNodeIds = new Set(emission.nodes.map((node) => node.id));
  const combinedNodes = upsertNodes(memory.nodes, emission.nodes);
  const existingEdgeKeys = new Set([...memory.edges, ...emission.edges].map(toEdgeKey));
  const edges = [...emission.edges];

  for (const source of combinedNodes) {
    if (!textSourceTypes.has(source.type)) {
      continue;
    }

    const sourceWasChanged = changedNodeIds.has(source.id);
    const sourceText = searchableText(source);

    for (const target of combinedNodes) {
      if (source.id === target.id || !codeTargetTypes.has(target.type)) {
        continue;
      }

      if (!sourceWasChanged && !changedNodeIds.has(target.id)) {
        continue;
      }

      const match = findTargetMention(sourceText, target);
      if (!match) {
        continue;
      }

      const edge: GraphEdge = {
        id: `edge:${source.id}:references:${target.id}`,
        from: source.id,
        to: target.id,
        type: "references",
        weight: match.weight,
        confidence: match.confidence,
        created_at: now,
        metadata: {
          source: "cross_source_linker",
          reason: match.reason,
          matched_text: match.value
        }
      };
      const key = toEdgeKey(edge);

      if (!existingEdgeKeys.has(key)) {
        existingEdgeKeys.add(key);
        edges.push(edge);
      }
    }
  }

  return {
    ...emission,
    edges
  };
}

function upsertNodes(existing: readonly GraphNode[], changed: readonly GraphNode[]): GraphNode[] {
  const nodesById = new Map(existing.map((node) => [node.id, node]));
  for (const node of changed) {
    nodesById.set(node.id, node);
  }
  return [...nodesById.values()];
}

function searchableText(node: GraphNode): string {
  return [
    node.id,
    node.title,
    node.summary ?? "",
    node.content_ref ?? "",
    JSON.stringify(node.metadata)
  ]
    .join("\n")
    .toLowerCase();
}

function findTargetMention(sourceText: string, target: GraphNode): {
  value: string;
  reason: "path_mention" | "content_ref_mention" | "node_id_mention";
  weight: number;
  confidence: number;
} | undefined {
  const path = typeof target.metadata.path === "string" ? normalizePath(target.metadata.path) : undefined;
  if (path && sourceText.includes(path.toLowerCase())) {
    return {
      value: path,
      reason: "path_mention",
      weight: 0.72,
      confidence: 0.82
    };
  }

  if (target.content_ref && sourceText.includes(normalizePath(target.content_ref).toLowerCase())) {
    return {
      value: target.content_ref,
      reason: "content_ref_mention",
      weight: 0.68,
      confidence: 0.76
    };
  }

  if (sourceText.includes(target.id.toLowerCase())) {
    return {
      value: target.id,
      reason: "node_id_mention",
      weight: 0.62,
      confidence: 0.72
    };
  }

  return undefined;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function toEdgeKey(edge: Pick<GraphEdge, "from" | "to" | "type">): string {
  return `${edge.from}:${edge.type}:${edge.to}`;
}
