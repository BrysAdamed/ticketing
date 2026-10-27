import { renderMarkdown } from '@shared/markdown/render-markdown';
import { activeHeading, extractOutline, headingLines, syncedScrollTop } from './page-outline';

describe('page outline', () => {
  it('lists h1–h3 with ids and depths relative to the shallowest level', () => {
    // Arrange
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('## Overview\n\n### Sequence\n\n#### Deep\n\n## Overview', {
      headingAnchors: true,
    });

    // Act
    const outline = extractOutline(root);

    // Assert
    expect(outline).toEqual([
      { id: 'overview', text: 'Overview', depth: 1 },
      { id: 'sequence', text: 'Sequence', depth: 2 },
      { id: 'overview-2', text: 'Overview', depth: 1 },
    ]);
  });

  it('spies the last heading scrolled past the offset', () => {
    // Arrange
    const entries = [
      { id: 'a', top: 100 },
      { id: 'b', top: 150 },
      { id: 'c', top: 900 },
    ];

    // Act and Assert
    expect(activeHeading(entries, 100)).toBe('b');
    expect(
      activeHeading(
        entries.map((e) => ({ ...e, top: e.top + 500 })),
        100,
      ),
    ).toBe('a');
    expect(activeHeading([], 0)).toBeNull();
  });

  it('finds ATX heading lines outside code fences', () => {
    // Arrange
    const source = '# Title\ntext\n```md\n# not a heading\n```\n## Two\n    ### indented code';

    // Act and Assert
    expect(headingLines(source)).toEqual([0, 5]);
  });

  it('interpolates the preview position between heading anchors', () => {
    // Act and Assert
    expect(syncedScrollTop(10, [10, 30], [400, 1000], 51, 2000)).toBe(400);
    expect(syncedScrollTop(20, [10, 30], [400, 1000], 51, 2000)).toBe(700);
    expect(syncedScrollTop(40, [10, 30], [400, 1000], 51, 2000)).toBe(1500);
    expect(syncedScrollTop(25, [10], [400, 1000], 51, 2000)).toBe(1000);
  });
});
