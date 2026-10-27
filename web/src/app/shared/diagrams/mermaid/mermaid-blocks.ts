import { fnv1a } from '@shared/util/hash';
import { rememberedHeight, rememberHeight } from '../diagram-heights';
import { DiagramTheme } from '../diagram-theme';
import { whenVisible } from '../when-visible';
import { cachedMermaid, MermaidRender, renderMermaid } from './mermaid-renderer';

/// What `renderMarkdown` emits for a ```` ```mermaid ```` fence.
export const MERMAID_BLOCK_SELECTOR = 'pre > code.language-mermaid';

/// Height reserved for a diagram that was never rendered on this device.
export const MERMAID_PLACEHOLDER_HEIGHT = 200;

export interface MermaidBlockOptions {
  /// Render each block only when it comes near the viewport; until then it is a skeleton of the
  /// remembered (or default) height. Default: wherever IntersectionObserver exists.
  lazy?: boolean;
  /// Aborted when the HTML is replaced or the view goes away: pending blocks are left alone.
  signal?: AbortSignal;
  /// The last good SVG per block index of this root (the editor preview). A block that fails to
  /// parse then keeps showing it above the error box. Read and updated in place.
  lastGood?: Map<number, string>;
}

/// Replaces every ```mermaid block under `root` (as rendered by `renderMarkdown`) with its diagram,
/// `figure.tk-mermaid`. A block that fails to parse stays as code (or as its last good render, see
/// `lastGood`), followed by `.tk-mermaid-error` with the parser message. Blocks already rendered
/// once in this theme are replaced synchronously. Free of Angular: the PDF bundle calls it with
/// `lazy: false`.
export async function renderMermaidBlocks(
  root: ParentNode,
  theme: DiagramTheme,
  options: MermaidBlockOptions = {},
): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(MERMAID_BLOCK_SELECTOR))
    .map((code) => code.parentElement)
    .filter((pre): pre is HTMLElement => !!pre);
  if (blocks.length === 0) return;
  const lazy = options.lazy ?? typeof IntersectionObserver !== 'undefined';
  await Promise.all(
    blocks.map(async (pre, index) => {
      const source = pre.textContent ?? '';
      const known = cachedMermaid(source, theme);
      if (known) return place(pre, source, known, index, options);
      if (lazy) {
        reserve(pre, source);
        await whenVisible(pre, options.signal);
      }
      if (options.signal?.aborted) return;
      const rendered = await renderMermaid(source, theme);
      if (options.signal?.aborted || !pre.parentNode) return;
      place(pre, source, rendered, index, options);
    }),
  );
}

/// The id under which a Mermaid source's rendered height is remembered.
export function mermaidHeightId(source: string): string {
  return `mermaid:${fnv1a(source).toString(36)}:${source.length}`;
}

function reserve(pre: HTMLElement, source: string): void {
  const height = rememberedHeight(mermaidHeightId(source)) ?? MERMAID_PLACEHOLDER_HEIGHT;
  pre.classList.add('tk-mermaid-pending');
  pre.style.height = `${height}px`;
  pre.setAttribute('aria-busy', 'true');
}

function place(
  pre: HTMLElement,
  source: string,
  rendered: MermaidRender,
  index: number,
  options: MermaidBlockOptions,
): void {
  const doc = pre.ownerDocument;
  pre.classList.remove('tk-mermaid-pending');
  pre.style.removeProperty('height');
  pre.removeAttribute('aria-busy');
  if (rendered.svg !== undefined) {
    options.lastGood?.set(index, rendered.svg);
    const figure = diagramFigure(doc, rendered.svg);
    pre.replaceWith(figure);
    const height = figure.isConnected ? figure.getBoundingClientRect().height : 0;
    if (height > 0) rememberHeight(mermaidHeightId(source), height);
    return;
  }
  const error = mermaidErrorBox(doc, rendered.error);
  const previous = options.lastGood?.get(index);
  if (previous !== undefined) {
    const figure = diagramFigure(doc, previous);
    figure.classList.add('tk-mermaid-stale');
    pre.replaceWith(figure);
    figure.after(error);
  } else {
    pre.after(error);
  }
}

/// The danger box under a diagram that does not parse: a title and Mermaid's message (with the
/// line number), `role=alert`.
export function mermaidErrorBox(doc: Document, message: string): HTMLElement {
  const box = doc.createElement('div');
  box.className = 'tk-mermaid-error';
  box.setAttribute('role', 'alert');
  const title = doc.createElement('p');
  title.className = 'tk-mermaid-error-title';
  title.textContent = 'Mermaid syntax error';
  const text = doc.createElement('div');
  text.className = 'tk-mermaid-error-message';
  text.textContent = message;
  box.append(title, text);
  return box;
}

function diagramFigure(doc: Document, svg: string): HTMLElement {
  const figure = doc.createElement('figure');
  figure.className = 'tk-mermaid';
  figure.innerHTML = svg;
  return figure;
}
