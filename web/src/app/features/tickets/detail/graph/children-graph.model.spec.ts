import { describe, expect, it } from 'vitest';
import { TicketGraph } from '@core/tickets/ticket.models';
import { buildGraphModel, neighbourhood } from './children-graph.model';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './children-graph.layout';
import { blocks, fiftyTicketsWithCircularLinks, node } from './children-graph.fixtures';

/// Epic TKT-10 on the team's own instance (2026-10-27).
const docsEpic: TicketGraph = {
  key: 'TKT-10',
  nodes: Array.from({ length: 12 }, (_, i) => node(`TKT-${11 + i}`)),
  edges: [
    ['TKT-11', 'TKT-17'],
    ['TKT-11', 'TKT-18'],
    ['TKT-11', 'TKT-20'],
    ['TKT-12', 'TKT-13'],
    ['TKT-12', 'TKT-19'],
    ['TKT-13', 'TKT-14'],
    ['TKT-14', 'TKT-15'],
    ['TKT-14', 'TKT-16'],
    ['TKT-14', 'TKT-17'],
    ['TKT-14', 'TKT-21'],
    ['TKT-17', 'TKT-18'],
    ['TKT-18', 'TKT-20'],
    ['TKT-20', 'TKT-22'],
  ].map(([from, to]) => blocks(from, to)),
};

describe('children graph model', () => {
  it('marks open tickets with an open blocker as blocked and the rest as ready', () => {
    // Act
    const model = buildGraphModel(docsEpic);

    // Assert
    expect(model.nodes.filter((n) => n.state === 'ready').map((n) => n.key)).toEqual([
      'TKT-11',
      'TKT-12',
    ]);
    expect(model.counts).toEqual({ ready: 2, blocked: 10, done: 0 });
    expect(model.nodes.find((n) => n.key === 'TKT-17')?.blockedBy).toEqual(['TKT-11', 'TKT-14']);
  });

  it('follows the longest chain of open tickets as the critical path', () => {
    // Act
    const model = buildGraphModel(docsEpic);

    // Assert
    expect(model.criticalPath).toEqual([
      'TKT-12',
      'TKT-13',
      'TKT-14',
      'TKT-17',
      'TKT-18',
      'TKT-20',
      'TKT-22',
    ]);
    expect(model.blocks.filter((e) => e.critical)).toHaveLength(6);
    expect(model.nodes.filter((n) => n.critical)).toHaveLength(7);
  });

  it('frees tickets whose blockers are done and drops done tickets from the critical path', () => {
    // Arrange
    const graph: TicketGraph = {
      key: 'E-1',
      nodes: [node('E-2', 'Done'), node('E-3'), node('E-4', 'InProgress')],
      edges: [blocks('E-2', 'E-3'), blocks('E-3', 'E-4')],
    };

    // Act
    const model = buildGraphModel(graph);

    // Assert
    expect(model.nodes.map((n) => n.state)).toEqual(['done', 'ready', 'blocked']);
    expect(model.blocks.map((e) => e.satisfied)).toEqual([true, false]);
    expect(model.criticalPath).toEqual(['E-3', 'E-4']);
  });

  it('counts external blockers but keeps only externals tied by Blocks', () => {
    // Arrange
    const graph: TicketGraph = {
      key: 'E-1',
      nodes: [node('E-2'), node('E-3'), node('OPS-7', 'ToDo', true), node('OPS-8', 'ToDo', true)],
      edges: [
        blocks('OPS-7', 'E-2'),
        { linkId: 'rel', type: 'RelatesTo', from: 'E-3', to: 'OPS-8' },
        { linkId: 'dup', type: 'Duplicates', from: 'E-2', to: 'E-3' },
      ],
    };

    // Act
    const model = buildGraphModel(graph);

    // Assert
    expect(model.nodes.map((n) => n.key)).toEqual(['E-2', 'E-3', 'OPS-7']);
    expect(model.nodes[0].state).toBe('blocked');
    expect(model.counts).toEqual({ ready: 1, blocked: 1, done: 0 });
    expect(model.related.map((e) => e.linkId)).toEqual(['dup']);
    expect(model.linked).toEqual(['E-2', 'OPS-7']);
    expect(model.unlinked).toEqual(['E-3']);
  });

  it('reports circular blocking and still finds a finite critical path', () => {
    // Arrange
    const graph: TicketGraph = {
      key: 'E-1',
      nodes: [node('E-2'), node('E-3'), node('E-4'), node('E-5')],
      edges: [
        blocks('E-2', 'E-3'),
        blocks('E-3', 'E-4'),
        blocks('E-4', 'E-2'),
        blocks('E-4', 'E-5'),
      ],
    };

    // Act
    const model = buildGraphModel(graph);

    // Assert
    expect(model.cycles).toEqual([['E-2', 'E-3', 'E-4']]);
    expect(model.criticalPath).toEqual(['E-2', 'E-3', 'E-4', 'E-5']);
    expect(model.blocks.filter((e) => e.inCycle).map((e) => e.linkId)).toEqual([
      'E-2>E-3',
      'E-3>E-4',
      'E-4>E-2',
    ]);
    expect(model.nodes.every((n) => n.state === 'blocked')).toBe(true);
  });

  it('highlights everything upstream and downstream of a ticket', () => {
    // Arrange
    const model = buildGraphModel(docsEpic);

    // Act
    const around = neighbourhood(model, 'TKT-14');

    // Assert
    expect([...around.nodes].sort()).toEqual(
      [
        'TKT-12',
        'TKT-13',
        'TKT-14',
        'TKT-15',
        'TKT-16',
        'TKT-17',
        'TKT-18',
        'TKT-20',
        'TKT-21',
        'TKT-22',
      ].sort(),
    );
    expect(around.edges.has('TKT-11>TKT-17')).toBe(false);
    expect(around.edges.has('TKT-12>TKT-19')).toBe(false);
    expect(around.edges.has('TKT-18>TKT-20')).toBe(true);
  });

  it('has no critical path below two open tickets', () => {
    // Act
    const model = buildGraphModel({ key: 'E-1', nodes: [node('E-2'), node('E-3')], edges: [] });

    // Assert
    expect(model.criticalPath).toEqual([]);
    expect(model.unlinked).toEqual(['E-2', 'E-3']);
  });
});

