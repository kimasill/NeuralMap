import type {
  GraphCurrentViewRequest,
  GraphDeltaArchiveOperation,
  GraphDeltaNeuron,
  GraphDeltaRequest,
  GraphDeltaSelector,
  GraphDeltaSynapse,
  GraphEdge,
  GraphNeuronQueryRequest,
  GraphNode,
  GraphScope,
  GraphTraverseRequest,
  LifecycleStatus,
  OntologyRef,
  Provenance
} from "@neuralmap/schema";
import { edgeTypes, scopeMatches, type EdgeType, type NodeType } from "@neuralmap/schema";

import { expandGraphNeighborhood, type GraphMemory } from "./graph-expansion.js";
import { nowIso } from "./ids.js";
import { rankSeedNodes } from "./retrieval.js";

export interface GraphDeltaCompilationResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  chunks: [];
  metadata: {
    upserted_neurons: number;
    upserted_synapses: number;
    temporal_updates: number;
    archived: number;
    fallback_synapse_types: string[];
  };
}

export interface GraphCurrentViewItem {
  id: string;
  current_key: string;
  valid_from?: string | undefined;
  valid_to?: string | null | undefined;
  properties: Record<string, unknown>;
  node: GraphNode;
}

const compatibleEdgeTypes = new Set<string>(edgeTypes);

export function compileGraphDelta(
  delta: GraphDeltaRequest,
  memory: GraphMemory,
  scope: GraphScope | undefined
): GraphDeltaCompilationResult {
  const now = nowIso();
  const sourceProvenance = delta.source
    ? [
        {
          system: delta.source.system,
          ...(delta.source.run_id ? { run_id: delta.source.run_id } : {}),
          ...(delta.source.turn_id ? { turn_id: delta.source.turn_id } : {}),
          ...(delta.source.raw_ref ? { raw_ref: delta.source.raw_ref } : {}),
          at: now,
          ...(delta.source.metadata ? { metadata: delta.source.metadata } : {})
        }
      ]
    : [];
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const fallbackSynapseTypes = new Set<string>();

  for (const neuron of delta.upsert_neurons ?? []) {
    const node = toGraphNode({
      neuron,
      delta,
      now,
      sourceProvenance,
      scope
    });
    nodes.set(node.id, node);
  }

  for (const operation of delta.temporal_operations ?? []) {
    for (const node of findTemporalCurrentNodes(memory.nodes, operation.selector, delta.profile_id, scope, operation.superseded_by)) {
      const updated = updateNodeLifecycle(node, {
        valid_to: operation.valid_to
      });
      nodes.set(updated.id, updated);
      const edge = toSupersedesEdge({
        from: updated.id,
        to: operation.superseded_by,
        delta,
        now,
        sourceProvenance,
        scope
      });
      edges.set(edge.id, edge);
      fallbackSynapseTypes.add("SUPERSEDES");
    }
  }

  for (const operation of delta.archive ?? []) {
    for (const node of findNodes(memory.nodes, operation.selector, delta.profile_id, scope)) {
      const updated = updateNodeLifecycle(node, {
        lifecycle_status: operation.lifecycle_status
      });
      nodes.set(updated.id, updated);
    }
  }

  const currentPointerSynapses = (delta.upsert_synapses ?? []).filter((synapse) => readCurrentPointerKey(synapse.properties));
  for (const synapse of currentPointerSynapses) {
    const currentPointerKey = readCurrentPointerKey(synapse.properties);
    if (!currentPointerKey) {
      continue;
    }
    const ontologyType = synapse.ontology?.type ?? synapse.type;
    for (const edge of memory.edges) {
      if (
        getCurrentPointerKey(edge) === currentPointerKey &&
        getSynapseType(edge) === ontologyType &&
        isLifecycleActive(edge) &&
        scopeMatches(edge.scope ?? readScopeFromMetadata(edge.metadata), scope)
      ) {
        const updated = updateEdgeLifecycle(edge, {
          lifecycle_status: "archived",
          valid_to: now
        });
        edges.set(updated.id, updated);
      }
    }
  }

  for (const synapse of delta.upsert_synapses ?? []) {
    const edge = toGraphEdge({
      synapse,
      delta,
      now,
      sourceProvenance,
      scope
    });
    if (!isCompatibleEdgeType(synapse.edge_type ?? synapse.type)) {
      fallbackSynapseTypes.add(synapse.type);
    }
    edges.set(edge.id, edge);
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    chunks: [],
    metadata: {
      upserted_neurons: delta.upsert_neurons?.length ?? 0,
      upserted_synapses: delta.upsert_synapses?.length ?? 0,
      temporal_updates: delta.temporal_operations?.length ?? 0,
      archived: delta.archive?.length ?? 0,
      fallback_synapse_types: [...fallbackSynapseTypes].sort()
    }
  };
}

