import { currentProjectFirst, docLinkMarkdown } from './doc-link-completions';

describe('doc link completions', () => {
  it('puts the current project first and keeps the ranking inside each group', () => {
    // Arrange
    const items = [
      { key: 'OPS-D-1', projectKey: 'OPS' },
      { key: 'PAY-D-4', projectKey: 'PAY' },
      { key: 'OPS-D-2', projectKey: 'OPS' },
      { key: 'PAY-D-1', projectKey: 'PAY' },
    ];

    // Act
    const sorted = currentProjectFirst(items, 'PAY');

    // Assert
    expect(sorted.map((i) => i.key)).toEqual(['PAY-D-4', 'PAY-D-1', 'OPS-D-1', 'OPS-D-2']);
  });

  it('inserts a markdown link with the title, brackets escaped', () => {
    // Act
    const markdown = docLinkMarkdown({ key: 'PAY-D-3', title: 'Flow [v2] \\ draft' });

    // Assert
    expect(markdown).toBe('[Flow \\[v2\\] \\\\ draft](PAY-D-3)');
  });
});
