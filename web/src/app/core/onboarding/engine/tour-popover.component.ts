import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
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
    @let step = s.step();
    <div
      #dialog
      class="card tk-dense"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      cdkTrapFocus
      data-testid="tour-popover"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="bodyId"
      [class.pending]="s.pending()"
    >
      <div class="main">
        <div class="eyebrow">
          <span class="tnum" data-testid="tour-step-count"
            >{{ s.tour.title }} tour · {{ s.label() }}</span
          >
          <button
            type="button"
            class="tk-icon-btn tk-icon-btn-sm close"
            aria-label="End tour"
            data-testid="tour-close"
            (click)="s.close('dismissed')"
          >
            <tk-icon name="tablerX" [size]="14" />
          </button>
        </div>
        <h2 class="title" [id]="titleId">{{ step.title }}</h2>
        <p class="body" [id]="bodyId">{{ step.body }}</p>
      </div>
      <div class="dots" aria-hidden="true">
        @for (dot of s.steps; track dot.id; let i = $index) {
          <i [class.on]="i === s.index()"></i>
        }
      </div>
      <div class="actions">
        @if (!s.isLast()) {
          <button mat-button type="button" data-testid="tour-skip" (click)="s.close('dismissed')">
            Skip tour
          </button>
        }
        <span class="spacer"></span>
        <button
          mat-stroked-button
          type="button"
          data-testid="tour-back"
          [disabled]="s.isFirst()"
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
