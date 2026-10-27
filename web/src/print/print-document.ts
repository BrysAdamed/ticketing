import { renderMermaidBlocks, mermaidErrorBox } from '@shared/diagrams/mermaid/mermaid-blocks';
import { renderMermaid } from '@shared/diagrams/mermaid/mermaid-renderer';
import { highlightCodeBlocks } from '@shared/markdown/highlight-code';
import { renderMarkdown } from '@shared/markdown/render-markdown';
import { PrintData, PrintEmbed, PrintEntry } from './print-data';

export const PREVIEW_NOT_RENDERED = 'Preview not rendered yet';
export const EMPTY_DIAGRAM = 'This diagram is empty.';
export const EMPTY_FOLDER = 'This folder has no pages or diagrams.';
const IMAGE_FILE = /^[a-z0-9][a-z0-9._-]*$/i;

/// Builds the printable document from the export data (D-100): for a folder a cover and a linked
/// contents page, then every entry in tree order, each document on a new page with its title block.
/// Diagrams are drawn afterwards by `drawDiagrams`.
export function buildPrint(doc: Document, data: PrintData): HTMLElement[] {
  const documents = data.entries.filter((e) => e.kind !== 'Folder');
  const nodes: HTMLElement[] = [];
  if (data.mode === 'folder') {
    nodes.push(cover(doc, data), contents(doc, data));
    if (documents.length === 0) nodes.push(element(doc, 'p', 'empty', EMPTY_FOLDER));
  }
  for (const entry of data.entries)
    nodes.push(entry.kind === 'Folder' ? folderHead(doc, entry) : article(doc, entry, data));
  return nodes;
}

/// Draws Mermaid blocks, diagram embeds and diagram documents (always light, all at once), then
/// highlights code. Pictures are bundle files, so nothing is fetched and Excalidraw never runs.
export async function drawDiagrams(root: HTMLElement, data: PrintData): Promise<void> {
  const embeds = new Map<string, PrintEmbed>();
  for (const entry of data.entries)
    for (const embed of entry.references.embeds) embeds.set(embed.key, embed);
  const doc = root.ownerDocument;
  const jobs: Promise<void>[] = [renderMermaidBlocks(root, 'light', { lazy: false })];
  for (const figure of Array.from(
    root.querySelectorAll<HTMLElement>('figure.tk-doc-embed[data-doc-key]'),
  )) {
    const body = figure.querySelector<HTMLElement>('.tk-doc-embed-body');
    const embed = embeds.get(figure.dataset['docKey'] ?? '');
    if (body && embed)
      jobs.push(drawInto(body, embed.diagramFormat, embed.content, embed.picture, embed.title));
  }
  for (const body of Array.from(root.querySelectorAll<HTMLElement>('[data-print-diagram]'))) {
    const entry = data.entries.find((e) => e.key === body.dataset['printDiagram']);
    if (entry)
      jobs.push(
        drawInto(body, entry.diagramFormat ?? '', entry.content, entry.picture, entry.title),
      );
  }
  await Promise.all(jobs);
  await highlightCodeBlocks(root);
  if (data.mode === 'single' && data.entries[0]?.kind === 'Diagram') orient(doc, root);
}

