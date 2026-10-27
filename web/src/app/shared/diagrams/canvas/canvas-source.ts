/// The stored Canvas source: Excalidraw's own JSON file format (`serializeAsJSON(..., 'database')`),
/// kept verbatim so a scene round-trips through the editor and opens in excalidraw.com too.
export interface CanvasSource {
  type: 'excalidraw';
  version: number;
  source?: string;
  elements: readonly Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export class CanvasSourceError extends Error {}

export function emptyCanvasSource(): CanvasSource {
  return {
    type: 'excalidraw',
    version: 2,
    elements: [],
    appState: { viewBackgroundColor: '#ffffff', gridSize: 20 },
    files: {},
  };
}

/// Parses stored source; null or blank is an empty scene. Throws CanvasSourceError when the text
/// is not an Excalidraw scene.
export function parseCanvasSource(text: string | null | undefined): CanvasSource {
  if (!text?.trim()) return emptyCanvasSource();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CanvasSourceError('Canvas source is not valid JSON.');
  }
  const scene = value as Partial<CanvasSource> | null;
  if (scene?.type !== 'excalidraw' || !Array.isArray(scene.elements)) {
    throw new CanvasSourceError('Canvas source is not an Excalidraw scene.');
  }
  return {
    type: 'excalidraw',
    version: typeof scene.version === 'number' ? scene.version : 2,
    source: scene.source,
    elements: scene.elements,
    appState: isRecord(scene.appState) ? scene.appState : {},
    files: isRecord(scene.files) ? scene.files : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
