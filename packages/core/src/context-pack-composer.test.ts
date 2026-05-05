import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode, GraphScope } from "@neuralmap/schema";

import { consolidateEventMemory } from "./memory-consolidation.js";
import { composeContextPack } from "./context-pack-composer.js";
import { expandGraphNeighborhood } from "./graph-expansion.js";
import { classifyQueryIntent } from "./intent.js";
import { rankSeedNodes } from "./retrieval.js";
import { sampleMemory } from "./sample-graph.js";
import { listContextTemplates, renderPromptSegment } from "./templates.js";

describe("core context assembly", () => {
  it("ranks lexical seed nodes using title and summary matches", () => {
    const seeds = rankSeedNodes(
      {
        query: "Context Pack",
        top_k: 3,
        expand_hops: 1,
        min_edge_confidence: 0.4
      },
      sampleMemory.nodes
    );

    expect(seeds[0]?.node.id).toBe("node_context_pack_contract");
    expect(seeds[0]?.lexical_score).toBeGreaterThan(0);
    expect(seeds[0]?.semantic_score).toBeGreaterThan(0);
    expect(seeds[0]?.reasons).toContain("hybrid:lexical+semantic");
    expect(seeds[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("can retrieve seeds from semantic vector-style similarity without an exact title match", () => {
    const seeds = rankSeedNodes(
      {
        query: "resume continuity bundle",
        top_k: 3,
        expand_hops: 1,
        min_edge_confidence: 0.4
      },
      sampleMemory.nodes
    );

    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.some((seed) => seed.semantic_score > 0)).toBe(true);
    expect(seeds[0]?.reasons.some((reason) => reason.startsWith("semantic:"))).toBe(true);
  });

  it("uses pgvector seed hints as semantic retrieval evidence", () => {
    const seeds = rankSeedNodes(
      {
        query: "unrelated words",
        top_k: 3,
        expand_hops: 1,
        min_edge_confidence: 0.4
      },
      sampleMemory.nodes,
      {
        semanticSeedHints: [
          {
            node_id: "node_context_pack_contract",
            similarity: 0.92,
            source: "pgvector_node"
          }
        ]
      }
    );

    expect(seeds[0]?.node.id).toBe("node_context_pack_contract");
    expect(seeds[0]?.semantic_score).toBeGreaterThan(3);
    expect(seeds[0]?.reasons).toContain("pgvector_node:0.920");
  });

  it("classifies query intent and applies type-aware retrieval reasons", () => {
    const intent = classifyQueryIntent("Design the graph schema policy");
    const seeds = rankSeedNodes(
      {
        query: "Design graph schema",
        top_k: 3,
        expand_hops: 1,
        min_edge_confidence: 0.4
      },
      sampleMemory.nodes,
      { intent }
    );

    expect(intent.kind).toBe("design");
    expect(intent.preferred_node_types).toContain("Decision");
    expect(seeds.some((seed) => seed.reasons.some((reason) => reason.startsWith("intent:design")))).toBe(true);
  });

  it("expands a seed node through confident graph edges", () => {
    const neighborhood = expandGraphNeighborhood(["node_context_pack_contract"], sampleMemory, {
      hops: 1,
      minConfidence: 0.4
    });

    expect(neighborhood.nodes.map((node) => node.id)).toContain("node_graph_schema");
    expect(neighborhood.edges.length).toBeGreaterThan(0);
  });

  it("composes evidence and template hints into a context pack", () => {
    const pack = composeContextPack(
      {
        objective: "Build graph context",
        agent_id: "main-agent",
        session_id: "session-test",
        task_type: "design",
        token_budget: 2000,
        seed_node_ids: [],
        query: "Context Pack graph schema"
      },
      sampleMemory
    );

    expect(pack.id).toMatch(/^ctx_/u);
    expect(pack.template_id).toBe("design:default");
    expect(pack.metadata.template).toMatchObject({ id: "design:default", version: 1 });
    expect(pack.metadata.intent).toMatchObject({ kind: "design" });
    expect(pack.metadata.retrieval).toMatchObject({
      mode: "hybrid",
      semantic_seed_count: expect.any(Number)
    });
    expect(pack.metadata.node_explanations).toMatchObject({
      node_context_pack_contract: {
        reason_kind: "retrieved_seed",
        seed_reasons: expect.arrayContaining([expect.stringContaining("title:context")])
      }
    });
    expect(pack.node_ids).toContain("node_context_pack_contract");
    expect(pack.evidence.length).toBeGreaterThan(0);
  });

  it("renders stable prompt segments from the template registry", () => {
    const template = listContextTemplates().find((candidate) => candidate.id === "handoff:default");

    expect(template).toBeDefined();
    expect(template?.slots).toContain("current_status");
    expect(renderPromptSegment(template!, "2026-05-03T00:00:00.000Z")).toMatchObject({
      template_id: "handoff:default",
      template_version: 1,
      slots: expect.arrayContaining(["current_status"])
    });
  });

  it("retrieves active content modules by scope and activation tags while excluding disabled modules", () => {
    const scoped = { tenant_id: "tenant-a", project_id: "docs" };
    const parent = contentModuleNode("guide-parent", "Tutor guide", {
      summary: "Use the tutoring guide when a learner asks for patient step-by-step help.",
      activationTags: ["tutoring", "guide"],
      priority: 0.92,
      version: "2",
      scope: scoped
    });
    const child = contentModuleNode("guide-child", "Example Appendix", {
      summary: "Worked examples should be short, scoped, and cited to the active parent module.",
      activationTags: [],
      parentModuleId: "guide-parent",
      priority: 0.82,
      scope: scoped
    });
    const disabled = contentModuleNode("old-guide", "Deprecated tutor guide", {
      summary: "This older disabled guide must not be retrieved.",
      activationTags: ["tutoring"],
      enabled: false,
      priority: 1,
      scope: scoped
    });
    const childEdge = contentModuleEdge(parent.id, child.id, scoped);
    const memory = {
      nodes: [...sampleMemory.nodes, parent, child, disabled],
      edges: [...sampleMemory.edges, childEdge]
    };
    const pack = composeContextPack(
      {
        objective: "Prepare tutoring context",
        agent_id: "tutor-agent",
        session_id: "session-module",
        task_type: "content_module",
        activation_tags: ["tutoring"],
        token_budget: 1600,
        seed_node_ids: ["module:guide-parent"],
        scope: scoped
      },
      memory
    );

    expect(pack.node_ids).toContain("module:guide-parent");
    expect(pack.node_ids).toContain("module:guide-child");
    expect(pack.node_ids).not.toContain("module:old-guide");
    expect(pack.metadata.content_modules).toContainEqual(
      expect.objectContaining({
        module_id: "guide-parent",
        activation_score: 1
      })
    );
    expect(pack.metadata.node_explanations).toMatchObject({
      "module:guide-child": {
        reason_kind: "graph_expansion"
      }
    });
  });

  it("prefers consolidated memories over covered raw event nodes", () => {
    const eventOne = eventNode(
      "simulation:ops:event:1",
      "The operator decided to use the blue deployment path. The team must verify rollback before launch."
    );
    const eventTwo = eventNode(
      "simulation:ops:event:2",
      "The operator confirmed the blue deployment path is active now."
    );
    const rawMemory = {
      nodes: [eventOne, eventTwo],
      edges: []
    };
    const consolidation = consolidateEventMemory({
      memory: rawMemory,
      session_id: "session-a"
    });
    const memory = {
      nodes: [...rawMemory.nodes, ...consolidation.nodes],
      edges: [...rawMemory.edges, ...consolidation.edges]
    };
    const pack = composeContextPack(
      {
        objective: "Resume deployment session",
        agent_id: "ops-agent",
        session_id: "session-b",
        query: "blue deployment rollback decision",
        token_budget: 1200,
        seed_node_ids: []
      },
      memory
    );

    expect(pack.node_ids.some((nodeId) => nodeId.includes("summary:session-a:rolling"))).toBe(true);
    expect(pack.node_ids).not.toContain("simulation:ops:event:1");
    expect(pack.metadata.retrieval).toMatchObject({
      mode: "hybrid"
    });
    expect(consolidation.token_savings.raw_tokens_estimate).toBeGreaterThan(0);
  });
});

function contentModuleNode(
  id: string,
  title: string,
  input: {
    summary: string;
    activationTags: string[];
    priority: number;
    scope: GraphScope;
    parentModuleId?: string | undefined;
    enabled?: boolean | undefined;
    version?: string | undefined;
  }
): GraphNode {
  return {
    id: `module:${id}`,
    type: "Document",
    title,
    summary: input.summary,
    content_ref: `module://${id}`,
    source_system: "user",
    trust_score: 0.8,
    freshness_score: 0.95,
    importance_score: input.priority,
    scope: input.scope,
    created_at: "2026-05-04T00:00:00.000Z",
    updated_at: "2026-05-04T00:00:00.000Z",
    metadata: {
      kind: "content_module",
      module_id: id,
      module_kind: "guide",
      parent_module_id: input.parentModuleId,
      enabled: input.enabled ?? true,
      priority: input.priority,
      activation_tags: input.activationTags,
      version: input.version ?? "1",
      lifecycle_status: "active",
      scope: input.scope
    }
  };
}

function contentModuleEdge(from: string, to: string, scope: GraphScope): GraphEdge {
  return {
    id: `edge:${from}:references:${to}`,
    from,
    to,
    type: "references",
    weight: 0.72,
    confidence: 0.86,
    scope,
    created_at: "2026-05-04T00:00:00.000Z",
    metadata: {
      source: "test",
      scope
    }
  };
}

function eventNode(id: string, summary: string): GraphNode {
  return {
    id,
    type: "Task",
    title: id,
    summary,
    content_ref: `memory://${id}`,
    source_system: "user",
    trust_score: 0.8,
    freshness_score: 0.95,
    importance_score: 0.9,
    created_at: "2026-05-04T00:00:00.000Z",
    updated_at: "2026-05-04T00:00:00.000Z",
    metadata: {
      kind: "simulation_event",
      session_id: "session-a",
      event_id: id.split(":").pop()
    }
  };
}
