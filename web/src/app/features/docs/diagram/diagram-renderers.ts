import { DiagramFormat } from '@core/docs/doc.models';
import { DiagramTheme } from '@shared/diagrams/diagram-theme';
import { isEmptyCanvasSource } from '@shared/diagrams/canvas/canvas-source';
import { renderMermaid } from '@shared/diagrams/mermaid/mermaid-renderer';
import { renderCanvas } from './canvas/canvas-renderer';

/// The published (or drafted) content of a diagram doc to render.
export interface DiagramSource {
  readonly key: string;
  readonly version: number;
  readonly content: string | null;
  /// Canvas: the stored SVG picture of this version, when it has one.
  readonly snapshotUrl?: string | null;
}

/// A rendered diagram: an element (inline SVG, or an image of a snapshot) with its natural size in
/// CSS pixels, or why nothing is shown. `exported` is a Canvas picture the browser had to make
/// because the server has none; a writer's diagram view stores it for that version. `notice`
/// marks a reason that is not a failure ("Preview not rendered yet", an empty diagram).
export type DiagramRender =
  | {
      readonly element: Element;
      readonly width: number;
      readonly height: number;
      readonly exported?: string;
    }
  | { readonly error: string; readonly notice?: boolean };

export type DiagramRenderer = (
  diagram: DiagramSource,
  theme: DiagramTheme,
) => Promise<DiagramRender>;

export const EMPTY_DIAGRAM = 'This diagram is empty.';

/// How each diagram format is drawn on screen, by the diagram view and by embeds in pages. A
/// format without one shows "can't be shown here".
export const DIAGRAM_RENDERERS: Readonly<Partial<Record<DiagramFormat, DiagramRenderer>>> = {
  Mermaid: async (diagram, theme) => {
    if (!diagram.content?.trim()) return { error: EMPTY_DIAGRAM, notice: true };
    const rendered = await renderMermaid(diagram.content, theme);
    return rendered.svg !== undefined ? svgRender(rendered.svg) : { error: rendered.error };
  },
  Canvas: renderCanvas,
};

/// Whether a diagram has nothing to draw (the view then offers "Start drawing").
export function isDiagramEmpty(format: DiagramFormat | null, content: string | null): boolean {
  if (!content?.trim()) return true;
  return format === 'Canvas' && isEmptyCanvasSource(content);
}

/// Parses SVG markup (already sanitized) into an element sized by its viewBox.
export function svgRender(markup: string): DiagramRender {
  const template = document.createElement('template');
  template.innerHTML = markup;
  const svg = template.content.querySelector('svg');
  if (!svg) return { error: 'The diagram produced no image.' };
  const [width, height] = svgSize(svg);
  svg.removeAttribute('style');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  return { element: svg, width, height };
}

/// The natural size of an SVG: its viewBox, else its width and height attributes.
export function svgSize(svg: Element): [number, number] {
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (box.length === 4 && box[2] > 0 && box[3] > 0) return [box[2], box[3]];
  const width = parseFloat(svg.getAttribute('width') ?? '');
  const height = parseFloat(svg.getAttribute('height') ?? '');
  return [width > 0 ? width : 300, height > 0 ? height : 150];
}
