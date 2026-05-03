import type { ContextPack } from "@neuralmap/schema";

import { classifyQueryIntent, type QueryIntent, type QueryIntentKind } from "./intent.js";

export const modelReasoningEfforts = ["low", "medium", "high"] as const;

export type ModelReasoningEffort = (typeof modelReasoningEfforts)[number];

export interface ModelProfile {
  id: string;
  name: string;
  description: string;
  model_family: string;
  reasoning_effort: ModelReasoningEffort;
  suited_intents: QueryIntentKind[];
  max_input_tokens: number;
  latency_budget_ms: number;
  cost_weight: number;
  quality_floor: number;
}

export interface ModelQualitySignal {
  profile_id: string;
  average_score: number;
  feedback_count: number;
  last_score?: number;
}

export interface ModelProfileSelectionInput {
  objective: string;
  task?: string | undefined;
  query?: string | undefined;
  requested_profile_id?: string | undefined;
  token_budget?: number | undefined;
  context_pack?: ContextPack | undefined;
  cache_hit_rate?: number | undefined;
  quality_signals?: Record<string, ModelQualitySignal> | undefined;
}

export interface TaskClassification {
  intent: QueryIntent;
  complexity: number;
  risk: number;
  urgency: number;
  token_budget: number;
  estimated_input_tokens: number;
  context_node_count: number;
  evidence_count: number;
  cache_hit_rate?: number;
  reasons: string[];
}

export interface ModelRouteDecision {
  task_classification: TaskClassification;
  selected_profile: ModelProfile;
  alternatives: Array<{
    profile: ModelProfile;
    score: number;
    reasons: string[];
  }>;
  budget: {
    token_budget: number;
    estimated_input_tokens: number;
    budget_pressure: number;
    latency_budget_ms: number;
    cost_weight: number;
  };
  quality: {
    profile_average_score?: number;
    feedback_count: number;
    quality_floor: number;
    needs_feedback: boolean;
  };
  routing_reasons: string[];
}

export const modelProfiles: ModelProfile[] = [
  {
    id: "fast-context",
    name: "Fast Context",
    description: "Low-latency profile for recall, handoff, and lightweight documentation tasks.",
    model_family: "fast",
    reasoning_effort: "low",
    suited_intents: ["general_recall", "documentation", "handoff", "ticket_triage"],
    max_input_tokens: 6000,
    latency_budget_ms: 3500,
    cost_weight: 0.35,
    quality_floor: 0.7
  },
  {
    id: "balanced-agent",
    name: "Balanced Agent",
    description: "Default profile for implementation and mixed graph-context work.",
    model_family: "balanced",
    reasoning_effort: "medium",
    suited_intents: ["code_change", "design", "ticket_triage", "general_recall", "documentation"],
    max_input_tokens: 12000,
    latency_budget_ms: 8000,
    cost_weight: 0.6,
    quality_floor: 0.78
  },
  {
    id: "deep-reasoning",
    name: "Deep Reasoning",
    description: "Higher-depth profile for complex design, debugging, and cross-source synthesis.",
    model_family: "deep",
    reasoning_effort: "high",
    suited_intents: ["bug_investigation", "design", "code_change", "validation"],
    max_input_tokens: 24000,
    latency_budget_ms: 18000,
    cost_weight: 1,
    quality_floor: 0.84
  },
  {
    id: "validation-guard",
    name: "Validation Guard",
    description: "Verification-oriented profile for tests, acceptance checks, and quality gates.",
    model_family: "validator",
    reasoning_effort: "medium",
    suited_intents: ["validation", "bug_investigation", "code_change"],
    max_input_tokens: 10000,
    latency_budget_ms: 9000,
    cost_weight: 0.55,
    quality_floor: 0.82
  }
];

const profilesById = new Map(modelProfiles.map((profile) => [profile.id, profile]));

export function listModelProfiles(): ModelProfile[] {
  return modelProfiles.map(cloneProfile);
}

export function getModelProfile(id: string): ModelProfile | undefined {
  const profile = profilesById.get(id);
  return profile ? cloneProfile(profile) : undefined;
}

export function selectModelProfile(input: ModelProfileSelectionInput): ModelRouteDecision {
  const classification = classifyTaskForModelProfile(input);
  const requestedProfile = input.requested_profile_id ? profilesById.get(input.requested_profile_id) : undefined;
  const scoredProfiles = modelProfiles
    .map((profile) => scoreProfile(profile, classification, input.quality_signals?.[profile.id]))
    .sort((a, b) => b.score - a.score || a.profile.cost_weight - b.profile.cost_weight);
  const selected = requestedProfile
    ? {
        profile: requestedProfile,
        score: 1,
        reasons: [`requested:${requestedProfile.id}`]
      }
    : scoredProfiles[0] ?? scoreProfile(modelProfiles[1]!, classification, input.quality_signals?.["balanced-agent"]);
  const budgetPressure = Number((classification.estimated_input_tokens / classification.token_budget).toFixed(4));
  const qualitySignal = input.quality_signals?.[selected.profile.id];
  const quality: ModelRouteDecision["quality"] = {
    feedback_count: qualitySignal?.feedback_count ?? 0,
    quality_floor: selected.profile.quality_floor,
    needs_feedback: !qualitySignal || qualitySignal.feedback_count < 3 || qualitySignal.average_score < selected.profile.quality_floor
  };
  if (qualitySignal) {
    quality.profile_average_score = qualitySignal.average_score;
  }

  return {
    task_classification: classification,
    selected_profile: cloneProfile(selected.profile),
    alternatives: scoredProfiles.slice(0, 3).map((candidate) => ({
      profile: cloneProfile(candidate.profile),
      score: candidate.score,
      reasons: candidate.reasons
    })),
    budget: {
      token_budget: classification.token_budget,
      estimated_input_tokens: classification.estimated_input_tokens,
      budget_pressure: budgetPressure,
      latency_budget_ms: selected.profile.latency_budget_ms,
      cost_weight: selected.profile.cost_weight
    },
    quality,
    routing_reasons: [
      ...classification.reasons,
      ...selected.reasons,
      `budget_pressure:${budgetPressure.toFixed(2)}`,
      `reasoning:${selected.profile.reasoning_effort}`
    ]
  };
}

