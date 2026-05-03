import type { GraphEdge, GraphNode } from "@neuralmap/schema";

import { chunkText } from "./chunking.js";
import type { IngestEmission, SimulationEventSnapshot } from "./types.js";

export function simulationSessionNodeId(simulationId: string, sessionId: string): string {
  return `simulation:${normalizeId(simulationId)}:session:${normalizeId(sessionId)}`;
}

export function simulationEventNodeId(simulationId: string, eventId: string): string {
  return `simulation:${normalizeId(simulationId)}:event:${normalizeId(eventId)}`;
}

export function simulationPersonNodeId(simulationId: string, personId: string): string {
  return `simulation:${normalizeId(simulationId)}:person:${normalizeId(personId)}`;
}

export function ingestSimulationEvent(event: SimulationEventSnapshot): IngestEmission {
  const now = new Date().toISOString();
  const occurredAt = event.occurred_at ?? now;
  const sessionNodeId = simulationSessionNodeId(event.simulation_id, event.session_id);
  const eventNodeId = simulationEventNodeId(event.simulation_id, event.event_id);
  const participants = normalizeParticipants(event);
  const sessionNode: GraphNode = {
    id: sessionNodeId,
    type: "Session",
    title: `Simulation ${event.simulation_id} / Session ${event.session_id}`,
    content_ref: `simulation://${event.simulation_id}/sessions/${event.session_id}`,
    summary: `Persistent simulation session for ${event.simulation_id}.`,
    source_system: "user",
    trust_score: 0.82,
    freshness_score: 1,
    importance_score: 0.74,
    created_at: now,
    updated_at: now,
    metadata: {
      kind: "simulation_session",
      simulation_id: event.simulation_id,
      session_id: event.session_id
    }
  };
  const eventNode: GraphNode = {
    id: eventNodeId,
    type: "Task",
    title: `Simulation event ${event.event_id}`,
    content_ref: `simulation://${event.simulation_id}/sessions/${event.session_id}/events/${event.event_id}`,
    summary: event.content.trim().slice(0, 700),
    source_system: "user",
    trust_score: 0.78,
    freshness_score: 1,
    importance_score: clamp(event.importance ?? inferImportance(event), 0.35, 1),
    created_at: occurredAt,
    updated_at: now,
    metadata: {
      kind: "simulation_event",
      simulation_id: event.simulation_id,
      session_id: event.session_id,
      event_id: event.event_id,
      actor_id: event.actor_id,
      actor_name: event.actor_name,
      tags: event.tags ?? [],
      ...(event.metadata ?? {})
    }
  };
  const personNodes = participants.map((participant) => createPersonNode(event, participant, now));
  const edges: GraphEdge[] = [
    {
      id: `edge:${sessionNodeId}:references:${eventNodeId}`,
      from: sessionNodeId,
      to: eventNodeId,
      type: "references",
      weight: 0.82,
      confidence: 0.9,
      created_at: now,
      metadata: {
        source: "simulation_ingest",
        reason: "session_event"
      }
    }
  ];

  for (const participant of participants) {
    const personNodeId = simulationPersonNodeId(event.simulation_id, participant.id);
    edges.push(
      {
        id: `edge:${eventNodeId}:mentions:${personNodeId}`,
        from: eventNodeId,
        to: personNodeId,
        type: "mentions",
        weight: participant.id === event.actor_id ? 0.8 : 0.62,
        confidence: 0.86,
        created_at: now,
        metadata: {
          source: "simulation_ingest",
          role: participant.role ?? (participant.id === event.actor_id ? "actor" : "participant")
        }
      },
      {
        id: `edge:${sessionNodeId}:mentions:${personNodeId}`,
        from: sessionNodeId,
        to: personNodeId,
        type: "mentions",
        weight: 0.58,
        confidence: 0.8,
        created_at: now,
        metadata: {
          source: "simulation_ingest",
          reason: "session_participant"
        }
      }
    );
  }

  if (event.previous_event_id) {
    edges.push({
      id: `edge:${simulationEventNodeId(event.simulation_id, event.previous_event_id)}:related_to:${eventNodeId}`,
      from: simulationEventNodeId(event.simulation_id, event.previous_event_id),
      to: eventNodeId,
      type: "related_to",
      weight: 0.74,
      confidence: 0.84,
      created_at: now,
      metadata: {
        source: "simulation_ingest",
        reason: "event_sequence"
      }
    });
  }

  return {
    nodes: [sessionNode, eventNode, ...personNodes],
    edges,
    chunks: chunkText(eventNodeId, eventNode.content_ref ?? eventNodeId, event.content).map((chunk) => ({
      ...chunk,
      metadata: {
        kind: "simulation_event",
        simulation_id: event.simulation_id,
        session_id: event.session_id,
        event_id: event.event_id
      }
    }))
  };
}

function createPersonNode(
  event: SimulationEventSnapshot,
  participant: { id: string; name?: string | undefined; role?: string | undefined },
  now: string
): GraphNode {
  return {
    id: simulationPersonNodeId(event.simulation_id, participant.id),
    type: "Person",
    title: participant.name ?? participant.id,
    content_ref: `simulation://${event.simulation_id}/people/${participant.id}`,
    summary: `${participant.name ?? participant.id} participates in simulation ${event.simulation_id}.`,
    source_system: "user",
    trust_score: 0.78,
    freshness_score: 0.92,
    importance_score: participant.id === event.actor_id ? 0.72 : 0.62,
    created_at: now,
    updated_at: now,
    metadata: {
      kind: "simulation_person",
      simulation_id: event.simulation_id,
      person_id: participant.id,
      role: participant.role
    }
  };
}

function normalizeParticipants(event: SimulationEventSnapshot): Array<{
  id: string;
  name?: string | undefined;
  role?: string | undefined;
}> {
  const participants = new Map<string, { id: string; name?: string | undefined; role?: string | undefined }>();

  if (event.actor_id) {
    participants.set(event.actor_id, {
      id: event.actor_id,
      name: event.actor_name,
      role: "actor"
    });
  }

  for (const participant of event.participants ?? []) {
    participants.set(participant.id, {
      id: participant.id,
      name: participant.name,
      role: participant.role
    });
  }

  return [...participants.values()];
}

function inferImportance(event: SimulationEventSnapshot): number {
  const text = [event.content, ...(event.tags ?? [])].join(" ").toLowerCase();
  if (/promise|secret|memory|relationship|conflict|injury|death|love|betray|quest|contract/u.test(text)) {
    return 0.86;
  }

  if (event.actor_id || (event.participants?.length ?? 0) > 0) {
    return 0.7;
  }

  return 0.6;
}

function normalizeId(value: string): string {
  return value.trim().replaceAll(/[^a-zA-Z0-9_.:-]+/gu, "-");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
