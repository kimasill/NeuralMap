import type { ContextPack, EvidenceItem, GraphNode } from "@neuralmap/schema";

import { isStaleTemporalNode } from "./context-pack-composer.js";

export type ContextValidationSeverity = "error" | "warning";

export interface ContextValidationIssue {
  code:
    | "evidence_without_source"
    | "section_without_source"
    | "unresolved_node"
    | "stale_evidence"
    | "current_state_conflict";
  severity: ContextValidationSeverity;
  message: string;
  node_id?: string;
}

export interface ContextValidationResult {
  ok: boolean;
  issues: ContextValidationIssue[];
  warnings: ContextValidationIssue[];
  stats: {
    evidence_count: number;
    stale_evidence_count: number;
    conflict_count: number;
    unresolved_node_count: number;
  };
}

/**
 * Rule-based reliability guard for an assembled Context Pack (blueprint §19).
 *
 * - every evidence/section snippet must trace back to a node listed in `node_ids`
 *   ("요약 문장마다 source node 필수 연결" / evidence-only mode)
 * - superseded or inactive temporal nodes leaking into evidence are flagged
 *   (freshness penalty surfaced as a warning)
 * - two different *current* values for the same (owner, state_type) is a hard
 *   conflict — the classic stale-state hallucination trigger
 */
export function validateContextPack(pack: ContextPack, nodes: readonly GraphNode[]): ContextValidationResult {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIdSet = new Set(pack.node_ids);
  const issues: ContextValidationIssue[] = [];
  const warnings: ContextValidationIssue[] = [];

  const sectionItems = Object.values(pack.sections ?? {}).flat();
  const allItems: Array<{ item: EvidenceItem; origin: "evidence" | "section" }> = [
    ...pack.evidence.map((item) => ({ item, origin: "evidence" as const })),
    ...sectionItems.map((item) => ({ item, origin: "section" as const }))
  ];

  let staleEvidenceCount = 0;
  let unresolvedNodeCount = 0;
  const currentStateValues = new Map<string, Map<string, string>>();

  for (const { item, origin } of allItems) {
    if (!nodeIdSet.has(item.node_id)) {
      issues.push({
        code: origin === "evidence" ? "evidence_without_source" : "section_without_source",
        severity: "error",
        node_id: item.node_id,
        message: `${origin} item references node '${item.node_id}' that is not in the pack's node_ids (no source linkage).`
      });
    }

    const node = nodesById.get(item.node_id);
    if (!node) {
      unresolvedNodeCount += 1;
      issues.push({
        code: "unresolved_node",
        severity: "error",
        node_id: item.node_id,
        message: `Cannot resolve source node '${item.node_id}' from the provided graph memory.`
      });
      continue;
    }

    if (isStaleTemporalNode(node)) {
      staleEvidenceCount += 1;
      warnings.push({
        code: "stale_evidence",
        severity: "warning",
        node_id: node.id,
        message: `Evidence node '${node.id}' is superseded or inactive (freshness penalty applies).`
      });
      continue;
    }

    const stateKey = currentStateKey(node);
    if (stateKey) {
      const value = currentStateValue(node);
      const seen = currentStateValues.get(stateKey) ?? new Map<string, string>();
      seen.set(value, node.id);
      currentStateValues.set(stateKey, seen);
    }
  }

  for (const [stateKey, values] of currentStateValues) {
    if (values.size > 1) {
      issues.push({
        code: "current_state_conflict",
        severity: "error",
        message: `Conflicting current state for '${stateKey}': ${[...values.entries()]
          .map(([value, nodeId]) => `${value} (${nodeId})`)
          .join(", ")}.`
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    stats: {
      evidence_count: allItems.length,
      stale_evidence_count: staleEvidenceCount,
      conflict_count: issues.filter((issue) => issue.code === "current_state_conflict").length,
      unresolved_node_count: unresolvedNodeCount
    }
  };
}

function currentStateKey(node: GraphNode): string | undefined {
  if (!isStateNode(node)) {
    return undefined;
  }
  const properties = nodeProperties(node);
  const owner = asString(properties.owner_id);
  const stateType = asString(properties.state_type);
  if (!owner || !stateType) {
    return undefined;
  }
  return `${owner}:${stateType}`;
}

function currentStateValue(node: GraphNode): string {
  const properties = nodeProperties(node);
  return asString(properties.value) ?? node.summary ?? node.title;
}

function isStateNode(node: GraphNode): boolean {
  if (node.ontology?.type === "State") {
    return true;
  }
  return (node.labels ?? []).includes("State");
}

function nodeProperties(node: GraphNode): Record<string, unknown> {
  if (node.properties && typeof node.properties === "object") {
    return node.properties;
  }
  const fromMetadata = node.metadata.properties;
  return fromMetadata && typeof fromMetadata === "object" && !Array.isArray(fromMetadata)
    ? (fromMetadata as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