describe('children graph layout', () => {
  it('places every blocker above what it blocks, without overlapping cards', () => {
    // Arrange
    const model = buildGraphModel(docsEpic);

    // Act
    const layout = layoutGraph(model);

    // Assert
    for (const edge of model.blocks)
      expect(layout.nodes.get(edge.from)!.y).toBeLessThan(layout.nodes.get(edge.to)!.y);
    const boxes = [...layout.nodes.values()];
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1))
        expect(Math.abs(a.x - b.x) >= NODE_WIDTH || Math.abs(a.y - b.y) >= NODE_HEIGHT).toBe(true);
    expect(layout.edges.size).toBe(model.blocks.length);
    expect(layout.unlinkedLabel).toBeNull();
  });

  it('starts every chain in the top layer and keeps every bend inside the box', () => {
    // Arrange
    const model = buildGraphModel(docsEpic);

    // Act
    const layout = layoutGraph(model);

    // Assert
    const top = Math.min(...[...layout.nodes.values()].map((p) => p.y));
    expect(layout.nodes.get('TKT-11')!.y).toBe(top);
    expect(layout.nodes.get('TKT-12')!.y).toBe(top);
    for (const d of layout.edges.values()) {
      const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      const xs = numbers.filter((_, i) => i % 2 === 0);
      const ys = numbers.filter((_, i) => i % 2 === 1);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(layout.width);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(layout.height);
    }
  });

  it('puts tickets without blocking links in a grid below the layers', () => {
    // Arrange
    const graph: TicketGraph = {
      key: 'E-1',
      nodes: [node('E-2'), node('E-3'), node('E-4'), node('E-5')],
      edges: [blocks('E-2', 'E-3')],
    };

    // Act
    const layout = layoutGraph(buildGraphModel(graph));

    // Assert
    const layered = Math.max(layout.nodes.get('E-2')!.y, layout.nodes.get('E-3')!.y);
    expect(layout.unlinkedLabel!.y).toBeGreaterThan(layered);
    expect(layout.nodes.get('E-4')!.y).toBe(layout.nodes.get('E-5')!.y);
    expect(layout.nodes.get('E-4')!.y).toBeGreaterThan(layout.unlinkedLabel!.y);
    expect(layout.height).toBeGreaterThan(layout.nodes.get('E-4')!.y + NODE_HEIGHT);
  });

  it('lays out 50 tickets with circular links', () => {
    // Arrange
    const graph = fiftyTicketsWithCircularLinks();

    // Act
    const layout = layoutGraph(buildGraphModel(graph));

    // Assert
    expect(layout.nodes.size).toBe(50);
    expect(layout.edges.size).toBe(graph.edges.length);
  });
});
