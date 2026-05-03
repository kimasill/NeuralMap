import type { Core, EventObject, StylesheetJson } from "cytoscape";
import { memo, useEffect, useMemo, useRef } from "react";

import type { WorkbenchGraph } from "./types.js";

interface GraphCanvasProps {
  graph: WorkbenchGraph;
  selectedNodeId: string | null;
  focusedNodeIds?: readonly string[];
  focusedEdgeIds?: readonly string[];
  onSelectNode: (nodeId: string) => void;
}

const nodeColors: Record<string, string> = {
  Agent: "#60a5fa",
  Session: "#38bdf8",
  Run: "#22c55e",
  Task: "#f59e0b",
  Decision: "#f97316",
  Summary: "#a78bfa",
  Template: "#ec4899",
  Repository: "#2dd4bf",
  CodeFile: "#84cc16",
  CodeSymbol: "#bef264",
  Document: "#eab308",
  DocSection: "#fde047",
  Ticket: "#fb7185",
  PR: "#c084fc",
  Commit: "#818cf8",
  TestCase: "#34d399",
  Error: "#ef4444",
  Artifact: "#94a3b8",
  Person: "#f472b6",
  Policy: "#facc15"
};

const stylesheet: StylesheetJson = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      "border-color": "#0f172a",
      "border-width": 2,
      color: "#dbeafe",
      "font-family": "Inter, ui-sans-serif, system-ui",
      "font-size": 11,
      height: "mapData(score, 0.5, 1, 28, 54)",
      label: "data(label)",
      "overlay-opacity": 0,
      shape: "ellipse",
      "text-background-color": "#111827",
      "text-background-opacity": 0.78,
      "text-background-padding": "3px",
      "text-margin-y": 8,
      "text-valign": "bottom",
      width: "mapData(score, 0.5, 1, 28, 54)"
    }
  },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "line-color": "#64748b",
      opacity: 0.68,
      "target-arrow-color": "#64748b",
      "target-arrow-shape": "triangle",
      width: "mapData(weight, 0, 1, 1, 5)"
    }
  },
  {
    selector: "node.query-hit",
    style: {
      "border-color": "#22c55e",
      "border-width": 4
    }
  },
  {
    selector: "edge.query-hit",
    style: {
      "line-color": "#22c55e",
      opacity: 0.95,
      "target-arrow-color": "#22c55e",
      width: "mapData(weight, 0, 1, 2, 6)"
    }
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#f8fafc",
      "border-width": 4
    }
  }
];

export const GraphCanvas = memo(function GraphCanvas({
  graph,
  selectedNodeId,
  focusedNodeIds = [],
  focusedEdgeIds = [],
  onSelectNode
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const elements = useMemo(
    () => {
      const focusedNodes = new Set(focusedNodeIds);
      const focusedEdges = new Set(focusedEdgeIds);

      return [
        ...graph.nodes.map((node) => ({
          classes: focusedNodes.has(node.id) ? "query-hit" : "",
          data: {
            id: node.id,
            label: node.title,
            type: node.type,
            score: node.importance_score,
            color: nodeColors[node.type] ?? "#94a3b8"
          }
        })),
        ...graph.edges.map((edge) => ({
          classes: focusedEdges.has(edge.id) ? "query-hit" : "",
          data: {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            type: edge.type,
            weight: edge.weight
          }
        }))
      ];
    },
    [focusedEdgeIds, focusedNodeIds, graph]
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let disposed = false;
    let instance: Core | null = null;

    const handleTap = (event: EventObject) => {
      onSelectNode(event.target.id());
    };

    void import("cytoscape").then(({ default: cytoscape }) => {
      if (disposed || !containerRef.current) {
        return;
      }

      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: stylesheet,
        layout: {
          name: "cose",
          animate: true,
          fit: true,
          padding: 42,
          nodeRepulsion: 5800,
          idealEdgeLength: 110
        }
      });

      cy.on("tap", "node", handleTap);
      cyRef.current = cy;
      instance = cy;
    });

    return () => {
      disposed = true;
      instance?.off("tap", "node", handleTap);
      instance?.destroy();
      cyRef.current = null;
    };
  }, [elements, onSelectNode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    cy.nodes().unselect();
    if (selectedNodeId) {
      cy.getElementById(selectedNodeId).select();
    }
  }, [selectedNodeId]);

  return <div className="graph-canvas" ref={containerRef} />;
});
