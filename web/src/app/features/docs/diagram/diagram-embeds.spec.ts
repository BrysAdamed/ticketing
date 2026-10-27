import { loadMermaid } from '@shared/diagrams/mermaid/mermaid-renderer';
import { renderDiagramEmbeds } from './diagram-embeds';

function stubSvgLayout(): void {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  proto['getBBox'] ??= function (this: SVGElement) {
    const length = (this.textContent ?? '').length;
    return { x: 0, y: 0, width: Math.max(8, length * 7), height: 16 };
  };
  proto['getComputedTextLength'] ??= function (this: SVGElement) {
    return (this.textContent ?? '').length * 7;
  };
}

function embed(key: string, format = 'Mermaid'): string {
  return (
    `<figure class="tk-doc-embed" data-doc-key="${key}" data-diagram-format="${format}">` +
    `<div class="tk-doc-embed-h"><a href="/docs/${key}">${key}</a></div>` +
    `<div class="tk-doc-embed-body"></div><figcaption>caption</figcaption></figure>`
  );
}

describe('renderDiagramEmbeds', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    stubSvgLayout();
    await loadMermaid();
  }, 180_000);

  it('draws readable Mermaid embeds and leaves the others alone', async () => {
    // Arrange
    const root = document.createElement('div');
    root.innerHTML =
      embed('WEB-D-1') + embed('WEB-D-2') + embed('WEB-D-3', 'Canvas') + embed('WEB-D-9');
    const embeds = [
      {
        key: 'WEB-D-1',
        diagramFormat: 'Mermaid' as const,
        version: 2,
        content: 'flowchart LR\n  A --> B',
      },
      {
        key: 'WEB-D-2',
        diagramFormat: 'Mermaid' as const,
        version: 1,
        content: 'flowchart LR\n  A -->',
      },
      { key: 'WEB-D-3', diagramFormat: 'Canvas' as const, version: 1, content: null },
    ];

    // Act
    await renderDiagramEmbeds(root, embeds, 'light');

    // Assert
    const bodies = Array.from(root.querySelectorAll('.tk-doc-embed-body'));
    expect(bodies[0].querySelector('svg')).not.toBeNull();
    expect(bodies[1].querySelector('.tk-mermaid-error')).not.toBeNull();
    expect(bodies[2].childElementCount).toBe(0);
    expect(bodies[3].childElementCount).toBe(0);
    expect(root.querySelectorAll('figcaption')).toHaveLength(4);
  });
});
