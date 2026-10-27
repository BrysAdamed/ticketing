import { TicketStatus, TICKET_STATUS_LABELS } from '@shared/domain/enums';
import { DOC_KEY_PATTERN, REFERENCE_KEY_IN_TEXT, TICKET_KEY_PATTERN } from '@shared/domain/keys';
import { statusGlyph } from '@shared/domain/status-glyph';

/// A ticket the reader may see, as the doc GET's `references.tickets` lists it.
export interface MarkdownTicketReference {
  key: string;
  title: string;
  status: TicketStatus;
  url: string;
}

/// A doc the content names; a deleted one has no title or url.
export interface MarkdownDocReference {
  key: string;
  title: string | null;
  deleted: boolean;
  url: string | null;
}

/// A diagram the reader may see, embedded with `![caption](KEY)`.
export interface MarkdownEmbed {
  key: string;
  title: string;
  diagramFormat: string;
  version: number;
  url: string;
}

/// What a doc's content may show of the keys it names (spec 1.8, 1.9). A key that is not listed is
/// unreadable or unknown: it renders as plain text (`unresolved: 'text'`, the reader) or as a plain
/// link (`'link'`, the editor preview, where new keys are not resolved before publishing).
export interface MarkdownReferences {
  tickets: readonly MarkdownTicketReference[];
  docs: readonly MarkdownDocReference[];
  embeds: readonly MarkdownEmbed[];
  unresolved?: 'text' | 'link';
}

export const TICKET_ROUTE_PREFIX = '/tickets/';
export const DOC_ROUTE_PREFIX = '/docs/';
export const DIAGRAM_NOT_AVAILABLE = 'Diagram not available';

const SKIP_AUTOLINK = new Set(['A', 'CODE', 'PRE', 'FIGCAPTION']);

interface Resolver {
  readonly doc: Document;
  ticket(key: string): MarkdownTicketReference | undefined;
  docRef(key: string): MarkdownDocReference | undefined;
  embed(key: string): MarkdownEmbed | undefined;
  /// Null: every key links by route (markdown outside docs).
  readonly unresolved: 'text' | 'link' | null;
}

/// Turns ticket and doc keys into links, ticket chips, `[text](KEY)` links and `![caption](KEY)`
/// diagram embeds. Without `references` (tickets, comments) every key links to its route; with
/// them, only what the reader may see gets a title or status, the rest follows `unresolved`.
export function linkReferences(root: DocumentFragment, references?: MarkdownReferences | null) {
  const doc = root.ownerDocument;
  const tickets = new Map(references?.tickets.map((t) => [t.key, t]));
  const docs = new Map(references?.docs.map((d) => [d.key, d]));
  const embeds = new Map(references?.embeds.map((e) => [e.key, e]));
  const resolver: Resolver = {
    doc,
    ticket: (key) => tickets.get(key),
    docRef: (key) => docs.get(key),
    embed: (key) => embeds.get(key),
    unresolved: references ? (references.unresolved ?? 'text') : null,
  };
  for (const image of Array.from(root.querySelectorAll('img[src]'))) embedDiagram(image, resolver);
  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) linkKeyHref(anchor, resolver);
  linkKeysInText(root, resolver);
}

function isDocKey(value: string): boolean {
  return DOC_KEY_PATTERN.test(value);
}

function isReferenceKey(value: string): boolean {
  return isDocKey(value) || TICKET_KEY_PATTERN.test(value);
}

function embedDiagram(image: Element, resolver: Resolver): void {
  const key = image.getAttribute('src') ?? '';
  if (!isDocKey(key)) return;
  const { doc } = resolver;
  const caption = image.getAttribute('alt') ?? '';
  const paragraph = image.parentElement;
  const alone =
    paragraph?.tagName === 'P' &&
    Array.from(paragraph.childNodes).every(
      (node) => node === image || (node.nodeType === 3 && !node.textContent?.trim()),
    );

  if (resolver.unresolved === null) {
    image.replaceWith(routeLink(doc, key, caption || key));
    return;
  }
  const embed = resolver.embed(key);
  if (!alone) {
    image.replaceWith(
      embed ? docLink(doc, embed.url, caption || embed.title, embed.title) : textOf(doc, caption),
    );
    return;
  }
  if (embed) paragraph!.replaceWith(embedFigure(doc, embed, caption));
  else if (resolver.unresolved === 'link') paragraph!.replaceWith(pendingFigure(doc, key, caption));
  else paragraph!.replaceWith(missingFigure(doc));
}

/// An embed the editor preview cannot resolve yet: it is checked when the page is published.
function pendingFigure(doc: Document, key: string, caption: string): HTMLElement {
  const figure = doc.createElement('figure');
  figure.className = 'tk-doc-embed tk-doc-embed-missing';
  figure.append(
    routeLink(doc, key, caption || key),
    doc.createTextNode(' · the diagram shows once the page is published'),
  );
  return figure;
}

function embedFigure(doc: Document, embed: MarkdownEmbed, caption: string): HTMLElement {
  const figure = doc.createElement('figure');
  figure.className = 'tk-doc-embed';
  figure.setAttribute('data-doc-key', embed.key);
  figure.setAttribute('data-diagram-format', embed.diagramFormat);
  figure.setAttribute('data-version', String(embed.version));
  const header = doc.createElement('div');
  header.className = 'tk-doc-embed-h';
  const title = docLink(doc, embed.url, embed.title, `Open ${embed.title}`);
  title.classList.add('tk-doc-embed-title');
  const format = doc.createElement('span');
  format.className = 'tk-doc-embed-format';
  format.textContent = `${embed.diagramFormat} · ${embed.key}`;
  header.append(title, format);
  const body = doc.createElement('div');
  body.className = 'tk-doc-embed-body';
  figure.append(header, body);
  if (caption) {
    const figcaption = doc.createElement('figcaption');
    figcaption.textContent = caption;
    figure.appendChild(figcaption);
  }
  return figure;
}

