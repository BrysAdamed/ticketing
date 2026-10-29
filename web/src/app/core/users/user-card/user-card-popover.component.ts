import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UserRef } from '@shared/ui/domain/user-display.component';
import { UserCardComponent } from '@shared/ui/user-card/user-card.component';
import { SharedMedalsState } from '@shared/ui/user-card/user-card.logic';
import { AchievementsAccess } from '../../achievements/achievements-access';
import { AchievementSharesApi } from '../../achievements/achievement-shares.api';
import { AuthService } from '../../auth/auth.service';

/// The user card with its data: who is looking, and the person's shared achievements, fetched
/// when the card opens and only while achievements are on for the viewer (D-155).
@Component({
  selector: 'tk-user-card-popover',
  imports: [UserCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tk-user-card
      [user]="user()"
      [self]="self()"
      [achievements]="achievements()"
      [trapFocus]="focusOnOpen()"
      (navigated)="closed.emit()"
    />
  `,
})
export class UserCardPopoverComponent {
  private readonly auth = inject(AuthService);

  readonly user = input.required<UserRef>();
  /// Move focus into the card (opened by click or Enter); a hover card leaves focus where it is.
  readonly focusOnOpen = input(false);
  readonly closed = output<void>();

  protected readonly self = computed(() => this.auth.currentUser()?.id === this.user().id);
  protected readonly achievements = signal<SharedMedalsState>({ status: 'off' });

  constructor() {
    const api = inject(AchievementSharesApi);
    const access = inject(AchievementsAccess);
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (this.focusOnOpen())
        host.nativeElement.querySelector<HTMLElement>('[role=dialog]')?.focus();
      if (!access.enabled()) return;
      this.achievements.set({ status: 'loading' });
      api
        .sharedBy(this.user().id)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: ({ items }) => this.achievements.set({ status: 'loaded', items }),
          error: () => this.achievements.set({ status: 'hidden' }),
        });
    });
  }
}