export function queryGraphNeurons(input: GraphNeuronQueryRequest, memory: GraphMemory) {
  const filteredNodes = memory.nodes.filter((node) => matchesNeuronQuery(node, input));
  const seeds = rankSeedNodes(
    {
      query: input.query,
      top_k: input.top_k,
      expand_hops: 0,
      min_edge_confidence: 0.4,
      ...(input.node_types ? { node_types: input.node_types } : {}),
      ...(input.scope ? { scope: input.scope } : {})
    },
    filteredNodes
  );

  return {
    seeds,
    nodes: seeds.map((seed) => seed.node),
    generated_at: nowIso()
  };
}

export function traverseGraph(input: GraphTraverseRequest, memory: GraphMemory) {
  const filteredMemory = {
    nodes: memory.nodes.filter((node) => scopeMatches(node.scope ?? readScopeFromMetadata(node.metadata), input.scope)),
    edges: memory.edges.filter((edge) => {
      const type = getSynapseType(edge);
      return (
        scopeMatches(edge.scope ?? readScopeFromMetadata(edge.metadata), input.scope) &&
        !isRedacted(edge) &&
        (!input.profile_id || getOntology(edge)?.profile_id === input.profile_id || edge.metadata.profile_id === input.profile_id) &&
        (!input.include_synapse_types?.length || input.include_synapse_types.includes(type))
      );
    })
  };

  return expandGraphNeighborhood(input.seed_node_ids, filteredMemory, {
    hops: input.max_hops,
    minConfidence: 0.4
  });
}

export function currentGraphView(input: GraphCurrentViewRequest, memory: GraphMemory): { items: GraphCurrentViewItem[] } {
  const grouped = new Map<string, GraphNode>();

  for (const node of memory.nodes) {
    if (!matchesCurrentView(node, input)) {
      continue;
    }
    const properties = getProperties(node);
    const currentKey = input.current_key.map((path) => String(readPath({ node, properties }, path) ?? "")).join(":");
    if (!currentKey || currentKey.split(":").some((value) => value.length === 0)) {
      continue;
    }
    const existing = grouped.get(currentKey);
    if (!existing || compareCurrentNodes(node, existing) > 0) {
      grouped.set(currentKey, node);
    }
  }

  return {
    items: [...grouped.entries()]
      .map(([currentKey, node]) => {
        const item: GraphCurrentViewItem = {
          id: node.id,
          current_key: currentKey,
          properties: getProperties(node),
          node
        };
        const validFrom = getValidFrom(node);
        const validTo = getValidTo(node);
        if (validFrom) {
          item.valid_from = validFrom;
        }
        if (validTo !== undefined) {
          item.valid_to = validTo;
        }
        return item;
      })
      .sort((a, b) => a.current_key.localeCompare(b.current_key))
  };
}

export function getSynapseType(edge: GraphEdge): string {
  return edge.ontology?.type ?? getOntology(edge)?.type ?? readMetadataString(edge.metadata, "synapse_type") ?? edge.type;
}

