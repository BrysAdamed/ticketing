import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import type { TourSession } from './tour-session';

let nextId = 0;

/// The step card of a tour: a modal dialog (focus trapped, labelled by the step title, described
/// by its body) connected to the anchor. Keys are handled by the session through the overlay's
/// keyboard dispatcher: Esc closes, ← and → move between steps.
@Component({
  selector: 'tk-tour-popover',
  imports: [CdkTrapFocus, MatButtonModule, KbdComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = session();
    <div
      #dialog
      class="card tk-dense"
      role="dialog"
      tabindex="-1"
      data-testid="tour-popover"
      [cdkTrapFocus]="!s.isAction()"
      [attr.aria-modal]="s.isAction() ? null : 'true'"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="bodyId"
      [attr.data-step]="s.step().id"
      [class.pending]="s.pending() || s.hidden()"
    >
      <div class="main">
        <div class="eyebrow">
          @if (s.walkthrough) {
            <tk-icon name="tablerRoute" [size]="12" />
          }
          <span class="tnum" data-testid="tour-step-count">{{ eyebrow() }}</span>
          <button
            type="button"
            class="tk-icon-btn tk-icon-btn-sm close"
            data-testid="tour-close"
            [attr.aria-label]="s.walkthrough ? 'End walkthrough' : 'End tour'"
            (click)="s.close('dismissed')"
          >
            <tk-icon name="tablerX" [size]="14" />
          </button>
        </div>
        <h2 class="title" [id]="titleId">{{ s.title() }}</h2>
        <p class="body" [id]="bodyId">{{ s.body() }}</p>
      </div>
      <div class="dots" aria-hidden="true">
        @for (on of s.dots(); track $index) {
          <i [class.on]="on"></i>
        }
      </div>
      @if (s.isAction()) {
        <div class="actions">
          <span class="waiting" data-testid="tour-waiting"
            ><span class="pulse" aria-hidden="true"></span>{{ s.waiting() }}</span
          >
        </div>
        <div class="actions">
          @if (s.step().optional) {
            <button mat-button type="button" data-testid="tour-skip-step" (click)="s.skipStep()">
              Skip this step
            </button>
          }
          <span class="spacer"></span>
          @if (s.actionLabel(); as label) {
            <button
              mat-flat-button
              type="button"
              data-testid="tour-action"
              (click)="s.runAction()"
            >
              {{ label }}
            </button>
          }
        </div>
        <div class="keys" aria-hidden="true">
          <tk-kbd>Esc</tk-kbd> end
          <span class="paused">Shortcuts work</span>
        </div>
      } @else {
        <div class="actions">
          @if (!s.isLast()) {
            <button mat-button type="button" data-testid="tour-skip" (click)="s.close('dismissed')">
              {{ s.walkthrough ? 'End walkthrough' : 'Skip tour' }}
            </button>
          }
          <span class="spacer"></span>
          <button
            mat-stroked-button
            type="button"
            data-testid="tour-back"
            [disabled]="!s.canGoBack()"
            (click)="s.previous()"
          >
            Back
          </button>
          <button mat-flat-button type="button" data-testid="tour-next" (click)="s.next()">
            {{ s.isLast() ? 'Done' : 'Next' }}
            @if (!s.isLast()) {
              <tk-icon class="next-icon" name="tablerArrowRight" [size]="14" />
            }
          </button>
        </div>
        <div class="keys" aria-hidden="true">
          <tk-kbd>←</tk-kbd><tk-kbd>→</tk-kbd> move <tk-kbd class="gap">Esc</tk-kbd> end
          <span class="paused">Shortcuts paused</span>
        </div>
      }
    </div>
  `,
  styles: `
    .card {
      width: 320px;
      max-width: calc(100vw - 16px);
      background: var(--tk-surface-raised);
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      box-shadow: var(--tk-shadow-lg);
      color: var(--tk-text);
      animation: tk-tour-enter var(--tk-duration-fast) var(--tk-ease-out);
      outline: none;

      &.pending {
        visibility: hidden;
      }
    }
    .main {
      padding: 14px var(--tk-space-4) var(--tk-space-1);
    }
    .eyebrow {
      display: flex;
      align-items: center;
      gap: var(--tk-space-1-5);
      margin-bottom: var(--tk-space-1-5);
      font-size: var(--tk-text-xs);
      line-height: var(--tk-leading-xs);
      font-weight: var(--tk-weight-medium);
      color: var(--tk-text-subtle);
    }
    .close {
      margin: -4px -6px -4px auto;
    }
    .title {
      margin: 0 0 var(--tk-space-1);
      font-size: var(--tk-text-base);
      line-height: var(--tk-leading-base);
      font-weight: var(--tk-weight-semibold);
    }
    .body {
      margin: 0;
      font-size: var(--tk-text-base);
      line-height: var(--tk-leading-base);
      color: var(--tk-text-muted);
    }
    .dots {
      display: flex;
      gap: var(--tk-space-1);
      padding: var(--tk-space-3) var(--tk-space-4) 0;

      i {
        width: 6px;
        height: 6px;
        border-radius: var(--tk-radius-full);
        background: var(--tk-border-strong);
        transition: width var(--tk-duration-fast) var(--tk-ease-out);
      }
      i.on {
        width: 16px;
        background: var(--tk-accent);
      }
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--tk-space-1-5);
      padding: var(--tk-space-3) var(--tk-space-3) var(--tk-space-3) var(--tk-space-4);
    }
    .actions [mat-button] {
      margin-left: calc(-1 * var(--tk-space-2));
      color: var(--tk-text-muted);
    }
    .next-icon {
      margin-left: var(--tk-space-1);
    }
    .spacer {
      flex: 1;
    }
    .waiting {
      display: flex;
      align-items: center;
      gap: var(--tk-space-2);
      font-size: var(--tk-text-sm);
      line-height: var(--tk-leading-sm);
      color: var(--tk-text-muted);
    }
    .pulse {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: var(--tk-radius-full);
      background: var(--tk-accent);
      box-shadow: 0 0 0 3px var(--tk-accent-subtle);
      animation: tk-tour-pulse 1.6s var(--tk-ease-out) infinite;
    }
    .actions + .actions {
      padding-top: 0;
    }
    @keyframes tk-tour-pulse {
      50% {
        opacity: 0.4;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .pulse {
        animation: none;
      }
    }
    .keys {
      display: flex;
      align-items: center;
      gap: var(--tk-space-1);
      padding: var(--tk-space-2) var(--tk-space-4);
      border-top: 1px solid var(--tk-border-subtle);
      font-size: var(--tk-text-xs);
      line-height: var(--tk-leading-xs);
      color: var(--tk-text-subtle);

      .gap {
        margin-left: var(--tk-space-2);
      }
    }
    .paused {
      margin-left: auto;
    }
    @keyframes tk-tour-enter {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
    }
  `,
})
export class TourPopoverComponent {
  readonly session = input.required<TourSession>();
  protected readonly eyebrow = computed(() => {
    const s = this.session();
    return s.walkthrough ? `${s.tour.title} · ${s.label()}` : `${s.tour.title} tour · ${s.label()}`;
  });
  protected readonly titleId = `tk-tour-title-${nextId}`;
  protected readonly bodyId = `tk-tour-body-${nextId++}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly injector = inject(Injector);

  /// After the current step has rendered, moves focus to the dialog unless it is already inside
  /// (on the button just pressed). Screen readers then read the title and body; step changes made
  /// from inside are announced by the session.
  focus(): void {
    afterNextRender(
      () => {
        const dialog = this.dialog().nativeElement;
        if (!dialog.contains(dialog.ownerDocument.activeElement)) dialog.focus();
      },
      { injector: this.injector },
    );
  }
}
