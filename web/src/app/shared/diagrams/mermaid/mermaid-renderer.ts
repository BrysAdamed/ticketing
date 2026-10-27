import DOMPurify from 'dompurify';
import type { Mermaid } from 'mermaid';
import { DiagramTheme } from '../diagram-theme';
import { mermaidConfig } from './mermaid-config';

export type MermaidRender = { svg: string; error?: undefined } | { svg?: undefined; error: string };

/// The diagram types the docs promise to LLMs and people (spec 12, MCP tool descriptions); Mermaid
/// renders more, these are the ones we test and offer templates for.
export const SUPPORTED_MERMAID_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'mindmap',
] as const;

const TYPE_LABELS: Record<string, string> = {
  flowchart: 'flowchart',
  graph: 'flowchart',
  sequenceDiagram: 'sequence',
  classDiagram: 'class',
  stateDiagram: 'state',
  'stateDiagram-v2': 'state',
  erDiagram: 'ER',
  gantt: 'gantt',
  mindmap: 'mindmap',
  pie: 'pie',
  journey: 'journey',
  timeline: 'timeline',
  gitGraph: 'git',
  quadrantChart: 'quadrant',
};

const CACHE_SIZE = 64;
const cache = new Map<string, MermaidRender>();

let mermaidModule: Promise<Mermaid> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

/// Loads Mermaid on first use (a lazy chunk, never part of the initial bundle).
export function loadMermaid(): Promise<Mermaid> {
  mermaidModule ??= import('mermaid').then((module) => module.default);
  return mermaidModule;
}

/// Renders Mermaid source to a sanitized SVG string, or returns the parser message. Renders run one
/// at a time because Mermaid's configuration is global and the theme is applied per render. The
/// last 64 results are kept, so re-renders (editor preview, theme toggles, revisits) are instant.
export function renderMermaid(source: string, theme: DiagramTheme): Promise<MermaidRender> {
  const cached = cachedMermaid(source, theme);
  if (cached) return Promise.resolve(cached);
  const result = queue.then(() => renderNow(source, theme));
  queue = result.catch(() => undefined);
  return result.then((rendered) => {
    remember(cacheKey(source, theme), rendered);
    return rendered;
  });
}

/// A render of `source` in `theme` that is already known, without waiting.
export function cachedMermaid(source: string, theme: DiagramTheme): MermaidRender | undefined {
  const key = cacheKey(source, theme);
  const hit = cache.get(key);
  if (hit) remember(key, hit);
  return hit;
}

/// A short label for the diagram type of `source` (`flowchart`, `sequence`, `ER` …), read from its
/// first statement after front-matter and comments; null when it has none.
export function mermaidDiagramType(source: string): string | null {
  const body = source.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '');
  for (const line of body.split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('%%')) continue;
    const word = /^[\w-]+/.exec(text)?.[0];
    return word ? (TYPE_LABELS[word] ?? word) : null;
  }
  return null;
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

function cacheKey(source: string, theme: DiagramTheme): string {
  return `${theme}\n${source}`;
}

function remember(key: string, rendered: MermaidRender): void {
  cache.delete(key);
  cache.set(key, rendered);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
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