function toGraphNode(input: {
  neuron: GraphDeltaNeuron;
  delta: GraphDeltaRequest;
  now: string;
  sourceProvenance: Provenance[];
  scope: GraphScope | undefined;
}): GraphNode {
  const labels = unique([...(input.neuron.labels ?? []), ...(input.neuron.ontology ? [input.neuron.ontology.type] : [])]);
  const ontology = input.neuron.ontology ?? inferOntology(input.delta.profile_id, input.neuron);
  const properties = input.neuron.properties ?? {};
  const lifecycleStatus = input.neuron.lifecycle_status ?? "active";
  const provenance = [...input.sourceProvenance, ...(input.neuron.provenance ?? [])];
  const metadata = withExtensionMetadata(
    {
      ...(input.delta.source ? { source: input.delta.source } : {}),
      ...(input.delta.profile_id ? { profile_id: input.delta.profile_id } : {}),
      ...(input.neuron.metadata ?? {})
    },
    {
      labels,
      ontology,
      properties,
      lifecycle_status: lifecycleStatus,
      valid_from: input.neuron.valid_from,
      valid_to: input.neuron.valid_to,
      provenance
    }
  );
  const scope = input.neuron.scope ?? input.scope ?? input.delta.scope;
  const node: GraphNode = {
    id: input.neuron.id,
    type: input.neuron.type ?? inferNodeType(labels, ontology),
    labels,
    title: input.neuron.title,
    trust_score: input.neuron.trust_score ?? input.neuron.confidence ?? 0.72,
    freshness_score: input.neuron.freshness_score ?? 1,
    importance_score: input.neuron.importance_score ?? 0.6,
    lifecycle_status: lifecycleStatus,
    properties,
    created_at: input.neuron.created_at ?? input.now,
    updated_at: input.neuron.updated_at ?? input.now,
    metadata
  };

  if (input.neuron.content_ref ?? input.neuron.body_ref) {
    node.content_ref = input.neuron.content_ref ?? input.neuron.body_ref;
  }
  if (input.neuron.summary) {
    node.summary = input.neuron.summary;
  }
  if (input.neuron.source_system ?? input.delta.source?.system) {
    node.source_system = toSourceSystem(input.neuron.source_system ?? input.delta.source?.system);
  }
  if (input.neuron.confidence !== undefined) {
    node.confidence = input.neuron.confidence;
  }
  if (input.neuron.valid_from) {
    node.valid_from = input.neuron.valid_from;
  }
  if (input.neuron.valid_to !== undefined) {
    node.valid_to = input.neuron.valid_to;
  }
  if (ontology) {
    node.ontology = ontology;
  }
  if (provenance.length > 0) {
    node.provenance = provenance;
  }
  if (scope) {
    node.scope = scope;
  }

  return node;
}

function toGraphEdge(input: {
  synapse: GraphDeltaSynapse;
  delta: GraphDeltaRequest;
  now: string;
  sourceProvenance: Provenance[];
  scope: GraphScope | undefined;
}): GraphEdge {
  const ontology = input.synapse.ontology ?? inferSynapseOntology(input.delta.profile_id, input.synapse);
  const labels = unique([...(input.synapse.labels ?? []), input.synapse.type]);
  const properties = input.synapse.properties ?? {};
  const lifecycleStatus = input.synapse.lifecycle_status ?? "active";
  const provenance = [...input.sourceProvenance, ...(input.synapse.provenance ?? [])];
  const edgeType = toCompatibleEdgeType(input.synapse.edge_type ?? input.synapse.type);
  const metadata = withExtensionMetadata(
    {
      ...(input.delta.source ? { source: input.delta.source } : {}),
      ...(input.delta.profile_id ? { profile_id: input.delta.profile_id } : {}),
      synapse_type: input.synapse.type,
      ...(input.synapse.metadata ?? {})
    },
    {
      labels,
      ontology,
      properties,
      lifecycle_status: lifecycleStatus,
      valid_from: input.synapse.valid_from,
      valid_to: input.synapse.valid_to,
      provenance
    }
  );
  const scope = input.synapse.scope ?? input.scope ?? input.delta.scope;
  const edge: GraphEdge = {
    id: input.synapse.id ?? createEdgeId(input.synapse.from, input.synapse.type, input.synapse.to),
    from: input.synapse.from,
    to: input.synapse.to,
    type: edgeType,
    labels,
    weight: input.synapse.weight ?? 1,
    confidence: input.synapse.confidence ?? 0.72,
    lifecycle_status: lifecycleStatus,
    properties,
    created_at: input.synapse.created_at ?? input.now,
    metadata
  };

  if (input.synapse.source_run_id ?? input.delta.source?.run_id) {
    edge.source_run_id = input.synapse.source_run_id ?? input.delta.source?.run_id;
  }
  if (input.synapse.valid_from) {
    edge.valid_from = input.synapse.valid_from;
  }
  if (input.synapse.valid_to !== undefined) {
    edge.valid_to = input.synapse.valid_to;
  }
  if (ontology) {
    edge.ontology = ontology;
  }
  if (provenance.length > 0) {
    edge.provenance = provenance;
  }
  if (scope) {
    edge.scope = scope;
  }

  return edge;
}

