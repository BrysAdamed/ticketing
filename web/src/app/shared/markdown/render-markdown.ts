import DOMPurify from 'dompurify';
import { Marked, Tokens, TokenizerAndRendererExtension } from 'marked';
import { initialsOf } from '@shared/util/initials';
import { paletteIndex } from '@shared/util/hash';
import { linkReferences, MarkdownReferences } from './link-references';
import { MENTION_AT_START, MentionUser } from './mentions';

export { TICKET_ROUTE_PREFIX } from './link-references';
export const INTERNAL_LINK_ATTR = 'data-tk-route';

export interface RenderOptions {
  /// Users that mention tokens may show as chips (current display name); any other token renders as
  /// the plain text `@StoredName`.
  mentions?: Iterable<MentionUser> | null;
  /// Gives headings stable ids (`#heading-slug`, duplicates `-2`, `-3`) and an empty
  /// `a.tk-anchor` link to them (docs pages); off for tickets, where several renders share a page.
  headingAnchors?: boolean;
  /// The tickets, docs and diagrams the reader may see (docs): known ticket keys become chips with
  /// their status, doc keys links with the title on hover, `![caption](KEY)` diagram embeds, and
  /// other keys plain text. Without it every key links to its route (tickets, comments).
  references?: MarkdownReferences | null;
}

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const CALLOUT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i;
const CALLOUT_TITLES: Record<CalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

const MENTION_ATTR = 'data-tk-mention';
const SERVER_PATHS = /^\/(\/|api\/|attachments\/|mcp|scalar|health)/;

/// The only URLs a rendered link or image may carry: http(s), mailto and scheme-less (relative,
/// root, fragment) URLs. DOMPurify's default list also lets tel:, sms:, xmpp: and friends through;
/// an explicit allowlist keeps app-launching schemes such as `claude-cli:`, `claude:`, `vscode:`
/// or `ticketing-agent:` out of ticket text, whatever DOMPurify allows by default.
export const SAFE_URL = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

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
/// output goes through DOMPurify with only `SAFE_URL` links and images, ticket and doc keys become
/// links (`linkReferences`), external links open in a new tab, GFM alerts (`> [!NOTE]` …) become
/// callouts and mention tokens of the given users become chips (D-96; built after sanitizing,
/// names as text). Safe to bind with [innerHTML] after DomSanitizer bypass. It must stay free of
/// Angular imports: the PDF print bundle uses it too (D-111).
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
    ALLOWED_URI_REGEXP: SAFE_URL,
  });
  renderMentions(fragment, options.mentions);
  renderCallouts(fragment);
  linkReferences(fragment, options.references);
  decorateLinks(fragment);
  if (options.headingAnchors) anchorHeadings(fragment);
  const container = fragment.ownerDocument.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

function renderMentions(
  root: DocumentFragment,
  mentions: Iterable<MentionUser> | null | undefined,
) {
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

/// The anchor of a heading text: lower case, letters, digits, `-` and `_` kept, spaces become
/// dashes, everything else dropped (as GitHub does); `section` when nothing is left.
export function headingSlug(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
  return slug || 'section';
}

function anchorHeadings(root: DocumentFragment): void {
  const doc = root.ownerDocument;
  const used = new Map<string, number>();
  for (const heading of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const base = headingSlug(heading.textContent ?? '');
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    heading.id = id;
    const anchor = doc.createElement('a');
    anchor.className = 'tk-anchor';
    anchor.href = `#${id}`;
    anchor.setAttribute('aria-hidden', 'true');
    anchor.tabIndex = -1;
    anchor.title = 'Copy link to this section';
    heading.appendChild(anchor);
  }
}

function renderCallouts(root: DocumentFragment): void {
  const doc = root.ownerDocument;
  for (const quote of Array.from(root.querySelectorAll('blockquote'))) {
    const first = quote.firstElementChild;
    const text = first?.tagName === 'P' ? first.firstChild : null;
    if (!text || text.nodeType !== 3) continue;
    const match = CALLOUT_MARKER.exec(text.nodeValue ?? '');
    if (!match) continue;
    const kind = match[1].toLowerCase() as CalloutKind;
    text.nodeValue = (text.nodeValue ?? '').slice(match[0].length);
    if (!text.nodeValue) {
      const next = text.nextSibling;
      text.remove();
      if (next?.nodeName === 'BR') next.remove();
      else if (next?.nodeType === 3) next.nodeValue = (next.nodeValue ?? '').replace(/^\n/, '');
    }
    if (!first!.hasChildNodes()) first!.remove();

    const callout = doc.createElement('div');
    callout.className = `tk-md-callout tk-md-callout-${kind}`;
    callout.setAttribute('role', 'note');
    const title = doc.createElement('p');
    title.className = 'tk-md-callout-title';
    title.textContent = CALLOUT_TITLES[kind];
    callout.appendChild(title);
    while (quote.firstChild) callout.appendChild(quote.firstChild);
    quote.replaceWith(callout);
  }
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
