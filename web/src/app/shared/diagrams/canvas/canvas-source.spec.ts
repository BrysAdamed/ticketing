import { CanvasSourceError, emptyCanvasSource, parseCanvasSource } from './canvas-source';

describe('parseCanvasSource', () => {
  it.each([null, undefined, '', '   '])('treats %j as an empty scene', (text) => {
    // Act
    const scene = parseCanvasSource(text);

    // Assert
    expect(scene).toEqual(emptyCanvasSource());
  });

  it('keeps elements, appState and files of a stored scene', () => {
    // Arrange
    const stored = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [{ id: 'a', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#fff' },
    });

    // Act
    const scene = parseCanvasSource(stored);

    // Assert
    expect(scene.elements).toEqual([{ id: 'a', type: 'rectangle' }]);
    expect(scene.appState).toEqual({ viewBackgroundColor: '#fff' });
    expect(scene.files).toEqual({});
    expect(scene.source).toBe('https://excalidraw.com');
  });

  it.each(['{not json', '[]', '{"type":"tldraw","elements":[]}', '{"type":"excalidraw"}'])(
    'rejects %s',
    (text) => {
      // Act
      const parse = () => parseCanvasSource(text);

      // Assert
      expect(parse).toThrow(CanvasSourceError);
    },
  );
});
