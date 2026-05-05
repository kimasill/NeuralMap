import type { GraphDeltaRequest, GraphProfile } from "@neuralmap/schema";

export interface GraphProfileRegistry {
  list(): GraphProfile[];
  get(id: string): GraphProfile | undefined;
  register(profile: GraphProfile): GraphProfile;
  validateDelta(delta: GraphDeltaRequest): GraphProfileValidationResult;
}

export interface GraphProfileValidationResult {
  ok: boolean;
  issues: GraphProfileValidationIssue[];
}

export interface GraphProfileValidationIssue {
  path: string;
  message: string;
}

export const defaultGraphProfiles: GraphProfile[] = [
  {
    id: "simulation-memory",
    version: "1",
    neuron_types: {
      Character: {
        base_labels: ["Entity", "Actor"],
        required_properties: ["name"],
        aliases: ["Person", "Actor"]
      },
      Scene: {
        base_labels: ["Entity", "Temporal"],
        required_properties: ["session_id"]
      },
      Event: {
        base_labels: ["Fact", "Temporal"],
        required_properties: ["source_turn_id"]
      },
      State: {
        base_labels: ["Fact", "Temporal", "State"],
        required_properties: ["owner_id", "state_type", "value"]
      },
      Observation: {
        base_labels: ["Perspective"],
        required_properties: ["observer_id", "target_id"]
      },
      Belief: {
        base_labels: ["Perspective", "Uncertain"],
        required_properties: ["holder_id", "content"]
      }
    },
    synapse_types: {
      ACTOR_OF: {
        from: ["Character"],
        to: ["Event"]
      },
      HAS_CURRENT_STATE: {
        from: ["Character"],
        to: ["State"],
        current_pointer: true,
        required_properties: ["current_pointer_key"]
      },
      OBSERVED: {
        from: ["Character"],
        to: ["Event"],
        perspective_edge: true
      },
      BELIEVES: {
        from: ["Character"],
        to: ["State"],
        perspective_edge: true
      },
      SUPERSEDES: {
        temporal_edge: true
      }
    },
    context_templates: {
      "turn-context": {
        sections: ["current_scene", "canonical_state", "perspective_state", "relevant_history", "open_threads"]
      }
    }
  },
  {
    id: "coding-context",
    version: "1",
    neuron_types: {
      Repository: {
        base_labels: ["Entity", "Code"],
        required_properties: ["name"]
      },
      File: {
        base_labels: ["Artifact", "Code"],
        required_properties: ["path"]
      },
      Decision: {
        base_labels: ["Fact"],
        required_properties: ["decision"]
      },
      TestResult: {
        base_labels: ["Fact", "Validation"],
        required_properties: ["status"]
      }
    },
    synapse_types: {
      DEPENDS_ON: {},
      IMPLEMENTS: {},
      VALIDATED_BY: {},
      REFERENCES: {}
    },
    context_templates: {
      "task-context": {
        sections: ["current_task", "relevant_files", "decisions", "failing_tests", "constraints"]
      }
    }
  },
  {
    id: "ops-incident",
    version: "1",
    neuron_types: {
      Incident: {
        base_labels: ["Entity", "Temporal"],
        required_properties: ["service", "status"]
      },
      Signal: {
        base_labels: ["Fact", "Temporal"],
        required_properties: ["source"]
      },
      Action: {
        base_labels: ["Fact", "Temporal"],
        required_properties: ["actor"]
      },
      RunbookStep: {
        base_labels: ["Policy"],
        required_properties: ["step"]
      }
    },
    synapse_types: {
      CAUSED_BY: {},
      MITIGATED_BY: {},
      FOLLOWED_BY: {},
      ROLLS_BACK: {}
    },
    context_templates: {
      "incident-context": {
        sections: ["incident_state", "recent_signals", "suspected_causes", "actions_taken", "rollback_options"]
      }
    }
  }
];

