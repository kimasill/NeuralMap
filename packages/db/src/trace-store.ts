import type { TraceSpan } from "@neuralmap/schema";
import { eq, sql } from "drizzle-orm";

import type { NeuralMapDatabase } from "./client.js";
import { traceRuns, traceSpans } from "./schema.js";
import type { TraceSpanRow } from "./types.js";

export interface DbTraceStore {
  addSpan(span: TraceSpan): void;
  updateSpan(span: TraceSpan): void;
  listSpans(runId: string): TraceSpan[] | Promise<TraceSpan[]>;
  clear(runId?: string): number | Promise<number>;
}

export function createDbTraceStore(db: NeuralMapDatabase, fallback: DbTraceStore): DbTraceStore {
  return {
    addSpan(span) {
      fallback.addSpan(span);
      void persistTraceSpan(db, span).catch(() => undefined);
    },

    updateSpan(span) {
      fallback.updateSpan(span);
      void persistTraceSpan(db, span).catch(() => undefined);
    },

    async listSpans(runId) {
      try {
        const rows = await db.select().from(traceSpans).where(eq(traceSpans.runId, runId)).orderBy(traceSpans.startedAt);
        if (rows.length > 0) {
          return rows.map(toTraceSpan);
        }
      } catch {
        return fallback.listSpans(runId);
      }

      return fallback.listSpans(runId);
    },

    async clear(runId) {
      const fallbackCount = await fallback.clear(runId);

      try {
        if (runId) {
          await db.delete(traceSpans).where(eq(traceSpans.runId, runId));
        } else {
          await db.delete(traceSpans);
        }
      } catch {
        return fallbackCount;
      }

      return fallbackCount;
    }
  };
}

export async function persistTraceSpan(db: NeuralMapDatabase, span: TraceSpan): Promise<void> {
  await db
    .insert(traceRuns)
    .values({
      id: span.run_id,
      agentId: "unknown",
      sessionId: "unknown",
      objective: "Trace-only run",
      status: span.ended_at ? "completed" : "running"
    })
    .onConflictDoNothing();

  await db
    .insert(traceSpans)
    .values(toTraceSpanInsert(span))
    .onConflictDoUpdate({
      target: traceSpans.id,
      set: {
        parentSpanId: sql`excluded.parent_span_id`,
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        attributes: sql`excluded.attributes`,
        startedAt: sql`excluded.started_at`,
        endedAt: sql`excluded.ended_at`
      }
    });
}

function toTraceSpanInsert(span: TraceSpan) {
  return {
    id: span.id,
    runId: span.run_id,
    parentSpanId: span.parent_span_id ?? null,
    name: span.name,
    kind: span.kind,
    attributes: span.attributes,
    startedAt: new Date(span.started_at),
    endedAt: span.ended_at ? new Date(span.ended_at) : null
  };
}

function toTraceSpan(row: TraceSpanRow): TraceSpan {
  const span: TraceSpan = {
    id: row.id,
    run_id: row.runId,
    name: row.name,
    kind: row.kind as TraceSpan["kind"],
    started_at: row.startedAt.toISOString(),
    attributes: row.attributes
  };

  if (row.parentSpanId) {
    span.parent_span_id = row.parentSpanId;
  }
  if (row.endedAt) {
    span.ended_at = row.endedAt.toISOString();
  }

  return span;
}
