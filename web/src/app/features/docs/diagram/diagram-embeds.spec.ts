import { loadMermaid } from '@shared/diagrams/mermaid/mermaid-renderer';
import { INTERNAL_LINK_ATTR } from '@shared/markdown/render-markdown';
import { CANVAS_DARK_FILTER, PREVIEW_NOT_RENDERED } from './canvas/canvas-renderer';
import { EmbeddedDiagram, renderDiagramEmbeds } from './diagram-embeds';

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

  afterEach(() => vi.restoreAllMocks());

  it('draws readable embeds and leaves unreadable ones alone', async () => {
    // Arrange
    const root = document.createElement('div');
    root.innerHTML =
      embed('WEB-D-1') +
      embed('WEB-D-2') +
      embed('WEB-D-3', 'Canvas') +
      embed('WEB-D-4', 'Canvas') +
      embed('WEB-D-9');
    stubPictures();
    const embeds: EmbeddedDiagram[] = [
      diagram('WEB-D-1', 'Mermaid', { version: 2, content: 'flowchart LR\n  A --> B' }),
      diagram('WEB-D-2', 'Mermaid', { content: 'flowchart LR\n  A -->' }),
      diagram('WEB-D-3', 'Canvas'),
      diagram('WEB-D-4', 'Canvas', { snapshotUrl: '/api/v1/docs/WEB-D-4/versions/1/snapshot.svg' }),
    ];

    // Act
    await renderDiagramEmbeds(root, embeds, 'dark');

    // Assert
    const bodies = Array.from(root.querySelectorAll('.tk-doc-embed-body'));
    expect(bodies[0].querySelector('svg')).not.toBeNull();
    expect(bodies[1].querySelector('.tk-mermaid-error')).not.toBeNull();
    expect(bodies[2].querySelector('.tk-doc-embed-notice')?.textContent).toBe(PREVIEW_NOT_RENDERED);
    const open = bodies[3].querySelector<HTMLAnchorElement>('a.tk-doc-embed-open');
    expect(open?.getAttribute('href')).toBe('/p/WEB/docs/WEB-D-4/diagram');
    expect(open?.hasAttribute(INTERNAL_LINK_ATTR)).toBe(true);
    const picture = open?.querySelector('img');
    expect(picture?.getAttribute('src')).toBe('/api/v1/docs/WEB-D-4/versions/1/snapshot.svg');
    expect(picture?.alt).toBe('Diagram WEB-D-4');
    expect(picture?.style.filter).toBe(CANVAS_DARK_FILTER);
    expect(picture?.getAttribute('width')).toBe('640');
    expect(bodies[4].childElementCount).toBe(0);
    expect(root.querySelectorAll('figcaption')).toHaveLength(5);
  });
});

function diagram(
  key: string,
  diagramFormat: EmbeddedDiagram['diagramFormat'],
  overrides: Partial<EmbeddedDiagram> = {},
): EmbeddedDiagram {
  return {
    key,
    title: `Diagram ${key}`,
    diagramFormat,
    version: 1,
    content: null,
    url: `/p/WEB/docs/${key}/diagram`,
    snapshotUrl: null,
    ...overrides,
  };
}

/// jsdom loads no images: every picture decodes at 640 × 320.
function stubPictures(): void {
  HTMLImageElement.prototype.decode ??= () => Promise.resolve();
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(320);
}
