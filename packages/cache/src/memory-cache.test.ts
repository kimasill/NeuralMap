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

    cache.set("retrieval", "key", { ok: true });
    expect(cache.get<{ ok: boolean }>("retrieval", "key")).toEqual({
      hit: true,
      value: { ok: true }
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
});

