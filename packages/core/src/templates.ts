import type { ComposeContextRequest } from "@neuralmap/schema";

import { classifyQueryIntent, type QueryIntent } from "./intent.js";

export interface ContextTemplate {
  id: string;
  kind: string;
  version: number;
  name: string;
  description: string;
  slots: string[];
  quality_bar: string[];
  prompt_segments: string[];
}

export interface PromptSegment {
  template_id: string;
  template_version: number;
  title: string;
  content: string;
  slots: string[];
  rendered_at: string;
}

const defaultQualityBar = [
  "Use only evidence from referenced graph nodes when making factual claims.",
  "Call out blockers and stale or low-confidence evidence explicitly.",
  "Keep the output focused on the current objective and next action."
];

const contextTemplates: ContextTemplate[] = [
  {
    id: "bug_investigation:default",
    kind: "bug_investigation",
    version: 1,
    name: "Bug Investigation",
    description: "Trace symptoms through errors, code files, tests, tickets, and prior fixes.",
    slots: ["goal", "symptoms", "relevant_files", "evidence", "suspected_causes", "validation_plan"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Start from observed symptoms, then connect each hypothesis to a source node.",
      "Prefer error, test, code file, ticket, PR, and commit nodes during expansion."
    ]
  },
  {
    id: "implementation:default",
    kind: "implementation",
    version: 1,
    name: "Implementation",
    description: "Plan and apply a focused code or product slice from the selected graph context.",
    slots: ["goal", "relevant_files", "known_constraints", "decisions", "evidence", "verification"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Use repository, code file, decision, task, and test nodes to keep the change scoped.",
      "Preserve existing conventions and include verification evidence in the handoff."
    ]
  },
  {
    id: "code_change:default",
    kind: "code_change",
    version: 1,
    name: "Code Change",
    description: "Make a targeted code change with repository and test context.",
    slots: ["goal", "relevant_files", "known_constraints", "tests", "risks", "verification"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Use code and test nodes before broad documentation nodes.",
      "Keep the final change aligned to the current task boundary."
    ]
  },
  {
    id: "repo_onboarding:default",
    kind: "repo_onboarding",
    version: 1,
    name: "Repo Onboarding",
    description: "Summarize repository structure, ownership, commands, and important design decisions.",
    slots: ["goal", "repo_map", "entry_points", "commands", "decisions", "open_questions"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Favor repository, document, ADR, config, and task nodes.",
      "Explain how the codebase is organized without dumping file lists."
    ]
  },
  {
    id: "pr_review:default",
    kind: "pr_review",
    version: 1,
    name: "PR Review",
    description: "Review a proposed change by grounding findings in files, tests, issues, and decisions.",
    slots: ["goal", "changed_files", "risks", "tests", "decisions", "findings"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Prioritize correctness, regressions, missing tests, and security risks.",
      "Make each finding actionable and cite the supporting node."
    ]
  },
  {
    id: "design:default",
    kind: "design",
    version: 1,
    name: "Design Doc",
    description: "Turn decisions, policies, repo context, and constraints into an implementation-ready design.",
    slots: ["goal", "requirements", "constraints", "decisions", "tradeoffs", "next_actions"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Prefer decision, policy, document, template, and task nodes.",
      "Separate locked decisions from open questions and speculative options."
    ]
  },
  {
    id: "documentation:default",
    kind: "documentation",
    version: 1,
    name: "Documentation",
    description: "Create or refresh docs from source-backed context and explicit reader goals.",
    slots: ["goal", "reader", "source_nodes", "decisions", "examples", "gaps"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Preserve source-backed facts and flag missing or stale evidence.",
      "Match the document shape to the reader task."
    ]
  },
  {
    id: "ticket_triage:default",
    kind: "ticket_triage",
    version: 1,
    name: "Ticket Resolution",
    description: "Connect a ticket to code, docs, decisions, blockers, and a concrete next action.",
    slots: ["goal", "ticket", "status", "related_work", "blockers", "next_actions"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Prefer ticket, task, PR, commit, error, and code file nodes.",
      "Keep status, blockers, and next actions explicit."
    ]
  },
  {
    id: "release_note:default",
    kind: "release_note",
    version: 1,
    name: "Release Note",
    description: "Summarize shipped changes from tickets, PRs, commits, decisions, and user-facing docs.",
    slots: ["goal", "changes", "impact", "migration_notes", "known_issues", "references"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Group changes by user impact and cite source nodes.",
      "Separate shipped behavior from internal implementation details."
    ]
  },
  {
    id: "handoff:default",
    kind: "handoff",
    version: 1,
    name: "Handoff Summary",
    description: "Prepare a compact session handoff with objective, status, decisions, blockers, and next actions.",
    slots: ["objective", "current_status", "key_decisions", "evidence", "open_loops", "next_actions"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Do not copy the session transcript.",
      "Preserve source node references for every important claim."
    ]
  },
  {
    id: "validation:default",
    kind: "validation",
    version: 1,
    name: "Validation",
    description: "Check implementation, tests, traces, and evidence before a phase or handoff is accepted.",
    slots: ["goal", "acceptance_criteria", "test_results", "risks", "evidence", "decision"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Prefer tests, trace spans, decisions, and changed artifact nodes.",
      "Report residual risk separately from verified facts."
    ]
  },
  {
    id: "general_recall:default",
    kind: "general_recall",
    version: 1,
    name: "General Recall",
    description: "Recover the smallest useful context set for an open-ended graph query.",
    slots: ["goal", "relevant_nodes", "evidence", "decisions", "blockers", "open_questions"],
    quality_bar: defaultQualityBar,
    prompt_segments: [
      "Use high-trust and high-importance nodes first.",
      "Compress related evidence and keep open questions visible."
    ]
  }
];

