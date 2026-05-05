import type { GraphEdge, GraphNode } from "@neuralmap/schema";
import { attachScopeToMetadata } from "@neuralmap/schema";

import { chunkText } from "./chunking.js";
import type { ContentModuleSnapshot, IngestEmission } from "./types.js";

export function contentModuleNodeId(id: string): string {
  return `module:${normalizeId(id)}`;
}

export function ingestContentModule(module: ContentModuleSnapshot): IngestEmission {
  const now = new Date().toISOString();
  const nodeId = contentModuleNodeId(module.id);
  const sourceUri = module.source_uri ?? `module://${module.id}`;
  const moduleKind = module.module_kind ?? "document";
  const node: GraphNode = {
    id: nodeId,
    type: toNodeType(moduleKind),
    title: module.title,
    content_ref: sourceUri,
    summary: summarizeModule(module.body),
    source_system: "user",
    trust_score: 0.78,
    freshness_score: 0.9,
    importance_score: clamp(module.priority ?? 0.65, 0.1, 1),
    created_at: now,
    updated_at: now,
    ...(module.scope ? { scope: module.scope } : {}),
    metadata: attachScopeToMetadata(
      {
        kind: "content_module",
        module_id: module.id,
        module_kind: moduleKind,
        parent_module_id: module.parent_module_id,
        enabled: module.enabled ?? true,
        priority: module.priority ?? 0.65,
        order: module.order ?? 0,
        activation_tags: normalizeTags(module.activation_tags ?? []),
        owner_scope: module.owner_scope,
        version: module.version ?? "1",
        source_uri: sourceUri,
        lifecycle_status: module.lifecycle_status ?? "active",
        ...(module.metadata ?? {})
      },
      module.scope
    )
  };
  const edges: GraphEdge[] = [];

  if (module.parent_module_id) {
    edges.push({
      id: `edge:${contentModuleNodeId(module.parent_module_id)}:references:${nodeId}`,
      from: contentModuleNodeId(module.parent_module_id),
      to: nodeId,
      type: "references",
      weight: 0.72,
      confidence: 0.86,
      created_at: now,
      ...(module.scope ? { scope: module.scope } : {}),
      metadata: attachScopeToMetadata(
        {
          source: "content_module_ingest",
          reason: "parent_child_module",
          parent_module_id: module.parent_module_id,
          child_module_id: module.id
        },
        module.scope
      )
    });
  }

  return {
    nodes: [node],
    edges,
    chunks: chunkText(node.id, sourceUri, module.body).map((chunk) => ({
      ...chunk,
      metadata: attachScopeToMetadata(
        {
          ...chunk.metadata,
          kind: "content_module",
          module_id: module.id,
          module_kind: moduleKind,
          activation_tags: normalizeTags(module.activation_tags ?? []),
          version: module.version ?? "1"
        },
        module.scope
      )
    }))
  };
}

function toNodeType(kind: NonNullable<ContentModuleSnapshot["module_kind"]>): GraphNode["type"] {
  switch (kind) {
    case "template":
      return "Template";
    case "policy":
      return "Policy";
    default:
      return "Document";
  }
}

function summarizeModule(body: string): string {
  return body.split(/\n\s*\n/u).find((paragraph) => paragraph.trim().length > 0)?.trim().slice(0, 700) ?? "";
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

function normalizeId(value: string): string {
  return value.trim().replaceAll(/[^a-zA-Z0-9_.:-]+/gu, "-");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
