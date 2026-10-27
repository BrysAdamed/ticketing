import { describe, expect, it } from 'vitest';
import { Doc } from './doc.models';
import { addRecent, MAX_RECENT_DOCS, RecentDoc, toRecentDoc } from './recent-docs';

function recent(key: string): RecentDoc {
  return {
    key,
    title: key,
    projectKey: 'PAY',
    kind: 'Page',
    diagramFormat: null,
    folderPath: '',
    url: `/docs/${key}`,
  };
}

describe('recent docs', () => {
  it('moves a visited doc to the front without duplicates and keeps the list short', () => {
    // Arrange
    const list = Array.from({ length: MAX_RECENT_DOCS }, (_, i) => recent(`PAY-D-${i + 1}`));

    // Act
    const again = addRecent(list, recent('PAY-D-3'));
    const added = addRecent(list, recent('PAY-D-99'));

    // Assert
    expect(again.map((d) => d.key).slice(0, 3)).toEqual(['PAY-D-3', 'PAY-D-1', 'PAY-D-2']);
    expect(again).toHaveLength(MAX_RECENT_DOCS);
    expect(added[0].key).toBe('PAY-D-99');
    expect(added).toHaveLength(MAX_RECENT_DOCS);
    expect(added.some((d) => d.key === `PAY-D-${MAX_RECENT_DOCS}`)).toBe(false);
  });

  it('keeps the folder path with escaped slashes and the canonical url', () => {
    // Arrange
    const doc = {
      key: 'PAY-D-9',
      title: 'Payment flow',
      projectKey: 'PAY',
      kind: 'Page',
      diagramFormat: null,
      breadcrumb: [
        { key: 'PAY-D-1', title: 'Architecture' },
        { key: 'PAY-D-2', title: 'In/Out' },
      ],
    } as unknown as Doc;

    // Act
    const item = toRecentDoc(doc);

    // Assert
    expect(item.folderPath).toBe('Architecture/In\\/Out');
    expect(item.url).toBe('/projects/PAY/docs/PAY-D-9/payment-flow');
  });
});
