import { cacheLayerNames, type CacheLayerName, type CacheLayerStats, type CacheLookup, type CacheStore } from "./types.js";

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

interface MutableStats {
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
}

export function createInMemoryCache(): CacheStore {
  const layers = new Map<CacheLayerName, Map<string, CacheEntry>>();
  const stats = new Map<CacheLayerName, MutableStats>();

  for (const layer of cacheLayerNames) {
    layers.set(layer, new Map());
    stats.set(layer, { hits: 0, misses: 0, writes: 0, evictions: 0 });
  }

  return {
    get<T>(layer: CacheLayerName, key: string): CacheLookup<T> {
      const layerMap = getLayer(layers, layer);
      const entry = layerMap.get(key);

      if (!entry) {
        getStats(stats, layer).misses += 1;
        return { hit: false };
      }

      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
        layerMap.delete(key);
        const layerStats = getStats(stats, layer);
        layerStats.misses += 1;
        layerStats.evictions += 1;
        return { hit: false };
      }

      getStats(stats, layer).hits += 1;
      return {
        hit: true,
        value: entry.value as T
      };
    },

    set<T>(layer: CacheLayerName, key: string, value: T, ttlMs?: number): void {
      const entry: CacheEntry = { value };
      if (ttlMs !== undefined) {
        entry.expiresAt = Date.now() + ttlMs;
      }

      getLayer(layers, layer).set(key, entry);
      getStats(stats, layer).writes += 1;
    },

    has(layer: CacheLayerName, key: string): boolean {
      const lookup = this.get(layer, key);
      return lookup.hit;
    },

    delete(layer: CacheLayerName, key: string): boolean {
      const deleted = getLayer(layers, layer).delete(key);
      if (deleted) {
        getStats(stats, layer).evictions += 1;
      }
      return deleted;
    },

    clear(layer?: CacheLayerName): number {
      if (layer) {
        const layerMap = getLayer(layers, layer);
        const size = layerMap.size;
        layerMap.clear();
        getStats(stats, layer).evictions += size;
        return size;
      }

      let count = 0;
      for (const layerName of cacheLayerNames) {
        count += this.clear(layerName);
      }
      return count;
    },

    stats(): CacheLayerStats[] {
      return cacheLayerNames.map((name) => ({
        name,
        ...getStats(stats, name),
        size: getLayer(layers, name).size
      }));
    }
  };
}

function getLayer(layers: Map<CacheLayerName, Map<string, CacheEntry>>, layer: CacheLayerName): Map<string, CacheEntry> {
  const layerMap = layers.get(layer);
  if (!layerMap) {
    throw new Error(`Unknown cache layer: ${layer}`);
  }
  return layerMap;
}

function getStats(stats: Map<CacheLayerName, MutableStats>, layer: CacheLayerName): MutableStats {
  const layerStats = stats.get(layer);
  if (!layerStats) {
    throw new Error(`Unknown cache layer: ${layer}`);
  }
  return layerStats;
}
