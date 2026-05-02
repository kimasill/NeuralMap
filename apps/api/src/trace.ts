import type { FastifyInstance } from "fastify";

export function registerTraceHooks(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    request.headers["x-neuralmap-started-at"] = String(Date.now());
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
  });
}

