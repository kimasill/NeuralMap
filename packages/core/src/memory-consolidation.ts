import type { GraphEdge, GraphNode, GraphScope } from "@neuralmap/schema";
import { attachScopeToMetadata } from "@neuralmap/schema";

import type { GraphMemory } from "./graph-expansion.js";
import { nowIso } from "./ids.js";

export interface MemoryConsolidationInput {
  memory: GraphMemory;
  session_id?: string | undefined;
  workflow_id?: string | undefined;
  scope?: GraphScope | undefined;
  max_events?: number | undefined;
}

export interface MemoryConsolidationOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source_event_ids: string[];
  token_savings: {
    raw_tokens_estimate: number;
    consolidated_tokens_estimate: number;
    saved_tokens_estimate: number;
  };
}

interface ExtractedMemory {
  kind: "fact" | "decision" | "commitment" | "state_change" | "open_loop";
  statement: string;
  event_id: string;
  importance: number;
  contradictory_key?: string | undefined;
  polarity?: "positive" | "negative" | undefined;
}

export function consolidateEventMemory(input: MemoryConsolidationInput): MemoryConsolidationOutput {
  const now = nowIso();
  const events = selectEvents(input).slice(0, input.max_events ?? 80);
  const extracted = deduplicate(events.flatMap(extractMemories));
  const sessionKey = normalizeId(input.session_id ?? input.workflow_id ?? inferSessionId(events) ?? "global");
  const scopePrefix = createScopePrefix(input.scope);
  const summaryId = `${scopePrefix}summary:${sessionKey}:rolling`;
  const summaryContent = createRollingSummary(events, extracted);
  const summaryNode: GraphNode = {
    id: summaryId,
    type: "Summary",
    title: `Rolling memory summary for ${input.session_id ?? input.workflow_id ?? "global"}`,
    summary: summaryContent,
    content_ref: `memory://${summaryId}`,
    source_system: "runtime",
    trust_score: 0.8,
    freshness_score: 1,
    importance_score: 0.84,
    created_at: now,
    updated_at: now,
    ...(input.scope ? { scope: input.scope } : {}),
    metadata: attachScopeToMetadata(
      {
        kind: "consolidated_memory",
        consolidation_kind: "rolling_summary",
        session_id: input.session_id,
        workflow_id: input.workflow_id,
        source_event_ids: events.map((event) => event.id),
        memory_count: extracted.length
      },
      input.scope
    )
  };
  const memoryNodes = extracted.map((memory) => toMemoryNode(memory, sessionKey, now, input.scope));
  const supersessionEdges = createSupersessionEdges(memoryNodes, extracted, now, input.scope);
  const evidenceEdges = [
    ...events.map((event) => createEdge(summaryId, event.id, "summarizes", now, input.scope, 0.76, 0.84)),
    ...memoryNodes.map((node, index) =>
      createEdge(node.id, extracted[index]!.event_id, "derived_from", now, input.scope, 0.72, 0.86)
    )
  ];
  const rawTokens = estimateTokens(events.map((event) => event.summary ?? event.title).join("\n"));
  const consolidatedTokens = estimateTokens([summaryContent, ...memoryNodes.map((node) => node.summary ?? "")].join("\n"));

  return {
    nodes: [summaryNode, ...memoryNodes],
    edges: [...evidenceEdges, ...supersessionEdges],
    source_event_ids: events.map((event) => event.id),
    token_savings: {
      raw_tokens_estimate: rawTokens,
      consolidated_tokens_estimate: consolidatedTokens,
      saved_tokens_estimate: Math.max(0, rawTokens - consolidatedTokens)
    }
  };
}

export function isRawEventNode(node: GraphNode): boolean {
  const kind = typeof node.metadata.kind === "string" ? node.metadata.kind : "";
  return kind.endsWith("_event") || Boolean(node.metadata.event_id);
}

export function isConsolidatedMemoryNode(node: GraphNode): boolean {
  return node.metadata.kind === "consolidated_memory";
}

export function rawEventsCoveredByConsolidatedMemory(memory: GraphMemory): Set<string> {
  const summaryNodeIds = new Set(memory.nodes.filter(isConsolidatedMemoryNode).map((node) => node.id));
  return new Set(
    memory.edges
      .filter((edge) => edge.type === "summarizes" && summaryNodeIds.has(edge.from))
      .map((edge) => edge.to)
  );
}

