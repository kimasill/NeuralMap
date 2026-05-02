import type { GraphEdge, GraphNode } from "@neuralmap/schema";

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
  metadata?: Record<string, unknown>;
}

export interface RepositoryFile {
  path: string;
  content: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface RepositorySnapshot {
  id: string;
  root: string;
  files: RepositoryFile[];
  metadata?: Record<string, unknown>;
}

export interface TicketSnapshot {
  id: string;
  title: string;
  url: string;
  body: string;
  status: string;
  labels?: string[];
  comments?: string[];
  metadata?: Record<string, unknown>;
}

