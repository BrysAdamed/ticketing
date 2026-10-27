import { mergeThreeWay, MergeResult } from './three-way-merge';

const BASE = [
  '# Payment flow',
  '',
  'Checkout creates a PaymentIntent.',
  '',
  '## Overview',
  '',
  'The browser only confirms it.',
  '',
  '## Webhooks',
  '',
  'Order state follows Stripe webhooks.',
].join('\n');

const edit = (text: string, from: string, to: string) => {
  expect(text).toContain(from);
  return text.replace(from, to);
};

interface Fixture {
  name: string;
  mine: string;
  theirs: string;
  expected: string | { conflicts: number };
}

const fixtures: Fixture[] = [
  { name: 'nobody changed anything', mine: BASE, theirs: BASE, expected: BASE },
  {
    name: 'only I changed it',
    mine: edit(BASE, 'only confirms it', 'only confirms the intent'),
    theirs: BASE,
    expected: edit(BASE, 'only confirms it', 'only confirms the intent'),
  },
  {
    name: 'only they changed it',
    mine: BASE,
    theirs: edit(BASE, 'Stripe webhooks', 'Stripe webhooks, never the browser'),
    expected: edit(BASE, 'Stripe webhooks', 'Stripe webhooks, never the browser'),
  },
  {
    name: 'we edited different sections',
    mine: edit(BASE, 'Checkout creates', 'Checkout always creates'),
    theirs: edit(BASE, 'Order state follows', 'The order state follows'),
    expected: edit(
      edit(BASE, 'Checkout creates', 'Checkout always creates'),
      'Order state follows',
      'The order state follows',
    ),
  },
  {
    name: 'I added a section at the end, they added a note at the top',
    mine: `${BASE}\n\n## Refunds\n\nRefunds go through the API.`,
    theirs: `> [!NOTE]\n> Draft for Checkout v2.\n\n${BASE}`,
    expected: `> [!NOTE]\n> Draft for Checkout v2.\n\n${BASE}\n\n## Refunds\n\nRefunds go through the API.`,
  },
  {
    name: 'we both made the same fix',
    mine: edit(BASE, 'PaymentIntent.', 'PaymentIntent on the server.'),
    theirs: edit(BASE, 'PaymentIntent.', 'PaymentIntent on the server.'),
    expected: edit(BASE, 'PaymentIntent.', 'PaymentIntent on the server.'),
  },
  {
    name: 'I deleted a section, they edited another one',
    mine: edit(BASE, '## Overview\n\nThe browser only confirms it.\n\n', ''),
    theirs: edit(BASE, 'Order state follows', 'Order status follows'),
    expected: edit(
      edit(BASE, '## Overview\n\nThe browser only confirms it.\n\n', ''),
      'Order state follows',
      'Order status follows',
    ),
  },
  {
    name: 'we changed the same line differently',
    mine: edit(BASE, 'The browser only confirms it.', 'The browser confirms it with 3-D Secure.'),
    theirs: edit(BASE, 'The browser only confirms it.', 'Only the browser confirms it.'),
    expected: { conflicts: 1 },
  },
  {
    name: 'we changed adjacent lines (no unchanged line between)',
    mine: edit(BASE, '## Overview', '## Summary'),
    theirs: edit(BASE, '\n\nThe browser only confirms it.', '\nThe browser only confirms it.'),
    expected: { conflicts: 1 },
  },
  {
    name: 'I deleted a block they edited',
    mine: edit(BASE, '## Webhooks\n\nOrder state follows Stripe webhooks.', '## Webhooks'),
    theirs: edit(BASE, 'Order state follows', 'Order status follows'),
    expected: { conflicts: 1 },
  },
  {
    name: 'we inserted different text at the same place',
    mine: edit(BASE, '## Webhooks', '## Retries\n\nThree attempts.\n\n## Webhooks'),
    theirs: edit(BASE, '## Webhooks', '## Idempotency\n\nKeys per request.\n\n## Webhooks'),
    expected: { conflicts: 1 },
  },
  {
    name: 'two separate clashes are reported separately',
    mine: edit(edit(BASE, '# Payment flow', '# Payments'), 'Stripe webhooks', 'webhooks'),
    theirs: edit(edit(BASE, '# Payment flow', '# Card payments'), 'Stripe webhooks', 'hooks'),
    expected: { conflicts: 2 },
  },
  {
    name: 'Windows line endings merge with Unix ones',
    mine: edit(BASE, 'Checkout creates', 'Checkout always creates').replace(/\n/g, '\r\n'),
    theirs: edit(BASE, 'Order state follows', 'The order state follows'),
    expected: edit(
      edit(BASE, 'Checkout creates', 'Checkout always creates'),
      'Order state follows',
      'The order state follows',
    ),
  },
];

describe('mergeThreeWay', () => {
  it.each(fixtures)('$name', ({ mine, theirs, expected }) => {
    // Act
    const result: MergeResult = mergeThreeWay(BASE, mine, theirs);

    // Assert
    if (typeof expected === 'string') {
      expect(result).toEqual({ clean: true, text: expected });
    } else {
      expect(result.clean).toBe(false);
      if (!result.clean) expect(result.conflicts).toHaveLength(expected.conflicts);
    }
  });

  it('points the conflict at the clashing lines of each side', () => {
    // Arrange
    const mine = `Intro added by me\n\n${edit(BASE, 'The browser only confirms it.', 'Mine.')}`;
    const theirs = edit(BASE, 'The browser only confirms it.', 'Theirs, line 1.\nTheirs, line 2.');

    // Act
    const result = mergeThreeWay(BASE, mine, theirs);

    // Assert
    expect(result.clean).toBe(false);
    if (result.clean) return;
    const [conflict] = result.conflicts;
    expect(mine.split('\n').slice(conflict.mine.start, conflict.mine.end)).toEqual(['Mine.']);
    expect(theirs.split('\n').slice(conflict.theirs.start, conflict.theirs.end)).toEqual([
      'Theirs, line 1.',
      'Theirs, line 2.',
    ]);
  });

  it('merges a 100 000-character page quickly', () => {
    // Arrange
    const paragraphs = Array.from({ length: 1500 }, (_, i) => `Paragraph ${i} ${'x'.repeat(50)}`);
    const base = paragraphs.join('\n\n');
    const mine = base.replace('Paragraph 10 ', 'Paragraph ten ');
    const theirs = base.replace('Paragraph 1400 ', 'Paragraph 1400 (edited) ');
    const started = performance.now();

    // Act
    const result = mergeThreeWay(base, mine, theirs);

    // Assert
    expect(base.length).toBeGreaterThan(90_000);
    expect(result.clean).toBe(true);
    expect(performance.now() - started).toBeLessThan(300);
  });
});
