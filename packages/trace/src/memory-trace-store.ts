import type { TraceSpan } from "@neuralmap/schema";

import type { TraceStore } from "./types.js";

export function createInMemoryTraceStore(): TraceStore {
  const spans = new Map<string, TraceSpan>();

  return {
    addSpan(span) {
      spans.set(span.id, span);
    },

    updateSpan(span) {
      spans.set(span.id, span);
    },

    listSpans(runId) {
      return [...spans.values()]
        .filter((span) => span.run_id === runId)
        .sort((a, b) => a.started_at.localeCompare(b.started_at));
    },

    clear(runId) {
      if (!runId) {
        const size = spans.size;
        spans.clear();
        return size;
      }

      let count = 0;
      for (const span of spans.values()) {
        if (span.run_id === runId) {
          spans.delete(span.id);
          count += 1;
        }
      }
      return count;
    }
  };
}

