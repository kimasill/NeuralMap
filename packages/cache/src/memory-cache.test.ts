import { describe, expect, it } from "vitest";

import { createCacheKey } from "./keys.js";
import { createInMemoryCache } from "./memory-cache.js";

describe("in-memory cache", () => {
  it("creates stable keys independent of object property order", () => {
    expect(createCacheKey({ b: 2, a: 1 })).toBe(createCacheKey({ a: 1, b: 2 }));
  });

  it("tracks hits, misses, writes, and clear evictions", () => {
    const cache = createInMemoryCache();
    expect(cache.get("retrieval", "missing").hit).toBe(false);

    cache.set("retrieval", "key", { ok: true }, { tags: ["graph", "query"] });
    expect(cache.get<{ ok: boolean }>("retrieval", "key")).toEqual({
      hit: true,
      value: { ok: true }
    });
    expect(cache.inspect("retrieval", "key")).toMatchObject({
      layer: "retrieval",
      key: "key",
      access_count: 1,
      tags: ["graph", "query"],
      value_type: "object"
    });

    expect(cache.clear("retrieval")).toBe(1);
    expect(cache.stats().find((layer) => layer.name === "retrieval")).toMatchObject({
      hits: 1,
      misses: 1,
      writes: 1,
      evictions: 1,
      size: 0
    });
  });

  it("invalidates entries by layer, key prefix, and tags", () => {
    const cache = createInMemoryCache();

    cache.set("retrieval", "query:a", { ok: true }, { tags: ["graph", "intent:design"] });
    cache.set("retrieval", "query:b", { ok: true }, { tags: ["graph", "intent:bug"] });
    cache.set("summary", "summary:a", { ok: true }, { tags: ["context", "node:a"] });

    expect(cache.listEntries({ tags: ["graph"] })).toHaveLength(2);
    expect(cache.invalidate({ layer: "retrieval", keyPrefix: "query:", tags: ["intent:design"] })).toMatchObject({
      count: 1,
      entries: [expect.objectContaining({ key: "query:a" })]
    });
    expect(cache.has("retrieval", "query:a")).toBe(false);
    expect(cache.has("retrieval", "query:b")).toBe(true);
    expect(cache.has("summary", "summary:a")).toBe(true);
  });

  it("expires entries without incrementing hits through inspection", async () => {
    const cache = createInMemoryCache();

    cache.set("response", "short-lived", { ok: true }, { ttlMs: 1, tags: ["response"] });
    expect(cache.inspect("response", "short-lived")).toMatchObject({
      expired: false
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(cache.inspect("response", "short-lived")).toBeUndefined();
    expect(cache.inspect("response", "short-lived", true)).toMatchObject({
      expired: true
    });
    expect(cache.stats().find((layer) => layer.name === "response")).toMatchObject({
      hits: 0,
      expired: 1
    });
  });
});
