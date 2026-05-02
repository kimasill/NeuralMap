export const sourceSystems = ["repo", "doc", "ticket", "runtime", "user"] as const;

export type SourceSystem = (typeof sourceSystems)[number];

export const nodeTypes = [
  "Agent",
  "Session",
  "Run",
  "Task",
  "Decision",
  "Summary",
  "Template",
  "Repository",
  "CodeFile",
  "CodeSymbol",
  "Document",
  "DocSection",
  "Ticket",
  "PR",
  "Commit",
  "TestCase",
  "Error",
  "Artifact",
  "Person",
  "Policy"
] as const;

export type NodeType = (typeof nodeTypes)[number];

export const edgeTypes = [
  "references",
  "derived_from",
  "implements",
  "depends_on",
  "related_to",
  "caused_by",
  "fixes",
  "mentions",
  "validated_by",
  "contradicts",
  "blocks",
  "handed_off_to",
  "used_template",
  "summarizes"
] as const;

export type EdgeType = (typeof edgeTypes)[number];

export const runStatuses = [
  "planned",
  "running",
  "waiting_tool",
  "waiting_human",
  "summarizing",
  "handoff_ready",
  "completed",
  "failed"
] as const;

export type RunStatus = (typeof runStatuses)[number];

