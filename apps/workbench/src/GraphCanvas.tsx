import "./GraphCanvas.css";

import { Boxes, Brain, Maximize2, Minus, Plus, Square } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ForceGraph3D from "react-force-graph-3d";

import type { WorkbenchGraph } from "./types.js";

// ---------------------------------------------------------------------------
// Props contract -- must not change (imported by App.tsx as named export)
// ---------------------------------------------------------------------------
interface GraphCanvasProps {
  graph: WorkbenchGraph;
  selectedNodeId: string | null;
  focusedNodeIds?: readonly string[]; // query-hit highlight
  focusedEdgeIds?: readonly string[];
  onSelectNode: (nodeId: string) => void;
}

type ViewMode = "3d" | "2d";

// ---------------------------------------------------------------------------
// Design-system node-type palette
// ---------------------------------------------------------------------------
const NODE_COLORS: Record<string, string> = {
  Agent:      "#7b87ff",
  Session:    "#56b6e6",
  Run:        "#3fb950",
  Task:       "#e3a13b",
  Decision:   "#e8743b",
  Summary:    "#a98bf0",
  Template:   "#e173b8",
  Repository: "#2bb6a6",
  CodeFile:   "#84b94a",
  CodeSymbol: "#a7d05a",
  Document:   "#d9b53f",
  DocSection: "#e6cd5a",
  Ticket:     "#ef6a7e",
  PR:         "#b98cf0",
  Commit:     "#8088ee",
  TestCase:   "#45c08a",
  Error:      "#f0664f",
  Person:     "#ef83b6",
  Policy:     "#e0c24a",
  Artifact:   "#8a9099",
};

const FALLBACK_COLOR = "#8a9099";
const ACCENT = "#7b87ff";
const HIT = "#3fb950";
const BG = "#0a0b0d";

function nodeColor(type: string): string {
  return NODE_COLORS[type] ?? FALLBACK_COLOR;
}

// Cluster key: group nodes by their owning simulation (or id namespace) so
// related neurons settle together and unrelated subgraphs stay apart.
function nodeGroup(id: string, type: string): string {
  const sim = /^simulation:([^:]+):/u.exec(id);
  if (sim) return `sim:${sim[1]}`;
  const colon = id.indexOf(":");
  if (colon > 0) return id.slice(0, colon);
  return type;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Force-graph data shapes
// ---------------------------------------------------------------------------
interface FGNode {
  id: string;
  label: string;
  type: string;
  score: number;
  val: number;
  color: string;
  group: string;
  x?: number;
  y?: number;
  z?: number;
}

interface FGLink {
  id: string;
  source: string | FGNode;
  target: string | FGNode;
  type: string;
  weight: number;
}

function linkEndId(end: string | FGNode): string {
  return typeof end === "object" ? end.id : end;
}

// Minimal surface of the imperative force-graph handle we actually call.
interface FGHandle {
  zoom?: (k?: number, ms?: number) => number;
  zoomToFit?: (ms?: number, px?: number) => void;
  cameraPosition?: (
    pos?: { x: number; y: number; z: number },
    lookAt?: unknown,
    ms?: number
  ) => { x: number; y: number; z: number };
  postProcessingComposer?: () => { addPass: (pass: unknown) => void; passes?: unknown[] };
  d3Force?: (name: string) =>
    | {
        strength?: (s: number | ((node: unknown) => number)) => unknown;
        distance?: (d: number | ((link: unknown) => number)) => unknown;
      }
    | undefined;
  d3ReheatSimulation?: () => void;
}

// ---------------------------------------------------------------------------
// Legend helpers
// ---------------------------------------------------------------------------
interface LegendEntry {
  type: string;
  color: string;
  count: number;
}

function buildLegend(nodes: WorkbenchGraph["nodes"]): LegendEntry[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, color: nodeColor(type), count }));
}

