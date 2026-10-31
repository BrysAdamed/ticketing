import {
  codeRanges,
  findMentionQuery,
  formatMention,
  insertMention,
  mentionedUserIds,
  parseMentions,
} from './mentions';

const ANN = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const BOB = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const ann = `@[Ann Lee](user:${ANN})`;
const bob = `@[Bob](user:${BOB})`;

const ids = (markdown: string) => parseMentions(markdown).map((t) => t.userId);

describe('formatMention', () => {
  it('formats the stored token with a lower-case id', () => {
    expect(formatMention(ANN.toUpperCase(), 'Ann Lee')).toBe(ann);
  });

  it('strips brackets, parentheses and line breaks from the name', () => {
    expect(formatMention(ANN, ' Ann [QA] (Lead)\r\nLee ')).toBe(`@[Ann QA LeadLee](user:${ANN})`);
  });

  it('falls back to "user" for an empty name', () => {
    expect(formatMention(ANN, '[]()')).toBe(`@[user](user:${ANN})`);
  });
});

describe('parseMentions', () => {
  it('finds tokens with their name and range', () => {
    // Arrange
    const text = `Hi ${ann}, see this`;

    // Act
    const tokens = parseMentions(text);

    // Assert
    expect(tokens).toEqual([{ userId: ANN, name: 'Ann Lee', start: 3, end: 3 + ann.length }]);
  });

  it('accepts adjacent punctuation and no space before the @', () => {
    expect(ids(`(${ann}).${bob}!`)).toEqual([ANN, BOB]);
    expect(ids(`x${ann}`)).toEqual([ANN]);
  });

  it('reads parentheses in a stored name and upper-case ids', () => {
    expect(parseMentions(`@[Ann (QA)](user:${ANN.toUpperCase()})`)).toEqual([
      { userId: ANN, name: 'Ann (QA)', start: 0, end: `@[Ann (QA)](user:${ANN})`.length },
    ]);
  });

  it('leaves malformed tokens as text', () => {
    const malformed = [
      `@[](user:${ANN})`,
      `@[Ann [x]](user:${ANN})`,
      `@[Ann\nLee](user:${ANN})`,
      `@[Ann](user:not-a-guid)`,
      `@[Ann](user:${ANN.slice(0, -1)})`,
      `@[Ann](usr:${ANN})`,
      `@[Ann] (user:${ANN})`,
      `[Ann](user:${ANN})`,
      `@[Ann](user:${ANN}`,
    ];
    for (const text of malformed) expect(ids(text), text).toEqual([]);
  });

  it('skips inline code spans, including longer backtick runs', () => {
    expect(ids(`\`${ann}\` and ${bob}`)).toEqual([BOB]);
    expect(ids(`\`\` a \` ${ann} \`\` ${bob}`)).toEqual([BOB]);
  });

  it('treats an unclosed backtick run as text', () => {
    expect(ids(`a \` ${ann}`)).toEqual([ANN]);
    expect(ids(`\`\` ${ann} \``)).toEqual([ANN]);
  });

  it('lets a code span cross a line break', () => {
    expect(ids(`\`start\n${ann}\` ${bob}`)).toEqual([BOB]);
  });

  it('skips fenced code blocks with backticks or tildes', () => {
    expect(ids(`${ann}\n\`\`\`ts\n${bob}\n\`\`\`\nafter ${bob}`)).toEqual([ANN, BOB]);
    expect(ids(`~~~\n${ann}\n~~~`)).toEqual([]);
  });

  it('closes a fence only with the same character and at least the opening length', () => {
    expect(ids(`\`\`\`\`\n${ann}\n\`\`\`\n${bob}\n\`\`\`\`\n${ann}`)).toEqual([ANN]);
    expect(ids(`\`\`\`\n${ann}\n~~~\n${bob}`)).toEqual([]);
  });

  it('runs an unclosed fence to the end of the text', () => {
    expect(ids(`${ann}\n\`\`\`\n${bob}`)).toEqual([ANN]);
  });

  it('allows up to three spaces before a fence and trailing spaces after a closing one', () => {
    expect(ids(`   \`\`\`\n${ann}\n   \`\`\`  \n${bob}`)).toEqual([BOB]);
    expect(ids(`    \`\`\`\n${ann}`)).toEqual([ANN]);
  });

  it('skips indented code blocks after a blank line, the start or a closing fence', () => {
    expect(ids(`    ${ann}`)).toEqual([]);
    expect(ids(`\t${ann}`)).toEqual([]);
    expect(ids(`Intro\n\n    ${ann}\n\n    ${bob}\nafter ${bob}`)).toEqual([BOB]);
    expect(ids(`\`\`\`\nx\n\`\`\`\n    ${ann}`)).toEqual([]);
    expect(ids(`- item\n\npara\n\n    ${ann}`)).toEqual([]);
    expect(ids(`    code\r\n\r\n    ${ann}\r\n${bob}`)).toEqual([BOB]);
  });

  it('does not take indented lines for code after a paragraph, inside a list or with three spaces', () => {
    expect(ids(`   ${ann}`)).toEqual([ANN]);
    expect(ids(`Paragraph\n    ${ann}`)).toEqual([ANN]);
    expect(ids(`- item\n\n    ${ann}`)).toEqual([ANN]);
    expect(ids(`1. item\n    nested\n\n    ${ann}`)).toEqual([ANN]);
    expect(ids(`* item\nlazy\n\n    ${ann}`)).toEqual([ANN]);
  });

  it('does not let an inline span reach into an indented block', () => {
    expect(ids(`    a \` b\nc\` ${ann}`)).toEqual([ANN]);
    expect(ids(`    a \` b\n\n${ann}\` c`)).toEqual([ANN]);
  });

  it('does not let an inline span reach into a fence', () => {
    expect(ids(`a \` b\n\`\`\`\n${ann}\n\`\`\`\n${bob} \``)).toEqual([BOB]);
    expect(ids(`a \` b\n\`\`\`\nx\n\`\`\`\n${bob}`)).toEqual([BOB]);
  });

  it('keeps duplicates as tokens and returns distinct ids in order', () => {
    // Arrange
    const text = `${bob} ${ann} ${bob}`;

    // Act + Assert
    expect(ids(text)).toEqual([BOB, ANN, BOB]);
    expect(mentionedUserIds(text)).toEqual([BOB, ANN]);
  });

  it('handles CRLF line endings', () => {
    expect(ids(`\`\`\`\r\n${ann}\r\n\`\`\`\r\n${bob}`)).toEqual([BOB]);
  });

  it('returns nothing for empty input', () => {
    expect(parseMentions(null)).toEqual([]);
    expect(parseMentions('')).toEqual([]);
    expect(codeRanges('')).toEqual([]);
  });
});

