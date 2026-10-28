import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { loadAvatarArt, UserAvatar } from '@shared/avatars/avatar-catalog';
import { AvatarSource } from '@shared/avatars/avatar-source';

export const AVATAR_REFRESH_AFTER_MS = 5 * 60 * 1000;

interface AvatarEntryDto {
  id: string;
  icon: string | null;
  color: string | null;
}

/// The avatars every user chose (D-129): loaded from `GET /users/avatars` after sign-in, refetched
/// when the tab becomes visible and the data is older than five minutes, updated optimistically
/// after the user's own save and cleared on sign-out. Loads the icon art (a lazy chunk) once any
/// avatar needs it.
@Injectable({ providedIn: 'root' })
export class AvatarDirectory implements AvatarSource {
  private readonly api = inject(ApiClient);
  private readonly document = inject(DOCUMENT);

  private readonly avatars = signal<ReadonlyMap<string, UserAvatar>>(new Map());
  private readonly art = signal<ReadonlyMap<string, string> | null>(null);
  private artRequest: Promise<void> | null = null;
  private loadedAt: number | null = null;
  private generation = 0;

  readonly artReady = computed(() => this.art() !== null);

  constructor() {
    const onVisible = () => {
      if (this.document.visibilityState === 'visible') void this.refreshIfStale();
    };
    this.document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisible),
    );
  }

  avatarOf(userId: string): UserAvatar | null {
    return this.avatars().get(userId.toLowerCase()) ?? null;
  }

  imageOf(icon: string): string | null {
    return this.art()?.get(icon) ?? null;
  }

  /// Fetches the directory; a failure keeps what is shown. A sign-out while it runs discards it.
  async load(): Promise<void> {
    const generation = ++this.generation;
    try {
      const entries = await firstValueFrom(this.api.get<AvatarEntryDto[]>('/users/avatars'));
      if (generation !== this.generation) return;
      this.avatars.set(
        new Map(entries.map((e) => [e.id.toLowerCase(), { icon: e.icon, color: e.color }])),
      );
      this.loadedAt = Date.now();
      if (entries.some((e) => e.icon)) void this.ensureArt();
    } catch {
      return;
    }
  }

  async refreshIfStale(now = Date.now()): Promise<void> {
    if (this.loadedAt !== null && now - this.loadedAt > AVATAR_REFRESH_AFTER_MS) await this.load();
  }

  /// Shows `avatar` for `userId` at once (null: initials on the hashed colour); a fetch already in
  /// flight is discarded so it cannot undo this.
  set(userId: string, avatar: UserAvatar | null): void {
    this.generation++;
    const next = new Map(this.avatars());
    if (avatar && (avatar.icon || avatar.color)) next.set(userId.toLowerCase(), avatar);
    else next.delete(userId.toLowerCase());
    this.avatars.set(next);
    if (avatar?.icon) void this.ensureArt();
  }

  ensureArt(): Promise<void> {
    this.artRequest ??= loadAvatarArt().then(
      (art) => this.art.set(art),
      () => {
        this.artRequest = null;
      },
    );
    return this.artRequest;
  }

  clear(): void {
    this.generation++;
    this.loadedAt = null;
    this.avatars.set(new Map());
  }
}
