import type { GraphNode } from "@neuralmap/schema";

import { chunkText } from "./chunking.js";
import type { IngestEmission, TicketSnapshot } from "./types.js";

export function ingestTicket(ticket: TicketSnapshot): IngestEmission {
  const now = new Date().toISOString();
  const body = [ticket.body, ...(ticket.comments ?? [])].join("\n\n");
  const node: GraphNode = {
    id: `ticket:${ticket.id}`,
    type: "Ticket",
    title: ticket.title,
    content_ref: ticket.url,
    summary: ticket.body.trim().slice(0, 500),
    source_system: "ticket",
    trust_score: 0.8,
    freshness_score: ticket.status.toLowerCase() === "done" ? 0.75 : 0.95,
    importance_score: ticket.labels?.includes("blocking") ? 0.9 : 0.7,
    created_at: now,
    updated_at: now,
    metadata: {
      status: ticket.status,
      labels: ticket.labels ?? [],
      ...(ticket.metadata ?? {})
    }
  };

  return {
    nodes: [node],
    edges: [],
    chunks: chunkText(node.id, ticket.url, body)
  };
}

