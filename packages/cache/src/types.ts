export const cacheLayerNames = ["retrieval", "graph_neighborhood", "prompt_segment", "summary"] as const;

export type CacheLayerName = (typeof cacheLayerNames)[number];

export interface CacheLayerStats {
  name: CacheLayerName;
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  size: number;
}

export interface CacheHit<T> {
  hit: true;
  value: T;
}

export interface CacheMiss {
  hit: false;
}

export type CacheLookup<T> = CacheHit<T> | CacheMiss;

export interface CacheStore {
  get<T>(layer: CacheLayerName, key: string): CacheLookup<T>;
  set<T>(layer: CacheLayerName, key: string, value: T, ttlMs?: number): void;
  has(layer: CacheLayerName, key: string): boolean;
  delete(layer: CacheLayerName, key: string): boolean;
  clear(layer?: CacheLayerName): number;
  stats(): CacheLayerStats[];
}

