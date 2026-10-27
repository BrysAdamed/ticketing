const USER = '(?:([A-Za-z0-9._~%+-]+)@)';
const HOST = '([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)';
const PORT = '(?::[0-9]{1,5})?';
const PATH = '([A-Za-z0-9._~%+/-]+)';
const HTTPS_FORM = new RegExp(`^https://${USER}?${HOST}${PORT}/${PATH}$`, 'i');
const SSH_FORM = new RegExp(`^ssh://${USER}?${HOST}${PORT}/${PATH}$`, 'i');
const SCP_FORM = new RegExp(`^${USER}${HOST}:${PATH}$`);
export const GIT_REMOTE_MAX_LENGTH = 500;
export const GIT_BRANCH_MAX_LENGTH = 100;

/// The form two remotes of one repository share (`git.example.com/team/repo`), or null when `value`
/// is not an https, ssh or scp-style git remote. Mirrors the server's `GitRemoteUrl`.
export function normalizeGitRemote(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.length > GIT_REMOTE_MAX_LENGTH) return null;
  const match = HTTPS_FORM.exec(trimmed) ?? SSH_FORM.exec(trimmed) ?? SCP_FORM.exec(trimmed);
  if (!match) return null;
  let path = match[3].replace(/^\/+|\/+$/g, '');
  if (path.toLowerCase().endsWith('.git')) path = path.slice(0, -4).replace(/\/+$/, '');
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return `${match[2]}/${path}`.toLowerCase();
}

/// Whether `git check-ref-format --branch` would accept the name, limited to printable ASCII.
/// Mirrors the server's `GitBranchName`.
export function isValidGitBranch(value: string | null | undefined): boolean {
  const name = value?.trim() ?? '';
  return (
    name.length > 0 &&
    name.length <= GIT_BRANCH_MAX_LENGTH &&
    [...name].every((c) => c > ' ' && c < '\u007f' && !' ~^:?*[\\'.includes(c)) &&
    name !== '@' &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.includes('@{') &&
    name.split('/').every((c) => !c.startsWith('.') && !c.endsWith('.lock'))
  );
}
