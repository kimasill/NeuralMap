import type { GraphNode, TraceSpan } from "@neuralmap/schema";
import { Activity, Database, GitBranch, Network, RefreshCw, Search, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchAgents, fetchRunTrace, fetchWorkbenchGraph } from "./api.js";
import { GraphCanvas } from "./GraphCanvas.js";
import type { AgentSummary, RunTrace, WorkbenchGraph } from "./types.js";

const defaultRunId = "run_sample_phase_1";

export function App() {
  const [graph, setGraph] = useState<WorkbenchGraph | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const selectedNode = useMemo(
    () => graph?.nodes.find((node) => node.id === selectedNodeId) ?? graph?.nodes[0] ?? null,
    [graph, selectedNodeId]
  );

  const filteredNodes = useMemo(() => {
    if (!graph || query.trim().length === 0) {
      return [];
    }

    const normalized = query.trim().toLowerCase();
    return graph.nodes
      .filter((node) => `${node.title} ${node.type} ${node.summary ?? ""}`.toLowerCase().includes(normalized))
      .slice(0, 5);
  }, [graph, query]);

  const loadWorkbench = useCallback(async () => {
    const [nextGraph, nextAgents, nextTrace] = await Promise.all([
      fetchWorkbenchGraph(),
      fetchAgents(),
      fetchRunTrace(defaultRunId)
    ]);
    setGraph(nextGraph);
    setAgents(nextAgents);
    setTrace(nextTrace);
    setSelectedNodeId((current) => current ?? nextGraph.nodes[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  return (
    <main className="app-shell">
      <aside className="agent-panel" aria-label="Agent panel">
        <div className="panel-title">
          <Network size={18} />
          <span>Agents</span>
        </div>
        <div className="agent-list">
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      </aside>

      <section className="graph-stage" aria-label="Graph canvas">
        <div className="stage-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search nodes"
              aria-label="Search nodes"
            />
          </div>
          <span className={`data-mode ${graph?.mode === "database" ? "live" : "sample"}`}>
            {graph?.mode === "database" ? "Database" : "Sample"}
          </span>
          <button className="icon-button" type="button" onClick={() => void loadWorkbench()} aria-label="Refresh graph">
            <RefreshCw size={17} />
          </button>
        </div>

        {filteredNodes.length > 0 ? (
          <div className="search-results">
            {filteredNodes.map((node) => (
              <button key={node.id} type="button" onClick={() => handleSelectNode(node.id)}>
                {node.title}
              </button>
            ))}
          </div>
        ) : null}

        {graph ? (
          <GraphCanvas graph={graph} selectedNodeId={selectedNode?.id ?? null} onSelectNode={handleSelectNode} />
        ) : (
          <div className="loading-state">Loading graph</div>
        )}
      </section>

      <aside className="inspector-panel" aria-label="Context inspector">
        <NodeInspector node={selectedNode} />
      </aside>

      <section className="trace-panel" aria-label="Run trace">
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
    </main>
  );
}

function AgentRow({ agent }: { agent: AgentSummary }) {
  return (
    <article className="agent-row">
      <div className="agent-status">
        <Zap size={15} />
        <span>{agent.status}</span>
      </div>
      <h2>{agent.name}</h2>
      <p>{agent.task}</p>
      <dl>
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
    </article>
  );
}

function NodeInspector({ node }: { node: GraphNode | null }) {
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
    </div>
  );
}

function TraceRow({ span }: { span: TraceSpan }) {
  return (
    <article className="trace-row">
      <span>{span.kind}</span>
      <strong>{span.name}</strong>
    </article>
  );
}
