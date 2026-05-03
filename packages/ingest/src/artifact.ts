import type { ContextPack, GraphEdge, GraphNode, HandoffPack } from "@neuralmap/schema";

import { chunkText } from "./chunking.js";
import type { IngestEmission } from "./types.js";

export function ingestContextPackArtifact(pack: ContextPack): IngestEmission {
  const node = createArtifactNode({
    id: `artifact:context:${pack.id}`,
    title: `Artifact: ${pack.objective}`,
    summary: createContextArtifactSummary(pack),
    createdAt: pack.created_at,
    metadata: {
      source: {
        kind: "ctx",
        id: pack.id
      },
      agent_id: pack.agent_id,
      session_id: pack.session_id,
      template_id: pack.template_id,
      token_budget: pack.token_budget,
      referenced_node_ids: pack.node_ids,
      evidence: pack.evidence.map((item) => ({
        node_id: item.node_id,
        snippet: item.snippet,
        score: item.score
      })),
      decisions: pack.decisions,
      blockers: pack.blockers
    }
  });
  const content = [
    `Artifact ${pack.id}`,
    `Objective: ${pack.objective}`,
    `Agent: ${pack.agent_id}`,
    `Session: ${pack.session_id}`,
    `Template: ${pack.template_id ?? "none"}`,
    `Referenced nodes: ${pack.node_ids.join(", ") || "none"}`,
    pack.evidence.length > 0 ? `Evidence:\n${pack.evidence.map((item) => `- ${item.node_id}: ${item.snippet}`).join("\n")}` : undefined,
    pack.decisions.length > 0 ? `Decisions:\n${pack.decisions.map((item) => `- ${item}`).join("\n")}` : undefined,
    pack.blockers.length > 0 ? `Blockers:\n${pack.blockers.map((item) => `- ${item}`).join("\n")}` : undefined
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    nodes: [node],
    edges: createReferenceEdges({
      artifactNodeId: node.id,
      referencedNodeIds: pack.node_ids,
      createdAt: pack.created_at,
      metadata: {
        source: "artifact_materializer",
        source_kind: "ctx",
        source_id: pack.id
      }
    }),
    chunks: chunkText(node.id, node.content_ref ?? node.id, content)
  };
}

export function ingestHandoffPackArtifact(pack: HandoffPack): IngestEmission {
  const sourceContextPackId = getSourceContextPackId(pack);
  const node = createArtifactNode({
    id: `artifact:handoff:${pack.id}`,
    title: `Artifact: ${pack.objective}`,
    summary: createHandoffArtifactSummary(pack),
    createdAt: pack.created_at,
    metadata: {
      source: {
        kind: "handoff",
        id: pack.id
      },
      from_run_id: pack.from_run_id,
      to_session_id: pack.to_session_id,
      context_pack_id: sourceContextPackId,
      referenced_node_ids: pack.referenced_node_ids,
      key_decisions: pack.key_decisions,
      open_loops: pack.open_loops,
      blockers: pack.blockers,
      constraints: pack.constraints,
      recommended_next_actions: pack.recommended_next_actions
    }
  });
  const content = [
    `Handoff artifact ${pack.id}`,
    `Objective: ${pack.objective}`,
    `Current status: ${pack.current_status}`,
    `From run: ${pack.from_run_id}`,
    pack.to_session_id ? `To session: ${pack.to_session_id}` : undefined,
    `Referenced nodes: ${pack.referenced_node_ids.join(", ") || "none"}`,
    pack.key_decisions.length > 0 ? `Decisions:\n${pack.key_decisions.map((item) => `- ${item}`).join("\n")}` : undefined,
    pack.open_loops.length > 0 ? `Open loops:\n${pack.open_loops.map((item) => `- ${item}`).join("\n")}` : undefined,
    pack.blockers.length > 0 ? `Blockers:\n${pack.blockers.map((item) => `- ${item}`).join("\n")}` : undefined,
    pack.constraints.length > 0 ? `Constraints:\n${pack.constraints.map((item) => `- ${item}`).join("\n")}` : undefined,
    pack.recommended_next_actions.length > 0
      ? `Recommended next actions:\n${pack.recommended_next_actions.map((item) => `- ${item}`).join("\n")}`
      : undefined
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    nodes: [node],
    edges: [
      ...createReferenceEdges({
        artifactNodeId: node.id,
        referencedNodeIds: pack.referenced_node_ids,
        createdAt: pack.created_at,
        sourceRunId: pack.from_run_id,
        metadata: {
          source: "artifact_materializer",
          source_kind: "handoff",
          source_id: pack.id
        }
      }),
      ...createHandoffRelationshipEdges({
        handoffNodeId: node.id,
        handoffPackId: pack.id,
        contextPackId: sourceContextPackId,
        createdAt: pack.created_at,
        sourceRunId: pack.from_run_id
      })
    ],
    chunks: chunkText(node.id, node.content_ref ?? node.id, content)
  };
}

