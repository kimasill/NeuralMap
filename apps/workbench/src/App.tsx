import type { GraphEdge, GraphNode, TraceSpan } from "@neuralmap/schema";
import {
  Activity,
  AlertCircle,
  Archive,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock,
  Database,
  Eye,
  EyeOff,
  FileText,
  GitBranch,
  Gauge,
  Info,
  Layers,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Star,
  Trash2
} from "lucide-react";
import { type Dispatch, type FormEvent, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";

import {
  applyWorkbenchScope,
  composeContextPack,
  createHandoffPack,
  fetchCacheDashboard,
  fetchAgents,
  fetchRunTrace,
  fetchModelProfiles,
  fetchWorkbenchArtifacts,
  fetchWorkbenchGraph,
  fetchWorkbenchTimeline,
  invalidateCache,
  queryGraph,
  refreshContextPack,
  routeModelProfile,
  sendModelFeedback,
  type WorkbenchScopeField,
  WORKBENCH_SCOPE,
  WORKBENCH_RUN_ID
} from "./api.js";
import { GraphCanvas } from "./GraphCanvas.js";
import type {
  AgentSummary,
  CacheDashboard,
  CacheInvalidateInput,
  CacheLayerName,
  ComposeContextInput,
  ContextNodeExplanation,
  ContextPack,
  GraphQueryResult,
  HandoffPack,
  HandoffRelationship,
  ModelProfilesDashboard,
  ModelRouteDecision,
  RunTrace,
  WorkbenchArtifacts,
  WorkbenchGraph,
  WorkbenchTimeline,
  WorkbenchTimelineEvent
} from "./types.js";

const defaultObjective = "Continue Phase 1 Memory Backbone";
const workbenchSessionId = "workbench-session";
const defaultGraphFilters: GraphViewFilters = {
  nodeTypes: [],
  sourceSystems: [],
  minImportance: 0,
  minConfidence: 0,
  maxNodes: 180,
  showArtifacts: true,
  groupBy: "type"
};

type GraphGroupMode = "none" | "type" | "source";

interface GraphViewFilters {
  nodeTypes: string[];
  sourceSystems: string[];
  minImportance: number;
  minConfidence: number;
  maxNodes: number;
  showArtifacts: boolean;
  groupBy: GraphGroupMode;
}

interface GraphGroupRow {
  id: string;
  label: string;
  nodeCount: number;
  edgeCount: number;
  averageImportance: number;
}

interface GraphViewState {
  graph: WorkbenchGraph;
  nodeIds: Set<string>;
  availableTypes: string[];
  availableSources: string[];
  groupRows: GraphGroupRow[];
  stats: {
    totalNodes: number;
    visibleNodes: number;
    totalEdges: number;
    visibleEdges: number;
  };
}

type AgentConnectionMode = "direct" | "scope" | "empty";

interface AgentDataView {
  agentId: string;
  graph: WorkbenchGraph;
  nodes: GraphNode[];
  edges: GraphEdge[];
  contextPacks: ContextPack[];
  handoffPacks: HandoffPack[];
  timelineEvents: WorkbenchTimelineEvent[];
  nodeIds: Set<string>;
  mode: AgentConnectionMode;
  exactNodeCount: number;
  typeRows: GraphGroupRow[];
  sourceRows: GraphGroupRow[];
}

export function App() {
  const [graph, setGraph] = useState<WorkbenchGraph | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [timeline, setTimeline] = useState<WorkbenchTimeline | null>(null);
  const [artifacts, setArtifacts] = useState<WorkbenchArtifacts | null>(null);
  const [cacheDashboard, setCacheDashboard] = useState<CacheDashboard | null>(null);
  const [profileDashboard, setProfileDashboard] = useState<ModelProfilesDashboard | null>(null);
  const [profileDecision, setProfileDecision] = useState<ModelRouteDecision | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [objective, setObjective] = useState(defaultObjective);
  const [queryResult, setQueryResult] = useState<GraphQueryResult | null>(null);
  const [contextPack, setContextPack] = useState<ContextPack | null>(null);
  const [handoffPack, setHandoffPack] = useState<HandoffPack | null>(null);
  const [graphFilters, setGraphFilters] = useState<GraphViewFilters>(defaultGraphFilters);
  const [cacheLayerFilter, setCacheLayerFilter] = useState<CacheLayerName | "all">("all");
  const [cacheTagFilter, setCacheTagFilter] = useState("graph");
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isRefreshingContext, setIsRefreshingContext] = useState(false);
  const [isCreatingHandoff, setIsCreatingHandoff] = useState(false);
  const [isInvalidatingCache, setIsInvalidatingCache] = useState(false);
  const [isRoutingProfile, setIsRoutingProfile] = useState(false);
  const [isSendingProfileFeedback, setIsSendingProfileFeedback] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>("inspector");
  const [activityOpen, setActivityOpen] = useState(false);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const agentDataById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, createAgentDataView(agent, graph, artifacts, timeline)])),
    [agents, artifacts, graph, timeline]
  );
  const selectedAgentData = selectedAgent ? agentDataById.get(selectedAgent.id) ?? null : null;
  const activeGraph = selectedAgentData?.graph ?? graph;
  const graphView = useMemo(
    () => createGraphView(activeGraph, graphFilters),
    [activeGraph, graphFilters]
  );
  const selectedNode = useMemo(
    () => activeGraph?.nodes.find((node) => node.id === selectedNodeId) ?? graphView.graph.nodes[0] ?? activeGraph?.nodes[0] ?? null,
    [activeGraph, graphView.graph.nodes, selectedNodeId]
  );
  const nodesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph]
  );
  const selectedNodeExplanation = useMemo(
    () => (selectedNode ? getContextNodeExplanation(contextPack, selectedNode.id) : null),
    [contextPack, selectedNode]
  );

  const filteredNodes = useMemo(() => {
    if (query.trim().length === 0) {
      return [];
    }

    const normalized = query.trim().toLowerCase();
    return graphView.graph.nodes
      .filter((node) => `${node.title} ${node.type} ${node.summary ?? ""}`.toLowerCase().includes(normalized))
      .slice(0, 5);
  }, [graphView.graph.nodes, query]);

  const focusedNodeIds = useMemo(() => {
    if (!queryResult) {
      return [];
    }

    return queryResult.neighborhood.nodes
      .map((node) => node.id)
      .filter((nodeId) => graphView.nodeIds.has(nodeId));
  }, [graphView.nodeIds, queryResult]);
  const focusedEdgeIds = useMemo(() => {
    if (!queryResult) {
      return [];
    }

    const visibleEdgeIds = new Set(graphView.graph.edges.map((edge) => edge.id));
    return queryResult.neighborhood.edges
      .map((edge) => edge.id)
      .filter((edgeId) => visibleEdgeIds.has(edgeId));
  }, [graphView.graph.edges, queryResult]);

  useEffect(() => {
    if (!activeGraph) {
      return;
    }
    if (selectedNodeId && graphView.nodeIds.has(selectedNodeId)) {
      return;
    }

    setSelectedNodeId(graphView.graph.nodes[0]?.id ?? activeGraph.nodes[0]?.id ?? null);
  }, [activeGraph, graphView.graph.nodes, graphView.nodeIds, selectedNodeId]);

  const loadWorkbench = useCallback(async () => {
    const [nextGraph, nextAgents, nextTrace, nextArtifacts, nextTimeline, nextCacheDashboard, nextProfileDashboard] = await Promise.all([
      fetchWorkbenchGraph(),
      fetchAgents(),
      fetchRunTrace(WORKBENCH_RUN_ID),
      fetchWorkbenchArtifacts(),
      fetchWorkbenchTimeline(WORKBENCH_RUN_ID),
      fetchCacheDashboard(),
      fetchModelProfiles()
    ]);
    setGraph(nextGraph);
    setAgents(nextAgents);
    setTrace(nextTrace);
    setArtifacts(nextArtifacts);
    setTimeline(nextTimeline);
    setCacheDashboard(nextCacheDashboard);
    setProfileDashboard(nextProfileDashboard);
    setSelectedNodeId((current) => current ?? nextGraph.nodes[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  useEffect(() => {
    if (selectedAgentId && agents.length > 0 && !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [agents, selectedAgentId]);

  const refreshTrace = useCallback(async (runId = WORKBENCH_RUN_ID) => {
    const [nextTrace, nextTimeline] = await Promise.all([fetchRunTrace(runId), fetchWorkbenchTimeline(runId)]);
    setTrace(nextTrace);
    setTimeline(nextTimeline);
  }, []);

  const refreshArtifacts = useCallback(async () => {
    setArtifacts(await fetchWorkbenchArtifacts());
  }, []);

  const refreshCacheDashboard = useCallback(async () => {
    setCacheDashboard(await fetchCacheDashboard());
  }, []);

  const refreshProfileDashboard = useCallback(async () => {
    setProfileDashboard(await fetchModelProfiles());
  }, []);

  const handleSelectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setSelectedNodeId(null);
    setQuery("");
    setQueryResult(null);
    setHandoffPack(null);
    setGraphFilters(defaultGraphFilters);
    setRailTab("inspector");
  }, []);

  const handleBackToRoster = useCallback(() => {
    setSelectedAgentId(null);
    setQueryResult(null);
    setHandoffPack(null);
  }, []);

  const handleRouteProfile = useCallback(
    async (pack: ContextPack | null = contextPack) => {
      setIsRoutingProfile(true);
      setProfileMessage(null);
      setOperationError(null);

      try {
        const decision = await routeModelProfile({
          objective,
          task: query.trim() || objective,
          query: query.trim() || undefined,
          context_pack_id: pack?.id,
          token_budget: pack?.token_budget ?? selectedAgent?.token_budget ?? agents[0]?.token_budget
        });
        setProfileDecision(decision);
      } catch (error) {
        setOperationError(toErrorMessage(error));
      } finally {
        setIsRoutingProfile(false);
      }
    },
    [agents, contextPack, objective, query, selectedAgent]
  );

  const handleSendProfileFeedback = useCallback(
    async (score: number) => {
      if (!profileDecision) {
        return;
      }

      setIsSendingProfileFeedback(true);
      setProfileMessage(null);
      setOperationError(null);

      try {
        const result = await sendModelFeedback({
          run_id: contextPack?.id ?? `profile_feedback_${Date.now()}`,
          model_profile: profileDecision.selected_profile.id,
          score,
          signal: score >= 0.75 ? "accepted" : "needs_review"
        });
        setProfileMessage(result ? `Feedback ${Math.round(score * 100)}%` : "Feedback unavailable");
        await refreshProfileDashboard();
      } catch (error) {
        setOperationError(toErrorMessage(error));
      } finally {
        setIsSendingProfileFeedback(false);
      }
    },
    [contextPack?.id, profileDecision, refreshProfileDashboard]
  );

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleRunQuery = useCallback(async () => {
    const activeQuery = query.trim() || selectedNode?.title;
    if (!activeQuery) {
      return;
    }

    setIsQuerying(true);
    setOperationError(null);

    try {
      const result = await queryGraph({
        query: activeQuery,
        top_k: 8,
        expand_hops: 1,
        min_edge_confidence: 0.4
      });
      setQueryResult(result);
      setSelectedNodeId(result.seeds[0]?.node.id ?? result.neighborhood.nodes[0]?.id ?? selectedNode?.id ?? null);
      await Promise.all([refreshTrace(), refreshCacheDashboard()]);
    } catch (error) {
      setOperationError(toErrorMessage(error));
    } finally {
      setIsQuerying(false);
    }
  }, [query, refreshCacheDashboard, refreshTrace, selectedNode?.id, selectedNode?.title]);

  const handleComposeContext = useCallback(async () => {
    const activeQuery = query.trim() || selectedNode?.title;
    const seedNodeIds = unique([
      selectedNode?.id,
      ...(queryResult?.neighborhood.seed_node_ids ?? [])
    ]);

    setIsComposing(true);
    setOperationError(null);

    try {
      const input: ComposeContextInput = {
        objective,
        agent_id: selectedAgent?.id ?? agents[0]?.id ?? "main-agent",
        session_id: workbenchSessionId,
        task_type: "implementation",
        token_budget: selectedAgent?.token_budget ?? agents[0]?.token_budget ?? 8000,
        seed_node_ids: seedNodeIds
      };
      if (activeQuery) {
        input.query = activeQuery;
      }

      const pack = await composeContextPack(input);
      setContextPack(pack);
      setHandoffPack(null);
      await Promise.all([refreshTrace(), refreshArtifacts(), refreshCacheDashboard(), handleRouteProfile(pack)]);
    } catch (error) {
      setOperationError(toErrorMessage(error));
    } finally {
      setIsComposing(false);
    }
  }, [agents, handleRouteProfile, objective, query, queryResult, refreshArtifacts, refreshCacheDashboard, refreshTrace, selectedAgent, selectedNode?.id, selectedNode?.title]);

  const handleCreateHandoff = useCallback(async () => {
    if (!contextPack) {
      return;
    }

    setIsCreatingHandoff(true);
    setOperationError(null);

    try {
      const pack = await createHandoffPack({
        from_run_id: WORKBENCH_RUN_ID,
        to_session_id: "workbench-followup",
        context_pack_id: contextPack.id,
        objective: contextPack.objective,
        current_status: `Context pack ${contextPack.id} is ready with ${contextPack.evidence.length} evidence items.`,
        open_loops: ["Review evidence coverage before resuming."],
        constraints: ["Keep durable memory in the graph backbone."],
        recommended_next_actions: ["Resume from the referenced node set."]
      });
      setHandoffPack(pack);
      await Promise.all([refreshTrace(), refreshArtifacts(), refreshCacheDashboard()]);
    } catch (error) {
      setOperationError(toErrorMessage(error));
    } finally {
      setIsCreatingHandoff(false);
    }
  }, [contextPack, refreshArtifacts, refreshCacheDashboard, refreshTrace]);

  const handleRefreshContext = useCallback(async () => {
    if (!contextPack) {
      return;
    }

    const activeQuery = query.trim() || contextPack.objective;
    setIsRefreshingContext(true);
    setOperationError(null);

    try {
      const result = await refreshContextPack(contextPack.id, {
        objective,
        query: activeQuery,
        seed_node_ids: unique([selectedNode?.id, ...contextPack.node_ids]),
        token_budget: contextPack.token_budget
      });
      setContextPack(result.pack);
      setHandoffPack(null);
      await Promise.all([refreshTrace(), refreshArtifacts(), refreshCacheDashboard(), handleRouteProfile(result.pack)]);
    } catch (error) {
      setOperationError(toErrorMessage(error));
    } finally {
      setIsRefreshingContext(false);
    }
  }, [contextPack, handleRouteProfile, objective, query, refreshArtifacts, refreshCacheDashboard, refreshTrace, selectedNode?.id]);

  const handleSelectContextPack = useCallback((pack: ContextPack) => {
    setContextPack(pack);
    setHandoffPack(null);
    setObjective(pack.objective);
    setSelectedNodeId(pack.evidence[0]?.node_id ?? pack.node_ids[0] ?? null);
    void handleRouteProfile(pack);
  }, [handleRouteProfile]);

  const handleSelectHandoffPack = useCallback(
    (pack: HandoffPack) => {
      const relationship = (artifacts?.relationships ?? []).find((candidate) => candidate.handoff_pack_id === pack.id);
      const sourceContextPackId = relationship?.context_pack_id ?? getHandoffSourceContextPackId(pack);
      const sourceContextPack = sourceContextPackId
        ? artifacts?.context_packs.find((candidate) => candidate.id === sourceContextPackId)
        : undefined;

      setHandoffPack(pack);
      setObjective(sourceContextPack?.objective ?? pack.objective);
      setSelectedNodeId(pack.referenced_node_ids[0] ?? null);
      if (sourceContextPack) {
        setContextPack(sourceContextPack);
      }

      void refreshTrace(pack.from_run_id)
        .catch((error: unknown) => setOperationError(toErrorMessage(error)));
    },
    [artifacts, refreshTrace]
  );

  const handleSelectTimelineEvent = useCallback(
    (event: WorkbenchTimelineEvent) => {
      const handoff = event.handoff_pack_id
        ? artifacts?.handoff_packs.find((pack) => pack.id === event.handoff_pack_id)
        : undefined;
      if (handoff) {
        handleSelectHandoffPack(handoff);
        return;
      }

      const context = event.context_pack_id
        ? artifacts?.context_packs.find((pack) => pack.id === event.context_pack_id)
        : undefined;
      if (context) {
        handleSelectContextPack(context);
        return;
      }

      if (event.node_ids[0]) {
        handleSelectNode(event.node_ids[0]);
      }
    },
    [artifacts, handleSelectContextPack, handleSelectHandoffPack, handleSelectNode]
  );

  const handleInvalidateCache = useCallback(
    async (input: CacheInvalidateInput) => {
      setIsInvalidatingCache(true);
      setCacheMessage(null);
      setOperationError(null);

      try {
        const result = await invalidateCache(input);
        setCacheMessage(`Invalidated ${result.count}`);
        await refreshCacheDashboard();
      } catch (error) {
        setOperationError(toErrorMessage(error));
      } finally {
        setIsInvalidatingCache(false);
      }
    },
    [refreshCacheDashboard]
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__left">
          {selectedAgent ? (
            <>
              <button className="topbar__back" type="button" onClick={handleBackToRoster}>
                <ChevronLeft size={16} />
                <span>Agents</span>
              </button>
              <span className="topbar__crumb">
                <span className="topbar__crumb-sep">/</span>
                <span className="topbar__crumb-name">{selectedAgent.name}</span>
              </span>
            </>
          ) : (
            <span className="topbar__brand">
              <span className="brand-mark">
                <Brain size={15} />
              </span>
              <span>NeuralMap</span>
            </span>
          )}
        </div>
        <div className="topbar__right">
          <span className={`chip ${graph?.mode === "database" ? "chip--live" : "chip--sample"}`}>
            <Database size={13} />
            <span>{graph?.mode === "database" ? "Database" : "Sample"}</span>
          </span>
          <span className="chip">
            <Layers size={13} />
            <span>{WORKBENCH_SCOPE.routeLabel}</span>
          </span>
          <button className="icon-button" type="button" onClick={() => void loadWorkbench()} aria-label="Refresh data">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {selectedAgent ? (
        <div className="brain">
          <AgentBrainHeader agent={selectedAgent} data={selectedAgentData} />

          <div className="brain__body">
            <section className="brain__stage" aria-label="Agent brain">
              <div className="stage__toolbar">
                <div className="search">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleRunQuery();
                      }
                    }}
                    placeholder="Search neurons"
                    aria-label="Search neurons"
                  />
                </div>
                <button className="btn btn--primary" type="button" onClick={() => void handleRunQuery()} disabled={isQuerying}>
                  <Search size={15} />
                  <span>{isQuerying ? "Querying" : "Query"}</span>
                </button>
              </div>

              <div className="graph-canvas-shell">
                {filteredNodes.length > 0 ? (
                  <div className="search-results">
                    {filteredNodes.map((node) => (
                      <button key={node.id} type="button" onClick={() => handleSelectNode(node.id)}>
                        {node.title}
                      </button>
                    ))}
                  </div>
                ) : null}

                {activeGraph ? (
                  <>
                    <GraphCanvas
                      graph={graphView.graph}
                      selectedNodeId={selectedNode?.id ?? null}
                      focusedNodeIds={focusedNodeIds}
                      focusedEdgeIds={focusedEdgeIds}
                      onSelectNode={handleSelectNode}
                    />
                    <GraphScaleControls
                      filters={graphFilters}
                      availableTypes={graphView.availableTypes}
                      availableSources={graphView.availableSources}
                      groupRows={graphView.groupRows}
                      stats={graphView.stats}
                      onChange={setGraphFilters}
                    />
                  </>
                ) : (
                  <div className="loading-state">Loading graph</div>
                )}
              </div>
            </section>

            <aside className="brain__rail" aria-label="Inspector">
              <div className="rail__tabs">
                {railTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`rail__tab ${railTab === tab.id ? "active" : ""}`}
                    onClick={() => setRailTab(tab.id)}
                  >
                    <tab.icon size={15} />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
              <div className="rail__panel">
                {railTab === "inspector" ? (
                  <NodeInspector node={selectedNode} explanation={selectedNodeExplanation} nodesById={nodesById} />
                ) : null}
                {railTab === "context" ? (
                  <ContextWorkbench
                    objective={objective}
                    onObjectiveChange={setObjective}
                    queryResult={queryResult}
                    contextPack={contextPack}
                    handoffPack={handoffPack}
                    artifacts={artifacts}
                    profileDashboard={profileDashboard}
                    profileDecision={profileDecision}
                    profileMessage={profileMessage}
                    nodesById={nodesById}
                    operationError={operationError}
                    isComposing={isComposing}
                    isRefreshingContext={isRefreshingContext}
                    isCreatingHandoff={isCreatingHandoff}
                    isRoutingProfile={isRoutingProfile}
                    isSendingProfileFeedback={isSendingProfileFeedback}
                    onComposeContext={handleComposeContext}
                    onRefreshContext={handleRefreshContext}
                    onCreateHandoff={handleCreateHandoff}
                    onRouteProfile={() => void handleRouteProfile()}
                    onSendProfileFeedback={handleSendProfileFeedback}
                    onSelectNode={handleSelectNode}
                    onSelectContextPack={handleSelectContextPack}
                    onSelectHandoffPack={handleSelectHandoffPack}
                  />
                ) : null}
                {railTab === "agent" ? (
                  <AgentConnectionPanel agent={selectedAgent} data={selectedAgentData} />
                ) : null}
              </div>
            </aside>
          </div>

          <section className="activity" aria-label="Activity">
            <div className="activity__bar">
              <button
                type="button"
                className={`activity__toggle ${activityOpen ? "active" : ""}`}
                onClick={() => setActivityOpen((open) => !open)}
              >
                <Activity size={14} />
                <span>Activity</span>
                {activityOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              <span className="activity__spacer" />
              <span className="data-mode">{timeline?.events.length ?? 0} events</span>
            </div>
            {activityOpen ? (
              <div className="activity__panels">
                <TimelinePanel timeline={timeline} onSelectEvent={handleSelectTimelineEvent} />
                <RunTracePanel trace={trace} />
                <CachePanel
                  dashboard={cacheDashboard}
                  layerFilter={cacheLayerFilter}
                  tagFilter={cacheTagFilter}
                  message={cacheMessage}
                  isInvalidating={isInvalidatingCache}
                  onLayerFilterChange={setCacheLayerFilter}
                  onTagFilterChange={setCacheTagFilter}
                  onRefresh={refreshCacheDashboard}
                  onInvalidate={handleInvalidateCache}
                />
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        <main className="roster" aria-label="Agent roster">
          <div className="roster__inner">
            <header className="roster__head">
              <div>
                <span className="eyebrow">NeuralMap Workbench</span>
                <h1>Agents</h1>
                <p className="roster__subtitle">
                  Each agent keeps its memory in the graph backbone. Open one to inspect its brain — neurons and synapses.
                </p>
              </div>
              <div className="roster__stats">
                <dl className="stat-tile">
                  <dt>Agents</dt>
                  <dd>{agents.length}</dd>
                </dl>
                <dl className="stat-tile">
                  <dt>Neurons</dt>
                  <dd>{graph?.nodes.length ?? 0}</dd>
                </dl>
                <dl className="stat-tile">
                  <dt>Synapses</dt>
                  <dd>{graph?.edges.length ?? 0}</dd>
                </dl>
              </div>
            </header>

            <ScopeSwitcher />

            <div className="roster__grid">
              {agents.map((agent) => (
                <AgentTile
                  key={agent.id}
                  agent={agent}
                  data={agentDataById.get(agent.id) ?? null}
                  onOpen={handleSelectAgent}
                />
              ))}
              {agents.length === 0 ? <div className="roster__empty">Loading agents…</div> : null}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

type RailTab = "inspector" | "context" | "agent";

const railTabs: Array<{ id: RailTab; label: string; icon: typeof Database }> = [
  { id: "inspector", label: "Inspector", icon: Database },
  { id: "context", label: "Context", icon: FileText },
  { id: "agent", label: "Agent", icon: Brain }
];

const nodeTypeColors: Record<string, string> = {
  Agent: "#7b87ff",
  Session: "#56b6e6",
  Run: "#3fb950",
  Task: "#e3a13b",
  Decision: "#e8743b",
  Summary: "#a98bf0",
  Template: "#e173b8",
  Repository: "#2bb6a6",
  CodeFile: "#84b94a",
  CodeSymbol: "#a7d05a",
  Document: "#d9b53f",
  DocSection: "#e6cd5a",
  Ticket: "#ef6a7e",
  PR: "#b98cf0",
  Commit: "#8088ee",
  TestCase: "#45c08a",
  Error: "#f0664f",
  Person: "#ef83b6",
  Policy: "#e0c24a",
  Artifact: "#8a9099"
};

function AgentTile({
  agent,
  data,
  onOpen
}: {
  agent: AgentSummary;
  data: AgentDataView | null;
  onOpen: (agentId: string) => void;
}) {
  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;
  const contextCount = data?.contextPacks.length ?? 0;
  const modeLabel = data?.mode === "direct" ? "Linked" : data?.mode === "scope" ? "Scoped" : "Empty";
  const modeClass = data?.mode === "direct" ? "linked" : data?.mode === "scope" ? "scoped" : "";
  const typeRows = data?.typeRows ?? [];

  return (
    <button type="button" className="agent-tile" onClick={() => onOpen(agent.id)}>
      <div className="agent-tile__top">
        <span className="agent-tile__status">
          <span className={`status-dot ${agent.status.toLowerCase()}`} />
          <span>{agent.status}</span>
        </span>
        <span className={`mode-chip ${modeClass}`}>{modeLabel}</span>
      </div>
      <div className="agent-tile__name">{agent.name}</div>
      <div className="agent-tile__task">{agent.task}</div>
      <TypeBar rows={typeRows} total={nodeCount} />
      <div className="agent-tile__foot">
        <div className="agent-tile__metric">
          <span>Model</span>
          <strong>{agent.model}</strong>
        </div>
        <div className="agent-tile__metric">
          <span>Neurons</span>
          <strong>{nodeCount}</strong>
        </div>
        <div className="agent-tile__metric">
          <span>Synapses</span>
          <strong>{edgeCount}</strong>
        </div>
        <div className="agent-tile__metric">
          <span>Packs</span>
          <strong>{contextCount}</strong>
        </div>
      </div>
    </button>
  );
}

function TypeBar({ rows, total }: { rows: GraphGroupRow[]; total: number }) {
  if (total === 0 || rows.length === 0) {
    return <div className="typebar" />;
  }

  return (
    <div className="typebar" aria-hidden>
      {rows.map((row) => (
        <span
          key={row.id}
          title={`${row.label} · ${row.nodeCount}`}
          style={{ width: `${(row.nodeCount / total) * 100}%`, background: nodeTypeColors[row.label] ?? "#8a9099" }}
        />
      ))}
    </div>
  );
}

function AgentBrainHeader({ agent, data }: { agent: AgentSummary; data: AgentDataView | null }) {
  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;
  const modeLabel = data?.mode === "direct" ? "Linked" : data?.mode === "scope" ? "Scoped" : "Empty";
  const modeClass = data?.mode === "direct" ? "linked" : data?.mode === "scope" ? "scoped" : "";

  return (
    <header className="brain__header">
      <div className="brain__id">
        <div className="brain__id-row">
          <span className={`status-dot ${agent.status.toLowerCase()}`} />
          <h1>{agent.name}</h1>
          <span className={`mode-chip ${modeClass}`}>{modeLabel}</span>
        </div>
        <p>{agent.task}</p>
      </div>
      <div className="metric-chips">
        <div className="metric-chip">
          <span>Model</span>
          <strong>{agent.model}</strong>
        </div>
        <div className="metric-chip">
          <span>Budget</span>
          <strong>{agent.token_budget.toLocaleString()}</strong>
        </div>
        <div className="metric-chip">
          <span>Cache</span>
          <strong>{Math.round(agent.cache_hit_rate * 100)}%</strong>
        </div>
        <div className="metric-chip">
          <span>Neurons</span>
          <strong>{nodeCount}</strong>
        </div>
        <div className="metric-chip">
          <span>Synapses</span>
          <strong>{edgeCount}</strong>
        </div>
      </div>
    </header>
  );
}

const scopeInputs: Array<{ key: WorkbenchScopeField; label: string }> = [
  { key: "tenant_id", label: "Tenant" },
  { key: "workspace_id", label: "Workspace" },
  { key: "project_id", label: "Project" },
  { key: "owner_scope", label: "Owner" }
];

function ScopeSwitcher() {
  const [fields, setFields] = useState<Record<WorkbenchScopeField, string>>(WORKBENCH_SCOPE.fields);
  const isDirty = scopeInputs.some(({ key }) => fields[key] !== WORKBENCH_SCOPE.fields[key]);

  const updateField = useCallback((key: WorkbenchScopeField, value: string) => {
    setFields((current) => ({
      ...current,
      [key]: value
    }));
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      applyWorkbenchScope(fields);
    },
    [fields]
  );

  const handleClear = useCallback(() => {
    applyWorkbenchScope({
      tenant_id: "",
      workspace_id: "",
      project_id: "",
      owner_scope: ""
    });
  }, []);

  return (
    <form className="scopebar" onSubmit={handleSubmit}>
      <div className="route-badge">
        <Database size={14} />
        <span>Route</span>
        <strong>{WORKBENCH_SCOPE.routeLabel}</strong>
      </div>
      {scopeInputs.map(({ key, label }) => (
        <label key={key} className="scope-field">
          <span>{label}</span>
          <input
            value={fields[key]}
            onChange={(event) => updateField(key, event.target.value)}
            aria-label={label}
            spellCheck={false}
          />
        </label>
      ))}
      <button className="icon-button scope-action" type="submit" aria-label="Apply scope" disabled={!isDirty}>
        <CheckCircle2 size={16} />
      </button>
      <button className="icon-button scope-action" type="button" onClick={handleClear} aria-label="Clear scope">
        <Trash2 size={16} />
      </button>
    </form>
  );
}

function AgentConnectionPanel({ agent, data }: { agent: AgentSummary; data: AgentDataView | null }) {
  const typeRows = data?.typeRows ?? [];
  const sourceRows = data?.sourceRows ?? [];

  return (
    <section className="agent-connection-panel">
      <div className="panel-title">
        <Brain size={18} />
        <span>{agent.name}</span>
      </div>
      <dl className="compact-metrics">
        <div>
          <dt>Model</dt>
          <dd>{agent.model}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{agent.token_budget.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Cache</dt>
          <dd>{Math.round(agent.cache_hit_rate * 100)}%</dd>
        </div>
      </dl>
      <div className="connection-lists">
        <DataRows title="Types" rows={typeRows} />
        <DataRows title="Sources" rows={sourceRows} />
      </div>
    </section>
  );
}

function DataRows({ title, rows }: { title: string; rows: GraphGroupRow[] }) {
  return (
    <div className="connection-list">
      <span>{title}</span>
      {rows.slice(0, 4).map((row) => (
        <div key={row.id}>
          <strong>{row.label}</strong>
          <small>{row.nodeCount}</small>
        </div>
      ))}
      {rows.length === 0 ? <small>None</small> : null}
    </div>
  );
}

function CachePanel({
  dashboard,
  layerFilter,
  tagFilter,
  message,
  isInvalidating,
  onLayerFilterChange,
  onTagFilterChange,
  onRefresh,
  onInvalidate
}: {
  dashboard: CacheDashboard | null;
  layerFilter: CacheLayerName | "all";
  tagFilter: string;
  message: string | null;
  isInvalidating: boolean;
  onLayerFilterChange: (layer: CacheLayerName | "all") => void;
  onTagFilterChange: (tag: string) => void;
  onRefresh: () => void;
  onInvalidate: (input: CacheInvalidateInput) => void;
}) {
  const layers = dashboard?.layers ?? [];
  const entries = dashboard?.entries ?? [];
  const normalizedTag = tagFilter.trim();
  const visibleEntries = entries
    .filter((entry) => layerFilter === "all" || entry.layer === layerFilter)
    .filter((entry) => !normalizedTag || entry.tags.includes(normalizedTag))
    .slice(0, 5);
  const totals = layers.reduce(
    (acc, layer) => ({
      hits: acc.hits + layer.hits,
      misses: acc.misses + layer.misses,
      size: acc.size + layer.size,
      expired: acc.expired + layer.expired
    }),
    { hits: 0, misses: 0, size: 0, expired: 0 }
  );
  const hitRate = totals.hits + totals.misses === 0 ? 0 : totals.hits / (totals.hits + totals.misses);

  return (
    <section className="cache-panel">
      <div className="panel-title split-title">
        <span>
          <Archive size={18} />
          <span>Cache</span>
        </span>
        <strong>{Math.round(hitRate * 100)}%</strong>
      </div>
      <dl className="compact-metrics cache-metrics">
        <div>
          <dt>Entries</dt>
          <dd>{totals.size}</dd>
        </div>
        <div>
          <dt>Hits</dt>
          <dd>{totals.hits}</dd>
        </div>
        <div>
          <dt>Expired</dt>
          <dd>{totals.expired}</dd>
        </div>
      </dl>
      <div className="cache-layer-list">
        <button
          type="button"
          className={layerFilter === "all" ? "active" : ""}
          onClick={() => onLayerFilterChange("all")}
        >
          <span>All</span>
          <strong>{totals.size}</strong>
        </button>
        {layers.map((layer) => (
          <button
            key={layer.name}
            type="button"
            className={layerFilter === layer.name ? "active" : ""}
            onClick={() => onLayerFilterChange(layer.name)}
          >
            <span>{formatCacheLayer(layer.name)}</span>
            <strong>{layer.size}</strong>
            <small>{formatCacheTtl(layer.ttl_ms)}</small>
          </button>
        ))}
      </div>
      <div className="cache-tag-row">
        <input
          value={tagFilter}
          onChange={(event) => onTagFilterChange(event.target.value)}
          placeholder="tag"
          aria-label="Cache tag"
        />
        <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh cache">
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="cache-actions">
        <button
          type="button"
          disabled={isInvalidating || layerFilter === "all"}
          onClick={() => onInvalidate(createCacheInvalidatePayload(layerFilter, ""))}
        >
          <Trash2 size={15} />
          <span>Layer</span>
        </button>
        <button
          type="button"
          disabled={isInvalidating || !normalizedTag}
          onClick={() => onInvalidate(createCacheInvalidatePayload(layerFilter, normalizedTag))}
        >
          <Trash2 size={15} />
          <span>Tag</span>
        </button>
        <button type="button" disabled={isInvalidating} onClick={() => onInvalidate({})}>
          <Trash2 size={15} />
          <span>All</span>
        </button>
      </div>
      {message ? <div className="cache-message">{message}</div> : null}
      <div className="cache-entry-list">
        {visibleEntries.map((entry) => (
          <div key={`${entry.layer}:${entry.key}`} className={entry.expired ? "expired" : ""}>
            <span>{formatCacheLayer(entry.layer)}</span>
            <strong>{entry.value_summary}</strong>
            <small>{formatCacheAge(entry.age_ms)} / {entry.tags.slice(0, 2).join(", ") || "untagged"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function NodeInspector({
  node,
  explanation,
  nodesById
}: {
  node: GraphNode | null;
  explanation: ContextNodeExplanation | null;
  nodesById: ReadonlyMap<string, GraphNode>;
}) {
  if (!node) {
    return (
      <div className="empty-panel">
        <Database size={18} />
        <span>No node selected</span>
      </div>
    );
  }

  return (
    <div className="node-inspector">
      <div className="panel-title">
        <Database size={18} />
        <span>Inspector</span>
      </div>
      <span className="node-type">{node.type}</span>
      <h2>{node.title}</h2>
      <p>{node.summary ?? node.content_ref ?? node.id}</p>
      <dl>
        <div>
          <dt>Trust</dt>
          <dd>{node.trust_score.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>{node.freshness_score.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Importance</dt>
          <dd>{node.importance_score.toFixed(2)}</dd>
        </div>
      </dl>
      <div className="metadata-block">
        <GitBranch size={16} />
        <code>{node.content_ref ?? node.id}</code>
      </div>
      {explanation ? <WhyIncluded explanation={explanation} nodesById={nodesById} /> : null}
    </div>
  );
}

function WhyIncluded({
  explanation,
  nodesById
}: {
  explanation: ContextNodeExplanation;
  nodesById: ReadonlyMap<string, GraphNode>;
}) {
  const viaNode = explanation.via_node_id ? nodesById.get(explanation.via_node_id) : undefined;

  return (
    <section className="why-panel">
      <div className="why-heading">
        <Info size={16} />
        <span>Why Included</span>
        <strong>{formatReasonKind(explanation.reason_kind)}</strong>
      </div>
      <p>{explanation.summary}</p>
      <dl className="compact-metrics">
        {typeof explanation.seed_score === "number" ? (
          <div>
            <dt>Seed</dt>
            <dd>{explanation.seed_score.toFixed(2)}</dd>
          </div>
        ) : null}
        {typeof explanation.evidence_score === "number" ? (
          <div>
            <dt>Evidence</dt>
            <dd>{explanation.evidence_score.toFixed(2)}</dd>
          </div>
        ) : null}
        {typeof explanation.via_edge_confidence === "number" ? (
          <div>
            <dt>Edge</dt>
            <dd>{explanation.via_edge_confidence.toFixed(2)}</dd>
          </div>
        ) : null}
      </dl>
      {viaNode || explanation.via_edge_type ? (
        <div className="why-path">
          <span>{viaNode?.title ?? explanation.via_node_id}</span>
          {explanation.via_edge_type ? <strong>{explanation.via_edge_type}</strong> : null}
        </div>
      ) : null}
      {explanation.seed_reasons?.length ? (
        <div className="reason-list">
          {explanation.seed_reasons.slice(0, 4).map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GraphScaleControls({
  filters,
  availableTypes,
  availableSources,
  groupRows,
  stats,
  onChange
}: {
  filters: GraphViewFilters;
  availableTypes: string[];
  availableSources: string[];
  groupRows: GraphGroupRow[];
  stats: GraphViewState["stats"];
  onChange: Dispatch<SetStateAction<GraphViewFilters>>;
}) {
  const toggleNodeType = (type: string) => {
    onChange((current) => ({
      ...current,
      nodeTypes: current.nodeTypes.includes(type)
        ? current.nodeTypes.filter((item) => item !== type)
        : [...current.nodeTypes, type]
    }));
  };
  const toggleSource = (source: string) => {
    onChange((current) => ({
      ...current,
      sourceSystems: current.sourceSystems.includes(source)
        ? current.sourceSystems.filter((item) => item !== source)
        : [...current.sourceSystems, source]
    }));
  };
  const setGroupMode = (groupBy: GraphGroupMode) => {
    onChange((current) => ({
      ...current,
      groupBy
    }));
  };
  const applyGroupRow = (row: GraphGroupRow) => {
    if (filters.groupBy === "type") {
      onChange((current) => ({
        ...current,
        nodeTypes: [row.id]
      }));
    }
    if (filters.groupBy === "source") {
      onChange((current) => ({
        ...current,
        sourceSystems: [row.id]
      }));
    }
  };

  return (
    <aside className="graph-controls" aria-label="Graph controls">
      <div className="graph-controls-heading">
        <SlidersHorizontal size={16} />
        <span>Graph Scale</span>
        <strong>{stats.visibleNodes}/{stats.totalNodes}</strong>
      </div>
      <div className="scale-sliders">
        <label>
          <span>Importance</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={filters.minImportance}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                minImportance: Number(event.target.value)
              }))
            }
          />
          <strong>{filters.minImportance.toFixed(2)}</strong>
        </label>
        <label>
          <span>Confidence</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={filters.minConfidence}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                minConfidence: Number(event.target.value)
              }))
            }
          />
          <strong>{filters.minConfidence.toFixed(2)}</strong>
        </label>
        <label>
          <span>Max</span>
          <input
            type="range"
            min="20"
            max="360"
            step="20"
            value={filters.maxNodes}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                maxNodes: Number(event.target.value)
              }))
            }
          />
          <strong>{filters.maxNodes}</strong>
        </label>
      </div>
      <div className="segmented-control" aria-label="Group graph">
        {(["none", "type", "source"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={filters.groupBy === mode ? "active" : ""}
            onClick={() => setGroupMode(mode)}
          >
            {formatIntent(mode)}
          </button>
        ))}
      </div>
      <div className="filter-actions">
        <button
          type="button"
          className={filters.showArtifacts ? "active" : ""}
          onClick={() =>
            onChange((current) => ({
              ...current,
              showArtifacts: !current.showArtifacts
            }))
          }
        >
          {filters.showArtifacts ? <Eye size={15} /> : <EyeOff size={15} />}
          <span>Artifacts</span>
        </button>
        <button type="button" onClick={() => onChange(defaultGraphFilters)}>
          <RefreshCw size={15} />
          <span>Reset</span>
        </button>
      </div>
      <div className="filter-chip-list" aria-label="Node types">
        {availableTypes.map((type) => (
          <button
            key={type}
            type="button"
            className={filters.nodeTypes.includes(type) ? "active" : ""}
            onClick={() => toggleNodeType(type)}
          >
            {type}
          </button>
        ))}
      </div>
      <div className="filter-chip-list source-list" aria-label="Sources">
        {availableSources.map((source) => (
          <button
            key={source}
            type="button"
            className={filters.sourceSystems.includes(source) ? "active" : ""}
            onClick={() => toggleSource(source)}
          >
            {formatSourceLabel(source)}
          </button>
        ))}
      </div>
      <div className="group-summary">
        <div className="group-summary-title">
          <Layers size={15} />
          <span>{filters.groupBy === "none" ? "Density" : formatIntent(filters.groupBy)}</span>
          <strong>{stats.visibleEdges}/{stats.totalEdges}</strong>
        </div>
        <div className="group-summary-list">
          {groupRows.slice(0, 5).map((row) => (
            <button
              key={row.id}
              type="button"
              disabled={filters.groupBy === "none"}
              onClick={() => applyGroupRow(row)}
            >
              <span>{row.label}</span>
              <strong>{row.nodeCount}</strong>
              <small>{row.averageImportance.toFixed(2)}</small>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

interface ContextWorkbenchProps {
  objective: string;
  onObjectiveChange: (value: string) => void;
  queryResult: GraphQueryResult | null;
  contextPack: ContextPack | null;
  handoffPack: HandoffPack | null;
  artifacts: WorkbenchArtifacts | null;
  profileDashboard: ModelProfilesDashboard | null;
  profileDecision: ModelRouteDecision | null;
  profileMessage: string | null;
  nodesById: ReadonlyMap<string, GraphNode>;
  operationError: string | null;
  isComposing: boolean;
  isRefreshingContext: boolean;
  isCreatingHandoff: boolean;
  isRoutingProfile: boolean;
  isSendingProfileFeedback: boolean;
  onComposeContext: () => void;
  onRefreshContext: () => void;
  onCreateHandoff: () => void;
  onRouteProfile: () => void;
  onSendProfileFeedback: (score: number) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectContextPack: (pack: ContextPack) => void;
  onSelectHandoffPack: (pack: HandoffPack) => void;
}

function ContextWorkbench({
  objective,
  onObjectiveChange,
  queryResult,
  contextPack,
  handoffPack,
  artifacts,
  profileDashboard,
  profileDecision,
  profileMessage,
  nodesById,
  operationError,
  isComposing,
  isRefreshingContext,
  isCreatingHandoff,
  isRoutingProfile,
  isSendingProfileFeedback,
  onComposeContext,
  onRefreshContext,
  onCreateHandoff,
  onRouteProfile,
  onSendProfileFeedback,
  onSelectNode,
  onSelectContextPack,
  onSelectHandoffPack
}: ContextWorkbenchProps) {
  return (
    <section className="context-workbench">
      <div className="panel-title">
        <FileText size={18} />
        <span>Context Pack</span>
      </div>

      <label className="field-label" htmlFor="context-objective">
        Objective
      </label>
      <input
        id="context-objective"
        className="objective-input"
        value={objective}
        onChange={(event) => onObjectiveChange(event.target.value)}
      />

      <div className="command-row">
        <button className="command-button" type="button" onClick={onComposeContext} disabled={isComposing}>
          <FileText size={16} />
          <span>{isComposing ? "Composing" : "Compose"}</span>
        </button>
        <button
          className="command-button"
          type="button"
          onClick={onRefreshContext}
          disabled={!contextPack || isRefreshingContext}
        >
          <RefreshCw size={16} />
          <span>{isRefreshingContext ? "Refreshing" : "Refresh"}</span>
        </button>
        <button
          className="command-button"
          type="button"
          onClick={onCreateHandoff}
          disabled={!contextPack || isCreatingHandoff}
        >
          <Send size={16} />
          <span>{isCreatingHandoff ? "Creating" : "Handoff"}</span>
        </button>
      </div>

      {operationError ? (
        <div className="error-row">
          <AlertCircle size={16} />
          <span>{operationError}</span>
        </div>
      ) : null}

      <ModelProfilePanel
        dashboard={profileDashboard}
        decision={profileDecision}
        message={profileMessage}
        isRouting={isRoutingProfile}
        isSendingFeedback={isSendingProfileFeedback}
        onRouteProfile={onRouteProfile}
        onSendFeedback={onSendProfileFeedback}
      />
      {queryResult ? <QuerySummary queryResult={queryResult} /> : null}
      {contextPack ? (
        <ContextPackPreview pack={contextPack} nodesById={nodesById} onSelectNode={onSelectNode} />
      ) : null}
      {handoffPack ? <HandoffPackPreview pack={handoffPack} /> : null}
      {handoffPack ? (
        <HandoffRelationshipPanel
          pack={handoffPack}
          relationship={
            (artifacts?.relationships ?? []).find((candidate) => candidate.handoff_pack_id === handoffPack.id) ?? null
          }
          sourcePack={
            (artifacts?.context_packs ?? []).find((candidate) => {
              const relationship = (artifacts?.relationships ?? []).find(
                (candidateRelationship) => candidateRelationship.handoff_pack_id === handoffPack.id
              );
              return candidate.id === (relationship?.context_pack_id ?? getHandoffSourceContextPackId(handoffPack));
            }) ?? null
          }
          nodesById={nodesById}
          onSelectContextPack={onSelectContextPack}
          onSelectNode={onSelectNode}
        />
      ) : null}
      <ArtifactHistory
        artifacts={artifacts}
        onSelectContextPack={onSelectContextPack}
        onSelectHandoffPack={onSelectHandoffPack}
      />
    </section>
  );
}

function QuerySummary({ queryResult }: { queryResult: GraphQueryResult }) {
  const retrievalMode = queryResult.retrieval?.mode ?? "hybrid";
  const semanticSeedCount =
    queryResult.retrieval?.semantic_seed_count ?? queryResult.seeds.filter((seed) => (seed.semantic_score ?? 0) > 0).length;
  const vectorSeedCount = queryResult.retrieval?.vector_seed_count ?? 0;

  return (
    <section className="artifact-panel">
      <div className="artifact-heading">
        <CheckCircle2 size={16} />
        <span>Graph Query</span>
        <strong>{queryResult.cache.hit ? "Hit" : "Miss"}</strong>
      </div>
      <dl className="compact-metrics">
        <div>
          <dt>Seeds</dt>
          <dd>{queryResult.seeds.length}</dd>
        </div>
        <div>
          <dt>Nodes</dt>
          <dd>{queryResult.neighborhood.nodes.length}</dd>
        </div>
        <div>
          <dt>Edges</dt>
          <dd>{queryResult.neighborhood.edges.length}</dd>
        </div>
        <div>
          <dt>Semantic</dt>
          <dd>{semanticSeedCount}</dd>
        </div>
        <div>
          <dt>Vector</dt>
          <dd>{vectorSeedCount}</dd>
        </div>
      </dl>
      <div className="intent-strip">
        <span>{formatIntent(queryResult.intent.kind)} / {formatIntent(queryResult.retrieval?.semantic_source ?? retrievalMode)}</span>
        <strong>{Math.round(queryResult.intent.confidence * 100)}%</strong>
      </div>
      <div className="seed-list">
        {queryResult.seeds.slice(0, 4).map((seed) => (
          <span key={seed.node.id}>{seed.node.title}</span>
        ))}
      </div>
    </section>
  );
}

function ModelProfilePanel({
  dashboard,
  decision,
  message,
  isRouting,
  isSendingFeedback,
  onRouteProfile,
  onSendFeedback
}: {
  dashboard: ModelProfilesDashboard | null;
  decision: ModelRouteDecision | null;
  message: string | null;
  isRouting: boolean;
  isSendingFeedback: boolean;
  onRouteProfile: () => void;
  onSendFeedback: (score: number) => void;
}) {
  const selected = decision?.selected_profile ?? dashboard?.profiles[0] ?? null;
  const feedback = selected ? dashboard?.feedback.find((item) => item.profile_id === selected.id) : undefined;

  return (
    <section className="artifact-panel model-profile-panel">
      <div className="artifact-heading">
        <Brain size={16} />
        <span>Dynamic Profile</span>
        <strong>{selected?.reasoning_effort ?? "Open"}</strong>
      </div>
      {selected ? (
        <>
          <div className="profile-strip">
            <div>
              <span>{selected.name}</span>
              <small>{selected.model_family}</small>
            </div>
            <strong>{selected.max_input_tokens.toLocaleString()}</strong>
          </div>
          {decision ? (
            <dl className="compact-metrics">
              <div>
                <dt>Complex</dt>
                <dd>{Math.round(decision.task_classification.complexity * 100)}%</dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>{Math.round(decision.task_classification.risk * 100)}%</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>{Math.round(decision.budget.budget_pressure * 100)}%</dd>
              </div>
            </dl>
          ) : null}
          <div className="intent-strip">
            <span>
              {decision ? formatIntent(decision.task_classification.intent.kind) : `${dashboard?.profiles.length ?? 0} profiles`}
            </span>
            <strong>{feedback ? Math.round(feedback.average_score * 100) : Math.round(selected.quality_floor * 100)}%</strong>
          </div>
          {decision ? (
            <div className="reason-list">
              {decision.routing_reasons.slice(0, 4).map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="handoff-status">No profiles loaded.</p>
      )}
      <div className="profile-actions">
        <button type="button" onClick={onRouteProfile} disabled={isRouting}>
          <Gauge size={15} />
          <span>{isRouting ? "Routing" : "Route"}</span>
        </button>
        <button type="button" onClick={() => onSendFeedback(0.92)} disabled={!decision || isSendingFeedback}>
          <Star size={15} />
          <span>Good</span>
        </button>
        <button type="button" onClick={() => onSendFeedback(0.45)} disabled={!decision || isSendingFeedback}>
          <AlertCircle size={15} />
          <span>Weak</span>
        </button>
      </div>
      {message ? <div className="cache-message">{message}</div> : null}
    </section>
  );
}

function ContextPackPreview({
  pack,
  nodesById,
  onSelectNode
}: {
  pack: ContextPack;
  nodesById: ReadonlyMap<string, GraphNode>;
  onSelectNode: (nodeId: string) => void;
}) {
  const templateInfo = getTemplateInfo(pack);
  const promptCache = getPromptSegmentCache(pack);
  const summaryCache = getSummaryCache(pack);
  const contextSummary = getContextSummary(pack);

  return (
    <section className="artifact-panel">
      <div className="artifact-heading">
        <FileText size={16} />
        <span>{pack.id}</span>
      </div>
      <dl className="compact-metrics">
        <div>
          <dt>Nodes</dt>
          <dd>{pack.node_ids.length}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{pack.evidence.length}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{pack.token_budget.toLocaleString()}</dd>
        </div>
      </dl>
      {templateInfo || promptCache || summaryCache ? (
        <div className="template-strip">
          {templateInfo ? <span>{templateInfo.name ?? templateInfo.id}</span> : null}
          <div className="cache-badges">
            {promptCache ? <strong>{promptCache.hit ? "Prompt Hit" : "Prompt Miss"}</strong> : null}
            {summaryCache ? <strong>{summaryCache.hit ? "Summary Hit" : "Summary Miss"}</strong> : null}
          </div>
        </div>
      ) : null}
      {contextSummary ? <p className="context-summary">{contextSummary.content}</p> : null}
      <div className="evidence-list">
        {pack.evidence.slice(0, 3).map((item) => (
          <button key={item.node_id} type="button" className="evidence-button" onClick={() => onSelectNode(item.node_id)}>
            <span>{nodesById.get(item.node_id)?.title ?? item.node_id}</span>
            <strong>{item.score.toFixed(2)}</strong>
            <small>{getContextNodeExplanation(pack, item.node_id)?.summary ?? item.snippet}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function HandoffPackPreview({ pack }: { pack: HandoffPack }) {
  return (
    <section className="artifact-panel">
      <div className="artifact-heading">
        <Send size={16} />
        <span>{pack.id}</span>
      </div>
      <p className="handoff-status">{pack.current_status}</p>
      <dl className="compact-metrics">
        <div>
          <dt>Refs</dt>
          <dd>{pack.referenced_node_ids.length}</dd>
        </div>
        <div>
          <dt>Loops</dt>
          <dd>{pack.open_loops.length}</dd>
        </div>
        <div>
          <dt>Actions</dt>
          <dd>{pack.recommended_next_actions.length}</dd>
        </div>
      </dl>
    </section>
  );
}

function HandoffRelationshipPanel({
  pack,
  relationship,
  sourcePack,
  nodesById,
  onSelectContextPack,
  onSelectNode
}: {
  pack: HandoffPack;
  relationship: HandoffRelationship | null;
  sourcePack: ContextPack | null;
  nodesById: ReadonlyMap<string, GraphNode>;
  onSelectContextPack: (pack: ContextPack) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const referencedNodeIds = relationship?.referenced_node_ids.length
    ? relationship.referenced_node_ids
    : pack.referenced_node_ids;

  return (
    <section className="artifact-panel relationship-panel">
      <div className="artifact-heading">
        <GitBranch size={16} />
        <span>Handoff Relationship</span>
        <strong>{relationship ? "Linked" : "Open"}</strong>
      </div>
      <div className="relationship-path">
        <button
          type="button"
          className="relationship-endpoint"
          onClick={() => {
            if (sourcePack) {
              onSelectContextPack(sourcePack);
            }
          }}
          disabled={!sourcePack}
        >
          <FileText size={15} />
          <span>{sourcePack?.id ?? "No source"}</span>
        </button>
        <span className="relationship-arrow">to</span>
        <div className="relationship-endpoint static">
          <Send size={15} />
          <span>{pack.id}</span>
        </div>
      </div>
      <dl className="compact-metrics relationship-metrics">
        <div>
          <dt>Run</dt>
          <dd>{relationship?.from_run_id ?? pack.from_run_id}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{relationship?.to_session_id ?? pack.to_session_id ?? "none"}</dd>
        </div>
        <div>
          <dt>Refs</dt>
          <dd>{referencedNodeIds.length}</dd>
        </div>
      </dl>
      <div className="relationship-node-list">
        {referencedNodeIds.slice(0, 5).map((nodeId) => (
          <button key={nodeId} type="button" className="relationship-node" onClick={() => onSelectNode(nodeId)}>
            <GitBranch size={14} />
            <span>{nodesById.get(nodeId)?.title ?? nodeId}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ArtifactHistory({
  artifacts,
  onSelectContextPack,
  onSelectHandoffPack
}: {
  artifacts: WorkbenchArtifacts | null;
  onSelectContextPack: (pack: ContextPack) => void;
  onSelectHandoffPack: (pack: HandoffPack) => void;
}) {
  const contextPacks = artifacts?.context_packs ?? [];
  const handoffPacks = artifacts?.handoff_packs ?? [];

  return (
    <section className="artifact-history">
      <div className="panel-title">
        <Archive size={18} />
        <span>Artifacts</span>
      </div>
      <div className="artifact-list">
        {contextPacks.map((pack) => (
          <button key={pack.id} type="button" className="artifact-button" onClick={() => onSelectContextPack(pack)}>
            <FileText size={15} />
            <span>{pack.objective}</span>
            <strong>{pack.node_ids.length}</strong>
          </button>
        ))}
        {handoffPacks.map((pack) => (
          <button key={pack.id} type="button" className="artifact-button" onClick={() => onSelectHandoffPack(pack)}>
            <Send size={15} />
            <span>{pack.objective}</span>
            <strong>{pack.referenced_node_ids.length}</strong>
          </button>
        ))}
        {contextPacks.length + handoffPacks.length === 0 ? <span className="empty-artifacts">No artifacts</span> : null}
      </div>
    </section>
  );
}

function TimelinePanel({
  timeline,
  onSelectEvent
}: {
  timeline: WorkbenchTimeline | null;
  onSelectEvent: (event: WorkbenchTimelineEvent) => void;
}) {
  const events = timeline?.events ?? [];

  return (
    <section className="timeline-column">
      <div className="panel-title split-title">
        <span>
          <Clock size={18} />
          <span>Timeline</span>
        </span>
        <strong>{timeline?.run_id ?? "sample"}</strong>
      </div>
      <div className="timeline-list">
        {events.map((event) => (
          <button key={event.id} type="button" className={`timeline-event ${event.kind}`} onClick={() => onSelectEvent(event)}>
            <span className="timeline-icon">
              <TimelineEventIcon kind={event.kind} />
            </span>
            <span className="timeline-copy">
              <strong>{event.title}</strong>
              <small>{event.summary ?? formatTimelineKind(event.kind)}</small>
            </span>
            <time>{formatEventTime(event.at)}</time>
            <span className="timeline-metrics">
              {Object.entries(event.metrics)
                .slice(0, 3)
                .map(([key, value]) => (
                  <span key={key}>{formatMetric(key, value)}</span>
                ))}
            </span>
          </button>
        ))}
        {events.length === 0 ? <span className="empty-artifacts">No timeline events</span> : null}
      </div>
    </section>
  );
}

function TimelineEventIcon({ kind }: { kind: WorkbenchTimelineEvent["kind"] }) {
  if (kind === "context_pack") {
    return <FileText size={15} />;
  }
  if (kind === "handoff_pack") {
    return <Send size={15} />;
  }
  if (kind === "artifact_relationship") {
    return <GitBranch size={15} />;
  }
  return <Activity size={15} />;
}

function RunTracePanel({ trace }: { trace: RunTrace | null }) {
  return (
    <section className="trace-column">
      <div className="panel-title">
        <Activity size={18} />
        <span>Run Trace</span>
      </div>
      <div className="trace-list">
        {(trace?.spans ?? []).map((span) => (
          <TraceRow key={span.id} span={span} />
        ))}
      </div>
    </section>
  );
}

function TraceRow({ span }: { span: TraceSpan }) {
  const durationMs =
    typeof span.attributes.durationMs === "number" ? `${Math.round(span.attributes.durationMs)}ms` : undefined;

  return (
    <article className="trace-row">
      <span>{span.kind}</span>
      <strong>{span.name}</strong>
      {durationMs ? <small>{durationMs}</small> : null}
    </article>
  );
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function formatIntent(intent: string): string {
  return intent
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCacheLayer(layer: CacheLayerName): string {
  if (layer === "graph_neighborhood") {
    return "Neighborhood";
  }
  if (layer === "prompt_segment") {
    return "Prompt";
  }
  return formatIntent(layer);
}

function formatCacheTtl(ttlMs: number | undefined): string {
  if (ttlMs === undefined) {
    return "Pinned";
  }
  return formatCacheAge(ttlMs);
}

function formatCacheAge(ageMs: number): string {
  if (ageMs < 1000) {
    return `${Math.max(0, Math.round(ageMs))}ms`;
  }
  if (ageMs < 60_000) {
    return `${Math.round(ageMs / 1000)}s`;
  }
  if (ageMs < 3_600_000) {
    return `${Math.round(ageMs / 60_000)}m`;
  }
  return `${Math.round(ageMs / 3_600_000)}h`;
}

function createCacheInvalidatePayload(layer: CacheLayerName | "all", tag: string): CacheInvalidateInput {
  const payload: CacheInvalidateInput = {};
  if (layer !== "all") {
    payload.layer = layer;
  }
  if (tag) {
    payload.tags = [tag];
  }
  return payload;
}

function formatReasonKind(kind: string): string {
  return kind
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimelineKind(kind: WorkbenchTimelineEvent["kind"]): string {
  return formatIntent(kind);
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatMetric(key: string, value: number | string | boolean): string {
  return `${formatMetricLabel(key)} ${String(value)}`;
}

function formatMetricLabel(key: string): string {
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createAgentDataView(
  agent: AgentSummary,
  graph: WorkbenchGraph | null,
  artifacts: WorkbenchArtifacts | null,
  timeline: WorkbenchTimeline | null
): AgentDataView {
  const emptyGraph: WorkbenchGraph = {
    nodes: [],
    edges: [],
    generated_at: graph?.generated_at ?? new Date(0).toISOString(),
    ...(graph?.mode ? { mode: graph.mode } : {})
  };

  if (!graph) {
    return {
      agentId: agent.id,
      graph: emptyGraph,
      nodes: [],
      edges: [],
      contextPacks: [],
      handoffPacks: [],
      timelineEvents: [],
      nodeIds: new Set(),
      mode: "empty",
      exactNodeCount: 0,
      typeRows: [],
      sourceRows: []
    };
  }

  const contextPacks = (artifacts?.context_packs ?? []).filter((pack) => pack.agent_id === agent.id);
  const contextPackIds = new Set(contextPacks.map((pack) => pack.id));
  const handoffPacks = (artifacts?.handoff_packs ?? []).filter((pack) => {
    const sourceContextPackId = getHandoffSourceContextPackId(pack);
    return Boolean(sourceContextPackId && contextPackIds.has(sourceContextPackId)) || metadataReferencesAgent(pack.metadata, agent.id);
  });
  const timelineEvents = (timeline?.events ?? []).filter(
    (event) =>
      Boolean(event.context_pack_id && contextPackIds.has(event.context_pack_id)) ||
      event.run_id === agent.id ||
      event.run_id?.includes(agent.id) ||
      metadataReferencesAgent(event.metrics, agent.id)
  );

  const exactNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeReferencesAgent(node, agent)) {
      exactNodeIds.add(node.id);
    }
  }
  for (const pack of contextPacks) {
    for (const nodeId of pack.node_ids) {
      exactNodeIds.add(nodeId);
    }
  }
  for (const pack of handoffPacks) {
    for (const nodeId of pack.referenced_node_ids) {
      exactNodeIds.add(nodeId);
    }
  }

  const canReadGraph = agent.permissions?.includes("read:graph") ?? true;
  const mode: AgentConnectionMode = exactNodeIds.size > 0 ? "direct" : canReadGraph && graph.nodes.length > 0 ? "scope" : "empty";
  const nodes =
    mode === "direct"
      ? graph.nodes.filter((node) => exactNodeIds.has(node.id))
      : mode === "scope"
        ? [...graph.nodes]
        : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const scopedGraph: WorkbenchGraph = {
    ...graph,
    nodes,
    edges
  };

  return {
    agentId: agent.id,
    graph: scopedGraph,
    nodes,
    edges,
    contextPacks,
    handoffPacks,
    timelineEvents,
    nodeIds,
    mode,
    exactNodeCount: exactNodeIds.size,
    typeRows: createGraphGroupRows(nodes, edges, "type"),
    sourceRows: createGraphGroupRows(nodes, edges, "source")
  };
}

function nodeReferencesAgent(node: GraphNode, agent: AgentSummary): boolean {
  return (
    node.id === agent.id ||
    node.id.endsWith(`:${agent.id}`) ||
    node.title === agent.name ||
    (node.type === "Agent" && node.title.toLowerCase().includes(agent.name.toLowerCase())) ||
    metadataReferencesAgent(node.metadata, agent.id) ||
    metadataReferencesAgent(node.properties, agent.id)
  );
}

function metadataReferencesAgent(value: unknown, agentId: string, depth = 0): boolean {
  if (depth > 3 || value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value === agentId || value.includes(agentId);
  }
  if (typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => metadataReferencesAgent(item, agentId, depth + 1));
  }

  return Object.entries(value).some(([key, item]) => {
    if (key.toLowerCase().includes("agent") && metadataReferencesAgent(item, agentId, depth + 1)) {
      return true;
    }
    return metadataReferencesAgent(item, agentId, depth + 1);
  });
}

function createGraphView(graph: WorkbenchGraph | null, filters: GraphViewFilters): GraphViewState {
  if (!graph) {
    return {
      graph: {
        nodes: [],
        edges: [],
        generated_at: new Date(0).toISOString()
      },
      nodeIds: new Set(),
      availableTypes: [],
      availableSources: [],
      groupRows: [],
      stats: {
        totalNodes: 0,
        visibleNodes: 0,
        totalEdges: 0,
        visibleEdges: 0
      }
    };
  }

  const availableTypes = [...new Set(graph.nodes.map((node) => node.type))].sort();
  const availableSources = [...new Set(graph.nodes.map(getNodeSourceGroup))].sort();
  const typeFilter = new Set(filters.nodeTypes);
  const sourceFilter = new Set(filters.sourceSystems);
  const nodes = graph.nodes
    .filter((node) => {
      if (!filters.showArtifacts && node.type === "Artifact") {
        return false;
      }
      if (node.importance_score < filters.minImportance) {
        return false;
      }
      if (typeFilter.size > 0 && !typeFilter.has(node.type)) {
        return false;
      }
      if (sourceFilter.size > 0 && !sourceFilter.has(getNodeSourceGroup(node))) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.importance_score - a.importance_score || a.title.localeCompare(b.title))
    .slice(0, filters.maxNodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => edge.confidence >= filters.minConfidence && nodeIds.has(edge.from) && nodeIds.has(edge.to)
  );
  const nextGraph: WorkbenchGraph = {
    ...graph,
    nodes,
    edges
  };

  return {
    graph: nextGraph,
    nodeIds,
    availableTypes,
    availableSources,
    groupRows: createGraphGroupRows(nodes, edges, filters.groupBy),
    stats: {
      totalNodes: graph.nodes.length,
      visibleNodes: nodes.length,
      totalEdges: graph.edges.length,
      visibleEdges: edges.length
    }
  };
}

function createGraphGroupRows(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  groupBy: GraphGroupMode
): GraphGroupRow[] {
  if (groupBy === "none") {
    return [
      {
        id: "visible",
        label: "Visible",
        nodeCount: nodes.length,
        edgeCount: edges.length,
        averageImportance: average(nodes.map((node) => node.importance_score))
      }
    ];
  }

  const rows = new Map<string, GraphGroupRow & { importanceTotal: number }>();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const id = groupBy === "type" ? node.type : getNodeSourceGroup(node);
    const row = rows.get(id) ?? {
      id,
      label: groupBy === "source" ? formatSourceLabel(id) : id,
      nodeCount: 0,
      edgeCount: 0,
      averageImportance: 0,
      importanceTotal: 0
    };
    row.nodeCount += 1;
    row.importanceTotal += node.importance_score;
    row.averageImportance = row.importanceTotal / row.nodeCount;
    rows.set(id, row);
  }

  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.from);
    if (!sourceNode) {
      continue;
    }
    const id = groupBy === "type" ? sourceNode.type : getNodeSourceGroup(sourceNode);
    const row = rows.get(id);
    if (row) {
      row.edgeCount += 1;
    }
  }

  return [...rows.values()]
    .map(({ importanceTotal: _importanceTotal, ...row }) => row)
    .sort((a, b) => b.nodeCount - a.nodeCount || b.averageImportance - a.averageImportance || a.label.localeCompare(b.label));
}

function getNodeSourceGroup(node: GraphNode): string {
  return node.source_system ?? "runtime";
}

function formatSourceLabel(source: string): string {
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function getContextNodeExplanation(pack: ContextPack | null, nodeId: string): ContextNodeExplanation | null {
  const explanations = asRecord(pack?.metadata.node_explanations);
  const explanation = asRecord(explanations?.[nodeId]);

  if (!explanation || typeof explanation.reason_kind !== "string" || typeof explanation.summary !== "string") {
    return null;
  }

  const parsed: ContextNodeExplanation = {
    node_id: typeof explanation.node_id === "string" ? explanation.node_id : nodeId,
    reason_kind: isReasonKind(explanation.reason_kind) ? explanation.reason_kind : "graph_expansion",
    summary: explanation.summary
  };

  if (typeof explanation.seed_score === "number") {
    parsed.seed_score = explanation.seed_score;
  }
  if (Array.isArray(explanation.seed_reasons)) {
    parsed.seed_reasons = explanation.seed_reasons.filter((reason): reason is string => typeof reason === "string");
  }
  if (typeof explanation.via_node_id === "string") {
    parsed.via_node_id = explanation.via_node_id;
  }
  if (typeof explanation.via_edge_id === "string") {
    parsed.via_edge_id = explanation.via_edge_id;
  }
  if (typeof explanation.via_edge_type === "string") {
    parsed.via_edge_type = explanation.via_edge_type;
  }
  if (typeof explanation.via_edge_confidence === "number") {
    parsed.via_edge_confidence = explanation.via_edge_confidence;
  }
  if (typeof explanation.evidence_score === "number") {
    parsed.evidence_score = explanation.evidence_score;
  }

  return parsed;
}

function isReasonKind(value: string): value is ContextNodeExplanation["reason_kind"] {
  return value === "direct_seed" || value === "retrieved_seed" || value === "graph_expansion";
}

function getTemplateInfo(pack: ContextPack): { id: string; name?: string } | null {
  const template = asRecord(pack.metadata.template);
  const id = typeof template?.id === "string" ? template.id : pack.template_id;
  const name = typeof template?.name === "string" ? template.name : undefined;

  if (!id) {
    return null;
  }

  return name ? { id, name } : { id };
}

function getPromptSegmentCache(pack: ContextPack): { hit: boolean } | null {
  const cache = asRecord(pack.metadata.prompt_segment_cache);

  if (typeof cache?.hit !== "boolean") {
    return null;
  }

  return { hit: cache.hit };
}

function getSummaryCache(pack: ContextPack): { hit: boolean } | null {
  const cache = asRecord(pack.metadata.summary_cache);

  if (typeof cache?.hit !== "boolean") {
    return null;
  }

  return { hit: cache.hit };
}

function getContextSummary(pack: ContextPack): { content: string } | null {
  const summary = asRecord(pack.metadata.context_summary);

  if (typeof summary?.content !== "string") {
    return null;
  }

  return { content: summary.content };
}

function getHandoffSourceContextPackId(pack: HandoffPack): string | null {
  const contextPackId = asRecord(pack.metadata)?.context_pack_id;
  return typeof contextPackId === "string" && contextPackId.length > 0 ? contextPackId : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