function toSupersedesEdge(input: {
  from: string;
  to: string;
  delta: GraphDeltaRequest;
  now: string;
  sourceProvenance: Provenance[];
  scope: GraphScope | undefined;
}): GraphEdge {
  return toGraphEdge({
    synapse: {
      from: input.from,
      to: input.to,
      type: "SUPERSEDES",
      labels: ["SUPERSEDES", "Temporal"],
      ontology: input.delta.profile_id ? { profile_id: input.delta.profile_id, type: "SUPERSEDES" } : undefined,
      properties: {
        reason: "supersede_current"
      }
    },
    delta: input.delta,
    now: input.now,
    sourceProvenance: input.sourceProvenance,
    scope: input.scope
  });
}

function findTemporalCurrentNodes(
  nodes: readonly GraphNode[],
  selector: GraphDeltaSelector,
  profileId: string | undefined,
  scope: GraphScope | undefined,
  supersededBy: string
): GraphNode[] {
  return findNodes(nodes, selector, profileId, scope).filter(
    (node) => node.id !== supersededBy && isLifecycleActive(node) && getValidTo(node) == null
  );
}

function findNodes(
  nodes: readonly GraphNode[],
  selector: GraphDeltaSelector | GraphDeltaArchiveOperation["selector"],
  profileId: string | undefined,
  scope: GraphScope | undefined
): GraphNode[] {
  return nodes.filter(
    (node) =>
      scopeMatches(node.scope ?? readScopeFromMetadata(node.metadata), scope) &&
      (!profileId || getOntology(node)?.profile_id === profileId || node.metadata.profile_id === profileId) &&
      matchesSelector(node, selector)
  );
}

function matchesSelector(node: GraphNode, selector: GraphDeltaSelector): boolean {
  if (selector.id && node.id !== selector.id) {
    return false;
  }
  if (selector.label && !getLabels(node).includes(selector.label)) {
    return false;
  }
  if (selector.ontology_type && getOntology(node)?.type !== selector.ontology_type) {
    return false;
  }
  if (selector.profile_id && getOntology(node)?.profile_id !== selector.profile_id && node.metadata.profile_id !== selector.profile_id) {
    return false;
  }
  return matchesProperties(getProperties(node), selector.properties);
}

function matchesNeuronQuery(node: GraphNode, input: GraphNeuronQueryRequest): boolean {
  return (
    scopeMatches(node.scope ?? readScopeFromMetadata(node.metadata), input.scope) &&
    isLifecycleActive(node) &&
    (input.include_superseded === true || getValidTo(node) == null) &&
    (!input.profile_id || getOntology(node)?.profile_id === input.profile_id || node.metadata.profile_id === input.profile_id) &&
    (!input.labels?.length || input.labels.every((label) => getLabels(node).includes(label))) &&
    matchesProperties(getProperties(node), input.filters)
  );
}

function matchesCurrentView(node: GraphNode, input: GraphCurrentViewRequest): boolean {
  return (
    scopeMatches(node.scope ?? readScopeFromMetadata(node.metadata), input.scope) &&
    isLifecycleActive(node) &&
    getValidTo(node) == null &&
    (!input.profile_id || getOntology(node)?.profile_id === input.profile_id || node.metadata.profile_id === input.profile_id) &&
    (!input.label || getLabels(node).includes(input.label)) &&
    matchesProperties(getProperties(node), input.filters)
  );
}