describe('findMentionQuery', () => {
  const at = (text: string) => findMentionQuery(text.replace('|', ''), text.indexOf('|'));

  it('finds the query after an @ at a word start', () => {
    expect(at('@|')).toEqual({ start: 0, end: 1, query: '' });
    expect(at('Hi @ma|')).toEqual({ start: 3, end: 6, query: 'ma' });
    expect(at('(@ma|')).toEqual({ start: 1, end: 4, query: 'ma' });
    expect(at('line\n@ma|')).toEqual({ start: 5, end: 8, query: 'ma' });
  });

  it('only looks at the text before the caret', () => {
    expect(at('Hi @ma| rest')).toEqual({ start: 3, end: 6, query: 'ma' });
  });

  it('allows names with single spaces and emails', () => {
    expect(at('@maya kow|')?.query).toBe('maya kow');
    expect(at('@maya.k@exa|')?.query).toBe('maya.k@exa');
  });

  it('ignores an @ inside a word (emails in prose)', () => {
    expect(at('mail foo@bar|')).toBeNull();
  });

  it('stops at line breaks, brackets, double spaces, a leading space and long queries', () => {
    expect(at('@ma\nx|')).toBeNull();
    expect(at('@[Ann](user:x) |')).toBeNull();
    expect(at('@ |')).toBeNull();
    expect(at('@maya  k|')).toBeNull();
    expect(at('@one two three four|')).toBeNull();
    expect(at(`@${'a'.repeat(60)}|`)).toBeNull();
  });

  it('ignores an @ inside code', () => {
    expect(at('a ` b @ma|')).not.toBeNull();
    expect(at('`x @ma|`')).toBeNull();
    expect(at('```\n@ma|')).toBeNull();
  });
});

describe('insertMention', () => {
  const candidate = { id: ANN, displayName: 'Ann Lee', email: 'ann@example.com' };

  it('replaces the query with the token and a space and puts the caret after it', () => {
    // Arrange
    const text = 'Hi @an';

    // Act
    const result = insertMention(text, { start: 3, end: 6, query: 'an' }, candidate);

    // Assert
    expect(result.text).toBe(`Hi ${ann} `);
    expect(result.caret).toBe(result.text.length);
  });

  it('reuses following whitespace and keeps the rest of the text', () => {
    // Act
    const result = insertMention('@an rest', { start: 0, end: 3, query: 'an' }, candidate);

    // Assert
    expect(result.text).toBe(`${ann} rest`);
    expect(result.caret).toBe(ann.length + 1);
  });
});
