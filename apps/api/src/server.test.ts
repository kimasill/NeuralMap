import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "./server.js";

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  if (originalDatabaseUrl) {
    process.env.DATABASE_URL = originalDatabaseUrl;
  } else {
    delete process.env.DATABASE_URL;
  }
});

describe("api server", () => {
  it("reports sample graph mode when no database is configured", async () => {
    const app = createApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        graph_mode: "sample"
      });
    } finally {
      await app.close();
    }
  });

  it("ingests a ticket and composes context from the same graph memory", async () => {
    const app = createApp();
    await app.ready();

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/ingest/ticket",
        payload: {
          id: "TEST-1",
          title: "Persist ingest smoke",
          url: "linear://TEST-1",
          body: "Smoke ingest context should be retrievable.",
          status: "open",
          labels: ["smoke"]
        }
      });

      expect(ingestResponse.statusCode).toBe(200);
      expect(ingestResponse.json()).toMatchObject({
        nodes: 1,
        chunks: 1,
        mode: "sample"
      });

      const contextResponse = await app.inject({
        method: "POST",
        url: "/context/compose",
        payload: {
          objective: "Find smoke context",
          agent_id: "main-agent",
          session_id: "test-session",
          query: "Smoke ingest",
          token_budget: 1200
        }
      });

      expect(contextResponse.statusCode).toBe(200);
      expect(contextResponse.json().node_ids).toContain("ticket:TEST-1");
    } finally {
      await app.close();
    }
  });

  it("caches graph query responses and reports cache stats", async () => {
    const app = createApp();
    await app.ready();

    try {
      const payload = {
        query: "Context Pack",
        top_k: 3,
        expand_hops: 1,
        min_edge_confidence: 0.4
      };

      const first = await app.inject({
        method: "POST",
        url: "/graph/query",
        payload
      });
      const second = await app.inject({
        method: "POST",
        url: "/graph/query",
        payload
      });
      const stats = await app.inject({
        method: "GET",
        url: "/cache/stats"
      });

      expect(first.json().cache.hit).toBe(false);
      expect(second.json().cache.hit).toBe(true);
      expect(stats.json().layers).toContainEqual(
        expect.objectContaining({
          name: "retrieval",
          hits: 1,
          misses: 1,
          writes: 1
        })
      );
    } finally {
      await app.close();
    }
  });

  it("records HTTP request spans for workbench trace inspection", async () => {
    const app = createApp();
    await app.ready();

    try {
      await app.inject({
        method: "GET",
        url: "/health",
        headers: {
          "x-neuralmap-run-id": "http-test"
        }
      });

      const response = await app.inject({
        method: "GET",
        url: "/workbench/runs/http-test/trace"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().spans).toContainEqual(
        expect.objectContaining({
          run_id: "http-test",
          kind: "user_request",
          name: "GET /health"
        })
      );
    } finally {
      await app.close();
    }
  });
});
