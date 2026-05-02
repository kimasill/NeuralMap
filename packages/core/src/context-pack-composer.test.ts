import { describe, expect, it } from "vitest";

import { composeContextPack } from "./context-pack-composer.js";
import { expandGraphNeighborhood } from "./graph-expansion.js";
import { rankSeedNodes } from "./retrieval.js";
import { sampleMemory } from "./sample-graph.js";

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
    expect(seeds[0]?.reasons.length).toBeGreaterThan(0);
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
    expect(pack.node_ids).toContain("node_context_pack_contract");
    expect(pack.evidence.length).toBeGreaterThan(0);
  });
});

