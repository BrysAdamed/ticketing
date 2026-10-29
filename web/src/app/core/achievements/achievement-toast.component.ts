import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { AchievementMedalComponent } from '@shared/ui/achievement-medal/achievement-medal.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  summaryLine,
  summaryMedals,
  summaryTitle,
  UnlockToast,
  unlockLine,
  unlockTitle,
} from './achievement-unlocks.logic';

export interface AchievementToastData {
  toast: UnlockToast;
  /// How long it stays; hovering or focusing it pauses the countdown.
  durationMs: number;
  view: () => void;
}

/// The two-line unlock toast (mockup achievements.html §5): the medal, "Name · Tier", a short line,
/// View and Dismiss; or the summary with up to three stacked medals. No animation of its own; the
/// snack bar's entry animation is off under reduced motion.
@Component({
  selector: 'tk-achievement-toast',
  imports: [AchievementMedalComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'achievement-toast',
    '[attr.data-kind]': 'toast.kind',
    '(mouseenter)': 'pause()',
    '(mouseleave)': 'resume()',
    '(focusin)': 'pause()',
    '(focusout)': 'resume()',
  },
  template: `
    @if (toast.kind === 'single') {
      <tk-achievement-medal
        [achievementId]="toast.item.id"
        [icon]="toast.item.icon"
        [tier]="toast.item.tier"
        [tierCount]="toast.item.tierCount"
        [size]="32"
      />
    } @else {
      <span class="stack">
        @for (medal of medals; track medal.id) {
          <tk-achievement-medal
            [achievementId]="medal.id"
            [icon]="medal.icon"
            [tier]="medal.tier"
            [tierCount]="medal.tierCount"
            [size]="32"
          />
        }
      </span>
    }
    <div class="msg">
      <b data-testid="achievement-toast-title">{{ title }}</b>
      <span>{{ line }}</span>
    </div>
    <button type="button" class="action" data-testid="achievement-toast-view" (click)="view()">
      View
    </button>
    <button
      type="button"
      class="tk-icon-btn tk-icon-btn-sm"
      aria-label="Dismiss"
      (click)="ref.dismiss()"
    >
      <tk-icon name="tablerX" [size]="14" />
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 32px;
      width: 400px;
      max-width: 100%;
      color: var(--tk-text);
    }
    .stack {
      display: flex;
      flex: none;
    }
    .stack tk-achievement-medal + tk-achievement-medal {
      margin-left: -10px;
    }
    .msg {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      line-height: 18px;
    }
    .msg b {
      font-weight: var(--tk-weight-semibold);
    }
    .msg span {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .action {
      border: 0;
      background: none;
      padding: 2px 6px;
      border-radius: var(--tk-radius-sm);
      color: var(--tk-accent-fg);
      font-weight: var(--tk-weight-medium);
      cursor: pointer;
    }
    .action:hover {
      background: var(--tk-bg-hover);
    }
  `,
})
export class AchievementToastComponent {
  private readonly data = inject<AchievementToastData>(MAT_SNACK_BAR_DATA);
  protected readonly ref = inject(MatSnackBarRef);
  protected readonly toast = this.data.toast;
  protected readonly medals = this.toast.kind === 'summary' ? summaryMedals(this.toast.items) : [];
  protected readonly title =
    this.toast.kind === 'single' ? unlockTitle(this.toast.item) : summaryTitle(this.toast.items);
  protected readonly line =
    this.toast.kind === 'single' ? unlockLine(this.toast.item) : summaryLine(this.toast.items);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.resume();
    inject(DestroyRef).onDestroy(() => this.pause());
  }

  protected view(): void {
    this.ref.dismissWithAction();
    this.data.view();
  }

  protected pause(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  protected resume(): void {
    this.pause();
    this.timer = setTimeout(() => this.ref.dismiss(), this.data.durationMs);
  }
}
