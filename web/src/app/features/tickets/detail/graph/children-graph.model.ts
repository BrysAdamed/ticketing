import { TicketGraph, TicketGraphEdge, TicketGraphNode } from '@core/tickets/ticket.models';

/// Ready: open and nothing open blocks it. Blocked: open with at least one open `Blocks`
/// predecessor. Done: closed (D-94).
export type GraphNodeState = 'ready' | 'blocked' | 'done';

export interface GraphNode extends TicketGraphNode {
  state: GraphNodeState;
  /// Keys of the open tickets that block this one.
  blockedBy: string[];
  critical: boolean;
}

export interface GraphEdge extends TicketGraphEdge {
  critical: boolean;
  /// A `Blocks` edge whose blocker is done no longer blocks.
  satisfied: boolean;
  inCycle: boolean;
}

export interface ChildrenGraphModel {
  nodes: GraphNode[];
  blocks: GraphEdge[];
  /// `RelatesTo` and `Duplicates` edges; drawn, but not part of the layout.
  related: GraphEdge[];
  /// Nodes with at least one `Blocks` edge (laid out as layers) and without (laid out as a grid).
  linked: string[];
  unlinked: string[];
  /// The longest chain of open tickets over `Blocks`, blocker first; empty below two tickets.
  criticalPath: string[];
  /// Groups of tickets that block each other in a circle.
  cycles: string[][];
  /// Children only; external tickets are not counted.
  counts: Record<GraphNodeState, number>;
}

export interface Neighbourhood {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
}

/// Builds the view model of a children graph. External tickets are kept only when a `Blocks` link
/// ties them to a child, so the graph stays about dependencies.
export function buildGraphModel(graph: TicketGraph): ChildrenGraphModel {
  const blocking = graph.edges.filter((e) => e.type === 'Blocks');
  const blockingKeys = new Set(blocking.flatMap((e) => [e.from, e.to]));
  const shown = graph.nodes.filter((n) => !n.external || blockingKeys.has(n.key));
  const shownKeys = new Set(shown.map((n) => n.key));
  const isOpen = new Map(shown.map((n) => [n.key, n.status !== 'Done']));

  const blocks = blocking.filter((e) => shownKeys.has(e.from) && shownKeys.has(e.to));
  const cycles = findCycles(
    shown.map((n) => n.key),
    blocks,
  );
  const cycleOf = new Map(cycles.flatMap((c, i) => c.map((key) => [key, i] as const)));
  const criticalPath = longestOpenChain(
    shown.filter((n) => isOpen.get(n.key)).map((n) => n.key),
    blocks.filter((e) => isOpen.get(e.from) && isOpen.get(e.to)),
  );
  const criticalNodes = new Set(criticalPath);
  const criticalEdges = new Set(criticalPath.slice(1).map((to, i) => `${criticalPath[i]}>${to}`));

  const blockedBy = new Map<string, string[]>();
  for (const edge of blocks) {
    if (!isOpen.get(edge.from) || !isOpen.get(edge.to)) continue;
    blockedBy.set(edge.to, [...(blockedBy.get(edge.to) ?? []), edge.from]);
  }

  const nodes = shown.map<GraphNode>((n) => ({
    ...n,
    state: !isOpen.get(n.key) ? 'done' : blockedBy.has(n.key) ? 'blocked' : 'ready',
    blockedBy: blockedBy.get(n.key) ?? [],
    critical: criticalNodes.has(n.key),
  }));
  const toEdge = (e: TicketGraphEdge): GraphEdge => ({
    ...e,
    critical: e.type === 'Blocks' && criticalEdges.has(`${e.from}>${e.to}`),
    satisfied: e.type === 'Blocks' && !isOpen.get(e.from),
    inCycle:
      e.type === 'Blocks' && cycleOf.has(e.from) && cycleOf.get(e.from) === cycleOf.get(e.to),
  });

  const counts: Record<GraphNodeState, number> = { ready: 0, blocked: 0, done: 0 };
  for (const node of nodes) if (!node.external) counts[node.state]++;

  return {
    nodes,
    blocks: blocks.map(toEdge),
    related: graph.edges
      .filter((e) => e.type !== 'Blocks' && shownKeys.has(e.from) && shownKeys.has(e.to))
      .map(toEdge),
    linked: nodes.filter((n) => blockingKeys.has(n.key)).map((n) => n.key),
    unlinked: nodes.filter((n) => !blockingKeys.has(n.key)).map((n) => n.key),
    criticalPath,
    cycles,
    counts,
  };
}

