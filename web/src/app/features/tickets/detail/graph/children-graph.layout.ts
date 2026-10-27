import dagre from '@dagrejs/dagre';
import { ChildrenGraphModel } from './children-graph.model';

export const NODE_WIDTH = 196;
export const NODE_HEIGHT = 58;
const NODE_GAP = 24;
const RANK_GAP = 44;
const MARGIN = 12;
const UNLINKED_LABEL = 28;
const MIN_GRID_COLUMNS = 3;

export interface Point {
  x: number;
  y: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  /// Top-left corner of each node card.
  nodes: ReadonlyMap<string, Point>;
  /// SVG path data per link id.
  edges: ReadonlyMap<string, string>;
  /// Where the "No blocking links" label of the grid sits, or null without unlinked tickets.
  unlinkedLabel: Point | null;
}

/// Lays out the `Blocks` edges top to bottom with dagre (D-94); tickets without blocking links go
/// in a grid below. `RelatesTo` / `Duplicates` edges are drawn between the placed cards.
export function layoutGraph(model: ChildrenGraphModel): GraphLayout {
  const g = new dagre.graphlib.Graph<
    object,
    { width: number; height: number; x?: number; y?: number }
  >();
  g.setGraph({
    rankdir: 'TB',
    nodesep: NODE_GAP,
    ranksep: RANK_GAP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const key of model.linked) g.setNode(key, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of model.blocks) g.setEdge(edge.from, edge.to);
  if (model.linked.length > 0) dagre.layout(g);

  const nodes = new Map<string, Point>();
  for (const key of model.linked) {
    const { x = 0, y = 0 } = g.node(key);
    nodes.set(key, { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 });
  }
  const edges = new Map<string, string>();
  for (const edge of model.blocks) {
    const label = g.edge(edge.from, edge.to) as { points?: Point[] } | undefined;
    if (label?.points) edges.set(edge.linkId, smoothPath(label.points));
  }

  const graphLabel = g.graph() as { width?: number; height?: number };
  let width = model.linked.length > 0 ? (graphLabel.width ?? 0) : 0;
  let height = model.linked.length > 0 ? (graphLabel.height ?? 0) : 0;

  let unlinkedLabel: Point | null = null;
  if (model.unlinked.length > 0) {
    const columns = Math.max(
      MIN_GRID_COLUMNS,
      Math.floor((width - 2 * MARGIN + NODE_GAP) / (NODE_WIDTH + NODE_GAP)),
    );
    const top = height + (model.linked.length > 0 ? 8 : MARGIN);
    unlinkedLabel = model.linked.length > 0 ? { x: MARGIN, y: top } : null;
    const gridTop = top + (unlinkedLabel ? UNLINKED_LABEL : 0);
    model.unlinked.forEach((key, i) => {
      nodes.set(key, {
        x: MARGIN + (i % columns) * (NODE_WIDTH + NODE_GAP),
        y: gridTop + Math.floor(i / columns) * (NODE_HEIGHT + NODE_GAP),
      });
    });
    const rows = Math.ceil(model.unlinked.length / columns);
    const used = Math.min(columns, model.unlinked.length);
    width = Math.max(width, 2 * MARGIN + used * NODE_WIDTH + (used - 1) * NODE_GAP);
    height = gridTop + rows * NODE_HEIGHT + (rows - 1) * NODE_GAP + MARGIN;
  }

  for (const edge of model.related) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from && to) edges.set(edge.linkId, arc(center(from), center(to)));
  }

  return { width, height, nodes, edges, unlinkedLabel };
}

/// A Catmull-Rom spline through dagre's bend points, as cubic Béziers.
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const p = points.map((pt) => ({ x: round(pt.x), y: round(pt.y) }));
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const c1 = { x: round(p1.x + (p2.x - p0.x) / 6), y: round(p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: round(p2.x - (p3.x - p1.x) / 6), y: round(p2.y - (p3.y - p1.y) / 6) };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

function arc(from: Point, to: Point): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const bend = 0.18;
  const cx = round(mx - (to.y - from.y) * bend);
  const cy = round(my + (to.x - from.x) * bend);
  return `M${round(from.x)},${round(from.y)} Q${cx},${cy} ${round(to.x)},${round(to.y)}`;
}

function center(p: Point): Point {
  return { x: p.x + NODE_WIDTH / 2, y: p.y + NODE_HEIGHT / 2 };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
