import { DiagramSource, isDiagramEmpty } from '../diagram-renderers';
import { canvasRenderer, PREVIEW_NOT_RENDERED, svgDataUrl } from './canvas-renderer';

const SCENE = '{"type":"excalidraw","elements":[{"id":"a","type":"rectangle"}]}';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';

function source(overrides: Partial<DiagramSource> = {}): DiagramSource {
  return { key: 'WEB-D-7', version: 2, content: SCENE, snapshotUrl: null, ...overrides };
}

/// Pictures decode at 400 × 200, except URLs listed as broken.
function stubPictures(broken: string[] = []): void {
  HTMLImageElement.prototype.decode ??= () => Promise.resolve();
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    return broken.includes(this.getAttribute('src') ?? '')
      ? Promise.reject(new Error('broken'))
      : Promise.resolve();
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(200);
}

describe('canvasRenderer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the stored picture without loading the editor', async () => {
    // Arrange
    stubPictures();
    const exporter = vi.fn(() => Promise.resolve(SVG));
    const url = '/api/v1/docs/WEB-D-7/versions/2/snapshot.svg';

    // Act
    const rendered = await canvasRenderer(exporter)(source({ snapshotUrl: url }), 'light');

    // Assert
    expect(rendered).toMatchObject({ width: 400, height: 200 });
    expect(rendered).not.toHaveProperty('exported');
    expect((rendered as { element: Element }).element.getAttribute('src')).toBe(url);
    expect(exporter).not.toHaveBeenCalled();
  });

  it('exports a picture in the browser when the version has none, for a writer to store', async () => {
    // Arrange
    stubPictures(['/missing.svg']);
    const exporter = vi.fn(() => Promise.resolve(SVG));

    // Act
    const rendered = await canvasRenderer(exporter)(
      source({ snapshotUrl: '/missing.svg' }),
      'light',
    );

    // Assert
    expect(exporter).toHaveBeenCalledWith(SCENE);
    expect(rendered).toMatchObject({ exported: SVG, width: 400, height: 200 });
    expect((rendered as { element: Element }).element.getAttribute('src')).toBe(svgDataUrl(SVG));
  });

  it('reports source that cannot be drawn', async () => {
    // Arrange
    const exporter = vi.fn(() => Promise.reject(new Error('Canvas source is not valid JSON.')));

    // Act
    const rendered = await canvasRenderer(exporter)(source({ content: '{oops' }), 'light');

    // Assert
    expect(rendered).toEqual({ error: 'Canvas source is not valid JSON.' });
  });

  it('says the preview is not rendered yet when there is neither a picture nor source', async () => {
    // Act
    const rendered = await canvasRenderer(vi.fn())(source({ content: null }), 'dark');

    // Assert
    expect(rendered).toEqual({ error: PREVIEW_NOT_RENDERED, notice: true });
  });
});

describe('isDiagramEmpty', () => {
  it.each([
    ['Canvas', null, true],
    ['Canvas', '{"type":"excalidraw","elements":[]}', true],
    ['Canvas', '{"type":"excalidraw","elements":[{"id":"a","isDeleted":true}]}', true],
    ['Canvas', SCENE, false],
    ['Canvas', '{not json', false],
    ['Mermaid', '  ', true],
    ['Mermaid', 'flowchart LR', false],
  ] as const)('%s %s is empty: %s', (format, content, expected) => {
    // Act
    const empty = isDiagramEmpty(format, content);

    // Assert
    expect(empty).toBe(expected);
  });
});