/// Everything upstream (what blocks it, transitively) and downstream (what it blocks) of `key`.
export function neighbourhood(model: ChildrenGraphModel, key: string): Neighbourhood {
  const up = reach(key, model.blocks, (e) => [e.to, e.from]);
  const down = reach(key, model.blocks, (e) => [e.from, e.to]);
  const edges = model.blocks
    .filter((e) => (up.has(e.to) && up.has(e.from)) || (down.has(e.from) && down.has(e.to)))
    .map((e) => e.linkId);
  return { nodes: new Set([...up, ...down]), edges: new Set(edges) };
}

function reach(
  start: string,
  edges: readonly TicketGraphEdge[],
  direction: (e: TicketGraphEdge) => [string, string],
): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const [from, to] = direction(edge);
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    for (const to of next.get(queue.shift()!) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

/// Strongly connected components with more than one ticket (Tarjan), in input order.
function findCycles(keys: readonly string[], edges: readonly TicketGraphEdge[]): string[][] {
  const next = successors(keys, edges);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const order = new Map(keys.map((k, i) => [k, i]));

  const visit = (key: string): void => {
    index.set(key, index.size);
    low.set(key, index.get(key)!);
    stack.push(key);
    onStack.add(key);
    for (const to of next.get(key)!) {
      if (!index.has(to)) {
        visit(to);
        low.set(key, Math.min(low.get(key)!, low.get(to)!));
      } else if (onStack.has(to)) {
        low.set(key, Math.min(low.get(key)!, index.get(to)!));
      }
    }
    if (low.get(key) !== index.get(key)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== key);
    if (component.length > 1) cycles.push(component.sort((a, b) => order.get(a)! - order.get(b)!));
  };

  for (const key of keys) if (!index.has(key)) visit(key);
  return cycles.sort((a, b) => order.get(a[0])! - order.get(b[0])!);
}

/// Longest path by ticket count. Edges that close a cycle (back edges of a depth-first search in
/// input order) are ignored, so circular links never loop. Ties go to the earlier ticket.
function longestOpenChain(keys: readonly string[], edges: readonly TicketGraphEdge[]): string[] {
  const next = successors(keys, edges);
  const state = new Map<string, 'active' | 'done'>();
  const finished: string[] = [];
  const acyclic = new Map<string, string[]>(keys.map((k) => [k, []]));

  const visit = (key: string): void => {
    state.set(key, 'active');
    for (const to of next.get(key)!) {
      if (state.get(to) === 'active') continue;
      acyclic.get(key)!.push(to);
      if (!state.has(to)) visit(to);
    }
    state.set(key, 'done');
    finished.push(key);
  };
  for (const key of keys) if (!state.has(key)) visit(key);

  const length = new Map<string, number>();
  const best = new Map<string, string>();
  for (const key of finished) {
    let longest = 1;
    for (const to of acyclic.get(key)!) {
      if (length.get(to)! + 1 > longest) {
        longest = length.get(to)! + 1;
        best.set(key, to);
      }
    }
    length.set(key, longest);
  }

  let start: string | undefined;
  for (const key of keys)
    if (start === undefined || length.get(key)! > length.get(start)!) start = key;
  if (start === undefined || length.get(start)! < 2) return [];
  const path = [start];
  while (best.has(path[path.length - 1])) path.push(best.get(path[path.length - 1])!);
  return path;
}

function successors(
  keys: readonly string[],
  edges: readonly TicketGraphEdge[],
): Map<string, string[]> {
  const next = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const edge of edges) next.get(edge.from)?.push(edge.to);
  return next;
}
