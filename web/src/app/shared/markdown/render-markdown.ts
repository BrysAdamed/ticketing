import DOMPurify from 'dompurify';
import { Marked, Tokens, TokenizerAndRendererExtension } from 'marked';
import { TICKET_KEY_IN_TEXT } from '@shared/domain/keys';
import { initialsOf } from '@shared/ui/domain/avatar.component';
import { paletteIndex } from '@shared/util/hash';
import { MENTION_AT_START, MentionUser } from './mentions';

export const TICKET_ROUTE_PREFIX = '/tickets/';
export const INTERNAL_LINK_ATTR = 'data-tk-route';

export interface RenderOptions {
  /// Users that mention tokens may show as chips (current display name); any other token renders as
  /// the plain text `@StoredName`.
  mentions?: Iterable<MentionUser> | null;
}

const MENTION_ATTR = 'data-tk-mention';
const SKIP_AUTOLINK = new Set(['A', 'CODE', 'PRE']);
const SERVER_PATHS = /^\/(\/|api\/|attachments\/|mcp|scalar|health)/;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mention: TokenizerAndRendererExtension = {
  name: 'mention',
  level: 'inline',
  start(src) {
    const index = src.indexOf('@[');
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = MENTION_AT_START.exec(src);
    if (!match) return undefined;
    return { type: 'mention', raw: match[0], name: match[1], userId: match[2].toLowerCase() };
  },
  renderer(token) {
    return `<span ${MENTION_ATTR}="${escapeHtml(token['userId'])}">@${escapeHtml(token['name'])}</span>`;
  },
};

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  extensions: [mention],
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text);
    },
  },
});

/// Renders user markdown (CommonMark + GFM) to sanitized HTML: raw HTML is shown as text,
/// output goes through DOMPurify, ticket keys become links to /tickets/KEY, external links
/// open in a new tab and mention tokens of the given users become chips (D-95; built after
/// sanitizing, names as text). Safe to bind with [innerHTML] after DomSanitizer bypass.
export function renderMarkdown(
  source: string | null | undefined,
  options: RenderOptions = {},
): string {
  if (!source) return '';
  const html = marked.parse(source) as string;
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style'],
  });
  renderMentions(fragment, options.mentions);
  linkTicketKeys(fragment);
  decorateLinks(fragment);
  const container = fragment.ownerDocument.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

function renderMentions(root: DocumentFragment, mentions: Iterable<MentionUser> | null | undefined) {
  const placeholders = root.querySelectorAll(`span[${MENTION_ATTR}]`);
  if (placeholders.length === 0) return;
  const users = new Map<string, MentionUser>();
  for (const user of mentions ?? []) users.set(user.id.toLowerCase(), user);
  const doc = root.ownerDocument;
  for (const placeholder of Array.from(placeholders)) {
    const user = users.get(placeholder.getAttribute(MENTION_ATTR) ?? '');
    placeholder.replaceWith(
      user ? mentionChip(doc, user) : doc.createTextNode(placeholder.textContent ?? ''),
    );
  }
}

function mentionChip(doc: Document, user: MentionUser): HTMLElement {
  const id = user.id.toLowerCase();
  const chip = doc.createElement('span');
  chip.className = 'tk-mention';
  chip.setAttribute('data-user-id', id);
  chip.setAttribute('data-testid', `mention-${id}`);
  if (user.email) chip.title = user.email;
  const avatar = doc.createElement('span');
  avatar.className = `tk-mention-avatar tk-palette-${paletteIndex(id)}`;
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = initialsOf(user.displayName);
  chip.append(avatar, doc.createTextNode(user.displayName));
  return chip;
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
    if (parent instanceof Element && parent.classList.contains('tk-mention')) return true;
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
