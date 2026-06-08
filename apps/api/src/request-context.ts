import { createCacheKey } from "@neuralmap/cache";
import type { GraphScope } from "@neuralmap/schema";
import { graphScopeSchema, normalizeScope } from "@neuralmap/schema";
import type { FastifyRequest } from "fastify";

// Request-scoped helpers shared by every route group: how a request's
// tenant/workspace/project/owner scope is read, how requests are authorized,
// and the per-scope rate limiter. Kept out of server.ts so the route handlers
// read as composition rather than plumbing.

export function getRequestScope(request: FastifyRequest, bodyScope?: GraphScope | undefined): GraphScope | undefined {
  return normalizeScope({
    ...readScopeFromHeaders(request),
    ...readScopeFromQuery(request),
    ...(bodyScope ?? readScopeFromBody(request.body))
  });
}

export function readScopeFromHeaders(request: FastifyRequest): GraphScope {
  const scope: GraphScope = {};
  const tenantId = readHeader(request, "x-neuralmap-tenant-id");
  const workspaceId = readHeader(request, "x-neuralmap-workspace-id");
  const projectId = readHeader(request, "x-neuralmap-project-id");
  const ownerScope = readHeader(request, "x-neuralmap-owner-scope");

  if (tenantId) {
    scope.tenant_id = tenantId;
  }
  if (workspaceId) {
    scope.workspace_id = workspaceId;
  }
  if (projectId) {
    scope.project_id = projectId;
  }
  if (ownerScope) {
    scope.owner_scope = ownerScope;
  }

  return scope;
}

export function readScopeFromQuery(request: FastifyRequest): GraphScope {
  const rawQuery = request.query;
  if (!rawQuery || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
    return {};
  }

  const query = rawQuery as Record<string, unknown>;
  return {
    ...readScopeField(query, "tenant_id"),
    ...readScopeField(query, "workspace_id"),
    ...readScopeField(query, "project_id"),
    ...readScopeField(query, "owner_scope")
  };
}

export function readScopeFromBody(body: unknown): GraphScope | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const parsed = graphScopeSchema.safeParse((body as Record<string, unknown>).scope);
  return parsed.success ? parsed.data : undefined;
}

export function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readScopeField(query: Record<string, unknown>, key: keyof GraphScope): GraphScope {
  const value = query[key];
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" && rawValue.trim().length > 0 ? { [key]: rawValue.trim() } : {};
}

export function applyRequestScope<T extends { scope?: GraphScope | undefined }>(body: T, scope: GraphScope | undefined): T {
  if (!scope) {
    return body;
  }

  return {
    ...body,
    scope
  };
}

export function authorizeRequest(request: FastifyRequest): { ok: true } | { ok: false } {
  const configuredKeys = (process.env.NEURALMAP_API_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (configuredKeys.length === 0) {
    return { ok: true };
  }

  const providedKey = readHeader(request, "x-neuralmap-api-key") ?? readBearerToken(request);
  return configuredKeys.includes(providedKey ?? "") ? { ok: true } : { ok: false };
}

export function readBearerToken(request: FastifyRequest): string | undefined {
  const authorization = readHeader(request, "authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1];
}

export function createScopeRateLimiter() {
  const limit = Number(process.env.NEURALMAP_RATE_LIMIT_PER_MINUTE ?? 0);
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    consume(scope: GraphScope | undefined, route: string): { ok: true } | { ok: false; reset_at: string } {
      if (!Number.isFinite(limit) || limit <= 0) {
        return { ok: true };
      }

      const now = Date.now();
      const key = createCacheKey({ route: route.split("?")[0], scope: scope ?? "global" });
      const existing = buckets.get(key);
      const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + 60_000 };
      bucket.count += 1;
      buckets.set(key, bucket);

      if (bucket.count > limit) {
        return { ok: false, reset_at: new Date(bucket.resetAt).toISOString() };
      }

      return { ok: true };
    }
  };
}
