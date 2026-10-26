import DOMPurify from 'dompurify';
import { Marked, Tokens } from 'marked';
import { TICKET_KEY_IN_TEXT } from '@shared/domain/keys';

export const TICKET_ROUTE_PREFIX = '/tickets/';
export const INTERNAL_LINK_ATTR = 'data-tk-route';

const SKIP_AUTOLINK = new Set(['A', 'CODE', 'PRE']);
const SERVER_PATHS = /^\/(\/|api\/|attachments\/|mcp|scalar|health)/;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text);
    },
  },
});

/// Renders user markdown (CommonMark + GFM) to sanitized HTML: raw HTML is shown as text,
/// output goes through DOMPurify, ticket keys become links to /tickets/KEY and external links
/// open in a new tab. Safe to bind with [innerHTML] after DomSanitizer bypass.
export function renderMarkdown(source: string | null | undefined): string {
  if (!source) return '';
  const html = marked.parse(source) as string;
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style'],
  });
  linkTicketKeys(fragment);
  decorateLinks(fragment);
  const container = fragment.ownerDocument.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

function linkTicketKeys(root: DocumentFragment): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!hasSkippedAncestor(node)) textNodes.push(node as Text);
  }
  for (const node of textNodes) {
    const text = node.data;
    TICKET_KEY_IN_TEXT.lastIndex = 0;
    if (!TICKET_KEY_IN_TEXT.test(text)) continue;
    TICKET_KEY_IN_TEXT.lastIndex = 0;
    const parts = doc.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(TICKET_KEY_IN_TEXT)) {
      const index = match.index ?? 0;
      if (index > last) parts.appendChild(doc.createTextNode(text.slice(last, index)));
      const anchor = doc.createElement('a');
      anchor.href = `${TICKET_ROUTE_PREFIX}${match[0]}`;
      anchor.className = 'tk-keyref';
      anchor.setAttribute(INTERNAL_LINK_ATTR, '');
      anchor.textContent = match[0];
      parts.appendChild(anchor);
      last = index + match[0].length;
    }
    if (last < text.length) parts.appendChild(doc.createTextNode(text.slice(last)));
    node.replaceWith(parts);
  }
}

function hasSkippedAncestor(node: Node): boolean {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (SKIP_AUTOLINK.has(parent.nodeName)) return true;
  }
  return false;
}

function decorateLinks(root: DocumentFragment): void {
  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    } else if (href.startsWith('/') && !SERVER_PATHS.test(href)) {
      anchor.setAttribute(INTERNAL_LINK_ATTR, '');
    }
  }
}
