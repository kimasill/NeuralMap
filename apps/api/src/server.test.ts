import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "./server.js";

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  if (originalDatabaseUrl) {
    process.env.DATABASE_URL = originalDatabaseUrl;
  } else {
    delete process.env.DATABASE_URL;
  }
});

describe("api server", () => {
  it("reports sample graph mode when no database is configured", async () => {
    const app = createApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        graph_mode: "sample"
      });
    } finally {
      await app.close();
    }
  });

  it("ingests a ticket and composes context from the same graph memory", async () => {
    const app = createApp();
    await app.ready();

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/ingest/ticket",
        payload: {
          id: "TEST-1",
          title: "Persist ingest smoke",
          url: "linear://TEST-1",
          body: "Smoke ingest context should be retrievable.",
          status: "open",
          labels: ["smoke"]
        }
      });

      expect(ingestResponse.statusCode).toBe(200);
      expect(ingestResponse.json()).toMatchObject({
        nodes: 1,
        chunks: 1,
        mode: "sample"
      });

      const contextResponse = await app.inject({
        method: "POST",
        url: "/context/compose",
        payload: {
          objective: "Find smoke context",
          agent_id: "main-agent",
          session_id: "test-session",
          query: "Smoke ingest",
          token_budget: 1200
        }
      });

      expect(contextResponse.statusCode).toBe(200);
      expect(contextResponse.json().node_ids).toContain("ticket:TEST-1");
    } finally {
      await app.close();
    }
  });

  it("caches graph query responses and reports cache stats", async () => {
    const app = createApp();
    await app.ready();

    try {
      const payload = {
        query: "Context Pack",
        top_k: 3,
        expand_hops: 1,
        min_edge_confidence: 0.4
      };

      const first = await app.inject({
        method: "POST",
        url: "/graph/query",
        payload
      });
      const second = await app.inject({
        method: "POST",
        url: "/graph/query",
        payload
      });
      const stats = await app.inject({
        method: "GET",
        url: "/cache/stats"
      });

      expect(first.json().cache.hit).toBe(false);
      expect(second.json().cache.hit).toBe(true);
      expect(first.json().intent.kind).toBe("general_recall");
      expect(first.json().retrieval).toMatchObject({
        mode: "hybrid",
        seed_count: expect.any(Number),
        semantic_seed_count: expect.any(Number),
        vector_seed_count: 0,
        semantic_source: "local_sparse"
      });
      expect(first.json().seeds[0]).toMatchObject({
        lexical_score: expect.any(Number),
        semantic_score: expect.any(Number)
      });
      expect(stats.json().layers).toContainEqual(
        expect.objectContaining({
          name: "retrieval",
          hits: 1,
          misses: 1,
          writes: 1
        })
      );
    } finally {
      await app.close();
    }
  });

  it("caches graph neighborhoods and invalidates graph caches after ingest", async () => {
    const app = createApp();
    await app.ready();

    try {
      const first = await app.inject({
        method: "GET",
        url: "/graph/nodes/node_context_pack_contract/neighbors"
      });
      const second = await app.inject({
        method: "GET",
        url: "/graph/nodes/node_context_pack_contract/neighbors"
      });
      const statsBeforeIngest = await app.inject({
        method: "GET",
        url: "/cache/stats"
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(statsBeforeIngest.json().layers).toContainEqual(
        expect.objectContaining({
          name: "graph_neighborhood",
          hits: 1,
          misses: 1,
          writes: 1,
          size: 1
        })
      );

      const ingestResponse = await app.inject({
        method: "POST",
        url: "/ingest/ticket",
        payload: {
          id: "CACHE-1",
          title: "Invalidate graph cache",
          url: "linear://CACHE-1",
          body: "Cache invalidation should evict graph neighborhood entries.",
          status: "open"
        }
      });
      const statsAfterIngest = await app.inject({
        method: "GET",
        url: "/cache/stats"
      });

      expect(ingestResponse.statusCode).toBe(200);
      expect(statsAfterIngest.json().layers).toContainEqual(
        expect.objectContaining({
          name: "graph_neighborhood",
          evictions: 1,
          size: 0
        })
      );
    } finally {
      await app.close();
    }
  });

  it("inspects cache entries and invalidates a targeted cache key", async () => {
    const app = createApp();
    await app.ready();

    try {
      const queryResponse = await app.inject({
        method: "POST",
        url: "/graph/query",
        payload: {
          query: "Context Pack",
          top_k: 3,
          expand_hops: 1,
          min_edge_confidence: 0.4
        }
      });
      const cacheKey = queryResponse.json().cache.key;
      const keyLookup = await app.inject({
        method: "GET",
        url: `/cache/key/${cacheKey}?layer=retrieval`
      });
      const entries = await app.inject({
        method: "GET",
        url: "/cache/entries?tag=graph&limit=10"
      });
      const invalidate = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        payload: {
          layer: "retrieval",
          key: cacheKey
        }
      });
      const keyLookupAfterInvalidate = await app.inject({
        method: "GET",
        url: `/cache/key/${cacheKey}?layer=retrieval`
      });

      expect(keyLookup.statusCode).toBe(200);
      expect(keyLookup.json()).toMatchObject({
        id: cacheKey,
        hit: true,
        entries: [
          expect.objectContaining({
            layer: "retrieval",
            key: cacheKey,
            tags: expect.arrayContaining(["graph", "retrieval"])
          })
        ]
      });
      expect(entries.json().entries.length).toBeGreaterThanOrEqual(1);
      expect(invalidate.json()).toMatchObject({
        invalidated: true,
        count: 1,
        entries: [
          expect.objectContaining({
            layer: "retrieval",
            key: cacheKey
          })
        ]
      });
      expect(keyLookupAfterInvalidate.json()).toMatchObject({
        hit: false,
        entries: []
      });
    } finally {
      await app.close();
    }
  });

  it("lists context templates and caches prompt segments during composition", async () => {
    const app = createApp();
    await app.ready();

    try {
      const templatesResponse = await app.inject({
        method: "GET",
        url: "/context/templates"
      });

      expect(templatesResponse.statusCode).toBe(200);
      expect(templatesResponse.json().templates).toContainEqual(
        expect.objectContaining({
          id: "implementation:default",
          version: 1
        })
      );

      const payload = {
        objective: "Implement prompt cache",
        agent_id: "main-agent",
        session_id: "test-session",
        task_type: "implementation",
        query: "Context Pack graph schema",
        token_budget: 1200
      };

      const first = await app.inject({
        method: "POST",
        url: "/context/compose",
        headers: {
          "x-neuralmap-run-id": "prompt-cache"
        },
        payload
      });
      const second = await app.inject({
        method: "POST",
        url: "/context/compose",
        headers: {
          "x-neuralmap-run-id": "prompt-cache"
        },
        payload
      });
      const stats = await app.inject({
        method: "GET",
        url: "/cache/stats"
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        template_id: "implementation:default",
        metadata: {
          prompt_segment_cache: {
            layer: "prompt_segment",
            hit: false
          },
          summary_cache: {
            layer: "summary",
            hit: false
          }
        }
      });
      expect(second.json()).toMatchObject({
        metadata: {
          prompt_segment_cache: {
            hit: true
          },
          summary_cache: {
            hit: true
          }
        }
      });
      expect(stats.json().layers).toContainEqual(
        expect.objectContaining({
          name: "prompt_segment",
          hits: 1,
          misses: 1,
          writes: 1
        })
      );
      expect(stats.json().layers).toContainEqual(
        expect.objectContaining({
          name: "summary",
          hits: 1,
          misses: 1,
          writes: 1
        })
      );
    } finally {
      await app.close();
    }
  });

  it("records HTTP request spans for workbench trace inspection", async () => {
    const app = createApp();
    await app.ready();

    try {
      await app.inject({
        method: "GET",
        url: "/health",
        headers: {
          "x-neuralmap-run-id": "http-test"
        }
      });

      const response = await app.inject({
        method: "GET",
        url: "/workbench/runs/http-test/trace"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().spans).toContainEqual(
        expect.objectContaining({
          run_id: "http-test",
          kind: "user_request",
          name: "GET /health"
        })
      );
    } finally {
      await app.close();
    }
  });

  it("caches agent runtime responses from context packs", async () => {
    const app = createApp();
    await app.ready();

    try {
      const contextResponse = await app.inject({
        method: "POST",
        url: "/context/compose",
        payload: {
          objective: "Run cached agent response",
          agent_id: "main-agent",
          session_id: "test-session",
          seed_node_ids: ["node_context_pack_contract"],
          query: "Context Pack",
          token_budget: 1200
        }
      });
      const contextPack = contextResponse.json();
      const payload = {
        task: "Summarize the cached context",
        context_pack_id: contextPack.id,
        model_profile: "deterministic-test"
      };

      const first = await app.inject({
        method: "POST",
        url: "/agents/main-agent/run",
        headers: {
          "x-neuralmap-run-id": "response-cache"
        },
        payload
      });
      const second = await app.inject({
        method: "POST",
        url: "/agents/main-agent/run",
        headers: {
          "x-neuralmap-run-id": "response-cache"
        },
        payload
      });
      const stats = await app.inject({
        method: "GET",
        url: "/cache/stats"
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        status: "completed",
        response: {
          context_pack_id: contextPack.id,
          referenced_node_ids: expect.arrayContaining(["node_context_pack_contract"])
        },
        cache: {
          layer: "response",
          hit: false
        }
      });
      expect(second.json()).toMatchObject({
        id: first.json().id,
        cache: {
          layer: "response",
          hit: true
        }
      });
      expect(stats.json().layers).toContainEqual(
        expect.objectContaining({
          name: "response",
          hits: 1,
          misses: 1,
          writes: 1
        })
      );
    } finally {
      await app.close();
    }
  });

  it("routes model profiles and records quality feedback", async () => {
    const app = createApp();
    await app.ready();

    try {
      const profiles = await app.inject({
        method: "GET",
        url: "/model/profiles"
      });
      const contextResponse = await app.inject({
        method: "POST",
        url: "/context/compose",
        payload: {
          objective: "Debug validation routing",
          agent_id: "main-agent",
          session_id: "test-session",
          seed_node_ids: ["node_context_pack_contract"],
          query: "debug validation failure",
          token_budget: 12000
        }
      });
      const contextPack = contextResponse.json();
      const route = await app.inject({
        method: "POST",
        url: "/model/route",
        payload: {
          objective: "Debug validation routing",
          task: "Investigate failure and validate fix",
          context_pack_id: contextPack.id
        }
      });
      const agentRun = await app.inject({
        method: "POST",
        url: "/agents/main-agent/run",
        payload: {
          task: "Investigate failure and validate fix",
          context_pack_id: contextPack.id
        }
      });
      const feedback = await app.inject({
        method: "POST",
        url: "/model/feedback",
        payload: {
          run_id: agentRun.json().id,
          model_profile: agentRun.json().profile.selected_profile.id,
          score: 0.9,
          signal: "accepted"
        }
      });

      expect(profiles.statusCode).toBe(200);
      expect(profiles.json().profiles).toContainEqual(
        expect.objectContaining({
          id: "balanced-agent"
        })
      );
      expect(route.statusCode).toBe(200);
      expect(route.json()).toMatchObject({
        selected_profile: {
          id: expect.any(String),
          reasoning_effort: expect.any(String)
        },
        task_classification: {
          intent: {
            kind: expect.any(String)
          }
        },
        budget: {
          budget_pressure: expect.any(Number)
        }
      });
      expect(agentRun.json()).toMatchObject({
        profile: {
          selected_profile: {
            id: expect.any(String)
          }
        },
        response: {
          profile_reasoning_effort: expect.any(String)
        }
      });
      expect(feedback.json()).toMatchObject({
        accepted: true,
        summaries: [
          expect.objectContaining({
            profile_id: agentRun.json().profile.selected_profile.id,
            average_score: 0.9,
            feedback_count: 1
          })
        ]
      });
    } finally {
      await app.close();
    }
  });

  it("keeps simulation memory across session continuity context", async () => {
    const app = createApp();
    await app.ready();

    try {
      const firstEvent = await app.inject({
        method: "POST",
        url: "/ingest/simulation-event",
        payload: {
          simulation_id: "char-platform",
          session_id: "session-1",
          event_id: "turn-1",
          actor_id: "aria",
          actor_name: "Aria",
          content: "Aria promises to remember the silver key hidden under the old fountain.",
          importance: 0.92,
          tags: ["promise", "memory"],
          participants: [
            {
              id: "user",
              name: "Traveler",
              role: "player"
            }
          ]
        }
      });
      const secondEvent = await app.inject({
        method: "POST",
        url: "/ingest/simulation-event",
        payload: {
          simulation_id: "char-platform",
          session_id: "session-1",
          event_id: "turn-2",
          previous_event_id: "turn-1",
          actor_id: "user",
          actor_name: "Traveler",
          content: "The Traveler asks Aria to keep the silver key secret until the next meeting.",
          importance: 0.88,
          tags: ["secret", "relationship"]
        }
      });
      const unrelatedEvent = await app.inject({
        method: "POST",
        url: "/ingest/simulation-event",
        payload: {
          simulation_id: "other-platform",
          session_id: "session-1",
          event_id: "turn-1",
          actor_id: "aria",
          actor_name: "Aria",
          content: "A separate simulation says Aria should remember a bronze compass, not the silver key.",
          importance: 0.95,
          tags: ["memory"]
        }
      });

      expect(firstEvent.statusCode).toBe(200);
      expect(secondEvent.statusCode).toBe(200);
      expect(unrelatedEvent.statusCode).toBe(200);
      expect(firstEvent.json()).toMatchObject({
        nodes: 4,
        chunks: 1,
        mode: "sample",
        session_node_id: "simulation:char-platform:session:session-1"
      });
      expect(secondEvent.json().edges).toBeGreaterThanOrEqual(3);

      const continuity = await app.inject({
        method: "POST",
        url: "/simulation/context",
        headers: {
          "x-neuralmap-run-id": "simulation-continuity"
        },
        payload: {
          simulation_id: "char-platform",
          session_id: "session-1",
          new_session_id: "session-2",
          agent_id: "character-agent",
          query: "What must Aria remember about the silver key?",
          token_budget: 1600
        }
      });

      expect(continuity.statusCode).toBe(200);
      expect(continuity.json()).toMatchObject({
        session_node_id: "simulation:char-platform:session:session-1",
        source_session_id: "session-1",
        target_session_id: "session-2",
        pack: {
          session_id: "session-2",
          metadata: {
            simulation_continuity: {
              simulation_id: "char-platform",
              source_session_id: "session-1",
              target_session_id: "session-2"
            }
          }
        }
      });
      expect(continuity.json().pack.node_ids).toEqual(
        expect.arrayContaining([
          "simulation:char-platform:session:session-1",
          "simulation:char-platform:event:turn-1",
          "simulation:char-platform:event:turn-2",
          "simulation:char-platform:person:aria"
        ])
      );
      expect(continuity.json().pack.evidence.map((item: { snippet: string }) => item.snippet).join(" ")).toContain(
        "silver key"
      );
      expect(continuity.json().pack.node_ids).not.toContain("simulation:other-platform:event:turn-1");
      expect(continuity.json().pack.evidence.map((item: { snippet: string }) => item.snippet).join(" ")).not.toContain(
        "bronze compass"
      );

      const agentRun = await app.inject({
        method: "POST",
        url: "/agents/main-agent/run",
        payload: {
          task: "Continue the character simulation without forgetting prior commitments.",
          context_pack_id: continuity.json().pack.id
        }
      });

      expect(agentRun.statusCode).toBe(200);
      expect(agentRun.json().response.referenced_node_ids).toEqual(
        expect.arrayContaining(["simulation:char-platform:event:turn-1"])
      );
    } finally {
      await app.close();
    }
  });

  it("accepts profile-backed graph deltas, current views, and sectioned context without core enum expansion", async () => {
    const app = createApp();
    await app.ready();

    try {
      const profiles = await app.inject({
        method: "GET",
        url: "/profiles"
      });

      expect(profiles.statusCode).toBe(200);
      expect(profiles.json().profiles).toContainEqual(
        expect.objectContaining({
          id: "simulation-memory"
        })
      );
      expect(profiles.json().profiles).toContainEqual(
        expect.objectContaining({
          id: "coding-context"
        })
      );

      const invalid = await app.inject({
        method: "POST",
        url: "/graph/deltas",
        payload: {
          idempotency_key: "bad-character:v1",
          profile_id: "simulation-memory",
          upsert_neurons: [
            {
              id: "char:missing-name",
              labels: ["Character"],
              ontology: {
                profile_id: "simulation-memory",
                type: "Character"
              },
              title: "Missing name",
              properties: {}
            }
          ]
        }
      });

      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({
        error: "profile_validation_failed"
      });

      const firstDelta = await app.inject({
        method: "POST",
        url: "/graph/deltas",
        payload: {
          idempotency_key: "sim-memory:turn-1:v1",
          profile_id: "simulation-memory",
          source: {
            system: "dynamicchat",
            run_id: "run-1",
            turn_id: "turn-1"
          },
          upsert_neurons: [
            {
              id: "char:mina",
              labels: ["Character"],
              ontology: {
                profile_id: "simulation-memory",
                type: "Character"
              },
              title: "Mina",
              summary: "Mina participates in the scene.",
              properties: {
                name: "Mina"
              }
            },
            {
              id: "state:mina:wearing:t1",
              labels: ["State", "TemporalFact"],
              ontology: {
                profile_id: "simulation-memory",
                type: "State"
              },
              title: "Mina wearing state",
              summary: "Mina is wearing an old hoodie.",
              valid_from: "turn-1",
              valid_to: null,
              properties: {
                owner_id: "char:mina",
                state_type: "Wearing",
                value: "old hoodie"
              }
            }
          ],
          upsert_synapses: [
            {
              from: "char:mina",
              to: "state:mina:wearing:t1",
              type: "HAS_CURRENT_STATE",
              ontology: {
                profile_id: "simulation-memory",
                type: "HAS_CURRENT_STATE"
              },
              properties: {
                current_pointer_key: "char:mina:Wearing"
              }
            }
          ]
        }
      });

      expect(firstDelta.statusCode).toBe(200);
      expect(firstDelta.json()).toMatchObject({
        accepted: true,
        idempotent_replay: false,
        profile_id: "simulation-memory",
        persistence: {
          nodes: 2,
          mode: "sample"
        }
      });

      const secondPayload = {
        idempotency_key: "sim-memory:turn-2:v1",
        profile_id: "simulation-memory",
        source: {
          system: "dynamicchat",
          run_id: "run-1",
          turn_id: "turn-2"
        },
        upsert_neurons: [
          {
            id: "state:mina:wearing:t2",
            labels: ["State", "TemporalFact"],
            ontology: {
              profile_id: "simulation-memory",
              type: "State"
            },
            title: "Mina wearing state",
            summary: "Mina is wearing a navy coat.",
            valid_from: "turn-2",
            valid_to: null,
            properties: {
              owner_id: "char:mina",
              state_type: "Wearing",
              value: "navy coat"
            }
          }
        ],
        upsert_synapses: [
          {
            from: "char:mina",
            to: "state:mina:wearing:t2",
            type: "HAS_CURRENT_STATE",
            ontology: {
              profile_id: "simulation-memory",
              type: "HAS_CURRENT_STATE"
            },
            properties: {
              current_pointer_key: "char:mina:Wearing"
            }
          }
        ],
        temporal_operations: [
          {
            operation: "supersede_current",
            selector: {
              label: "State",
              properties: {
                owner_id: "char:mina",
                state_type: "Wearing"
              }
            },
            valid_to: "turn-2",
            superseded_by: "state:mina:wearing:t2"
          }
        ]
      };

      const secondDelta = await app.inject({
        method: "POST",
        url: "/graph/deltas",
        payload: secondPayload
      });
      const secondReplay = await app.inject({
        method: "POST",
        url: "/graph/deltas",
        payload: secondPayload
      });
      const secondConflict = await app.inject({
        method: "POST",
        url: "/graph/deltas",
        payload: {
          ...secondPayload,
          upsert_neurons: [
            {
              id: "state:mina:wearing:t2-conflict",
              labels: ["State", "TemporalFact"],
              ontology: {
                profile_id: "simulation-memory",
                type: "State"
              },
              title: "Conflicting wearing state",
              summary: "This conflicting replay should be rejected.",
              valid_from: "turn-2",
              valid_to: null,
              properties: {
                owner_id: "char:mina",
                state_type: "Wearing",
                value: "red coat"
              }
            }
          ]
        }
      });

      expect(secondDelta.statusCode).toBe(200);
      expect(secondDelta.json()).toMatchObject({
        accepted: true,
        idempotent_replay: false,
        request_hash: expect.any(String),
        delta: {
          temporal_updates: 1
        }
      });
      expect(secondReplay.json()).toMatchObject({
        accepted: true,
        idempotent_replay: true
      });
      expect(secondConflict.statusCode).toBe(409);
      expect(secondConflict.json()).toMatchObject({
        error: "idempotency_key_conflict"
      });

      const oldState = await app.inject({
        method: "GET",
        url: "/graph/nodes/state:mina:wearing:t1"
      });
      const currentView = await app.inject({
        method: "POST",
        url: "/graph/views/current",
        payload: {
          profile_id: "simulation-memory",
          label: "State",
          current_key: ["properties.owner_id", "properties.state_type"],
          filters: {
            owner_id: "char:mina"
          }
        }
      });
      const neuronQuery = await app.inject({
        method: "POST",
        url: "/graph/neurons/query",
        payload: {
          profile_id: "simulation-memory",
          labels: ["State"],
          query: "navy coat",
          top_k: 5
        }
      });
      const context = await app.inject({
        method: "POST",
        url: "/context/compose",
        payload: {
          objective: "Continue the simulation scene",
          agent_id: "simulation-agent",
          session_id: "scene-1",
          profile_id: "simulation-memory",
          query: "Mina wearing navy coat",
          token_budget: 1200,
          context_policy: {
            sections: ["canonical_state", "relevant_history"]
          }
        }
      });

      expect(oldState.json()).toMatchObject({
        id: "state:mina:wearing:t1",
        valid_to: "turn-2"
      });
      expect(currentView.json().items).toEqual([
        expect.objectContaining({
          id: "state:mina:wearing:t2",
          current_key: "char:mina:Wearing",
          properties: expect.objectContaining({
            value: "navy coat"
          })
        })
      ]);
      expect(neuronQuery.json().nodes.map((node: { id: string }) => node.id)).toContain("state:mina:wearing:t2");
      expect(context.json()).toMatchObject({
        metadata: {
          profile_id: "simulation-memory",
          context_policy: {
            sections: ["canonical_state", "relevant_history"]
          }
        },
        sections: {
          canonical_state: expect.arrayContaining([
            expect.objectContaining({
              node_id: "state:mina:wearing:t2"
            })
          ])
        }
      });
    } finally {
      await app.close();
    }
  });

  it("stores activation-aware content modules and keeps tenant scopes isolated", async () => {
    const app = createApp();
    await app.ready();

    try {
      const tenantAHeaders = { "x-neuralmap-tenant-id": "tenant-a" };
      const tenantBHeaders = { "x-neuralmap-tenant-id": "tenant-b" };

      await app.inject({
        method: "POST",
        url: "/content/modules",
        headers: tenantAHeaders,
        payload: {
          id: "tutor-guide",
          title: "Tutor Guide",
          body: "Use patient tutoring examples for step-by-step learner support.",
          activation_tags: ["tutoring"],
          priority: 0.95
        }
      });
      await app.inject({
        method: "POST",
        url: "/content/modules",
        headers: tenantAHeaders,
        payload: {
          id: "disabled-guide",
          title: "Disabled Tutor Guide",
          body: "This disabled guide should not be selected.",
          activation_tags: ["tutoring"],
          enabled: false,
          priority: 1
        }
      });
      await app.inject({
        method: "POST",
        url: "/content/modules",
        headers: tenantBHeaders,
        payload: {
          id: "tenant-b-guide",
          title: "Tenant B Guide",
          body: "Tenant B tutoring material must not leak to tenant A.",
          activation_tags: ["tutoring"],
          priority: 0.99
        }
      });

      const query = await app.inject({
        method: "POST",
        url: "/content/modules/query",
        headers: tenantAHeaders,
        payload: {
          query: "patient tutoring examples",
          activation_tags: ["tutoring"]
        }
      });

      expect(query.statusCode).toBe(200);
      expect(query.json().modules).toContain("module:tutor-guide");
      expect(query.json().modules).not.toContain("module:disabled-guide");
      expect(query.json().modules).not.toContain("module:tenant-b-guide");
      expect(query.json().content_modules).toContainEqual(
        expect.objectContaining({
          module_id: "tutor-guide",
          activation_score: 1
        })
      );
    } finally {
      await app.close();
    }
  });

  it("enforces scoped graph retrieval and redaction across cache-backed queries", async () => {
    const app = createApp();
    await app.ready();

    try {
      await app.inject({
        method: "POST",
        url: "/ingest/ticket",
        headers: { "x-neuralmap-tenant-id": "tenant-a" },
        payload: {
          id: "TENANT-A",
          title: "Tenant A secret",
          url: "linear://TENANT-A",
          body: "Tenant A retrieval should include the sapphire marker.",
          status: "open"
        }
      });
      await app.inject({
        method: "POST",
        url: "/ingest/ticket",
        headers: { "x-neuralmap-tenant-id": "tenant-b" },
        payload: {
          id: "TENANT-B",
          title: "Tenant B secret",
          url: "linear://TENANT-B",
          body: "Tenant B retrieval should include the copper marker.",
          status: "open"
        }
      });

      const tenantAQuery = await app.inject({
        method: "POST",
        url: "/graph/query",
        headers: { "x-neuralmap-tenant-id": "tenant-a" },
        payload: {
          query: "sapphire marker",
          top_k: 5,
          expand_hops: 1,
          min_edge_confidence: 0.4
        }
      });
      const tenantBQuery = await app.inject({
        method: "POST",
        url: "/graph/query",
        headers: { "x-neuralmap-tenant-id": "tenant-b" },
        payload: {
          query: "marker",
          top_k: 5,
          expand_hops: 1,
          min_edge_confidence: 0.4
        }
      });

      expect(tenantAQuery.json().neighborhood.nodes.map((node: { id: string }) => node.id)).toContain("ticket:TENANT-A");
      expect(tenantAQuery.json().neighborhood.nodes.map((node: { id: string }) => node.id)).not.toContain(
        "ticket:TENANT-B"
      );
      expect(tenantBQuery.json().neighborhood.nodes.map((node: { id: string }) => node.id)).toContain("ticket:TENANT-B");

      const redaction = await app.inject({
        method: "POST",
        url: "/privacy/redactions",
        headers: { "x-neuralmap-tenant-id": "tenant-a" },
        payload: {
          node_ids: ["ticket:TENANT-A"],
          reason: "tenant requested deletion"
        }
      });
      const afterRedaction = await app.inject({
        method: "POST",
        url: "/graph/query",
        headers: { "x-neuralmap-tenant-id": "tenant-a" },
        payload: {
          query: "sapphire marker",
          top_k: 5,
          expand_hops: 1,
          min_edge_confidence: 0.4
        }
      });

      expect(redaction.json()).toMatchObject({
        redacted: true,
        nodes: 1
      });
      expect(afterRedaction.json().neighborhood.nodes.map((node: { id: string }) => node.id)).not.toContain(
        "ticket:TENANT-A"
      );
    } finally {
      await app.close();
    }
  });

  it("consolidates event memories into compact context with evidence links", async () => {
    const app = createApp();
    await app.ready();

    try {
      await app.inject({
        method: "POST",
        url: "/ingest/simulation-event",
        payload: {
          simulation_id: "workflow",
          session_id: "session-c",
          event_id: "event-1",
          content: "The operator decided to keep the blue deployment path. The team must verify rollback.",
          importance: 0.94
        }
      });
      await app.inject({
        method: "POST",
        url: "/ingest/simulation-event",
        payload: {
          simulation_id: "workflow",
          session_id: "session-c",
          event_id: "event-2",
          content: "The operator confirmed the blue deployment path is active now.",
          importance: 0.88
        }
      });

      const consolidation = await app.inject({
        method: "POST",
        url: "/memory/consolidate",
        payload: {
          session_id: "session-c"
        }
      });
      const context = await app.inject({
        method: "POST",
        url: "/context/compose",
        payload: {
          objective: "Resume deployment workflow",
          agent_id: "ops-agent",
          session_id: "session-d",
          query: "blue deployment rollback",
          token_budget: 1200
        }
      });

      expect(consolidation.statusCode).toBe(200);
      expect(consolidation.json().source_event_ids).toEqual(
        expect.arrayContaining(["simulation:workflow:event:event-1", "simulation:workflow:event:event-2"])
      );
      expect(consolidation.json().token_savings.raw_tokens_estimate).toBeGreaterThan(0);
      expect(context.json().node_ids.some((nodeId: string) => nodeId.includes("summary:session-c:rolling"))).toBe(true);
      expect(context.json().node_ids).not.toContain("simulation:workflow:event:event-1");
    } finally {
      await app.close();
    }
  });

  it("registers agents, composes per-agent context, validates writes, and exposes embedding backfill controls", async () => {
    const app = createApp();
    await app.ready();

    try {
      const agent = await app.inject({
        method: "POST",
        url: "/agents",
        payload: {
          id: "docs-agent",
          role: "documentation",
          model_profile: "fast-context",
          context_budget: 900,
          permissions: ["read:graph", "write:proposed_memory"],
          output_contract: {
            format: "markdown"
          }
        }
      });
      const context = await app.inject({
        method: "POST",
        url: "/agents/docs-agent/context",
        payload: {
          objective: "Document the context contract",
          session_id: "agent-session",
          query: "Context Pack",
          token_budget: 5000
        }
      });
      const validation = await app.inject({
        method: "POST",
        url: "/agents/docs-agent/memory-writes/validate",
        payload: {
          candidates: [
            {
              node: {
                id: "memory:docs-agent:validated",
                type: "Summary",
                title: "Validated docs memory",
                summary: "Context Pack docs should cite source node evidence.",
                source_system: "runtime",
                trust_score: 0.8,
                freshness_score: 1,
                importance_score: 0.7,
                created_at: "2026-05-04T00:00:00.000Z",
                updated_at: "2026-05-04T00:00:00.000Z",
                metadata: {
                  evidence_node_ids: ["node_context_pack_contract"]
                }
              },
              evidence_node_ids: ["node_context_pack_contract"]
            }
          ]
        }
      });
      const transition = await app.inject({
        method: "POST",
        url: "/agents/docs-agent/runs/run-1/state",
        payload: {
          from: "planned",
          to: "running"
        }
      });
      const health = await app.inject({
        method: "GET",
        url: "/embeddings/health"
      });
      const backfill = await app.inject({
        method: "POST",
        url: "/embeddings/backfill",
        payload: {
          dry_run: true,
          limit: 5
        }
      });

      expect(agent.json()).toMatchObject({
        id: "docs-agent",
        context_budget: 900
      });
      expect(context.json()).toMatchObject({
        pack: {
          agent_id: "docs-agent",
          token_budget: 900
        }
      });
      expect(validation.json()).toMatchObject({
        accepted: [
          expect.objectContaining({
            node: expect.objectContaining({
              id: "memory:docs-agent:validated"
            })
          })
        ],
        rejected: []
      });
      expect(transition.json()).toMatchObject({
        previous_status: "planned",
        status: "running"
      });
      expect(health.json()).toMatchObject({
        provider: {
          model: expect.any(String)
        },
        nodes: {
          total: expect.any(Number),
          coverage: expect.any(Number)
        }
      });
      expect(backfill.json()).toMatchObject({
        dry_run: true,
        validated: true
      });
    } finally {
      await app.close();
    }
  });

  it("creates handoff packs from saved context packs and records domain spans", async () => {
    const app = createApp();
    await app.ready();

    try {
      const contextResponse = await app.inject({
        method: "POST",
        url: "/context/compose",
        headers: {
          "x-neuralmap-run-id": "context-loop"
        },
        payload: {
          objective: "Prepare a context handoff",
          agent_id: "main-agent",
          session_id: "test-session",
          seed_node_ids: ["node_context_pack_contract"],
          query: "Context Pack",
          token_budget: 1200
        }
      });
      const contextPack = contextResponse.json();

      const refreshResponse = await app.inject({
        method: "POST",
        url: `/context/packs/${contextPack.id}/refresh`,
        headers: {
          "x-neuralmap-run-id": "context-loop"
        },
        payload: {
          query: "Graph schema",
          token_budget: 1400
        }
      });
      const refreshedContextPack = refreshResponse.json().pack;

      expect(refreshResponse.statusCode).toBe(200);
      expect(refreshResponse.json().previous_pack_id).toBe(contextPack.id);
      expect(refreshedContextPack.id).not.toBe(contextPack.id);
      expect(refreshedContextPack.token_budget).toBe(1400);
      expect(refreshedContextPack.metadata.source_run_id).toBe("context-loop");

      const refreshTimelineResponse = await app.inject({
        method: "GET",
        url: "/workbench/timeline?run_id=context-loop&limit=10"
      });

      expect(refreshTimelineResponse.statusCode).toBe(200);
      expect(refreshTimelineResponse.json().events).toContainEqual(
        expect.objectContaining({
          kind: "context_pack",
          context_pack_id: refreshedContextPack.id,
          run_id: "context-loop"
        })
      );

      const handoffResponse = await app.inject({
        method: "POST",
        url: "/context/handoff",
        headers: {
          "x-neuralmap-run-id": "context-loop"
        },
        payload: {
          from_run_id: "context-loop",
          context_pack_id: refreshedContextPack.id,
          objective: refreshedContextPack.objective,
          current_status: "Context is ready for the next session.",
          recommended_next_actions: ["Resume from the referenced nodes."]
        }
      });

      expect(handoffResponse.statusCode).toBe(200);
      expect(handoffResponse.json().referenced_node_ids).toContain("node_context_pack_contract");
      expect(handoffResponse.json()).toMatchObject({
        metadata: {
          context_pack_id: refreshedContextPack.id
        }
      });

      const handoffLookup = await app.inject({
        method: "GET",
        url: `/context/handoffs/${handoffResponse.json().id}`
      });
      const artifactsResponse = await app.inject({
        method: "GET",
        url: "/workbench/artifacts?limit=5"
      });
      const relationshipResponse = await app.inject({
        method: "GET",
        url: `/workbench/artifacts/handoffs/${handoffResponse.json().id}/relationship`
      });
      const timelineResponse = await app.inject({
        method: "GET",
        url: "/workbench/timeline?run_id=context-loop&limit=20"
      });

      expect(handoffLookup.statusCode).toBe(200);
      expect(handoffLookup.json().id).toBe(handoffResponse.json().id);
      expect(artifactsResponse.statusCode).toBe(200);
      expect(relationshipResponse.statusCode).toBe(200);
      expect(timelineResponse.statusCode).toBe(200);
      expect(relationshipResponse.json()).toMatchObject({
        context_pack_id: refreshedContextPack.id,
        context_artifact_id: `artifact:context:${refreshedContextPack.id}`,
        handoff_pack_id: handoffResponse.json().id,
        handoff_artifact_id: `artifact:handoff:${handoffResponse.json().id}`,
        from_run_id: "context-loop"
      });
      expect(artifactsResponse.json().context_packs).toContainEqual(
        expect.objectContaining({
          id: refreshedContextPack.id
        })
      );
      expect(artifactsResponse.json().handoff_packs).toContainEqual(
        expect.objectContaining({
          id: handoffResponse.json().id
        })
      );
      expect(artifactsResponse.json().relationships).toContainEqual(
        expect.objectContaining({
          context_pack_id: refreshedContextPack.id,
          context_artifact_id: `artifact:context:${refreshedContextPack.id}`,
          handoff_pack_id: handoffResponse.json().id,
          handoff_artifact_id: `artifact:handoff:${handoffResponse.json().id}`,
          from_run_id: "context-loop",
          referenced_node_ids: expect.arrayContaining(["node_context_pack_contract"])
        })
      );
      expect(timelineResponse.json().events).toContainEqual(
        expect.objectContaining({
          kind: "context_pack",
          context_pack_id: refreshedContextPack.id,
          node_ids: expect.arrayContaining(["node_context_pack_contract"])
        })
      );
      expect(timelineResponse.json().events).toContainEqual(
        expect.objectContaining({
          kind: "artifact_relationship",
          context_pack_id: refreshedContextPack.id,
          handoff_pack_id: handoffResponse.json().id,
          relationship_id: `relationship:${refreshedContextPack.id}:handoff:${handoffResponse.json().id}`
        })
      );
      expect(timelineResponse.json().events).toContainEqual(
        expect.objectContaining({
          kind: "trace_span",
          run_id: "context-loop",
          span_kind: "context_pack"
        })
      );
      expect(timelineResponse.json().events).toEqual(
        [...timelineResponse.json().events].sort((a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at))
      );

      const graphResponse = await app.inject({
        method: "GET",
        url: "/workbench/graph/subgraph"
      });
      const graph = graphResponse.json();
      const contextArtifactId = `artifact:context:${refreshedContextPack.id}`;
      const handoffArtifactId = `artifact:handoff:${handoffResponse.json().id}`;

      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          id: contextArtifactId,
          type: "Artifact"
        })
      );
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          id: handoffArtifactId,
          type: "Artifact"
        })
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: contextArtifactId,
          to: "node_context_pack_contract",
          type: "references"
        })
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: handoffArtifactId,
          to: "node_context_pack_contract",
          type: "references"
        })
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: contextArtifactId,
          to: handoffArtifactId,
          type: "handed_off_to",
          source_run_id: "context-loop",
          metadata: expect.objectContaining({
            context_pack_id: refreshedContextPack.id,
            handoff_pack_id: handoffResponse.json().id
          })
        })
      );

      const traceResponse = await app.inject({
        method: "GET",
        url: "/workbench/runs/context-loop/trace"
      });
      const spanKinds = traceResponse.json().spans.map((span: { kind: string }) => span.kind);

      expect(spanKinds).toContain("context_pack");
      expect(spanKinds).toContain("handoff");
    } finally {
      await app.close();
    }
  });
});