function matchesProperties(properties: Record<string, unknown>, filters: Record<string, unknown> | undefined): boolean {
  if (!filters) {
    return true;
  }

  for (const [path, expected] of Object.entries(filters)) {
    const actual = readPath({ properties }, path);
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) {
        return false;
      }
      continue;
    }
    if (expected && typeof expected === "object" && "not" in expected) {
      if (actual === (expected as { not: unknown }).not) {
        return false;
      }
      continue;
    }
    if (actual !== expected) {
      return false;
    }
  }

  return true;
}

function updateNodeLifecycle(
  node: GraphNode,
  update: {
    lifecycle_status?: LifecycleStatus | undefined;
    valid_to?: string | null | undefined;
  }
): GraphNode {
  const next: GraphNode = {
    ...node,
    metadata: {
      ...node.metadata
    },
    updated_at: nowIso()
  };

  if (update.lifecycle_status) {
    next.lifecycle_status = update.lifecycle_status;
    next.metadata.lifecycle_status = update.lifecycle_status;
  }
  if (update.valid_to !== undefined) {
    next.valid_to = update.valid_to;
    next.metadata.valid_to = update.valid_to;
  }

  return next;
}

function updateEdgeLifecycle(
  edge: GraphEdge,
  update: {
    lifecycle_status?: LifecycleStatus | undefined;
    valid_to?: string | null | undefined;
  }
): GraphEdge {
  const next: GraphEdge = {
    ...edge,
    metadata: {
      ...edge.metadata
    }
  };

  if (update.lifecycle_status) {
    next.lifecycle_status = update.lifecycle_status;
    next.metadata.lifecycle_status = update.lifecycle_status;
  }
  if (update.valid_to !== undefined) {
    next.valid_to = update.valid_to;
    next.metadata.valid_to = update.valid_to;
  }

  return next;
}

function inferNodeType(labels: readonly string[], ontology: OntologyRef | undefined): NodeType {
  const candidates = new Set([...labels, ontology?.type].filter((value): value is string => Boolean(value)));
  if (hasAny(candidates, ["Character", "Actor", "Person"])) {
    return "Person";
  }
  if (hasAny(candidates, ["Scene", "Session"])) {
    return "Session";
  }
  if (hasAny(candidates, ["Event", "Task"])) {
    return "Task";
  }
  if (hasAny(candidates, ["Document", "DocSection"])) {
    return "Document";
  }
  if (hasAny(candidates, ["Policy", "RunbookStep"])) {
    return "Policy";
  }
  if (hasAny(candidates, ["Decision"])) {
    return "Decision";
  }
  if (hasAny(candidates, ["Artifact"])) {
    return "Artifact";
  }
  return "Summary";
}

function inferOntology(profileId: string | undefined, neuron: GraphDeltaNeuron): OntologyRef | undefined {
  const type = neuron.labels?.[0];
  return profileId && type ? { profile_id: profileId, type } : undefined;
}

function inferSynapseOntology(profileId: string | undefined, synapse: GraphDeltaSynapse): OntologyRef | undefined {
  return profileId ? { profile_id: profileId, type: synapse.type } : undefined;
}

function hasAny(values: ReadonlySet<string>, expected: readonly string[]): boolean {
  return expected.some((value) => values.has(value));
}

function toCompatibleEdgeType(type: string): EdgeType {
  return isCompatibleEdgeType(type) ? type as EdgeType : "related_to";
}

function isCompatibleEdgeType(type: string): boolean {
  return compatibleEdgeTypes.has(type);
}

function toSourceSystem(value: string | undefined): GraphNode["source_system"] {
  switch (value) {
    case "repo":
    case "doc":
    case "ticket":
    case "runtime":
    case "user":
      return value;
    default:
      return "runtime";
  }
}

function isLifecycleActive(item: { lifecycle_status?: LifecycleStatus | undefined; metadata: Record<string, unknown> }): boolean {
  const status = item.lifecycle_status ?? readMetadataString(item.metadata, "lifecycle_status") ?? "active";
  return status === "active";
}

function isRedacted(item: { metadata: Record<string, unknown> }): boolean {
  return item.metadata.redacted === true || item.metadata.deleted === true || item.metadata.lifecycle_status === "redacted";
}

