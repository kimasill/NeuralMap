import type { GraphEdge, GraphNode } from "@neuralmap/schema";

export const queryIntentKinds = [
  "bug_investigation",
  "code_change",
  "documentation",
  "design",
  "ticket_triage",
  "handoff",
  "validation",
  "general_recall"
] as const;

export type QueryIntentKind = (typeof queryIntentKinds)[number];

export interface QueryIntent {
  kind: QueryIntentKind;
  confidence: number;
  reasons: string[];
  preferred_node_types: Array<GraphNode["type"]>;
  preferred_edge_types: Array<GraphEdge["type"]>;
  suggested_hops: number;
}

interface IntentRule {
  kind: QueryIntentKind;
  keywords: string[];
  preferredNodeTypes: Array<GraphNode["type"]>;
  preferredEdgeTypes: Array<GraphEdge["type"]>;
  suggestedHops: number;
}

const intentRules: IntentRule[] = [
  {
    kind: "bug_investigation",
    keywords: ["bug", "error", "failure", "fail", "exception", "regression", "broken", "장애", "버그", "실패", "에러"],
    preferredNodeTypes: ["Ticket", "Error", "CodeFile", "TestCase", "PR", "Commit"],
    preferredEdgeTypes: ["caused_by", "fixes", "validated_by", "blocks", "references"],
    suggestedHops: 2
  },
  {
    kind: "code_change",
    keywords: ["implement", "fix", "refactor", "code", "module", "function", "api", "구현", "수정", "리팩터"],
    preferredNodeTypes: ["CodeFile", "CodeSymbol", "Repository", "TestCase", "Ticket"],
    preferredEdgeTypes: ["implements", "depends_on", "validated_by", "references"],
    suggestedHops: 1
  },
  {
    kind: "documentation",
    keywords: ["doc", "docs", "readme", "guide", "how-to", "adr", "문서", "가이드", "설명"],
    preferredNodeTypes: ["Document", "DocSection", "Decision", "Policy", "Template"],
    preferredEdgeTypes: ["references", "summarizes", "derived_from"],
    suggestedHops: 1
  },
  {
    kind: "design",
    keywords: ["design", "architecture", "adr", "proposal", "schema", "policy", "설계", "구조", "정책"],
    preferredNodeTypes: ["Decision", "Template", "Policy", "Document", "DocSection", "CodeFile"],
    preferredEdgeTypes: ["depends_on", "references", "contradicts", "used_template"],
    suggestedHops: 1
  },
  {
    kind: "ticket_triage",
    keywords: ["ticket", "issue", "linear", "triage", "status", "label", "티켓", "이슈", "상태"],
    preferredNodeTypes: ["Ticket", "Task", "PR", "Commit", "Person", "Error"],
    preferredEdgeTypes: ["mentions", "fixes", "blocks", "related_to", "references"],
    suggestedHops: 2
  },
  {
    kind: "handoff",
    keywords: ["handoff", "resume", "session", "summary", "continue", "인계", "재개", "요약", "세션"],
    preferredNodeTypes: ["Run", "Summary", "Decision", "Task", "Artifact", "Template"],
    preferredEdgeTypes: ["handed_off_to", "summarizes", "references", "used_template"],
    suggestedHops: 1
  },
  {
    kind: "validation",
    keywords: ["test", "verify", "validate", "ci", "coverage", "검증", "테스트", "확인"],
    preferredNodeTypes: ["TestCase", "Error", "PR", "CodeFile", "Artifact"],
    preferredEdgeTypes: ["validated_by", "fixes", "caused_by", "references"],
    suggestedHops: 1
  }
];

const generalIntent: QueryIntent = {
  kind: "general_recall",
  confidence: 0.25,
  reasons: ["fallback:general"],
  preferred_node_types: ["Decision", "Document", "CodeFile", "Ticket", "Task"],
  preferred_edge_types: ["references", "related_to", "depends_on"],
  suggested_hops: 1
};

export function classifyQueryIntent(query: string): QueryIntent {
  const normalized = query.toLowerCase();
  const scored = intentRules
    .map((rule) => {
      const matches = rule.keywords.filter((keyword) => normalized.includes(keyword));
      return {
        rule,
        matches
      };
    })
    .filter((candidate) => candidate.matches.length > 0)
    .sort((a, b) => b.matches.length - a.matches.length || b.rule.preferredNodeTypes.length - a.rule.preferredNodeTypes.length);

  const best = scored[0];
  if (!best) {
    return generalIntent;
  }

  return {
    kind: best.rule.kind,
    confidence: Number(Math.min(0.95, 0.45 + best.matches.length * 0.15).toFixed(2)),
    reasons: best.matches.map((match) => `keyword:${match}`),
    preferred_node_types: best.rule.preferredNodeTypes,
    preferred_edge_types: best.rule.preferredEdgeTypes,
    suggested_hops: best.rule.suggestedHops
  };
}

export function nodeTypeIntentBoost(node: GraphNode, intent: QueryIntent): number {
  const index = intent.preferred_node_types.indexOf(node.type);
  if (index < 0) {
    return 0;
  }

  return Number((1.2 - index * 0.12).toFixed(2));
}

export function edgeTypeIntentBoosts(intent: QueryIntent): Partial<Record<GraphEdge["type"], number>> {
  return Object.fromEntries(
    intent.preferred_edge_types.map((edgeType, index) => [edgeType, Number((1.25 - index * 0.05).toFixed(2))])
  );
}