export function createGraphProfileRegistry(initialProfiles: readonly GraphProfile[] = defaultGraphProfiles): GraphProfileRegistry {
  const profiles = new Map<string, GraphProfile>();
  for (const profile of initialProfiles) {
    profiles.set(profile.id, cloneProfile(profile));
  }

  return {
    list() {
      return [...profiles.values()].map(cloneProfile);
    },

    get(id) {
      const profile = profiles.get(id);
      return profile ? cloneProfile(profile) : undefined;
    },

    register(profile) {
      profiles.set(profile.id, cloneProfile(profile));
      return cloneProfile(profile);
    },

    validateDelta(delta) {
      return validateGraphDeltaAgainstProfiles(delta, profiles);
    }
  };
}

export function validateGraphDeltaAgainstProfiles(
  delta: GraphDeltaRequest,
  profiles: ReadonlyMap<string, GraphProfile>
): GraphProfileValidationResult {
  const profileId = delta.profile_id;
  if (!profileId) {
    return { ok: true, issues: [] };
  }

  const profile = profiles.get(profileId);
  if (!profile) {
    return {
      ok: false,
      issues: [
        {
          path: "profile_id",
          message: `Unknown graph profile '${profileId}'.`
        }
      ]
    };
  }

  const issues: GraphProfileValidationIssue[] = [];

  delta.upsert_neurons.forEach((neuron, index) => {
    const type = neuron.ontology?.type;
    if (!type) {
      return;
    }
    if (neuron.ontology?.profile_id && neuron.ontology.profile_id !== profileId) {
      issues.push({
        path: `upsert_neurons.${index}.ontology.profile_id`,
        message: `Ontology profile '${neuron.ontology.profile_id}' does not match delta profile '${profileId}'.`
      });
    }
    const definition = profile.neuron_types[type];
    if (!definition) {
      issues.push({
        path: `upsert_neurons.${index}.ontology.type`,
        message: `Neuron type '${type}' is not defined by profile '${profileId}'.`
      });
      return;
    }
    for (const property of definition.required_properties ?? []) {
      if (!hasProperty(neuron.properties, property)) {
        issues.push({
          path: `upsert_neurons.${index}.properties.${property}`,
          message: `Required property '${property}' is missing for neuron type '${type}'.`
        });
      }
    }
  });

  delta.upsert_synapses.forEach((synapse, index) => {
    const type = synapse.ontology?.type ?? synapse.type;
    if (synapse.ontology?.profile_id && synapse.ontology.profile_id !== profileId) {
      issues.push({
        path: `upsert_synapses.${index}.ontology.profile_id`,
        message: `Ontology profile '${synapse.ontology.profile_id}' does not match delta profile '${profileId}'.`
      });
    }
    const definition = profile.synapse_types[type];
    if (!definition) {
      issues.push({
        path: `upsert_synapses.${index}.type`,
        message: `Synapse type '${type}' is not defined by profile '${profileId}'.`
      });
      return;
    }
    for (const property of definition.required_properties ?? []) {
      if (!hasProperty(synapse.properties, property)) {
        issues.push({
          path: `upsert_synapses.${index}.properties.${property}`,
          message: `Required property '${property}' is missing for synapse type '${type}'.`
        });
      }
    }
  });

  return {
    ok: issues.length === 0,
    issues
  };
}

function hasProperty(properties: Record<string, unknown> | undefined, property: string): boolean {
  const value = properties?.[property];
  return value !== undefined && value !== null && value !== "";
}

function cloneProfile(profile: GraphProfile): GraphProfile {
  return {
    ...profile,
    neuron_types: cloneRecord(profile.neuron_types),
    synapse_types: cloneRecord(profile.synapse_types),
    ...(profile.context_templates ? { context_templates: cloneRecord(profile.context_templates) } : {}),
    ...(profile.render_hints ? { render_hints: { ...profile.render_hints } } : {}),
    ...(profile.metadata ? { metadata: { ...profile.metadata } } : {})
  };
}

function cloneRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, cloneValue(value)]));
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>) } as T;
  }
  return value;
}