const templatesById = new Map(contextTemplates.map((template) => [template.id, template]));
const templatesByKind = new Map(contextTemplates.map((template) => [template.kind, template]));

export function listContextTemplates(): ContextTemplate[] {
  return contextTemplates.map((template) => cloneTemplate(template));
}

export function getContextTemplate(id: string): ContextTemplate | undefined {
  const template = templatesById.get(id);
  return template ? cloneTemplate(template) : undefined;
}

export function selectContextTemplate(
  request: Pick<ComposeContextRequest, "objective" | "query" | "task_type">,
  intent: QueryIntent = classifyQueryIntent(request.query ?? request.objective)
): ContextTemplate {
  const normalizedTaskType = normalizeKind(request.task_type);
  if (normalizedTaskType) {
    const explicitTemplate = templatesById.get(`${normalizedTaskType}:default`) ?? templatesByKind.get(normalizedTaskType);
    if (explicitTemplate) {
      return cloneTemplate(explicitTemplate);
    }
  }

  const intentTemplate = templatesByKind.get(intent.kind);
  return cloneTemplate(intentTemplate ?? templatesByKind.get("general_recall")!);
}

export function renderPromptSegment(template: ContextTemplate, renderedAt = new Date().toISOString()): PromptSegment {
  return {
    template_id: template.id,
    template_version: template.version,
    title: template.name,
    slots: [...template.slots],
    rendered_at: renderedAt,
    content: [
      `Template: ${template.name}`,
      `Purpose: ${template.description}`,
      `Slots: ${template.slots.join(", ")}`,
      "Prompt Segments:",
      ...template.prompt_segments.map((segment) => `- ${segment}`),
      "Quality Bar:",
      ...template.quality_bar.map((rule) => `- ${rule}`)
    ].join("\n")
  };
}

function normalizeKind(kind: string | undefined): string | undefined {
  if (!kind) {
    return undefined;
  }

  return kind.trim().toLowerCase().replaceAll(/[\s-]+/gu, "_");
}

function cloneTemplate(template: ContextTemplate): ContextTemplate {
  return {
    ...template,
    slots: [...template.slots],
    quality_bar: [...template.quality_bar],
    prompt_segments: [...template.prompt_segments]
  };
}
