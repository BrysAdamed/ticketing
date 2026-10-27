import { describe, expect, it, vi } from 'vitest';
import { keyJumpItem, toPaletteItem } from './quick-jump';

describe('quick jump', () => {
  it('jumps to ticket, test case and session keys in any case', () => {
    // Arrange
    const navigate = vi.fn();

    // Act
    keyJumpItem(' web-42 ', navigate)?.run();
    keyJumpItem('web-tc-7', navigate)?.run();
    keyJumpItem('WEB-r-3', navigate)?.run();

    // Assert
    expect(navigate.mock.calls).toEqual([['/tickets/WEB-42'], ['/projects/WEB/test-cases/WEB-TC-7'], ['/projects/WEB/regressions/WEB-R-3']]);
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
      { kind: 'Ticket', id: '1', key: 'WEB-1', title: 'Login fails', projectKey: 'WEB', url: '/tickets/WEB-1', ticketType: 'Bug', status: 'ToDo' },
      navigate,
    );
    item.run();

    // Assert
    expect(item).toMatchObject({ id: 'Ticket:WEB-1', group: 'Tickets', icon: 'tablerBug', hint: 'WEB' });
    expect(item.label).toContain('Login fails');
    expect(navigate).toHaveBeenCalledWith('/tickets/WEB-1');
  });
});
