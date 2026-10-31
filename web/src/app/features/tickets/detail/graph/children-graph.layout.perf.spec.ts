import { describe, expect, it } from 'vitest';
import { buildGraphModel } from './children-graph.model';
import { layoutGraph } from './children-graph.layout';
import { fiftyTicketsWithCircularLinks } from './children-graph.fixtures';

describe('children graph layout performance', () => {
  it('lays out 50 tickets with circular links well within the 200 ms budget', () => {
    // Arrange
    const graph = fiftyTicketsWithCircularLinks();
    const started = performance.now();

    // Act
    const layout = layoutGraph(buildGraphModel(graph));

    // Assert
    expect(performance.now() - started).toBeLessThan(200);
    expect(layout.nodes.size).toBe(50);
  });
});
