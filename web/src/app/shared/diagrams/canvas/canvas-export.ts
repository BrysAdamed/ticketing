import { CanvasSource, parseCanvasSource } from './canvas-source';
import { loadExcalidraw } from './excalidraw-loader';

type ExportToSvg = (typeof import('@excalidraw/excalidraw'))['exportToSvg'];
type ExportInput = Parameters<ExportToSvg>[0];

export const CANVAS_EXPORT_PADDING = 16;

/// Renders a scene to a light SVG with the used glyphs of its fonts inlined, so the snapshot shows
/// the same in an <img>, in dark mode (CSS-inverted like Excalidraw's own dark theme) and in PDF.
export async function exportSceneSvg(
  scene: Pick<CanvasSource, 'elements' | 'appState' | 'files'>,
): Promise<string> {
  const { excalidraw } = await loadExcalidraw();
  const svg = await excalidraw.exportToSvg({
    elements: scene.elements,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportWithDarkMode: false,
      exportEmbedScene: false,
    },
    files: scene.files,
    exportPadding: CANVAS_EXPORT_PADDING,
  } as unknown as ExportInput);
  return svg.outerHTML;
}

/// `exportSceneSvg` for stored source, without mounting an editor.
export function exportCanvasSourceSvg(source: string): Promise<string> {
  return exportSceneSvg(parseCanvasSource(source));
}
