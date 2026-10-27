import dagre from '@dagrejs/dagre';
import { ChildrenGraphModel } from './children-graph.model';

export const NODE_WIDTH = 204;
export const NODE_HEIGHT = 68;
const NODE_GAP = 24;
const RANK_GAP = 40;
const MARGIN = 12;
const UNLINKED_LABEL = 28;
const MIN_GRID_COLUMNS = 3;
const ROOT = '\u0000root';
const ROOT_WEIGHT = 8;

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
  const { nodes, edges, width: layeredWidth, height: layeredHeight } = layers(model);
  let width = layeredWidth;
  let height = layeredHeight;

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

/// dagre places sources near what they block; a hidden root with heavy edges to every source puts
/// all of them in the top layer, so "what can start" reads first. dagre may route long edges
/// outside its own bounds, so the box is measured from the cards and every bend point.
function layers(model: ChildrenGraphModel): {
  nodes: Map<string, Point>;
  edges: Map<string, string>;
  width: number;
  height: number;
} {
  const nodes = new Map<string, Point>();
  const edges = new Map<string, string>();
  if (model.linked.length === 0) return { nodes, edges, width: 0, height: 0 };

  const g = new dagre.graphlib.Graph<
    object,
    { width: number; height: number; x?: number; y?: number }
  >();
  g.setGraph({ rankdir: 'TB', nodesep: NODE_GAP, ranksep: RANK_GAP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const key of model.linked) g.setNode(key, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of model.blocks) g.setEdge(edge.from, edge.to);
  const blocked = new Set(model.blocks.map((e) => e.to));
  const sources = model.linked.filter((key) => !blocked.has(key));
  if (sources.length > 1) {
    g.setNode(ROOT, { width: 1, height: 1 });
    for (const key of sources) g.setEdge(ROOT, key, { weight: ROOT_WEIGHT, minlen: 1 });
  }
  dagre.layout(g);

  const routes = new Map<string, Point[]>();
  for (const edge of model.blocks) {
    const label = g.edge(edge.from, edge.to) as { points?: Point[] } | undefined;
    if (label?.points) routes.set(edge.linkId, label.points);
  }
  const corners = model.linked.map((key) => {
    const { x = 0, y = 0 } = g.node(key);
    return [key, { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 }] as const;
  });
  const xs = [
    ...corners.flatMap(([, p]) => [p.x, p.x + NODE_WIDTH]),
    ...[...routes.values()].flat().map((p) => p.x),
  ];
  const ys = [
    ...corners.flatMap(([, p]) => [p.y, p.y + NODE_HEIGHT]),
    ...[...routes.values()].flat().map((p) => p.y),
  ];
  const dx = MARGIN - Math.min(...xs);
  const dy = MARGIN - Math.min(...ys);

  for (const [key, p] of corners) nodes.set(key, { x: p.x + dx, y: p.y + dy });
  for (const [id, points] of routes)
    edges.set(id, smoothPath(points.map((p) => ({ x: p.x + dx, y: p.y + dy }))));
  return {
    nodes,
    edges,
    width: Math.max(...xs) + dx + MARGIN,
    height: Math.max(...ys) + dy + MARGIN,
  };
}

/// A uniform cubic B-spline over dagre's bend points (as d3's `curveBasis`): it starts and ends on
/// the first and last point and never overshoots the bends.
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const p = points;
  const at = (x: number, y: number) => `${round(x)},${round(y)}`;
  let d = `M${at(p[0].x, p[0].y)}`;
  if (p.length === 1) return d;
  if (p.length === 2) return `${d} L${at(p[1].x, p[1].y)}`;
  d += ` L${at((5 * p[0].x + p[1].x) / 6, (5 * p[0].y + p[1].y) / 6)}`;
  for (let i = 2; i <= p.length; i++) {
    const a = p[i - 2];
    const b = p[i - 1];
    const c = p[Math.min(i, p.length - 1)];
    d +=
      ` C${at((2 * a.x + b.x) / 3, (2 * a.y + b.y) / 3)}` +
      ` ${at((a.x + 2 * b.x) / 3, (a.y + 2 * b.y) / 3)}` +
      ` ${at((a.x + 4 * b.x + c.x) / 6, (a.y + 4 * b.y + c.y) / 6)}`;
  }
  const last = p[p.length - 1];
  return `${d} L${at(last.x, last.y)}`;
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
