import { describe, expect, it } from "vitest";

import type { ContextPack, GraphNode } from "@neuralmap/schema";

import { composeContextPack } from "./context-pack-composer.js";
import type { GraphMemory } from "./graph-expansion.js";
import { validateContextPack } from "./context-validation.js";

function stateNode(id: string, value: string, validTo: string | null): GraphNode {
  return {
    id,
    type: "Summary",
    labels: ["State"],
    title: `Mina wearing state ${id}`,
    summary: `Mina is currently wearing a ${value}.`,
    trust_score: 0.8,
    freshness_score: 0.9,
    importance_score: 0.9,
    lifecycle_status: "active",
    valid_to: validTo,
    ontology: { profile_id: "simulation-memory", type: "State" },
    properties: { owner_id: "char:mina", state_type: "Wearing", value },
    created_at: "2026-05-04T00:00:00.000Z",
    updated_at: "2026-05-04T00:00:00.000Z",
    metadata: {}
  };
}

describe("validateContextPack", () => {
  it("passes a pack whose evidence all resolves to current source nodes", () => {
    const node = stateNode("state:current", "navy coat", null);
    const pack: ContextPack = {
      id: "ctx_1",
      objective: "o",
      agent_id: "a",
      session_id: "s",
      node_ids: [node.id],
      evidence: [{ node_id: node.id, snippet: node.summary!, score: 0.9 }],
      decisions: [],
      blockers: [],
      token_budget: 1000,
      metadata: {},
      created_at: "2026-05-04T00:00:00.000Z"
    };

    const result = validateContextPack(pack, [node]);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.stats.stale_evidence_count).toBe(0);
  });

  it("flags evidence that has no source node in node_ids", () => {
    const node = stateNode("state:current", "navy coat", null);
    const pack: ContextPack = {
      id: "ctx_2",
      objective: "o",
      agent_id: "a",
      session_id: "s",
      node_ids: [],
      evidence: [{ node_id: node.id, snippet: node.summary!, score: 0.9 }],
      decisions: [],
      blockers: [],
      token_budget: 1000,
      metadata: {},
      created_at: "2026-05-04T00:00:00.000Z"
    };

    const result = validateContextPack(pack, [node]);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "evidence_without_source")).toBe(true);
  });

  it("detects conflicting current state values for the same owner/state_type", () => {
    const current = stateNode("state:current", "navy coat", null);
    const alsoCurrent = stateNode("state:also", "gray raincoat", null);
    const pack: ContextPack = {
      id: "ctx_3",
      objective: "o",
      agent_id: "a",
      session_id: "s",
      node_ids: [current.id, alsoCurrent.id],
      evidence: [
        { node_id: current.id, snippet: current.summary!, score: 0.9 },
        { node_id: alsoCurrent.id, snippet: alsoCurrent.summary!, score: 0.9 }
      ],
      decisions: [],
      blockers: [],
      token_budget: 1000,
      metadata: {},
      created_at: "2026-05-04T00:00:00.000Z"
    };

    const result = validateContextPack(pack, [current, alsoCurrent]);

    expect(result.ok).toBe(false);
    expect(result.stats.conflict_count).toBe(1);
  });

  it("warns (but does not fail) when a superseded node leaks into evidence", () => {
    const stale = stateNode("state:old", "old hoodie", "turn-80");
    const pack: ContextPack = {
      id: "ctx_4",
      objective: "o",
      agent_id: "a",
      session_id: "s",
      node_ids: [stale.id],
      evidence: [{ node_id: stale.id, snippet: stale.summary!, score: 0.5 }],
      decisions: [],
      blockers: [],
      token_budget: 1000,
      metadata: {},
      created_at: "2026-05-04T00:00:00.000Z"
    };

    const result = validateContextPack(pack, [stale]);

    expect(result.ok).toBe(true);
    expect(result.stats.stale_evidence_count).toBe(1);
    expect(result.warnings.some((warning) => warning.code === "stale_evidence")).toBe(true);
  });
});

describe("composeContextPack temporal hygiene", () => {
  it("excludes superseded state nodes from a composed pack and records a clean validation", () => {
    const memory: GraphMemory = {
      nodes: [
        stateNode("state:mina:wearing:1", "old hoodie", "turn-2"),
        stateNode("state:mina:wearing:2", "gray raincoat", "turn-3"),
        stateNode("state:mina:wearing:3", "navy coat", null)
      ],
      edges: []
    };

    const pack = composeContextPack(
      {
        objective: "next turn",
        agent_id: "a",
        session_id: "s",
        profile_id: "simulation-memory",
        query: "Mina current wearing state",
        token_budget: 1500,
        seed_node_ids: []
      },
      memory
    );

    const evidenceText = pack.evidence
      .map((item) => item.snippet)
      .join(" ")
      .toLowerCase();
    expect(evidenceText).toContain("navy coat");
    expect(evidenceText).not.toContain("old hoodie");
    expect(evidenceText).not.toContain("gray raincoat");
    expect(pack.metadata.validation).toMatchObject({ ok: true, stale_evidence_count: 0, conflict_count: 0 });
  });

  it("still includes a superseded node when the caller selects it explicitly, but penalizes its freshness", () => {
    const memory: GraphMemory = {
      nodes: [
        {
          id: "state:current",
          type: "Summary",
          labels: ["State"],
          title: "current state",
          summary: "Mina is currently wearing a navy coat.",
          trust_score: 0.8,
          freshness_score: 0.9,
          importance_score: 0.9,
          lifecycle_status: "active",
          valid_to: null,
          ontology: { profile_id: "simulation-memory", type: "State" },
          properties: { owner_id: "char:mina", state_type: "Wearing", value: "navy coat" },
          created_at: "2026-05-04T00:00:00.000Z",
          updated_at: "2026-05-04T00:00:00.000Z",
          metadata: {}
        },
        {
          id: "state:history",
          type: "Summary",
          labels: ["State"],
          title: "history state",
          summary: "Mina was wearing a gray raincoat.",
          trust_score: 0.8,
          freshness_score: 0.9,
          importance_score: 0.95,
          lifecycle_status: "active",
          valid_to: "turn-2",
          ontology: { profile_id: "simulation-memory", type: "State" },
          properties: { owner_id: "char:mina", state_type: "Wearing", value: "gray raincoat" },
          created_at: "2026-05-04T00:00:00.000Z",
          updated_at: "2026-05-04T00:00:00.000Z",
          metadata: {}
        }
      ],
      edges: []
    };

    const pack = composeContextPack(
      {
        objective: "review history",
        agent_id: "a",
        session_id: "s",
        profile_id: "simulation-memory",
        token_budget: 1500,
        seed_node_ids: ["state:current", "state:history"]
      },
      memory
    );

    const current = pack.evidence.find((item) => item.node_id === "state:current");
    const history = pack.evidence.find((item) => item.node_id === "state:history");
    expect(current).toBeDefined();
    expect(history).toBeDefined();
    // Despite higher importance, the superseded history node must rank below current state.
    expect(current!.score).toBeGreaterThan(history!.score);
  });
});
