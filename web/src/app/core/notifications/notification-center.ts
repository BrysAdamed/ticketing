import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, Subject } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { PeekService } from '../layout/peek/peek';
import { ToastService } from '../notify/toast.service';
import { groupByDay } from './notification-format';
import { NotificationFilter, UserNotification } from './notification.models';
import { NotificationsApi } from './notifications.api';

export const UNREAD_POLL_MS = 60_000;
export const NOTIFICATIONS_PAGE_SIZE = 25;

export type NotificationPanelStatus = 'idle' | 'loading' | 'ready' | 'error';

/// The signed-in user's notifications: the unread count (polled every minute and on window
/// focus, there is no push) and the state of the top bar panel, with optimistic reads.
@Injectable({ providedIn: 'root' })
export class NotificationCenter {
  private readonly api = inject(NotificationsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly peek = inject(PeekService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  private readonly count = signal(0);
  private readonly opened = signal(false);
  private readonly filterState = signal<NotificationFilter>('all');
  private readonly list = signal<UserNotification[]>([]);
  private readonly cursor = signal<string | null>(null);
  private readonly state = signal<NotificationPanelStatus>('idle');
  private readonly more = signal(false);
  private readonly now = signal(Date.now());
  private readonly pollTicks = new Subject<void>();
  private countGeneration = 0;
  private listGeneration = 0;

  /// Emits on every unread-count refresh (the minute poll, window focus, sign-in), so other
  /// per-user counts can ride on the same poll instead of starting their own.
  readonly polls = this.pollTicks.asObservable();

  readonly unreadCount = this.count.asReadonly();
  readonly isOpen = this.opened.asReadonly();
  readonly filter = this.filterState.asReadonly();
  readonly items = this.list.asReadonly();
  readonly nextCursor = this.cursor.asReadonly();
  readonly status = this.state.asReadonly();
  readonly loadingMore = this.more.asReadonly();
  readonly groups = computed(() => groupByDay(this.list(), new Date(this.now())));
  readonly hasUnread = computed(() => this.count() > 0 || this.list().some((n) => !n.readAt));

  constructor() {
    const window = this.document.defaultView;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    effect(() => {
      const signedIn = this.auth.isAuthenticated();
      untracked(() => {
        stop();
        if (!signedIn) {
          this.reset();
          return;
        }
        void this.refreshCount();
        timer = setInterval(() => {
          if (this.document.visibilityState !== 'hidden') void this.refreshCount();
        }, UNREAD_POLL_MS);
      });
    });

    const onFocus = () => {
      if (this.auth.isAuthenticated()) void this.refreshCount();
    };
    window?.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      stop();
      window?.removeEventListener('focus', onFocus);
    });
  }

  async refreshCount(): Promise<void> {
    this.pollTicks.next();
    const generation = ++this.countGeneration;
    const count = await firstValueFrom(this.api.unreadCount()).catch(() => null);
    if (count === null || generation !== this.countGeneration) return;
    if (this.auth.isAuthenticated()) this.count.set(count);
  }

  open(): void {
    if (this.opened()) return;
    this.opened.set(true);
    void this.load();
  }

  close(): void {
    this.opened.set(false);
  }

  toggle(): void {
    if (this.opened()) this.close();
    else this.open();
  }

  setFilter(filter: NotificationFilter): void {
    if (filter === this.filterState()) return;
    this.filterState.set(filter);
    this.list.set([]);
    this.cursor.set(null);
    void this.load();
  }

  async load(): Promise<void> {
    const generation = ++this.listGeneration;
    this.now.set(Date.now());
    this.more.set(false);
    if (!this.list().length) this.state.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.list(this.filterState() === 'unread', { limit: NOTIFICATIONS_PAGE_SIZE }),
      );
      if (generation !== this.listGeneration) return;
      this.list.set(page.items);
      this.cursor.set(page.nextCursor);
      this.state.set('ready');
    } catch (error) {
      if (generation !== this.listGeneration) return;
      if (this.list().length) this.toast.error(error);
      else this.state.set('error');
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.cursor();
    if (!cursor || this.more()) return;
    const generation = this.listGeneration;
    this.more.set(true);
    try {
      const page = await firstValueFrom(
        this.api.list(this.filterState() === 'unread', {
          limit: NOTIFICATIONS_PAGE_SIZE,
          cursor,
        }),
      );
      if (generation !== this.listGeneration) return;
      this.list.update((list) => {
        const known = new Set(list.map((n) => n.id));
        return [...list, ...page.items.filter((n) => !known.has(n.id))];
      });
      this.cursor.set(page.nextCursor);
    } catch (error) {
      if (generation === this.listGeneration) this.toast.error(error);
    } finally {
      if (generation === this.listGeneration) this.more.set(false);
    }
  }

  async markRead(notification: UserNotification): Promise<void> {
    if (notification.readAt) return;
    const ids = [notification.id];
    this.setReadAt(ids, new Date().toISOString());
    this.count.update((count) => Math.max(0, count - 1));
    const generation = ++this.countGeneration;
    try {
      const unread = await firstValueFrom(this.api.markRead(ids));
      if (generation === this.countGeneration) this.count.set(unread);
    } catch (error) {
      this.setReadAt(ids, null);
      this.count.update((count) => count + 1);
      this.toast.error(error);
    }
  }

  async markAllRead(): Promise<void> {
    if (!this.hasUnread()) return;
    const ids = this.list()
      .filter((n) => !n.readAt)
      .map((n) => n.id);
    const previousCount = this.count();
    this.setReadAt(ids, new Date().toISOString());
    this.count.set(0);
    const generation = ++this.countGeneration;
    try {
      const unread = await firstValueFrom(this.api.markAllRead());
      if (generation === this.countGeneration) this.count.set(unread);
    } catch (error) {
      this.setReadAt(ids, null);
      if (generation === this.countGeneration) this.count.set(previousCount);
      this.toast.error(error);
    }
  }

  /// Click or Enter on a row: marks it read and opens the ticket in the peek panel (or the
  /// regression item page). A deleted ticket has nothing to open, so the panel stays.
  activate(notification: UserNotification): void {
    void this.markRead(notification);
    if (notification.ticket?.deleted || notification.doc?.deleted) return;
    this.close();
    if (notification.ticket) this.peek.open(notification.ticket.key);
    else void this.router.navigateByUrl(notification.url);
  }

  private setReadAt(ids: readonly string[], readAt: string | null): void {
    if (!ids.length) return;
    const set = new Set(ids);
    this.list.update((list) => list.map((n) => (set.has(n.id) ? { ...n, readAt } : n)));
  }

  private reset(): void {
    this.countGeneration++;
    this.listGeneration++;
    this.count.set(0);
    this.opened.set(false);
    this.filterState.set('all');
    this.list.set([]);
    this.cursor.set(null);
    this.state.set('idle');
    this.more.set(false);
  }
}