function createArtifactNode(input: {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}): GraphNode {
  return {
    id: input.id,
    type: "Artifact",
    title: input.title,
    content_ref: `runtime://${input.id}`,
    summary: input.summary,
    source_system: "runtime",
    trust_score: 0.82,
    freshness_score: 0.95,
    importance_score: 0.62,
    created_at: input.createdAt,
    updated_at: input.createdAt,
    metadata: input.metadata
  };
}

function createReferenceEdges(input: {
  artifactNodeId: string;
  referencedNodeIds: readonly string[];
  createdAt: string;
  sourceRunId?: string;
  metadata: Record<string, unknown>;
}): GraphEdge[] {
  return unique(input.referencedNodeIds).map((nodeId) => {
    const edge: GraphEdge = {
      id: `edge:${input.artifactNodeId}:references:${nodeId}`,
      from: input.artifactNodeId,
      to: nodeId,
      type: "references",
      weight: 0.7,
      confidence: 0.82,
      created_at: input.createdAt,
      metadata: input.metadata
    };

    if (input.sourceRunId) {
      edge.source_run_id = input.sourceRunId;
    }

    return edge;
  });
}

function createHandoffRelationshipEdges(input: {
  handoffNodeId: string;
  handoffPackId: string;
  contextPackId: string | undefined;
  createdAt: string;
  sourceRunId: string;
}): GraphEdge[] {
  if (!input.contextPackId) {
    return [];
  }

  const contextNodeId = `artifact:context:${input.contextPackId}`;
  return [
    {
      id: `edge:${contextNodeId}:handed_off_to:${input.handoffNodeId}`,
      from: contextNodeId,
      to: input.handoffNodeId,
      type: "handed_off_to",
      weight: 0.78,
      confidence: 0.86,
      created_at: input.createdAt,
      source_run_id: input.sourceRunId,
      metadata: {
        source: "artifact_materializer",
        source_kind: "handoff_relationship",
        context_pack_id: input.contextPackId,
        handoff_pack_id: input.handoffPackId
      }
    }
  ];
}

function createContextArtifactSummary(pack: ContextPack): string {
  const evidencePreview = pack.evidence
    .slice(0, 2)
    .map((item) => `${item.node_id}: ${item.snippet}`)
    .join(" | ");

  return [
    `Objective: ${pack.objective}`,
    `Nodes: ${pack.node_ids.length}`,
    evidencePreview ? `Evidence: ${evidencePreview}` : undefined,
    pack.decisions.length > 0 ? `Decisions: ${pack.decisions.length}` : undefined,
    pack.blockers.length > 0 ? `Blockers: ${pack.blockers.length}` : undefined
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function createHandoffArtifactSummary(pack: HandoffPack): string {
  return [
    `Objective: ${pack.objective}`,
    `Status: ${pack.current_status}`,
    `Nodes: ${pack.referenced_node_ids.length}`,
    pack.open_loops.length > 0 ? `Open loops: ${pack.open_loops.length}` : undefined,
    pack.blockers.length > 0 ? `Blockers: ${pack.blockers.length}` : undefined
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function getSourceContextPackId(pack: HandoffPack): string | undefined {
  const contextPackId = pack.metadata.context_pack_id;
  return typeof contextPackId === "string" && contextPackId.length > 0 ? contextPackId : undefined;
}