function missingFigure(doc: Document): HTMLElement {
  const figure = doc.createElement('figure');
  figure.className = 'tk-doc-embed tk-doc-embed-missing';
  figure.setAttribute('data-testid', 'doc-embed-missing');
  figure.textContent = DIAGRAM_NOT_AVAILABLE;
  return figure;
}

function linkKeyHref(anchor: Element, resolver: Resolver): void {
  const key = anchor.getAttribute('href') ?? '';
  if (!isReferenceKey(key)) return;
  const { doc } = resolver;
  if (resolver.unresolved === null) {
    anchor.setAttribute('href', routeOf(key));
    return;
  }
  if (isDocKey(key)) {
    const target = resolver.docRef(key);
    if (target?.deleted) {
      anchor.replaceWith(deletedDoc(doc, anchor.textContent ?? key));
    } else if (target?.url) {
      anchor.setAttribute('href', target.url);
      anchor.classList.add('tk-docref');
      if (target.title) anchor.setAttribute('title', target.title);
    } else {
      unresolvedHref(anchor, key, resolver);
    }
    return;
  }
  const ticket = resolver.ticket(key);
  if (ticket) {
    anchor.setAttribute('href', ticket.url);
    anchor.setAttribute('title', ticketTitle(ticket));
  } else {
    unresolvedHref(anchor, key, resolver);
  }
}

function unresolvedHref(anchor: Element, key: string, resolver: Resolver): void {
  if (resolver.unresolved === 'link') anchor.setAttribute('href', routeOf(key));
  else anchor.replaceWith(...Array.from(anchor.childNodes));
}

function linkKeysInText(root: DocumentFragment, resolver: Resolver): void {
  const { doc } = resolver;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!hasSkippedAncestor(node)) textNodes.push(node as Text);
  }
  for (const node of textNodes) {
    const text = node.data;
    REFERENCE_KEY_IN_TEXT.lastIndex = 0;
    if (!REFERENCE_KEY_IN_TEXT.test(text)) continue;
    REFERENCE_KEY_IN_TEXT.lastIndex = 0;
    const parts = doc.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(REFERENCE_KEY_IN_TEXT)) {
      const index = match.index ?? 0;
      if (index > last) parts.appendChild(doc.createTextNode(text.slice(last, index)));
      parts.appendChild(keyNode(match[0], resolver));
      last = index + match[0].length;
    }
    if (last < text.length) parts.appendChild(doc.createTextNode(text.slice(last)));
    node.replaceWith(parts);
  }
}

function keyNode(key: string, resolver: Resolver): Node {
  const { doc } = resolver;
  if (resolver.unresolved === null) return routeLink(doc, key, key);
  if (isDocKey(key)) {
    const target = resolver.docRef(key);
    if (target?.deleted) return deletedDoc(doc, key);
    if (target?.url) {
      const link = docLink(doc, target.url, key, target.title ?? key);
      link.classList.add('tk-keyref');
      return link;
    }
  } else {
    const ticket = resolver.ticket(key);
    if (ticket) return ticketChip(doc, ticket);
  }
  return resolver.unresolved === 'link' ? routeLink(doc, key, key) : doc.createTextNode(key);
}

function ticketChip(doc: Document, ticket: MarkdownTicketReference): HTMLElement {
  const chip = doc.createElement('a');
  chip.href = ticket.url;
  chip.className = `tk-tref tk-tref-${ticket.status.toLowerCase()}`;
  chip.title = ticketTitle(ticket);
  chip.setAttribute('data-testid', `ticket-chip-${ticket.key}`);
  const key = doc.createElement('span');
  key.className = 'tk-tref-k';
  key.textContent = ticket.key;
  chip.append(statusGlyph(doc, ticket.status, 14), key);
  return chip;
}

function ticketTitle(ticket: MarkdownTicketReference): string {
  return `${ticket.key} · ${ticket.title} (${TICKET_STATUS_LABELS[ticket.status]})`;
}

function docLink(doc: Document, url: string, text: string, title: string): HTMLAnchorElement {
  const link = doc.createElement('a');
  link.href = url;
  link.className = 'tk-docref';
  link.title = title;
  link.textContent = text;
  return link;
}

function deletedDoc(doc: Document, text: string): HTMLElement {
  const span = doc.createElement('span');
  span.className = 'tk-docref-deleted';
  const struck = doc.createElement('s');
  struck.textContent = text;
  span.append(struck, doc.createTextNode(' (deleted)'));
  return span;
}

function routeOf(key: string): string {
  return `${isDocKey(key) ? DOC_ROUTE_PREFIX : TICKET_ROUTE_PREFIX}${key}`;
}

function routeLink(doc: Document, key: string, text: string): HTMLAnchorElement {
  const anchor = doc.createElement('a');
  anchor.href = routeOf(key);
  anchor.className = 'tk-keyref';
  anchor.textContent = text;
  return anchor;
}

function textOf(doc: Document, text: string): Text {
  return doc.createTextNode(text || DIAGRAM_NOT_AVAILABLE);
}

function hasSkippedAncestor(node: Node): boolean {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (SKIP_AUTOLINK.has(parent.nodeName)) return true;
    if (parent instanceof Element && parent.classList.contains('tk-mention')) return true;
    if (parent instanceof Element && parent.classList.contains('tk-docref-deleted')) return true;
  }
  return false;
}
