/// The Claude app a delegation opens: Claude Code in a terminal or Claude Desktop (ADR 0013).
export type ClaudeApp = 'ClaudeCode' | 'ClaudeDesktop';

export const CLAUDE_APP_LABELS: Record<ClaudeApp, string> = {
  ClaudeCode: 'Claude Code',
  ClaudeDesktop: 'Claude Desktop',
};

/// Claude ignores longer deep-link prompts silently, counting UTF-16 code units (D-97).
export const CLAUDE_PROMPT_LIMIT = 5000;

/// What Claude's handler does to the prompt anyway: CRLF becomes LF and trailing whitespace goes.
export function normalizePrompt(prompt: string): string {
  return prompt.replace(/\r\n/g, '\n').trimEnd();
}

export function fitsClaudeLimit(prompt: string): boolean {
  return normalizePrompt(prompt).length <= CLAUDE_PROMPT_LIMIT;
}

/// `claude-cli://open?cwd=…&q=…` or `claude://code/new?folder=…&q=…`, every value through
/// `encodeURIComponent` (never URLSearchParams, which turns spaces into `+`) and never `repo` (D-97).
export function claudeDeepLink(app: ClaudeApp, folder: string, prompt: string): string {
  const q = encodeURIComponent(normalizePrompt(prompt));
  const path = encodeURIComponent(folder);
  return app === 'ClaudeDesktop'
    ? `claude://code/new?folder=${path}&q=${q}`
    : `claude-cli://open?cwd=${path}&q=${q}`;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI_OR_INVISIBLE =
  /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/;

/// Why Claude would ignore or misread this local folder, or null when it is an absolute drive
/// path it accepts: `C:\src\app` or `C:/src/app`, no `..` segment, no UNC share, no control,
/// bidirectional or invisible characters (D-97). Spaces, non-ASCII, `;` and `&` are fine.
export function localFolderError(path: string): string | null {
  const value = path.trim();
  if (!value) return 'Enter the folder of your local clone.';
  if (CONTROL.test(value) || BIDI_OR_INVISIBLE.test(value))
    return 'The path contains control or invisible characters.';
  if (/^[\\/]{2}/.test(value)) return 'Network (UNC) paths are not supported; use a local drive.';
  if (!/^[A-Za-z]:[\\/]/.test(value))
    return 'Use an absolute path that starts with a drive, for example C:\\src\\ticketing.';
  if (value.split(/[\\/]/).some((segment) => segment === '..'))
    return 'The path cannot contain "..".';
  return null;
}
