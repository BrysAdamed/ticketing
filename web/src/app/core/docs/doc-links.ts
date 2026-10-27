import { DOC_KEY_PATTERN } from '@shared/domain/keys';

const SLUG_MAX_LENGTH = 80;

/// Cosmetic URL slug of a doc title, the same as the server's `DocPaths.Slug`: accents dropped,
/// ASCII letters and digits kept in lower case, every other run becomes one dash.
export function docSlug(title: string): string {
  let slug = '';
  let dash = false;
  for (const char of title.normalize('NFD')) {
    if (/\p{Mn}/u.test(char)) continue;
    if (/[A-Za-z0-9]/.test(char)) {
      if (dash && slug.length > 0) slug += '-';
      slug += char.toLowerCase();
      dash = false;
    } else {
      dash = true;
    }
    if (slug.length >= SLUG_MAX_LENGTH) break;
  }
  return slug.length === 0 ? 'doc' : slug.replace(/-+$/, '');
}

export function docsHomeUrl(projectKey: string): string {
  return `/projects/${projectKey}/docs`;
}

/// `/projects/{PK}/docs/{KEY}/{slug}`; the slug is cosmetic and replaced when stale.
export function docUrl(key: string, title: string): string {
  return `${docsHomeUrl(projectKeyOfDoc(key))}/${key}/${docSlug(title)}`;
}

/// Title segments of a doc path (`Architecture/ADRs/Use Postgres`), where a title's own `/` is
/// written `\/` and `\` is written `\\` (spec 12.1).
export function docPathSegments(path: string): string[] {
  const segments: string[] = [];
  let current = '';
  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === '\\' && i + 1 < path.length) current += path[++i];
    else if (char === '/') {
      segments.push(current);
      current = '';
    } else current += char;
  }
  segments.push(current);
  return segments;
}

/// Where a listed doc lives: its folder path (` / ` between folders), led by its project key when
/// that is not `currentProjectKey`; empty for a doc at the root of the current project.
export function docLocation(
  path: string,
  projectKey: string,
  currentProjectKey: string | null,
): string {
  const folder = docPathSegments(path).slice(0, -1).join(' / ');
  return projectKey === currentProjectKey
    ? folder
    : [projectKey, folder].filter(Boolean).join(' · ');
}

export function isDocKey(value: string): boolean {
  return DOC_KEY_PATTERN.test(value.toUpperCase());
}

export function projectKeyOfDoc(key: string): string {
  return key.toUpperCase().replace(/-D-\d+$/, '');
}

const MENTION_PREFIX = 'mention-';

/// URL fragment that opens a doc at its first mention of a ticket (`#mention-WEB-42`).
export function mentionFragment(ticketKey: string): string {
  return `${MENTION_PREFIX}${ticketKey}`;
}

/// The ticket key of a `#mention-KEY` fragment, or null for any other fragment.
export function mentionedTicketKey(fragment: string): string | null {
  return fragment.startsWith(MENTION_PREFIX) ? fragment.slice(MENTION_PREFIX.length) || null : null;
}
