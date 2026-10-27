import DOMPurify from 'dompurify';
import type { Mermaid } from 'mermaid';
import { DiagramTheme } from '../diagram-theme';
import { mermaidConfig } from './mermaid-config';

export type MermaidRender = { svg: string; error?: undefined } | { svg?: undefined; error: string };

export const MERMAID_BLOCK_SELECTOR = 'pre > code.language-mermaid';

let mermaidModule: Promise<Mermaid> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

/// Loads Mermaid on first use (a lazy chunk, never part of the initial bundle).
export function loadMermaid(): Promise<Mermaid> {
  mermaidModule ??= import('mermaid').then((module) => module.default);
  return mermaidModule;
}

/// Renders Mermaid source to a sanitized SVG string, or returns the parser message. Renders run one
/// at a time because Mermaid's configuration is global and the theme is applied per render.
export function renderMermaid(source: string, theme: DiagramTheme): Promise<MermaidRender> {
  const result = queue.then(() => renderNow(source, theme));
  queue = result.catch(() => undefined);
  return result;
}

/// Replaces every ```mermaid block under `root` (as rendered by `renderMarkdown`) with its diagram.
/// A block that fails to parse stays as code, followed by an error box with the parser message.
export async function renderMermaidBlocks(root: HTMLElement, theme: DiagramTheme): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(MERMAID_BLOCK_SELECTOR));
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) continue;
    const rendered = await renderMermaid(code.textContent ?? '', theme);
    const doc = pre.ownerDocument;
    if (rendered.svg !== undefined) {
      const figure = doc.createElement('figure');
      figure.className = 'tk-mermaid';
      figure.innerHTML = rendered.svg;
      pre.replaceWith(figure);
    } else {
      const error = doc.createElement('div');
      error.className = 'tk-mermaid-error';
      error.setAttribute('role', 'alert');
      error.textContent = rendered.error;
      pre.after(error);
    }
  }
}

async function renderNow(source: string, theme: DiagramTheme): Promise<MermaidRender> {
  const mermaid = await loadMermaid();
  mermaid.initialize(mermaidConfig(theme));
  const id = `tk-mermaid-${++sequence}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return { svg: sanitizeSvg(svg) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/// Second line of defence after Mermaid's own strict mode: an SVG-only DOMPurify pass that keeps
/// Mermaid's scoped <style> but drops scripts, event handlers, foreignObject and javascript: links.
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['foreignObject'],
  });
}
