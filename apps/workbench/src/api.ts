import { fallbackAgents, fallbackGraph, fallbackTrace } from "./fallback.js";
import type { AgentSummary, RunTrace, WorkbenchGraph } from "./types.js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4317";

export async function fetchWorkbenchGraph(): Promise<WorkbenchGraph> {
  return fetchJson<WorkbenchGraph>("/workbench/graph/subgraph", fallbackGraph);
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const response = await fetchJson<{ agents: AgentSummary[] }>("/workbench/agents", { agents: fallbackAgents });
  return response.agents;
}

export async function fetchRunTrace(runId: string): Promise<RunTrace> {
  return fetchJson<RunTrace>(`/workbench/runs/${runId}/trace`, fallbackTrace);
}

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`);

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