export function classifyTaskForModelProfile(input: ModelProfileSelectionInput): TaskClassification {
  const sourceText = [input.task, input.query, input.objective, input.context_pack?.objective].filter(Boolean).join(" ");
  const intent = classifyQueryIntent(sourceText || input.objective);
  const tokenBudget = input.token_budget ?? input.context_pack?.token_budget ?? 8000;
  const contextNodeCount = input.context_pack?.node_ids.length ?? 0;
  const evidenceCount = input.context_pack?.evidence.length ?? 0;
  const estimatedInputTokens = estimateInputTokens(tokenBudget, contextNodeCount, evidenceCount);
  const complexity = clampScore(
    0.22 +
      contextNodeCount * 0.035 +
      evidenceCount * 0.025 +
      (intent.suggested_hops - 1) * 0.15 +
      (tokenBudget > 12000 ? 0.12 : 0) +
      (input.cache_hit_rate !== undefined && input.cache_hit_rate < 0.25 ? 0.08 : 0)
  );
  const risk = clampScore(
    (["bug_investigation", "validation", "code_change"].includes(intent.kind) ? 0.5 : 0.25) +
      (contextNodeCount > 8 ? 0.15 : 0) +
      (evidenceCount > 6 ? 0.1 : 0)
  );
  const urgency = clampScore(hasUrgencySignal(sourceText) ? 0.82 : input.cache_hit_rate !== undefined && input.cache_hit_rate > 0.75 ? 0.62 : 0.28);
  const reasons = [
    `intent:${intent.kind}`,
    `complexity:${complexity.toFixed(2)}`,
    `risk:${risk.toFixed(2)}`,
    `urgency:${urgency.toFixed(2)}`
  ];

  if (contextNodeCount > 0) {
    reasons.push(`context_nodes:${contextNodeCount}`);
  }
  if (evidenceCount > 0) {
    reasons.push(`evidence:${evidenceCount}`);
  }
  if (input.cache_hit_rate !== undefined) {
    reasons.push(`cache_hit_rate:${input.cache_hit_rate.toFixed(2)}`);
  }

  const classification: TaskClassification = {
    intent,
    complexity,
    risk,
    urgency,
    token_budget: tokenBudget,
    estimated_input_tokens: estimatedInputTokens,
    context_node_count: contextNodeCount,
    evidence_count: evidenceCount,
    reasons
  };

  if (input.cache_hit_rate !== undefined) {
    classification.cache_hit_rate = input.cache_hit_rate;
  }

  return classification;
}

function scoreProfile(profile: ModelProfile, classification: TaskClassification, qualitySignal?: ModelQualitySignal) {
  const reasons: string[] = [];
  let score = 0.25;

  if (profile.suited_intents.includes(classification.intent.kind)) {
    score += 0.32;
    reasons.push(`intent_fit:${classification.intent.kind}`);
  }

  if (profile.reasoning_effort === "high") {
    score += classification.complexity * 0.28 + classification.risk * 0.24;
    reasons.push("deep_for_complexity");
  } else if (profile.reasoning_effort === "medium") {
    score += (1 - Math.abs(0.58 - classification.complexity)) * 0.2;
    reasons.push("balanced_complexity");
  } else {
    score += classification.urgency * 0.2 + (1 - classification.complexity) * 0.14;
    reasons.push("fast_low_complexity");
  }

  const budgetFit = Math.min(1, profile.max_input_tokens / Math.max(1, classification.estimated_input_tokens));
  score += budgetFit * 0.16;
  reasons.push(`budget_fit:${budgetFit.toFixed(2)}`);

  if (qualitySignal) {
    const adjustment = (qualitySignal.average_score - profile.quality_floor) * 0.35;
    score += adjustment;
    reasons.push(`quality:${qualitySignal.average_score.toFixed(2)}`);
  }

  if (classification.urgency > 0.75 && profile.latency_budget_ms <= 4000) {
    score += 0.16;
    reasons.push("latency_fit");
  }

  return {
    profile,
    score: Number(clampScore(score).toFixed(4)),
    reasons
  };
}

function estimateInputTokens(tokenBudget: number, contextNodeCount: number, evidenceCount: number): number {
  if (contextNodeCount === 0 && evidenceCount === 0) {
    return Math.min(tokenBudget, 1400);
  }

  return Math.min(tokenBudget, 900 + contextNodeCount * 360 + evidenceCount * 140);
}

function hasUrgencySignal(value: string): boolean {
  return /\b(urgent|quick|fast|asap|now|today)\b|긴급|빠르게|빨리|즉시/i.test(value);
}

function clampScore(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

function cloneProfile(profile: ModelProfile): ModelProfile {
  return {
    ...profile,
    suited_intents: [...profile.suited_intents]
  };
}
