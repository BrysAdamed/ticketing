/// A user a stored mention token can resolve to (the API's `UserRef` fits).
export interface MentionUser {
  id: string;
  displayName: string;
  email?: string;
}

/// One row of the mention picker.
export interface MentionCandidate {
  id: string;
  displayName: string;
  email: string;
}

/// Searches the people who may be mentioned. The signal aborts when the query changes or the picker closes.
export type MentionSearch = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly MentionCandidate[]>;

/// A `@[Name](user:<id>)` token found outside code (D-96). `userId` is lower-case.
export interface MentionToken {
  userId: string;
  name: string;
  start: number;
  end: number;
}

/// The `@query` being typed before the caret: `start` is the `@`, `end` the caret.
export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

const GUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const TOKEN_SOURCE = `@\\[([^\\[\\]\\r\\n]+)\\]\\(user:(${GUID})\\)`;

/// Matches a mention token at the start of the input (for the markdown tokenizer).
export const MENTION_AT_START = new RegExp(`^${TOKEN_SOURCE}`);

const NAME_FORBIDDEN = /[[\]()\r\n]/g;
const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const QUERY_STOP = /[\r\n[\]()`]/;
const BEFORE_AT = /[\s([{"'>*_~]/;
const MAX_QUERY = 50;
const MAX_WORDS = 3;

/// The stored form of a mention: `@[Display Name](user:<id>)`, with brackets, parentheses and line
/// breaks removed from the name.
export function formatMention(userId: string, displayName: string): string {
  const name = displayName.replace(NAME_FORBIDDEN, '').trim() || 'user';
  return `@[${name}](user:${userId.toLowerCase()})`;
}

/// Mention tokens in markdown, in order, skipping fenced code blocks and inline code spans.
export function parseMentions(markdown: string | null | undefined): MentionToken[] {
  if (!markdown) return [];
  const code = codeRanges(markdown);
  const tokens: MentionToken[] = [];
  for (const match of markdown.matchAll(new RegExp(TOKEN_SOURCE, 'g'))) {
    const start = match.index ?? 0;
    if (inRanges(code, start)) continue;
    tokens.push({
      userId: match[2].toLowerCase(),
      name: match[1],
      start,
      end: start + match[0].length,
    });
  }
  return tokens;
}

/// Distinct mentioned user ids (lower-case) in order of first appearance.
export function mentionedUserIds(markdown: string | null | undefined): string[] {
  return [...new Set(parseMentions(markdown).map((t) => t.userId))];
}

/// [start, end) ranges of fenced code blocks (found line by line first) and of inline code spans in
/// the text between them. An unclosed fence runs to the end; an unclosed backtick run is plain text.
export function codeRanges(markdown: string): [number, number][] {
  const ranges: [number, number][] = [];
  let textStart = 0;
  let fence: { char: string; length: number; start: number } | null = null;
  let offset = 0;
  for (const line of markdown.split('\n')) {
    const lineEnd = offset + line.length;
    const content = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence.char}{${fence.length},}[ \\t]*$`);
      if (closing.test(content)) {
        ranges.push([fence.start, lineEnd]);
        fence = null;
        textStart = lineEnd + 1;
      }
    } else {
      const opening = OPENING_FENCE.exec(content);
      if (opening) {
        ranges.push(...codeSpans(markdown, textStart, offset));
        fence = { char: opening[1][0], length: opening[1].length, start: offset };
      }
    }
    offset = lineEnd + 1;
  }
  if (fence) ranges.push([fence.start, markdown.length]);
  else ranges.push(...codeSpans(markdown, textStart, markdown.length));
  return ranges;
}

function codeSpans(text: string, from: number, to: number): [number, number][] {
  const spans: [number, number][] = [];
  let i = from;
  while (i < to) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    const length = runLength(text, i, to);
    let close = -1;
    for (let j = i + length; j < to;) {
      if (text[j] !== '`') {
        j++;
        continue;
      }
      const run = runLength(text, j, to);
      if (run === length) {
        close = j;
        break;
      }
      j += run;
    }
    if (close < 0) {
      i += length;
      continue;
    }
    spans.push([i, close + length]);
    i = close + length;
  }
  return spans;
}

function runLength(text: string, at: number, to: number): number {
  let end = at;
  while (end < to && text[end] === '`') end++;
  return end - at;
}

function inRanges(ranges: readonly [number, number][], index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/// The `@query` typed right before the caret, or null. The `@` must start the text or follow a space or
/// opening punctuation, sit outside code, and the query may hold single spaces (names) and `@` (emails).
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  for (let i = caret - 1; i >= 0 && caret - i <= MAX_QUERY + 1; i--) {
    const char = text[i];
    if (QUERY_STOP.test(char)) return null;
    if (char !== '@' || (i > 0 && !BEFORE_AT.test(text[i - 1]))) continue;
    const query = text.slice(i + 1, caret);
    if (/^\s|\s\s/.test(query) || query.split(' ').length > MAX_WORDS) return null;
    if (inRanges(codeRanges(text), i)) return null;
    return { start: i, end: caret, query };
  }
  return null;
}

/// Replaces the typed `@query` with the candidate's token and a following space; returns the new
/// text and the caret position after the space.
export function insertMention(
  text: string,
  query: MentionQuery,
  candidate: MentionUser,
): { text: string; caret: number } {
  const token = formatMention(candidate.id, candidate.displayName);
  const after = text.slice(query.end);
  const spacer = /^\s/.test(after) ? '' : ' ';
  return {
    text: text.slice(0, query.start) + token + spacer + after,
    caret: query.start + token.length + 1,
  };
}