function selectEvents(input: MemoryConsolidationInput): GraphNode[] {
  return input.memory.nodes
    .filter(isRawEventNode)
    .filter((node) => !isRedacted(node))
    .filter((node) => !input.session_id || node.metadata.session_id === input.session_id)
    .filter((node) => !input.workflow_id || node.metadata.workflow_id === input.workflow_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function extractMemories(event: GraphNode): ExtractedMemory[] {
  const text = [event.summary ?? "", event.title].join(" ").replace(/\s+/gu, " ").trim();
  if (!text) {
    return [];
  }

  const memories: ExtractedMemory[] = [];
  for (const sentence of splitSentences(text)) {
    const importance = clamp(event.importance_score, 0.35, 1);
    const lower = sentence.toLowerCase();

    if (/\b(decided|decision|choose|chosen|approved|rejected)\b/u.test(lower)) {
      memories.push({ kind: "decision", statement: sentence, event_id: event.id, importance });
      continue;
    }
    if (/\b(promise|commit|committed|must|should|todo|follow up|next)\b/u.test(lower)) {
      memories.push({ kind: "commitment", statement: sentence, event_id: event.id, importance });
      continue;
    }
    if (/\b(blocked|question|unknown|open|needs|waiting)\b/u.test(lower)) {
      memories.push({ kind: "open_loop", statement: sentence, event_id: event.id, importance });
      continue;
    }
    if (/\b(now|became|changed|updated|moved|enabled|disabled)\b/u.test(lower)) {
      memories.push({ kind: "state_change", statement: sentence, event_id: event.id, importance });
      continue;
    }

    memories.push({
      kind: "fact",
      statement: sentence,
      event_id: event.id,
      importance: importance * 0.92,
      contradictory_key: contradictionKey(sentence),
      polarity: sentencePolarity(sentence)
    });
  }

  return memories;
}

function deduplicate(memories: ExtractedMemory[]): ExtractedMemory[] {
  const byKey = new Map<string, ExtractedMemory>();
  for (const memory of memories) {
    const key = `${memory.kind}:${normalizeStatement(memory.statement)}`;
    const existing = byKey.get(key);
    if (!existing || existing.importance < memory.importance) {
      byKey.set(key, memory);
    }
  }

  return [...byKey.values()];
}

function toMemoryNode(memory: ExtractedMemory, sessionKey: string, now: string, scope: GraphScope | undefined): GraphNode {
  const id = `${createScopePrefix(scope)}memory:${sessionKey}:${memory.kind}:${hashText(normalizeStatement(memory.statement))}`;
  return {
    id,
    type: memory.kind === "decision" ? "Decision" : "Summary",
    title: titleForMemory(memory),
    summary: memory.statement,
    content_ref: `memory://${id}`,
    source_system: "runtime",
    trust_score: 0.76,
    freshness_score: 1,
    importance_score: clamp(memory.importance, 0.35, 1),
    created_at: now,
    updated_at: now,
    ...(scope ? { scope } : {}),
    metadata: attachScopeToMetadata(
      {
        kind: "consolidated_memory",
        consolidation_kind: memory.kind,
        source_event_id: memory.event_id,
        lifecycle_status: "active",
        contradictory_key: memory.contradictory_key,
        polarity: memory.polarity
      },
      scope
    )
  };
}

function createSupersessionEdges(
  nodes: readonly GraphNode[],
  memories: readonly ExtractedMemory[],
  now: string,
  scope: GraphScope | undefined
): GraphEdge[] {
  const byContradictionKey = new Map<string, Array<{ node: GraphNode; memory: ExtractedMemory }>>();
  memories.forEach((memory, index) => {
    if (!memory.contradictory_key || !memory.polarity) {
      return;
    }

    const group = byContradictionKey.get(memory.contradictory_key) ?? [];
    group.push({ node: nodes[index]!, memory });
    byContradictionKey.set(memory.contradictory_key, group);
  });

  return [...byContradictionKey.values()].flatMap((group) => {
    const positives = group.filter((item) => item.memory.polarity === "positive");
    const negatives = group.filter((item) => item.memory.polarity === "negative");
    if (positives.length === 0 || negatives.length === 0) {
      return [];
    }

    return positives.flatMap((positive) =>
      negatives.map((negative) =>
        createEdge(negative.node.id, positive.node.id, "contradicts", now, scope, 0.68, 0.74, {
          source: "memory_consolidation",
          reason: "opposing_polarity",
          contradictory_key: positive.memory.contradictory_key
        })
      )
    );
  });
}

function createEdge(
  from: string,
  to: string,
  type: GraphEdge["type"],
  now: string,
  scope: GraphScope | undefined,
  weight: number,
  confidence: number,
  metadata: Record<string, unknown> = { source: "memory_consolidation" }
): GraphEdge {
  return {
    id: `edge:${from}:${type}:${to}`,
    from,
    to,
    type,
    weight,
    confidence,
    created_at: now,
    ...(scope ? { scope } : {}),
    metadata: attachScopeToMetadata(metadata, scope)
  };
}

function createRollingSummary(events: readonly GraphNode[], memories: readonly ExtractedMemory[]): string {
  const lines = memories
    .slice(0, 12)
    .map((memory) => `- ${memory.kind}: ${memory.statement}`)
    .join("\n");

  return [`Consolidated ${events.length} events into ${memories.length} durable memories.`, lines || "- No durable memories extracted."]
    .join("\n")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8)
    .slice(0, 12);
}

function titleForMemory(memory: ExtractedMemory): string {
  const prefix = memory.kind.replaceAll("_", " ");
  return `${prefix}: ${memory.statement.slice(0, 72)}`;
}

function inferSessionId(events: readonly GraphNode[]): string | undefined {
  const value = events.find((event) => typeof event.metadata.session_id === "string")?.metadata.session_id;
  return typeof value === "string" ? value : undefined;
}

function contradictionKey(statement: string): string | undefined {
  const tokens = normalizeStatement(statement)
    .split(" ")
    .filter((token) => !["not", "no", "never", "without", "is", "are", "was", "were", "the", "a", "an"].includes(token));
  return tokens.length >= 3 ? tokens.slice(0, 8).join(" ") : undefined;
}

function sentencePolarity(statement: string): "positive" | "negative" {
  return /\b(not|no|never|without|disabled|blocked|reject|rejected)\b/iu.test(statement) ? "negative" : "positive";
}

function normalizeStatement(statement: string): string {
  return statement.toLowerCase().replaceAll(/[^a-z0-9가-힣]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function createScopePrefix(scope: GraphScope | undefined): string {
  if (!scope?.tenant_id) {
    return "";
  }

  return `tenant:${normalizeId(scope.tenant_id)}:`;
}

function normalizeId(value: string): string {
  return value.trim().replaceAll(/[^a-zA-Z0-9_.:-]+/gu, "-");
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isRedacted(node: GraphNode): boolean {
  return node.metadata.redacted === true || node.metadata.lifecycle_status === "redacted" || node.metadata.deleted === true;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
