import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { Page } from '../api/page';
import { AuthService } from '../auth/auth.service';
import { PeekService } from '../layout/peek/peek';
import { ToastService } from '../notify/toast.service';
import { NotificationCenter, UNREAD_POLL_MS } from './notification-center';
import { UserNotification } from './notification.models';
import { NotificationsApi } from './notifications.api';

function notification(id: string, overrides: Partial<UserNotification> = {}): UserNotification {
  const at = new Date().toISOString();
  return {
    id,
    kind: 'Commented',
    summary: 'commented',
    eventCount: 1,
    actor: { id: 'u1', email: 'ann@example.com', displayName: 'Ann Lee', isActive: true },
    projectKey: 'PAY',
    ticket: { key: `PAY-${id}`, title: `Ticket ${id}`, deleted: false },
    regression: null,
    url: `/tickets/PAY-${id}`,
    createdAt: at,
    updatedAt: at,
    readAt: null,
    ...overrides,
  };
}

const page = (items: UserNotification[], nextCursor: string | null = null) =>
  of<Page<UserNotification>>({ items, nextCursor });

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('NotificationCenter', () => {
  let api: {
    list: ReturnType<typeof vi.fn>;
    unreadCount: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
    markAllRead: ReturnType<typeof vi.fn>;
  };
  let toast: { error: ReturnType<typeof vi.fn> };
  let peek: { open: ReturnType<typeof vi.fn> };
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  const signedIn = signal(true);

  function create(): NotificationCenter {
    const center = TestBed.inject(NotificationCenter);
    TestBed.tick();
    return center;
  }

  beforeEach(() => {
    signedIn.set(true);
    api = {
      list: vi.fn().mockReturnValue(page([])),
      unreadCount: vi.fn().mockReturnValue(of(0)),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    };
    toast = { error: vi.fn() };
    peek = { open: vi.fn() };
    router = { navigateByUrl: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: NotificationsApi, useValue: api },
        { provide: AuthService, useValue: { isAuthenticated: computed(() => signedIn()) } },
        { provide: ToastService, useValue: toast },
        { provide: PeekService, useValue: peek },
        { provide: Router, useValue: router },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  describe('unread count', () => {
    it('loads at sign-in, then every minute and whenever the window gets focus', async () => {
      // Arrange
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      api.unreadCount.mockReturnValue(of(3));

      // Act
      const center = create();
      await flush();

      // Assert
      expect(api.unreadCount).toHaveBeenCalledTimes(1);
      expect(center.unreadCount()).toBe(3);

      // Act
      vi.advanceTimersByTime(UNREAD_POLL_MS);
      window.dispatchEvent(new Event('focus'));

      // Assert
      expect(api.unreadCount).toHaveBeenCalledTimes(3);
    });

    it('stops polling and forgets the count after sign-out', async () => {
      // Arrange
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      api.unreadCount.mockReturnValue(of(4));
      const center = create();
      await flush();

      // Act
      signedIn.set(false);
      TestBed.tick();
      vi.advanceTimersByTime(3 * UNREAD_POLL_MS);
      window.dispatchEvent(new Event('focus'));

      // Assert
      expect(api.unreadCount).toHaveBeenCalledTimes(1);
      expect(center.unreadCount()).toBe(0);
    });

    it('ignores a poll answer that started before the user read something', async () => {
      // Arrange
      const poll = new Subject<number>();
      api.unreadCount.mockReturnValueOnce(of(2)).mockReturnValueOnce(poll);
      api.list.mockReturnValue(page([notification('1'), notification('2')]));
      api.markRead.mockReturnValue(of(1));
      const center = create();
      center.open();
      await flush();
      const refresh = center.refreshCount();

      // Act
      await center.markRead(center.items()[0]);
      poll.next(2);
      poll.complete();
      await refresh;

      // Assert
      expect(center.unreadCount()).toBe(1);
    });
  });

  describe('panel', () => {
    it('loads the list newest first, grouped by day, when it opens', async () => {
      // Arrange
      const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      api.list.mockReturnValue(
        page([notification('2'), notification('1', { createdAt: yesterday })], 'next'),
      );
      const center = create();

      // Act
      center.open();
      const status = center.status();
      await flush();

      // Assert
      expect(status).toBe('loading');
      expect(center.status()).toBe('ready');
      expect(api.list).toHaveBeenCalledWith(false, { limit: 25 });
      expect(center.groups().map((g) => g.items.map((n) => n.id))).toEqual([['2'], ['1']]);
      expect(center.groups()[0].label).toBe('Today');
      expect(center.nextCursor()).toBe('next');
    });

    it('reloads unread only when the filter changes and appends the next page', async () => {
      // Arrange
      const center = create();
      api.list.mockReturnValueOnce(page([notification('3')], 'c1'));
      api.list.mockReturnValueOnce(page([notification('2')]));

      // Act
      center.setFilter('unread');
      await flush();
      await center.loadMore();

      // Assert
      expect(api.list).toHaveBeenNthCalledWith(1, true, { limit: 25 });
      expect(api.list).toHaveBeenNthCalledWith(2, true, { limit: 25, cursor: 'c1' });
      expect(center.items().map((n) => n.id)).toEqual(['3', '2']);
      expect(center.nextCursor()).toBeNull();
    });

    it('shows an error state when the first page fails', async () => {
      // Arrange
      const failing = new Subject<Page<UserNotification>>();
      api.list.mockReturnValue(failing);
      const center = create();

      // Act
      center.open();
      failing.error(new Error('down'));
      await flush();

      // Assert
      expect(center.status()).toBe('error');
    });
  });

  describe('reading', () => {
    it('marks a notification read at once and keeps the server count', async () => {
      // Arrange
      api.unreadCount.mockReturnValue(of(5));
      api.list.mockReturnValue(page([notification('1')]));
      const response = new Subject<number>();
      api.markRead.mockReturnValue(response);
      const center = create();
      center.open();
      await flush();

      // Act
      const pending = center.markRead(center.items()[0]);

      // Assert
      expect(center.items()[0].readAt).not.toBeNull();
      expect(center.unreadCount()).toBe(4);
      expect(api.markRead).toHaveBeenCalledWith(['1']);

      // Act
      response.next(2);
      response.complete();
      await pending;

      // Assert
      expect(center.unreadCount()).toBe(2);
    });

    it('rolls a failed read back and tells the user', async () => {
      // Arrange
      api.unreadCount.mockReturnValue(of(1));
      api.list.mockReturnValue(page([notification('1')]));
      const response = new Subject<number>();
      api.markRead.mockReturnValue(response);
      const center = create();
      center.open();
      await flush();

      // Act
      const pending = center.markRead(center.items()[0]);
      response.error(new Error('offline'));
      await pending;

      // Assert
      expect(center.items()[0].readAt).toBeNull();
      expect(center.unreadCount()).toBe(1);
      expect(toast.error).toHaveBeenCalledOnce();
    });

    it('marks everything read optimistically and restores it when the server refuses', async () => {
      // Arrange
      api.unreadCount.mockReturnValue(of(2));
      const readBefore = notification('3', { readAt: '2026-10-20T10:00:00Z' });
      api.list.mockReturnValue(page([notification('1'), notification('2'), readBefore]));
      const response = new Subject<number>();
      api.markAllRead.mockReturnValue(response);
      const center = create();
      center.open();
      await flush();

      // Act
      const pending = center.markAllRead();

      // Assert
      expect(center.items().every((n) => n.readAt !== null)).toBe(true);
      expect(center.unreadCount()).toBe(0);
      expect(center.hasUnread()).toBe(false);

      // Act
      response.error(new Error('offline'));
      await pending;

      // Assert
      expect(center.items().map((n) => n.readAt)).toEqual([null, null, readBefore.readAt]);
      expect(center.unreadCount()).toBe(2);
      expect(toast.error).toHaveBeenCalledOnce();
    });

    it('opens a ticket in the peek, marks it read and closes the panel', async () => {
      // Arrange
      api.list.mockReturnValue(page([notification('7')]));
      api.markRead.mockReturnValue(of(0));
      const center = create();
      center.open();
      await flush();

      // Act
      center.activate(center.items()[0]);

      // Assert
      expect(peek.open).toHaveBeenCalledWith('PAY-7');
      expect(api.markRead).toHaveBeenCalledWith(['7']);
      expect(center.isOpen()).toBe(false);
    });

    it('navigates to a regression item and keeps the panel open for deleted tickets', async () => {
      // Arrange
      const item = notification('8', {
        kind: 'RegressionItemAssigned',
        ticket: null,
        regression: { sessionKey: 'PAY-R-3', sessionName: 'Release 1.5', testCaseKey: 'PAY-TC-12' },
        url: '/projects/PAY/regressions/PAY-R-3?item=PAY-TC-12',
      });
      const deleted = notification('9', {
        kind: 'Deleted',
        ticket: { key: 'PAY-9', title: 'Gone', deleted: true },
      });
      api.markRead.mockReturnValue(of(0));
      const center = create();

      // Act
      center.open();
      center.activate(item);
      center.open();
      center.activate(deleted);

      // Assert
      expect(router.navigateByUrl).toHaveBeenCalledWith(item.url);
      expect(peek.open).not.toHaveBeenCalled();
      expect(center.isOpen()).toBe(true);
      expect(api.markRead).toHaveBeenCalledWith(['9']);
    });
  });
});