/// Makes the rendered markdown of one document printable: heading ids become unique within the
/// export, in-page links follow them, app-relative links become absolute, and images that are not
/// bundle files become their alt text (the renderer may load nothing else).
export function preparePrintFragment(
  fragment: DocumentFragment,
  entry: PrintEntry,
  data: PrintData,
): void {
  const doc = fragment.ownerDocument;
  const prefix = `${entry.key}--`;
  const exported = new Set(data.entries.map((e) => e.key));
  for (const anchor of Array.from(fragment.querySelectorAll('a.tk-anchor'))) anchor.remove();
  for (const heading of Array.from(fragment.querySelectorAll('[id]'))) {
    heading.id = prefix + heading.id;
  }
  for (const link of Array.from(fragment.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = link.getAttribute('href') ?? '';
    link.removeAttribute('target');
    link.removeAttribute('rel');
    link.removeAttribute('data-tk-route');
    if (href.startsWith('#')) {
      if (!exported.has(href.slice(1))) link.setAttribute('href', `#${prefix}${href.slice(1)}`);
    } else if (href.startsWith('/') && !href.startsWith('//')) {
      link.setAttribute('href', data.appUrl + href);
    } else if (!/^(https?:|mailto:)/i.test(href)) {
      link.replaceWith(...Array.from(link.childNodes));
    }
  }
  for (const image of Array.from(fragment.querySelectorAll('img'))) {
    const src = image.getAttribute('src') ?? '';
    const file = entry.images[src];
    if (file && IMAGE_FILE.test(file)) {
      image.setAttribute('src', file);
      image.removeAttribute('srcset');
    } else {
      const alt = image.getAttribute('alt');
      image.replaceWith(doc.createTextNode(alt ? `[${alt}]` : '[image]'));
    }
  }
}

function article(doc: Document, entry: PrintEntry, data: PrintData): HTMLElement {
  const el = doc.createElement('article');
  el.id = entry.key;
  el.className = `doc doc-${entry.kind.toLowerCase()}`;
  const head = doc.createElement('header');
  head.className = 'doc-head';
  head.append(
    element(doc, 'h1', 'doc-title', entry.title),
    element(
      doc,
      'p',
      'doc-meta',
      `${entry.key} · v${entry.version} · Last edited by ${entry.updatedBy} on ${entry.updatedAt}` +
        (entry.path ? ` · ${entry.path}` : ''),
    ),
  );
  el.append(head);
  if (entry.kind === 'Page') {
    const body = doc.createElement('div');
    body.className = 'tk-md';
    const template = doc.createElement('template');
    template.innerHTML = renderMarkdown(entry.content, {
      headingAnchors: true,
      references: { ...entry.references, unresolved: 'text' },
    });
    preparePrintFragment(template.content, entry, data);
    body.append(template.content);
    el.append(body);
  } else {
    const figure = doc.createElement('figure');
    figure.className = 'doc-diagram';
    figure.setAttribute('data-print-diagram', entry.key);
    el.append(figure);
  }
  return el;
}

function cover(doc: Document, data: PrintData): HTMLElement {
  const folder = data.folder!;
  const el = doc.createElement('section');
  el.className = 'cover';
  el.append(
    element(doc, 'p', 'cover-project', `${data.projectName} (${data.projectKey})`),
    element(doc, 'h1', 'cover-title', folder.title),
    element(doc, 'p', 'cover-path', folder.path === folder.title ? '' : folder.path),
    element(
      doc,
      'p',
      'cover-meta',
      `${folder.documents} ${folder.documents === 1 ? 'document' : 'documents'} · ${folder.key}`,
    ),
    element(doc, 'p', 'cover-meta', `Exported by ${data.exportedBy} on ${data.exportedAt}`),
  );
  return el;
}

function contents(doc: Document, data: PrintData): HTMLElement {
  const nav = doc.createElement('nav');
  nav.className = 'toc';
  nav.append(element(doc, 'h2', 'toc-title', 'Contents'));
  const list = doc.createElement('ul');
  for (const entry of data.entries) {
    const item = doc.createElement('li');
    item.className = `toc-${entry.kind.toLowerCase()} toc-d${Math.min(entry.depth, 6)}`;
    const link = doc.createElement('a');
    link.href = `#${entry.key}`;
    link.textContent = entry.title;
    item.append(link);
    if (entry.kind !== 'Folder') item.append(element(doc, 'span', 'toc-key', entry.key));
    list.append(item);
  }
  nav.append(list);
  return nav;
}

function folderHead(doc: Document, entry: PrintEntry): HTMLElement {
  const el = doc.createElement('section');
  el.id = entry.key;
  el.className = 'folder-head';
  el.append(
    element(doc, 'h1', 'folder-title', entry.title),
    element(doc, 'p', 'folder-path', entry.path),
  );
  return el;
}

async function drawInto(
  body: HTMLElement,
  format: string,
  content: string | null,
  picture: string | null,
  title: string,
): Promise<void> {
  const doc = body.ownerDocument;
  if (format === 'Canvas') {
    if (picture && IMAGE_FILE.test(picture)) {
      const image = doc.createElement('img');
      image.className = 'tk-canvas-picture';
      image.alt = title;
      image.src = picture;
      body.replaceChildren(image);
    } else {
      body.replaceChildren(element(doc, 'p', 'tk-doc-embed-notice', PREVIEW_NOT_RENDERED));
    }
    return;
  }
  if (!content?.trim()) {
    body.replaceChildren(element(doc, 'p', 'tk-doc-embed-notice', EMPTY_DIAGRAM));
    return;
  }
  const rendered = await renderMermaid(content, 'light');
  if (rendered.svg === undefined) {
    body.replaceChildren(mermaidErrorBox(doc, rendered.error));
    return;
  }
  const template = doc.createElement('template');
  template.innerHTML = rendered.svg;
  const svg = template.content.querySelector('svg');
  if (!svg) return;
  svg.removeAttribute('style');
  const [width, height] = naturalSize(svg);
  if (width > 0 && height > 0) {
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
  }
  body.replaceChildren(svg);
}

/// A single diagram is printed on one page, landscape when it is wider than tall (spec 1.11).
function orient(doc: Document, root: HTMLElement): void {
  const target = root.querySelector('[data-print-diagram] svg, [data-print-diagram] img');
  if (!target) return;
  const [width, height] = naturalSize(target);
  if (width <= height * 1.15) return;
  doc.body.classList.add('landscape');
  const style = doc.createElement('style');
  style.textContent = '@page { size: A4 landscape; }';
  doc.head.append(style);
}

function naturalSize(target: Element): [number, number] {
  if (target instanceof HTMLImageElement) return [target.naturalWidth, target.naturalHeight];
  const box = (target.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  return box.length === 4 ? [box[2], box[3]] : [0, 0];
}

function element(doc: Document, tag: string, className: string, text: string): HTMLElement {
  const el = doc.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}
