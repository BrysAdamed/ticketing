import { isValidGitBranch, normalizeGitRemote } from './git';

describe('normalizeGitRemote', () => {
  it.each([
    ['https://GitLab.example.com/Team/Ticketing.git', 'gitlab.example.com/team/ticketing'],
    ['https://user@git.example.com:8443/team/repo/', 'git.example.com/team/repo'],
    ['ssh://git@git.example.com:2222/team/repo.git', 'git.example.com/team/repo'],
    ['git@github.com:owner/repo.git', 'github.com/owner/repo'],
    ['  git@github.com:owner/repo  ', 'github.com/owner/repo'],
  ])('normalizes %s', (value, expected) => {
    // Act
    const normalized = normalizeGitRemote(value);

    // Assert
    expect(normalized).toBe(expected);
  });

  it.each([
    '',
    'http://git.example.com/team/repo',
    'github.com/owner/repo',
    'https://git.example.com/team/../repo',
    'https://user:secret@git.example.com/team/repo',
    'C:\\repos\\ticketing',
  ])('rejects %s', (value) => {
    // Act
    const normalized = normalizeGitRemote(value);

    // Assert
    expect(normalized).toBeNull();
  });
});

describe('isValidGitBranch', () => {
  it.each(['main', 'develop', 'release/2.0', 'feat/TKT-30-agent'])('accepts %s', (name) => {
    // Act & Assert
    expect(isValidGitBranch(name)).toBe(true);
  });

  it.each(['', 'a b', '-x', 'x/', 'x.', 'a..b', 'a//b', 'x@{1}', '@', '.hidden', 'x.lock', 'a~1'])(
    'rejects %s',
    (name) => {
      // Act & Assert
      expect(isValidGitBranch(name)).toBe(false);
    },
  );
});
