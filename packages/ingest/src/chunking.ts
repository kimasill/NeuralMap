import { createHash } from "node:crypto";

import type { ContentChunkDraft } from "./types.js";

export interface ChunkTextOptions {
  maxChars?: number;
  overlapChars?: number;
}

export function chunkText(nodeId: string, sourceUri: string, content: string, options: ChunkTextOptions = {}): ContentChunkDraft[] {
  const maxChars = options.maxChars ?? 1600;
  const overlapChars = options.overlapChars ?? 160;
  const chunks: ContentChunkDraft[] = [];
  let cursor = 0;
  let ordinal = 0;

  while (cursor < content.length) {
    const end = Math.min(cursor + maxChars, content.length);
    const chunk = content.slice(cursor, end).trim();

    if (chunk.length > 0) {
      chunks.push({
        id: `${nodeId}:chunk:${ordinal}`,
        node_id: nodeId,
        source_uri: sourceUri,
        ordinal,
        content: chunk,
        content_hash: hashContent(chunk),
        metadata: {}
      });
      ordinal += 1;
    }

    if (end === content.length) {
      break;
    }

    cursor = Math.max(end - overlapChars, cursor + 1);
  }

  return chunks;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

