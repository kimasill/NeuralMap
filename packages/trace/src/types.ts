import type { TraceSpan } from "@neuralmap/schema";

export type TraceSpanKind = TraceSpan["kind"];

export interface StartTraceSpanInput {
  runId: string;
  name: string;
  kind: TraceSpanKind;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
}

export interface TraceHandle {
  spanId: string;
  end(attributes?: Record<string, unknown>): TraceSpan;
}

export interface TraceStore {
  addSpan(span: TraceSpan): void;
  updateSpan(span: TraceSpan): void;
  listSpans(runId: string): TraceSpan[];
  clear(runId?: string): number;
}

