import { startTraceSpan, type TraceHandle, type TraceStore } from "@neuralmap/trace";
import type { FastifyInstance } from "fastify";

export function registerTraceHooks(app: FastifyInstance, traceStore: TraceStore): void {
  app.addHook("onRequest", async (request) => {
    request.headers["x-neuralmap-started-at"] = String(Date.now());
    const runId = String(request.headers["x-neuralmap-run-id"] ?? "http");
    const span = startTraceSpan(traceStore, {
      runId,
      name: `${request.method} ${request.url}`,
      kind: "user_request",
      attributes: {
        method: request.method,
        url: request.url
      }
    });
    request.neuralMapTraceHandle = span;
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = Number(request.headers["x-neuralmap-started-at"] ?? Date.now());
    const durationMs = Date.now() - startedAt;

    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs
      },
      "request trace span"
    );

    if (request.neuralMapTraceHandle) {
      request.neuralMapTraceHandle.end({
        statusCode: reply.statusCode,
        durationMs
      });
    }
  });
}

declare module "fastify" {
  interface FastifyRequest {
    neuralMapTraceHandle?: TraceHandle;
  }
}
