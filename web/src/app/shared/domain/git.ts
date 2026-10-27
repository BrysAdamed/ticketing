const USER = '(?:([A-Za-z0-9._~+][A-Za-z0-9._~%+-]{0,49})@)';
const HOST = '([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)';
const PORT = '(?::[0-9]{1,5})?';
const PATH = '([A-Za-z0-9._~%+/-]+)';
const HTTPS_FORM = new RegExp(`^https://${USER}?${HOST}${PORT}/${PATH}$`, 'i');
const SSH_FORM = new RegExp(`^ssh://${USER}?${HOST}${PORT}/${PATH}$`, 'i');
const SCP_FORM = new RegExp(`^${USER}${HOST}:${PATH}$`);
const TOKEN_PREFIXES = [
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'github_pat_',
  'glpat-',
  'gldt-',
  'glptt-',
  'glrt-',
  'gloas-',
  'atbb',
  'atctt',
  'xoxb-',
  'xoxp-',
  'tkt_',
];
export const GIT_REMOTE_MAX_LENGTH = 500;
export const GIT_BRANCH_MAX_LENGTH = 100;

/// The form two remotes of one repository share (`git.example.com/team/repo`), or null when `value`
/// is not an https, ssh or scp-style git remote. Mirrors the server's `GitRemoteUrl`.
export function normalizeGitRemote(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.length > GIT_REMOTE_MAX_LENGTH) return null;
  const match = HTTPS_FORM.exec(trimmed) ?? SSH_FORM.exec(trimmed) ?? SCP_FORM.exec(trimmed);
  if (!match) return null;
  const user = (match[1] ?? '').toLowerCase();
  if (TOKEN_PREFIXES.some((prefix) => user.startsWith(prefix))) return null;
  let path = match[3].replace(/^\/+|\/+$/g, '');
  if (path.toLowerCase().endsWith('.git')) path = path.slice(0, -4).replace(/\/+$/, '');
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return `${match[2]}/${path}`.toLowerCase();
}

/// Whether `git check-ref-format --branch` would accept the name, limited to ASCII letters, digits,
/// `-`, `_`, `.` and `/`.
/// Mirrors the server's `GitBranchName`.
export function isValidGitBranch(value: string | null | undefined): boolean {
  const name = value?.trim() ?? '';
  return (
    name.length > 0 &&
    name.length <= GIT_BRANCH_MAX_LENGTH &&
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.includes('..') &&
    !name.includes('//') &&
    name.split('/').every((c) => !c.startsWith('.') && !c.endsWith('.lock'))
  );
}
