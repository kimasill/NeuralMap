import type { GraphNode } from "@neuralmap/schema";

import { chunkText } from "./chunking.js";
import type { IngestEmission, SourceDocument } from "./types.js";

export function ingestDocument(document: SourceDocument): IngestEmission {
  const now = new Date().toISOString();
  const node: GraphNode = {
    id: `doc:${document.id}`,
    type: "Document",
    title: document.title,
    content_ref: document.uri,
    summary: firstParagraph(document.body),
    source_system: "doc",
    trust_score: 0.75,
    freshness_score: 0.75,
    importance_score: 0.6,
    created_at: now,
    updated_at: now,
    metadata: document.metadata ?? {}
  };

  return {
    nodes: [node],
    edges: [],
    chunks: chunkText(node.id, document.uri, document.body)
  };
}

function firstParagraph(content: string): string {
  return content.split(/\n\s*\n/u).find((paragraph) => paragraph.trim().length > 0)?.trim().slice(0, 500) ?? "";
}

