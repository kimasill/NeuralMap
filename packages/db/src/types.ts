import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import type {
  contentChunks,
  contextPacks,
  graphEdges,
  graphNodes,
  handoffPacks,
  traceRuns,
  traceSpans
} from "./schema.js";

export type GraphNodeRow = InferSelectModel<typeof graphNodes>;
export type NewGraphNodeRow = InferInsertModel<typeof graphNodes>;

export type GraphEdgeRow = InferSelectModel<typeof graphEdges>;
export type NewGraphEdgeRow = InferInsertModel<typeof graphEdges>;

export type ContentChunkRow = InferSelectModel<typeof contentChunks>;
export type NewContentChunkRow = InferInsertModel<typeof contentChunks>;

export type ContextPackRow = InferSelectModel<typeof contextPacks>;
export type NewContextPackRow = InferInsertModel<typeof contextPacks>;

export type HandoffPackRow = InferSelectModel<typeof handoffPacks>;
export type NewHandoffPackRow = InferInsertModel<typeof handoffPacks>;

export type TraceRunRow = InferSelectModel<typeof traceRuns>;
export type NewTraceRunRow = InferInsertModel<typeof traceRuns>;

export type TraceSpanRow = InferSelectModel<typeof traceSpans>;
export type NewTraceSpanRow = InferInsertModel<typeof traceSpans>;

