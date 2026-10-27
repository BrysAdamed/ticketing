import { DiagramTheme } from '@shared/diagrams/diagram-theme';
import type { DiagramRender, DiagramRenderer } from '../diagram-renderers';

export const PREVIEW_NOT_RENDERED = 'Preview not rendered yet';
const DRAW_FAILED = "Couldn't draw the diagram.";

/// Excalidraw's own dark transform: the light picture inverted, hues turned back (D-110).
export const CANVAS_DARK_FILTER = 'invert(93%) hue-rotate(180deg)';

type Picture = Extract<DiagramRender, { element: Element }>;

export type CanvasExporter = (source: string) => Promise<string>;

const exportInBrowser: CanvasExporter = async (source) => {
  const { exportCanvasSourceSvg } = await import('@shared/diagrams/canvas/canvas-export');
  return exportCanvasSourceSvg(source);
};

/// Draws a Canvas diagram as an image of its stored SVG picture. Without one (a version written
/// over MCP) it exports the picture from the source in the browser (`exporter`, loading
/// Excalidraw) and returns it as `exported` so a writer's view can store it; without source
/// either (an embed) it reports "Preview not rendered yet".
export function canvasRenderer(exporter: CanvasExporter = exportInBrowser): DiagramRenderer {
  return async (diagram, theme) => {
    if (diagram.snapshotUrl) {
      const stored = await loadPicture(diagram.snapshotUrl, theme);
      if (stored) return stored;
    }
    if (!diagram.content?.trim()) return { error: PREVIEW_NOT_RENDERED, notice: true };
    let svg: string;
    try {
      svg = await exporter(diagram.content);
    } catch (error) {
      return { error: error instanceof Error ? error.message : DRAW_FAILED };
    }
    const exported = await loadPicture(svgDataUrl(svg), theme);
    return exported ? { ...exported, exported: svg } : { error: DRAW_FAILED };
  };
}

export const renderCanvas = canvasRenderer();

/// An `<img>` of a Canvas picture at its natural size, CSS-inverted for the dark theme; null when
/// it cannot be loaded.
export async function loadPicture(src: string, theme: DiagramTheme): Promise<Picture | null> {
  const image = document.createElement('img');
  image.className = 'tk-canvas-picture';
  image.alt = 'Canvas diagram';
  image.decoding = 'async';
  image.draggable = false;
  if (theme === 'dark') image.style.filter = CANVAS_DARK_FILTER;
  image.src = src;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const width = image.naturalWidth > 0 ? image.naturalWidth : 300;
  const height = image.naturalHeight > 0 ? image.naturalHeight : 150;
  return { element: image, width, height };
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