// ---------------------------------------------------------------------------
// Container size tracking (force-graph needs explicit width/height)
// ---------------------------------------------------------------------------
function useElementSize(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    // Synchronous initial read -- ResizeObserver's first callback is unreliable
    // in some embedded browsers, so don't depend on it for the initial size.
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return [ref, size];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const GraphCanvas = memo(function GraphCanvas({
  graph,
  selectedNodeId,
  focusedNodeIds = [],
  focusedEdgeIds = [],
  onSelectNode,
}: GraphCanvasProps) {
  const [containerRef, size] = useElementSize();
  const fgRef = useRef<FGHandle | undefined>(undefined);
  const [mode, setMode] = useState<ViewMode>("3d");
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Auto-fit happens once per (graph, mode). Once the user zooms/pans we never
  // re-fit, so a late engine-stop can't snap their view back out.
  const didFitRef = useRef(false);
  const userInteractedRef = useRef(false);
  const markInteracted = useCallback(() => {
    userInteractedRef.current = true;
  }, []);

  const focusedNodeSet = useMemo(() => new Set(focusedNodeIds), [focusedNodeIds]);
  const focusedEdgeSet = useMemo(() => new Set(focusedEdgeIds), [focusedEdgeIds]);

  // -------------------------------------------------------------------------
  // Graph data -- rebuilt only when the graph itself changes so the layout
  // is preserved across focus / hover updates.
  // -------------------------------------------------------------------------
  const graphData = useMemo(() => {
    const base = graph.nodes.map((node) => ({
      id: node.id,
      label: node.title,
      type: node.type,
      score: node.importance_score,
      val: 0.6 + node.importance_score * 2.2,
      color: nodeColor(node.type),
      group: nodeGroup(node.id, node.type),
    }));

    // Seed each group at a distinct ring anchor so unrelated subgraphs
    // (e.g. different simulations) start apart instead of one tangled blob.
    const groups = Array.from(new Set(base.map((n) => n.group)));
    const ring = Math.max(180, groups.length * 95);
    const anchor = new Map<string, { x: number; y: number }>();
    groups.forEach((g, i) => {
      const a = (i / Math.max(1, groups.length)) * Math.PI * 2;
      anchor.set(g, { x: Math.cos(a) * ring, y: Math.sin(a) * ring });
    });

    const nodes: FGNode[] = base.map((n) => {
      const c = anchor.get(n.group) ?? { x: 0, y: 0 };
      const jitter = 80;
      return {
        ...n,
        x: c.x + (Math.random() - 0.5) * jitter,
        y: c.y + (Math.random() - 0.5) * jitter,
        z: (Math.random() - 0.5) * jitter,
      };
    });
    const links: FGLink[] = graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: edge.type,
      weight: edge.weight,
    }));
    return { nodes, links };
  }, [graph]);

  // Adjacency: edge id -> endpoints, and node id -> connected edge ids.
  const adjacency = useMemo(() => {
    const nodeEdges = new Map<string, Set<string>>();
    for (const link of graphData.links) {
      const s = linkEndId(link.source);
      const t = linkEndId(link.target);
      if (!nodeEdges.has(s)) nodeEdges.set(s, new Set());
      if (!nodeEdges.has(t)) nodeEdges.set(t, new Set());
      nodeEdges.get(s)!.add(link.id);
      nodeEdges.get(t)!.add(link.id);
    }
    return nodeEdges;
  }, [graphData]);

  const activeNodeId = hoverId ?? selectedNodeId;
  const activeEdges = useMemo(
    () => (activeNodeId ? adjacency.get(activeNodeId) ?? new Set<string>() : new Set<string>()),
    [activeNodeId, adjacency]
  );

  // Ambient "alive" flow only when the network is small enough to stay readable.
  const ambientFlow = graphData.links.length <= 140;

  // -------------------------------------------------------------------------
  // Accessors (identity changes with focus/hover so the wrapper re-applies)
  // -------------------------------------------------------------------------
  const isNodeActive = useCallback(
    (id: string) => id === selectedNodeId || id === hoverId || focusedNodeSet.has(id),
    [focusedNodeSet, hoverId, selectedNodeId]
  );

  const getNodeColor = useCallback(
    (node: FGNode) => {
      if (node.id === selectedNodeId) return ACCENT;
      if (focusedNodeSet.has(node.id)) return HIT;
      const dim = activeNodeId && !isNodeActive(node.id) && !activeEdges.size;
      return dim ? rgba(node.color, 0.55) : node.color;
    },
    [activeEdges.size, activeNodeId, focusedNodeSet, isNodeActive, selectedNodeId]
  );

  const linkState = useCallback(
    (link: FGLink): "hit" | "active" | "base" => {
      if (focusedEdgeSet.has(link.id)) return "hit";
      if (activeEdges.has(link.id)) return "active";
      return "base";
    },
    [activeEdges, focusedEdgeSet]
  );

  const getLinkColor = useCallback(
    (link: FGLink) => {
      switch (linkState(link)) {
        case "hit":
          return rgba(HIT, 0.9);
        case "active":
          return rgba(ACCENT, 0.8);
        default: {
          // 2D needs more contrast than 3D (no depth cue) to read connections.
          const idle = mode === "2d" ? 0.42 : 0.3;
          const dimmed = mode === "2d" ? 0.2 : 0.16;
          return rgba("#525762", activeNodeId ? dimmed : idle);
        }
      }
    },
    [activeNodeId, linkState, mode]
  );

  const getLinkWidth = useCallback(
    (link: FGLink) => {
      const floor = mode === "2d" ? 0.6 : 0.4;
      const span = mode === "2d" ? 1.8 : 1.4;
      const base = floor + link.weight * span;
      return linkState(link) === "base" ? base : base + 1.4;
    },
    [linkState, mode]
  );

  const getLinkParticles = useCallback(
    (link: FGLink) => {
      const state = linkState(link);
      if (state === "hit") return 4;
      if (state === "active") return 3;
      return ambientFlow ? 1 : 0;
    },
    [ambientFlow, linkState]
  );

  const getLinkParticleColor = useCallback(
    (link: FGLink) => {
      const state = linkState(link);
      if (state === "hit") return HIT;
      if (state === "active") return ACCENT;
      return rgba("#7b87ff", 0.4);
    },
    [linkState]
  );

  const getLinkParticleWidth = useCallback(
    (link: FGLink) => (linkState(link) === "base" ? 1.6 : 2.6),
    [linkState]
  );

  // -------------------------------------------------------------------------
  // 2D node renderer -- circle + label only for important / active nodes
  // -------------------------------------------------------------------------
  const paintNode2D = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = 2.5 + node.score * 4.5;
      const active = isNodeActive(node.id);
      const fill = getNodeColor(node);

      if (active) {
        ctx.shadowColor = fill;
        ctx.shadowBlur = 12;
      }
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.shadowBlur = 0;

      if (active) {
        ctx.lineWidth = 1.5 / globalScale;
        ctx.strokeStyle = node.id === selectedNodeId ? ACCENT : "rgba(236,238,241,0.8)";
        ctx.stroke();
      }

      // Labels: only show when there's room (zoomed in enough) and for
      // important / active nodes, at a constant on-screen size so they never
      // balloon when zooming in.
      const showLabel = active || (node.score >= 0.6 && globalScale > 0.85);
      if (showLabel && globalScale > 0.55) {
        const fontSize = 11 / globalScale; // constant ~11px on screen
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = active ? "#eceef1" : "rgba(168,171,179,0.85)";
        const label = node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label;
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + 3 / globalScale);
      }
    },
    [getNodeColor, isNodeActive, selectedNodeId]
  );

  const paintNodePointer2D = useCallback(
    (node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
      const r = Math.max(4, 2 + node.score * 5) + 2;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  // -------------------------------------------------------------------------
  // 3D bloom glow -- attach UnrealBloomPass once the instance exists
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (mode !== "3d") return;
    let cancelled = false;

    void Promise.all([
      import("three"),
      import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
    ]).then(([three, { UnrealBloomPass }]) => {
      if (cancelled) return;
      const composer = fgRef.current?.postProcessingComposer?.();
      if (!composer) return;
      // Avoid stacking passes if the effect re-runs.
      if (composer.passes && composer.passes.length > 1) return;
      // strength, radius, threshold — softer so neurons read as crisp spheres
      // with a subtle glow instead of washed-out blobs.
      const bloom = new UnrealBloomPass(
        new three.Vector2(size.width || 800, size.height || 600),
        0.6,
        0.4,
        0.22
      );
      composer.addPass(bloom);
    });

    return () => {
      cancelled = true;
    };
  }, [mode, size.height, size.width]);

  // -------------------------------------------------------------------------
  // Fit once after the first layout settles -- but never override a view the
  // user has already zoomed/panned (this was the "zoom in -> snaps back" bug).
  // -------------------------------------------------------------------------
  const handleEngineStop = useCallback(() => {
    if (userInteractedRef.current || didFitRef.current) return;
    didFitRef.current = true;
    fgRef.current?.zoomToFit?.(600, mode === "3d" ? 80 : 48);
  }, [mode]);

  // Reset the fit gate and re-tune forces whenever the graph or mode changes so
  // each fresh layout breathes (less clumping) and auto-fits exactly once.
  // `ready` flips to true once the canvas is mounted, which is when the
  // force-graph instance (and its d3 forces) actually exist.
  const ready = size.width > 0;
  useEffect(() => {
    didFitRef.current = false;
    userInteractedRef.current = false;
    if (!ready) return;

    const fg = fgRef.current;
    if (!fg?.d3Force) return;
    fg.d3Force("charge")?.strength?.(mode === "2d" ? -110 : -80);
    fg.d3Force("link")?.distance?.((link: unknown) => 26 + (1 - clamp01((link as FGLink).weight)) * 44);
    fg.d3ReheatSimulation?.();
  }, [graphData, mode, ready]);

  // -------------------------------------------------------------------------
  // Selection follow -- recenter on the selected node.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedNodeId) return;
    const node = graphData.nodes.find((n) => n.id === selectedNodeId) as
      | (FGNode & { x?: number; y?: number; z?: number })
      | undefined;
    if (!node || mode !== "3d") return;
    if (typeof node.x !== "number") return;
    const distance = 120;
    const hypot = Math.hypot(node.x, node.y ?? 0, (node as { z?: number }).z ?? 0) || 1;
    const ratio = 1 + distance / hypot;
    fgRef.current?.cameraPosition?.(
      { x: node.x * ratio, y: (node.y ?? 0) * ratio, z: ((node as { z?: number }).z ?? 0) * ratio },
      undefined,
      600
    );
  }, [graphData.nodes, mode, selectedNodeId]);

  // -------------------------------------------------------------------------
  // Zoom controls
  // -------------------------------------------------------------------------
  const handleZoomIn = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (mode === "2d" && fg.zoom) {
      fg.zoom(fg.zoom() * 1.3, 250);
    } else if (fg.cameraPosition) {
      const cam = fg.cameraPosition();
      fg.cameraPosition({ x: cam.x * 0.8, y: cam.y * 0.8, z: cam.z * 0.8 }, undefined, 250);
    }
  }, [mode]);

  const handleZoomOut = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (mode === "2d" && fg.zoom) {
      fg.zoom(fg.zoom() * 0.77, 250);
    } else if (fg.cameraPosition) {
      const cam = fg.cameraPosition();
      fg.cameraPosition({ x: cam.x * 1.25, y: cam.y * 1.25, z: cam.z * 1.25 }, undefined, 250);
    }
  }, [mode]);

  const handleFit = useCallback(() => {
    fgRef.current?.zoomToFit?.(500, mode === "3d" ? 80 : 48);
  }, [mode]);

  const handleNodeClick = useCallback(
    (node: FGNode) => onSelectNode(node.id),
    [onSelectNode]
  );

  const handleNodeHover = useCallback(
    (node: FGNode | null) => setHoverId(node?.id ?? null),
    []
  );

  const legendEntries = useMemo(() => buildLegend(graph.nodes), [graph.nodes]);
  const isEmpty = graph.nodes.length === 0;

  // Shared props for both renderers.
  const common = {
    graphData,
    width: size.width,
    height: size.height,
    backgroundColor: BG,
    nodeId: "id",
    nodeVal: "val" as const,
    nodeColor: getNodeColor as (n: object) => string,
    nodeLabel: ((n: FGNode) => `${n.label}  ·  ${n.type}`) as (n: object) => string,
    linkColor: getLinkColor as (l: object) => string,
    linkWidth: getLinkWidth as (l: object) => number,
    linkDirectionalParticles: getLinkParticles as (l: object) => number,
    linkDirectionalParticleColor: getLinkParticleColor as (l: object) => string,
    linkDirectionalParticleWidth: getLinkParticleWidth as (l: object) => number,
    linkDirectionalParticleSpeed: 0.006,
    onNodeClick: handleNodeClick as (n: object) => void,
    onNodeHover: handleNodeHover as (n: object | null) => void,
    onEngineStop: handleEngineStop,
    cooldownTicks: 120,
    warmupTicks: 20,
  };

  return (
    <div
      className="nm-graph"
      ref={containerRef}
      onWheelCapture={markInteracted}
      onPointerDownCapture={markInteracted}
    >
      {/* Empty state */}
      {isEmpty && (
        <div className="nm-graph__empty">
          <Brain className="nm-graph__empty-icon" size={36} strokeWidth={1.25} />
          <span className="nm-graph__empty-label">No connected neurons</span>
        </div>
      )}

      {/* Force-graph surface */}
      {!isEmpty && size.width > 0 && (
        mode === "3d" ? (
          <ForceGraph3D
            ref={fgRef as never}
            {...common}
            nodeOpacity={0.95}
            nodeResolution={16}
            linkOpacity={0.45}
            showNavInfo={false}
          />
        ) : (
          <ForceGraph2D
            ref={fgRef as never}
            {...common}
            nodeCanvasObject={paintNode2D as never}
            nodePointerAreaPaint={paintNodePointer2D as never}
            linkDirectionalParticleColor={getLinkParticleColor as never}
          />
        )
      )}

      {/* Top-right controls */}
      {!isEmpty && (
        <div className="nm-graph__controls" aria-label="Graph view controls">
          <div className="nm-graph__mode" role="group" aria-label="View mode">
            <button
              type="button"
              className={`nm-graph__mode-btn ${mode === "3d" ? "active" : ""}`}
              onClick={() => setMode("3d")}
              title="3D view"
              aria-pressed={mode === "3d"}
            >
              <Boxes size={13} strokeWidth={2} />
              <span>3D</span>
            </button>
            <button
              type="button"
              className={`nm-graph__mode-btn ${mode === "2d" ? "active" : ""}`}
              onClick={() => setMode("2d")}
              title="2D view"
              aria-pressed={mode === "2d"}
            >
              <Square size={12} strokeWidth={2} />
              <span>2D</span>
            </button>
          </div>
          <div className="nm-graph__zoom">
            <button className="nm-graph__ctrl-btn" onClick={handleZoomIn} title="Zoom in" type="button" aria-label="Zoom in">
              <Plus size={14} strokeWidth={2} />
            </button>
            <button className="nm-graph__ctrl-btn" onClick={handleZoomOut} title="Zoom out" type="button" aria-label="Zoom out">
              <Minus size={14} strokeWidth={2} />
            </button>
            <div className="nm-graph__ctrl-divider" role="separator" />
            <button className="nm-graph__ctrl-btn" onClick={handleFit} title="Fit to view" type="button" aria-label="Fit graph to view">
              <Maximize2 size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* Legend -- bottom-left */}
      {legendEntries.length > 0 && (
        <div className="nm-graph__legend" aria-label="Node type legend">
          <div className="nm-graph__legend-title">Node types</div>
          {legendEntries.map((entry) => (
            <div key={entry.type} className="nm-graph__legend-item">
              <span className="nm-graph__legend-swatch" style={{ background: entry.color }} aria-hidden="true" />
              <span>{entry.type}</span>
              <span className="nm-graph__legend-count">{entry.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
