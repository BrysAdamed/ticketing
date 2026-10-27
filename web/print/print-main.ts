import { renderMarkdown } from '@shared/markdown/render-markdown';
import { renderMermaidBlocks } from '@shared/diagrams/mermaid/mermaid-renderer';

interface PrintDocument {
  key: string;
  title: string;
  version: number;
  path: string;
  updatedBy: string;
  updatedAt: string;
  markdown: string;
}

interface PrintData {
  project: string;
  exportedBy: string;
  exportedAt: string;
  folder: string | null;
  documents: PrintDocument[];
  diagrams: Record<string, string>;
}

declare global {
  interface Window {
    __printReady?: boolean;
    __printError?: string;
  }
}

const DOC_KEY = /^[A-Z][A-Z0-9]{1,9}-D-\d+$/;

async function main(): Promise<void> {
  const data = JSON.parse(document.getElementById('tk-print-data')!.textContent!) as PrintData;
  const root = document.querySelector('main')!;
  if (data.folder) root.append(cover(data), contents(data));
  for (const doc of data.documents) root.append(section(doc, data));
  await renderMermaidBlocks(root, 'light');
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)));
}

function cover(data: PrintData): HTMLElement {
  const el = document.createElement('section');
  el.className = 'cover';
  el.innerHTML = `<p class="project"></p><h1></h1><p class="meta"></p>`;
  el.querySelector('.project')!.textContent = data.project;
  el.querySelector('h1')!.textContent = data.folder;
  el.querySelector('.meta')!.textContent =
    `${data.documents.length} documents · Exported by ${data.exportedBy} on ${data.exportedAt}`;
  return el;
}

function contents(data: PrintData): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'toc';
  const heading = document.createElement('h2');
  heading.textContent = 'Contents';
  const list = document.createElement('ol');
  for (const doc of data.documents) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#${doc.key}`;
    link.textContent = doc.title;
    item.append(link);
    list.append(item);
  }
  nav.append(heading, list);
  return nav;
}

function section(doc: PrintDocument, data: PrintData): HTMLElement {
  const el = document.createElement('article');
  el.id = doc.key;
  const title = document.createElement('h1');
  title.textContent = doc.title;
  const meta = document.createElement('p');
  meta.className = 'doc-meta';
  meta.textContent = `${doc.key} · v${doc.version} · Last edited by ${doc.updatedBy} on ${doc.updatedAt} · ${doc.path}`;
  const body = document.createElement('div');
  body.className = 'tk-md';
  const template = document.createElement('template');
  template.innerHTML = renderMarkdown(doc.markdown);
  const content = template.content;
  for (const img of Array.from(content.querySelectorAll('img'))) {
    const key = img.getAttribute('src') ?? '';
    if (!DOC_KEY.test(key)) continue;
    const figure = document.createElement('figure');
    figure.className = 'tk-canvas';
    const file = data.diagrams[key];
    if (file) {
      const svg = document.createElement('img');
      svg.src = file;
      svg.alt = img.alt;
      figure.append(svg);
    } else {
      figure.textContent = 'Diagram not available';
    }
    const caption = document.createElement('figcaption');
    caption.textContent = img.alt;
    figure.append(caption);
    (img.closest('p') ?? img).replaceWith(figure);
  }
  for (const link of Array.from(
    content.querySelectorAll<HTMLAnchorElement>('a[href^="/tickets/"]'),
  )) {
    link.href = `https://ticketing.example${link.getAttribute('href')}`;
  }
  body.append(content);
  el.append(title, meta, body);
  return el;
}

main()
  .catch((error: unknown) => {
    window.__printError = String(error);
    document.body.dataset['printError'] = String(error);
  })
  .finally(() => {
    window.__printReady = true;
  });
