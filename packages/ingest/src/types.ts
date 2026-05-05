import type { GraphEdge, GraphNode, GraphScope } from "@neuralmap/schema";

export interface ContentChunkDraft {
  id: string;
  node_id: string;
  source_uri: string;
  ordinal: number;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
}

export interface IngestEmission {
  nodes: GraphNode[];
  edges: GraphEdge[];
  chunks: ContentChunkDraft[];
}

export interface SourceDocument {
  id: string;
  title: string;
  uri: string;
  body: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface RepositoryFile {
  path: string;
  content: string;
  language?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface RepositorySnapshot {
  id: string;
  root: string;
  files: RepositoryFile[];
  metadata?: Record<string, unknown> | undefined;
}

export interface TicketSnapshot {
  id: string;
  title: string;
  url: string;
  body: string;
  status: string;
  labels?: string[] | undefined;
  comments?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface SimulationEventSnapshot {
  simulation_id: string;
  session_id: string;
  event_id: string;
  content: string;
  actor_id?: string | undefined;
  actor_name?: string | undefined;
  previous_event_id?: string | undefined;
  occurred_at?: string | undefined;
  importance?: number | undefined;
  tags?: string[] | undefined;
  participants?: Array<{
    id: string;
    name?: string | undefined;
    role?: string | undefined;
  }> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ContentModuleSnapshot {
  id: string;
  title: string;
  body: string;
  module_kind?: "document" | "template" | "policy" | "snippet" | "guide" | "reference" | undefined;
  parent_module_id?: string | undefined;
  enabled?: boolean | undefined;
  priority?: number | undefined;
  order?: number | undefined;
  activation_tags?: string[] | undefined;
  owner_scope?: string | undefined;
  version?: string | undefined;
  source_uri?: string | undefined;
  lifecycle_status?: "draft" | "active" | "deprecated" | "archived" | undefined;
  scope?: GraphScope | undefined;
  metadata?: Record<string, unknown> | undefined;
}
