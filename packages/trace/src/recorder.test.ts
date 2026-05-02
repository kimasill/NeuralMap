import { describe, expect, it } from "vitest";

import { createInMemoryTraceStore } from "./memory-trace-store.js";
import { startTraceSpan } from "./recorder.js";

describe("trace recorder", () => {
  it("records and completes spans in a run", () => {
    const store = createInMemoryTraceStore();
    const span = startTraceSpan(store, {
      runId: "run-test",
      name: "Request",
      kind: "user_request",
      attributes: { method: "GET" }
    });

    const ended = span.end({ statusCode: 200 });
    expect(ended.ended_at).toBeDefined();
    expect(store.listSpans("run-test")).toEqual([
      expect.objectContaining({
        id: span.spanId,
        attributes: {
          method: "GET",
          statusCode: 200
        }
      })
    ]);
  });
});

