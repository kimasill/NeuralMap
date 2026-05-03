import { describe, expect, it } from "vitest";

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
});
