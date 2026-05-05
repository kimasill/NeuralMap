import { z } from "zod";

const scopeFieldSchema = z.string().trim().min(1);

export const graphScopeSchema = z
  .object({
    tenant_id: scopeFieldSchema.optional(),
    workspace_id: scopeFieldSchema.optional(),
    project_id: scopeFieldSchema.optional(),
    owner_scope: scopeFieldSchema.optional()
  })
  .strict();

export type GraphScope = z.infer<typeof graphScopeSchema>;

const scopeKeys = ["tenant_id", "workspace_id", "project_id", "owner_scope"] as const;

export function normalizeScope(scope: GraphScope | undefined): GraphScope | undefined {
  if (!scope) {
    return undefined;
  }

  const normalized: GraphScope = {};
  for (const key of scopeKeys) {
    const value = scope[key]?.trim();
    if (value) {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function getScopeFromMetadata(metadata: Record<string, unknown> | undefined): GraphScope | undefined {
  const rawScope = metadata?.scope;
  if (!rawScope || typeof rawScope !== "object" || Array.isArray(rawScope)) {
    return normalizeScope(readLegacyScope(metadata));
  }

  const parsed = graphScopeSchema.safeParse(rawScope);
  return parsed.success ? normalizeScope(parsed.data) : normalizeScope(readLegacyScope(metadata));
}

export function scopeToMetadata(scope: GraphScope | undefined): Record<string, unknown> {
  const normalized = normalizeScope(scope);
  return normalized ? { scope: normalized } : {};
}

export function scopeMatches(resourceScope: GraphScope | undefined, requestedScope: GraphScope | undefined): boolean {
  const resource = normalizeScope(resourceScope);
  const requested = normalizeScope(requestedScope);

  if (!resource) {
    return true;
  }
  if (!requested) {
    return false;
  }

  for (const key of scopeKeys) {
    const resourceValue = resource[key];
    const requestedValue = requested[key];
    if (resourceValue && requestedValue && resourceValue !== requestedValue) {
      return false;
    }
    if (resourceValue && !requestedValue) {
      return false;
    }
  }

  return true;
}

export function attachScopeToMetadata(
  metadata: Record<string, unknown>,
  scope: GraphScope | undefined
): Record<string, unknown> {
  const normalized = normalizeScope(scope);
  if (!normalized) {
    return metadata;
  }

  return {
    ...metadata,
    scope: normalized
  };
}

function readLegacyScope(metadata: Record<string, unknown> | undefined): GraphScope | undefined {
  if (!metadata) {
    return undefined;
  }

  const scope: GraphScope = {};
  for (const key of scopeKeys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      scope[key] = value.trim();
    }
  }

  return scope;
}