function compareCurrentNodes(a: GraphNode, b: GraphNode): number {
  return (getValidFrom(a) ?? a.updated_at ?? a.created_at).localeCompare(getValidFrom(b) ?? b.updated_at ?? b.created_at);
}

function getLabels(item: { labels?: string[] | undefined; metadata: Record<string, unknown> }): string[] {
  return item.labels ?? readMetadataStringArray(item.metadata, "labels");
}

function getOntology(item: { ontology?: OntologyRef | undefined; metadata: Record<string, unknown> }): OntologyRef | undefined {
  return item.ontology ?? readOntology(item.metadata.ontology);
}

function getProperties(item: { properties?: Record<string, unknown> | undefined; metadata: Record<string, unknown> }): Record<string, unknown> {
  return item.properties ?? readMetadataRecord(item.metadata.properties);
}

function getValidFrom(item: { valid_from?: string | undefined; metadata: Record<string, unknown> }): string | undefined {
  return item.valid_from ?? readMetadataString(item.metadata, "valid_from");
}

function getValidTo(item: { valid_to?: string | null | undefined; metadata: Record<string, unknown> }): string | null | undefined {
  return item.valid_to ?? readMetadataStringOrNull(item.metadata, "valid_to");
}

function getCurrentPointerKey(edge: GraphEdge): string | undefined {
  return readCurrentPointerKey(edge.properties) ?? readCurrentPointerKey(readMetadataRecord(edge.metadata.properties));
}

function readCurrentPointerKey(properties: Record<string, unknown> | undefined): string | undefined {
  const value = properties?.current_pointer_key;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readScopeFromMetadata(metadata: Record<string, unknown>): GraphScope | undefined {
  const scope = metadata.scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return undefined;
  }
  return scope as GraphScope;
}

function withExtensionMetadata(
  metadata: Record<string, unknown>,
  extensions: {
    labels?: string[] | undefined;
    ontology?: OntologyRef | undefined;
    properties?: Record<string, unknown> | undefined;
    lifecycle_status?: LifecycleStatus | undefined;
    valid_from?: string | undefined;
    valid_to?: string | null | undefined;
    provenance?: Provenance[] | undefined;
  }
): Record<string, unknown> {
  return {
    ...metadata,
    ...(extensions.labels?.length ? { labels: extensions.labels } : {}),
    ...(extensions.ontology ? { ontology: extensions.ontology } : {}),
    ...(extensions.properties ? { properties: extensions.properties } : {}),
    ...(extensions.lifecycle_status ? { lifecycle_status: extensions.lifecycle_status } : {}),
    ...(extensions.valid_from ? { valid_from: extensions.valid_from } : {}),
    ...(extensions.valid_to !== undefined ? { valid_to: extensions.valid_to } : {}),
    ...(extensions.provenance?.length ? { provenance: extensions.provenance } : {})
  };
}

function readPath(input: { node?: GraphNode; properties?: Record<string, unknown> }, path: string): unknown {
  const normalized = path.startsWith("properties.") ? path.slice("properties.".length) : path;
  const root = path.startsWith("node.") ? input.node : input.properties;
  const segments = (path.startsWith("node.") ? path.slice("node.".length) : normalized).split(".");
  let current: unknown = root;

  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function readMetadataStringOrNull(metadata: Record<string, unknown>, key: string): string | null | undefined {
  const value = metadata[key];
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

function readMetadataStringArray(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readOntology(value: unknown): OntologyRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.profile_id !== "string" || typeof candidate.type !== "string") {
    return undefined;
  }
  const ontology: OntologyRef = {
    profile_id: candidate.profile_id,
    type: candidate.type
  };
  if (typeof candidate.version === "string") {
    ontology.version = candidate.version;
  }
  return ontology;
}

function createEdgeId(from: string, type: string, to: string): string {
  return `edge:${normalizeId(from)}:${normalizeId(type)}:${normalizeId(to)}`;
}

function normalizeId(value: string): string {
  return value.trim().replaceAll(/[^a-zA-Z0-9_.:-]+/gu, "-");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
