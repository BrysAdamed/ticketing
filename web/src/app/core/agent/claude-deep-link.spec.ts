import {
  claudeDeepLink,
  CLAUDE_PROMPT_LIMIT,
  fitsClaudeLimit,
  localFolderError,
  normalizePrompt,
} from './claude-deep-link';

describe('claudeDeepLink', () => {
  it('encodes folder and prompt with encodeURIComponent for Claude Code', () => {
    // Arrange
    const prompt = 'Fix TKT-42 & run "tests"; 100% done\r\nzażółć 🚀  \n';

    // Act
    const url = claudeDeepLink('ClaudeCode', 'C:\\src\\my app', prompt);

    // Assert
    expect(url).toBe(
      `claude-cli://open?cwd=C%3A%5Csrc%5Cmy%20app&q=${encodeURIComponent('Fix TKT-42 & run "tests"; 100% done\nzażółć 🚀')}`,
    );
    expect(url).not.toContain('+');
    const q = new URL(url.replace('claude-cli://open', 'https://x/')).searchParams;
    expect(q.get('q')).toBe('Fix TKT-42 & run "tests"; 100% done\nzażółć 🚀');
  });

  it('builds the Claude Desktop link with folder and never sends repo', () => {
    // Act
    const url = claudeDeepLink('ClaudeDesktop', 'D:/work/ticketing', 'Go');

    // Assert
    expect(url).toBe('claude://code/new?folder=D%3A%2Fwork%2Fticketing&q=Go');
    expect(url).not.toContain('repo=');
  });
});

describe('prompt limit', () => {
  it('counts UTF-16 code units after normalising CRLF and trailing whitespace', () => {
    // Arrange
    const exact = 'a'.repeat(CLAUDE_PROMPT_LIMIT - 2) + '🚀';
    const over = 'a'.repeat(CLAUDE_PROMPT_LIMIT - 1) + '🚀';
    const crlf = 'a\r\n'.repeat(2500) + '   ';

    // Act / Assert
    expect(fitsClaudeLimit(exact)).toBe(true);
    expect(fitsClaudeLimit(over)).toBe(false);
    expect(normalizePrompt(crlf).length).toBe(4999);
    expect(fitsClaudeLimit(crlf)).toBe(true);
  });
});

describe('localFolderError', () => {
  it.each(['C:\\src\\ticketing', 'c:/src/ticketing', 'D:\\projekt zażółć; a&b\\', 'C:\\'])(
    'accepts %s',
    (path) => {
      // Act / Assert
      expect(localFolderError(path)).toBeNull();
    },
  );

  it.each([
    ['', 'Enter the folder'],
    ['src\\ticketing', 'absolute path'],
    ['/home/me/ticketing', 'absolute path'],
    ['\\\\server\\share\\repo', 'UNC'],
    ['//server/share', 'UNC'],
    ['C:\\src\\..\\other', '".."'],
    ['C:\\src\\tick\u202eeting', 'invisible'],
    ['C:\\src\\a\u200bb', 'invisible'],
    ['C:\\src\\a\tb', 'control'],
  ])('rejects %j', (path, message) => {
    // Act / Assert
    expect(localFolderError(path)).toContain(message);
  });
});
