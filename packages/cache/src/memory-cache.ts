import {
  cacheLayerNames,
  defaultCacheLayerPolicies,
  type CacheEntryInfo,
  type CacheInspectFilter,
  type CacheInvalidationResult,
  type CacheLayerName,
  type CacheLayerPolicy,
  type CacheLayerStats,
  type CacheLookup,
  type CacheStore,
  type CacheWriteOptions
} from "./types.js";

interface CacheEntry {
  value: unknown;
  createdAt: number;
  accessCount: number;
  tags: string[];
  lastAccessedAt?: number;
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
  const policies = new Map<CacheLayerName, CacheLayerPolicy>(
    cacheLayerNames.map((name) => [name, defaultCacheLayerPolicies[name]])
  );

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
      entry.accessCount += 1;
      entry.lastAccessedAt = Date.now();
      return {
        hit: true,
        value: entry.value as T
      };
    },

    set<T>(layer: CacheLayerName, key: string, value: T, options?: number | CacheWriteOptions): void {
      const now = Date.now();
      const writeOptions = normalizeWriteOptions(options);
      const policy = getPolicy(policies, layer);
      const ttlMs = writeOptions.ttlMs ?? policy.ttlMs;
      const entry: CacheEntry = {
        value,
        createdAt: now,
        accessCount: 0,
        tags: normalizeTags(writeOptions.tags)
      };
      if (ttlMs !== undefined) {
        entry.expiresAt = now + ttlMs;
      }

      getLayer(layers, layer).set(key, entry);
      getStats(stats, layer).writes += 1;
      enforceMaxEntries(layers, stats, policies, layer);
    },

    has(layer: CacheLayerName, key: string): boolean {
      return Boolean(this.inspect(layer, key));
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
      return cacheLayerNames.map((name) => {
        const policy = getPolicy(policies, name);
        const layerStats: CacheLayerStats = {
          name,
          ...getStats(stats, name),
          size: getLayer(layers, name).size,
          expired: countExpiredEntries(getLayer(layers, name))
        };

        if (policy.ttlMs !== undefined) {
          layerStats.ttl_ms = policy.ttlMs;
        }
        if (policy.maxEntries !== undefined) {
          layerStats.max_entries = policy.maxEntries;
        }

        return layerStats;
      });
    },

    policies(): CacheLayerPolicy[] {
      return cacheLayerNames.map((name) => ({ ...getPolicy(policies, name) }));
    },

    inspect(layer: CacheLayerName, key: string, includeExpired = false): CacheEntryInfo | undefined {
      const entry = getLayer(layers, layer).get(key);
      if (!entry) {
        return undefined;
      }
      if (!includeExpired && isExpired(entry)) {
        return undefined;
      }
      return toEntryInfo(layer, key, entry);
    },

    listEntries(filter: CacheInspectFilter = {}): CacheEntryInfo[] {
      const layerNames = filter.layer ? [filter.layer] : cacheLayerNames;
      const entries: CacheEntryInfo[] = [];

      for (const layer of layerNames) {
        for (const [key, entry] of getLayer(layers, layer)) {
          const info = toEntryInfo(layer, key, entry);
          if (matchesFilter(info, filter)) {
            entries.push(info);
          }
        }
      }

      return entries
        .sort((a, b) => {
          const aTime = a.last_accessed_at ?? a.created_at;
          const bTime = b.last_accessed_at ?? b.created_at;
          return bTime.localeCompare(aTime) || a.layer.localeCompare(b.layer) || a.key.localeCompare(b.key);
        })
        .slice(0, filter.limit ?? entries.length);
    },

    invalidate(filter: CacheInspectFilter = {}): CacheInvalidationResult {
      const entries = this.listEntries({ ...filter, includeExpired: filter.includeExpired ?? true });

      for (const entry of entries) {
        getLayer(layers, entry.layer).delete(entry.key);
        getStats(stats, entry.layer).evictions += 1;
      }

      return {
        count: entries.length,
        entries
      };
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

function getPolicy(policies: Map<CacheLayerName, CacheLayerPolicy>, layer: CacheLayerName): CacheLayerPolicy {
  const policy = policies.get(layer);
  if (!policy) {
    throw new Error(`Unknown cache layer: ${layer}`);
  }
  return policy;
}

function normalizeWriteOptions(options?: number | CacheWriteOptions): CacheWriteOptions {
  if (typeof options === "number") {
    return { ttlMs: options };
  }
  return options ?? {};
}

function normalizeTags(tags: string[] = []): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
}

function isExpired(entry: CacheEntry): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
}

function countExpiredEntries(layer: Map<string, CacheEntry>): number {
  let count = 0;
  for (const entry of layer.values()) {
    if (isExpired(entry)) {
      count += 1;
    }
  }
  return count;
}

function toEntryInfo(layer: CacheLayerName, key: string, entry: CacheEntry): CacheEntryInfo {
  const now = Date.now();
  const info: CacheEntryInfo = {
    layer,
    key,
    created_at: new Date(entry.createdAt).toISOString(),
    age_ms: Math.max(0, now - entry.createdAt),
    expired: isExpired(entry),
    access_count: entry.accessCount,
    tags: entry.tags,
    value_type: getValueType(entry.value),
    value_summary: summarizeValue(entry.value)
  };

  if (entry.lastAccessedAt !== undefined) {
    info.last_accessed_at = new Date(entry.lastAccessedAt).toISOString();
  }
  if (entry.expiresAt !== undefined) {
    info.expires_at = new Date(entry.expiresAt).toISOString();
    info.ttl_ms = Math.max(0, entry.expiresAt - now);
  }

  return info;
}

function matchesFilter(info: CacheEntryInfo, filter: CacheInspectFilter): boolean {
  if (!filter.includeExpired && info.expired) {
    return false;
  }
  if (filter.key && info.key !== filter.key) {
    return false;
  }
  if (filter.keyPrefix && !info.key.startsWith(filter.keyPrefix)) {
    return false;
  }
  if (filter.tags?.length && !filter.tags.every((tag) => info.tags.includes(tag))) {
    return false;
  }
  return true;
}

function enforceMaxEntries(
  layers: Map<CacheLayerName, Map<string, CacheEntry>>,
  stats: Map<CacheLayerName, MutableStats>,
  policies: Map<CacheLayerName, CacheLayerPolicy>,
  layer: CacheLayerName
): void {
  const maxEntries = getPolicy(policies, layer).maxEntries;
  if (maxEntries === undefined) {
    return;
  }

  const layerMap = getLayer(layers, layer);
  if (layerMap.size <= maxEntries) {
    return;
  }

  const evictable = [...layerMap.entries()].sort((a, b) => {
    const aTime = a[1].lastAccessedAt ?? a[1].createdAt;
    const bTime = b[1].lastAccessedAt ?? b[1].createdAt;
    return aTime - bTime;
  });

  while (layerMap.size > maxEntries) {
    const candidate = evictable.shift();
    if (!candidate) {
      return;
    }
    layerMap.delete(candidate[0]);
    getStats(stats, layer).evictions += 1;
  }
}

function getValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 96 ? `${value.slice(0, 96)}...` : value;
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 6);
    return keys.length > 0 ? `Object(${keys.join(", ")})` : "Object";
  }
  return String(value);
}
