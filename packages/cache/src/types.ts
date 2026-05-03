export const cacheLayerNames = ["retrieval", "graph_neighborhood", "prompt_segment", "summary", "response"] as const;

export type CacheLayerName = (typeof cacheLayerNames)[number];

export interface CacheLayerPolicy {
  name: CacheLayerName;
  ttlMs?: number;
  maxEntries?: number;
}

export const defaultCacheLayerPolicies: Record<CacheLayerName, CacheLayerPolicy> = {
  retrieval: {
    name: "retrieval",
    ttlMs: 5 * 60 * 1000,
    maxEntries: 120
  },
  graph_neighborhood: {
    name: "graph_neighborhood",
    ttlMs: 10 * 60 * 1000,
    maxEntries: 160
  },
  prompt_segment: {
    name: "prompt_segment",
    maxEntries: 80
  },
  summary: {
    name: "summary",
    ttlMs: 30 * 60 * 1000,
    maxEntries: 120
  },
  response: {
    name: "response",
    ttlMs: 15 * 60 * 1000,
    maxEntries: 120
  }
};

export interface CacheLayerStats {
  name: CacheLayerName;
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  size: number;
  expired: number;
  ttl_ms?: number;
  max_entries?: number;
}

export interface CacheHit<T> {
  hit: true;
  value: T;
}

export interface CacheMiss {
  hit: false;
}

export type CacheLookup<T> = CacheHit<T> | CacheMiss;

export interface CacheWriteOptions {
  ttlMs?: number;
  tags?: string[];
}

export interface CacheInspectFilter {
  layer?: CacheLayerName;
  key?: string;
  keyPrefix?: string;
  tags?: string[];
  includeExpired?: boolean;
  limit?: number;
}

export interface CacheEntryInfo {
  layer: CacheLayerName;
  key: string;
  created_at: string;
  last_accessed_at?: string;
  expires_at?: string;
  age_ms: number;
  ttl_ms?: number;
  expired: boolean;
  access_count: number;
  tags: string[];
  value_type: string;
  value_summary: string;
}

export interface CacheInvalidationResult {
  count: number;
  entries: CacheEntryInfo[];
}

export interface CacheStore {
  get<T>(layer: CacheLayerName, key: string): CacheLookup<T>;
  set<T>(layer: CacheLayerName, key: string, value: T, options?: number | CacheWriteOptions): void;
  has(layer: CacheLayerName, key: string): boolean;
  delete(layer: CacheLayerName, key: string): boolean;
  clear(layer?: CacheLayerName): number;
  stats(): CacheLayerStats[];
  policies(): CacheLayerPolicy[];
  inspect(layer: CacheLayerName, key: string, includeExpired?: boolean): CacheEntryInfo | undefined;
  listEntries(filter?: CacheInspectFilter): CacheEntryInfo[];
  invalidate(filter?: CacheInspectFilter): CacheInvalidationResult;
}
