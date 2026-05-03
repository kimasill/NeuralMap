import { describe, expect, it } from "vitest";

import { selectModelProfile } from "./model-profiles.js";

describe("dynamic model profiles", () => {
  it("selects deep reasoning for risky bug investigation with large context", () => {
    const decision = selectModelProfile({
      objective: "Investigate a regression in graph cache invalidation",
      task: "debug failing cache tests and verify the fix",
      context_pack: {
        id: "ctx_profile_bug",
        objective: "Debug cache regression",
        agent_id: "main-agent",
        session_id: "test",
        node_ids: Array.from({ length: 12 }, (_, index) => `node:${index}`),
        evidence: Array.from({ length: 8 }, (_, index) => ({
          node_id: `node:${index}`,
          snippet: "Evidence",
          score: 0.8
        })),
        decisions: [],
        blockers: [],
        template_id: "bug_investigation:default",
        token_budget: 18000,
        metadata: {},
        created_at: new Date().toISOString()
      }
    });

    expect(decision.task_classification.intent.kind).toBe("bug_investigation");
    expect(decision.selected_profile.id).toBe("deep-reasoning");
    expect(decision.budget.budget_pressure).toBeGreaterThan(0);
  });

  it("selects fast context for urgent lightweight handoff work", () => {
    const decision = selectModelProfile({
      objective: "Quick handoff summary",
      task: "빠르게 handoff summary 작성",
      token_budget: 4000,
      cache_hit_rate: 0.9
    });

    expect(decision.task_classification.intent.kind).toBe("handoff");
    expect(decision.selected_profile.id).toBe("fast-context");
    expect(decision.routing_reasons).toContain("reasoning:low");
  });

  it("honors a requested model profile override", () => {
    const decision = selectModelProfile({
      objective: "Validate the build",
      task: "run validation checks",
      requested_profile_id: "validation-guard"
    });

    expect(decision.selected_profile.id).toBe("validation-guard");
    expect(decision.routing_reasons).toContain("requested:validation-guard");
  });
});
