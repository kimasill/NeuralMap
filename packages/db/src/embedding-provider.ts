export interface EmbeddingProviderConfig {
  provider: "deterministic" | "external";
  model: string;
  dimensions: number;
  version: string;
}

export const storageEmbeddingDimensions = 1536;
export const fallbackEmbeddingProvider: EmbeddingProviderConfig = {
  provider: "deterministic",
  model: "deterministic-sparse-hash-v1",
  dimensions: storageEmbeddingDimensions,
  version: "deterministic-sparse-hash-v1:1536"
};

export function createEmbeddingProviderConfig(env: Record<string, string | undefined> = process.env): EmbeddingProviderConfig {
  const provider = env.NEURALMAP_EMBEDDING_PROVIDER === "external" ? "external" : "deterministic";
  const model = env.NEURALMAP_EMBEDDING_MODEL?.trim() || fallbackEmbeddingProvider.model;
  const requestedDimensions = Number(env.NEURALMAP_EMBEDDING_DIMENSIONS ?? storageEmbeddingDimensions);
  const dimensions =
    Number.isFinite(requestedDimensions) && requestedDimensions > 0
      ? Math.min(storageEmbeddingDimensions, Math.floor(requestedDimensions))
      : storageEmbeddingDimensions;

  return {
    provider,
    model,
    dimensions,
    version: `${provider}:${model}:${dimensions}`
  };
}

export function embeddingMetadata(config: EmbeddingProviderConfig = createEmbeddingProviderConfig()): Record<string, unknown> {
  return {
    embedding_provider: config.provider,
    embedding_model: config.model,
    embedding_dimensions: config.dimensions,
    embedding_storage_dimensions: storageEmbeddingDimensions,
    embedding_version: config.version
  };
}
