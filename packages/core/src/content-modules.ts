import type { GraphNode } from "@neuralmap/schema";

export interface ContentModuleInfo {
  module_id: string;
  module_kind: string;
  enabled: boolean;
  priority: number;
  order: number;
  activation_tags: string[];
  version: string;
  lifecycle_status: string;
  parent_module_id?: string | undefined;
  owner_scope?: string | undefined;
}

export function isContentModuleNode(node: GraphNode): boolean {
  return node.metadata.kind === "content_module";
}

export function readContentModuleInfo(node: GraphNode): ContentModuleInfo | undefined {
  if (!isContentModuleNode(node)) {
    return undefined;
  }

  const moduleId = readString(node.metadata.module_id) ?? node.id.replace(/^module:/u, "");
  const moduleKind = readString(node.metadata.module_kind) ?? "document";
  const enabled = readBoolean(node.metadata.enabled) ?? true;
  const priority = readNumber(node.metadata.priority) ?? node.importance_score;
  const order = readNumber(node.metadata.order) ?? 0;
  const version = readString(node.metadata.version) ?? "1";
  const lifecycleStatus = readString(node.metadata.lifecycle_status) ?? "active";
  const parentModuleId = readString(node.metadata.parent_module_id);
  const ownerScope = readString(node.metadata.owner_scope);
  const info: ContentModuleInfo = {
    module_id: moduleId,
    module_kind: moduleKind,
    enabled,
    priority,
    order,
    activation_tags: readStringList(node.metadata.activation_tags),
    version,
    lifecycle_status: lifecycleStatus
  };

  if (parentModuleId) {
    info.parent_module_id = parentModuleId;
  }
  if (ownerScope) {
    info.owner_scope = ownerScope;
  }

  return info;
}

export function isActiveContentModule(node: GraphNode): boolean {
  const info = readContentModuleInfo(node);
  return !info || (info.enabled && !["archived", "deprecated"].includes(info.lifecycle_status));
}

export function contentModuleActivationScore(node: GraphNode, activationTags: readonly string[]): number {
  const info = readContentModuleInfo(node);
  if (!info || activationTags.length === 0) {
    return 0;
  }

  const requested = new Set(activationTags.map(normalizeTag));
  const matched = info.activation_tags.filter((tag) => requested.has(normalizeTag(tag)));
  return matched.length === 0 ? 0 : matched.length / Math.max(requested.size, 1);
}

export function contentModuleSortScore(node: GraphNode, activationTags: readonly string[]): number {
  const info = readContentModuleInfo(node);
  if (!info) {
    return node.importance_score;
  }

  return info.priority + contentModuleActivationScore(node, activationTags) * 0.4 - info.order * 0.001;
}

export function listIncludedContentModules(
  nodes: readonly GraphNode[],
  activationTags: readonly string[]
): Array<ContentModuleInfo & { node_id: string; activation_score: number }> {
  return nodes.flatMap((node) => {
    const info = readContentModuleInfo(node);
    if (!info) {
      return [];
    }

    return [
      {
        ...info,
        node_id: node.id,
        activation_score: contentModuleActivationScore(node, activationTags)
      }
    ];
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string").map(normalizeTag).filter(Boolean))];
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}
