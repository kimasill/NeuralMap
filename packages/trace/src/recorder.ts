import { randomUUID } from "node:crypto";

import type { TraceSpan } from "@neuralmap/schema";

import type { StartTraceSpanInput, TraceHandle, TraceStore } from "./types.js";

export function startTraceSpan(store: TraceStore, input: StartTraceSpanInput): TraceHandle {
  const span: TraceSpan = {
    id: `span_${randomUUID()}`,
    run_id: input.runId,
    name: input.name,
    kind: input.kind,
    started_at: new Date().toISOString(),
    attributes: input.attributes ?? {}
  };

  if (input.parentSpanId) {
    span.parent_span_id = input.parentSpanId;
  }

  store.addSpan(span);

  return {
    spanId: span.id,
    end(attributes) {
      const endedSpan: TraceSpan = {
        ...span,
        ended_at: new Date().toISOString(),
        attributes: {
          ...span.attributes,
          ...(attributes ?? {})
        }
      };
      store.updateSpan(endedSpan);
      return endedSpan;
    }
  };
}

