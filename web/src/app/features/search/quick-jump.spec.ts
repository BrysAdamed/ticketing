import { describe, expect, it, vi } from 'vitest';
import { docLocation, keyJumpItem, recentDocItem, toPaletteItem } from './quick-jump';

describe('quick jump', () => {
  it('jumps to ticket, test case and session keys in any case', () => {
    // Arrange
    const navigate = vi.fn();

    // Act
    keyJumpItem(' web-42 ', navigate)?.run();
    keyJumpItem('web-tc-7', navigate)?.run();
    keyJumpItem('WEB-r-3', navigate)?.run();
    keyJumpItem('web-d-12', navigate)?.run();

    // Assert
    expect(navigate.mock.calls).toEqual([
      ['/tickets/WEB-42'],
      ['/projects/WEB/test-cases/WEB-TC-7'],
      ['/projects/WEB/regressions/WEB-R-3'],
      ['/docs/WEB-D-12'],
    ]);
  });

  it('offers no jump for plain text', () => {
    // Act
    const item = keyJumpItem('login page', vi.fn());

    // Assert
    expect(item).toBeNull();
  });

  it('maps server items to grouped palette rows', () => {
    // Arrange
    const navigate = vi.fn();

    // Act
    const item = toPaletteItem(
      {
        kind: 'Ticket',
        id: '1',
        key: 'WEB-1',
        title: 'Login fails',
        projectKey: 'WEB',
        url: '/tickets/WEB-1',
        ticketType: 'Bug',
        status: 'ToDo',
      },
      navigate,
    );
    item.run();

    // Assert
    expect(item).toMatchObject({
      id: 'Ticket:WEB-1',
      group: 'Tickets',
      icon: 'tablerBug',
      hint: 'WEB',
    });
    expect(item.label).toContain('Login fails');
    expect(navigate).toHaveBeenCalledWith('/tickets/WEB-1');
  });

  it('maps docs to two-line rows with location, snippet and the title match', () => {
    // Arrange
    const navigate = vi.fn();
    const snippet = { text: 'the idempotency key', highlights: [{ start: 4, length: 11 }] };

    // Act
    const item = toPaletteItem(
      {
        kind: 'Doc',
        id: '2',
        key: 'PAY-D-7',
        title: 'Idempotency rules',
        projectKey: 'PAY',
        url: '/p/PAY/docs/PAY-D-7/idempotency-rules',
        ticketType: null,
        status: null,
        docKind: 'Diagram',
        diagramFormat: 'Canvas',
        folderPath: 'Architecture/ADRs',
        snippet,
      },
      navigate,
      'idempotency',
    );
    item.run();

    // Assert
    expect(item).toMatchObject({
      id: 'Doc:PAY-D-7',
      group: 'Docs',
      label: 'Idempotency rules',
      labelHighlights: [{ start: 0, length: 11 }],
      detail: 'PAY · Architecture / ADRs',
      icon: 'tablerChalkboard',
      hint: 'PAY-D-7',
      snippet,
    });
    expect(navigate).toHaveBeenCalledWith('/p/PAY/docs/PAY-D-7/idempotency-rules');
  });

  it('lists recently viewed docs under their own group', () => {
    // Arrange
    const navigate = vi.fn();

    // Act
    const item = recentDocItem(
      {
        key: 'PAY-D-3',
        title: 'Architecture',
        projectKey: 'PAY',
        kind: 'Folder',
        diagramFormat: null,
        folderPath: '',
        url: '/projects/PAY/docs/PAY-D-3/architecture',
      },
      navigate,
    );
    item.run();

    // Assert
    expect(item).toMatchObject({ group: 'Recent docs', icon: 'tablerFolder', detail: 'PAY' });
    expect(navigate).toHaveBeenCalledWith('/projects/PAY/docs/PAY-D-3/architecture');
    expect(docLocation('PAY', 'A/B\\/C')).toBe('PAY · A / B/C');
  });
});
