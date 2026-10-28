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
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import type { TourSession } from './tour-session';

let nextId = 0;

/// The step card of a tour: a modal dialog (focus trapped, labelled by the step title, described
/// by its body) connected to the anchor. Keys are handled by the session through the overlay's
/// keyboard dispatcher: Esc closes, ← and → move between steps.
@Component({
  selector: 'tk-tour-popover',
  imports: [CdkTrapFocus, MatButtonModule, KbdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = session();
    @let step = s.step();
    <div
      #dialog
      class="card"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      cdkTrapFocus
      data-testid="tour-popover"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="bodyId"
      [class.pending]="s.pending()"
    >
      <div class="eyebrow">
        <span class="count tnum" data-testid="tour-step-count">{{ s.label() }}</span>
        <span class="keys" aria-hidden="true"
          ><tk-kbd>←</tk-kbd><tk-kbd>→</tk-kbd><tk-kbd>Esc</tk-kbd></span
        >
      </div>
      <h2 class="title" [id]="titleId">{{ step.title }}</h2>
      <p class="body" [id]="bodyId">{{ step.body }}</p>
      <div class="actions">
        @if (!s.isLast()) {
          <button mat-button type="button" data-testid="tour-skip" (click)="s.close('dismissed')">
            Skip tour
          </button>
        }
        <span class="spacer"></span>
        @if (!s.isFirst()) {
          <button mat-stroked-button type="button" data-testid="tour-back" (click)="s.previous()">
            Back
          </button>
        }
        <button mat-flat-button type="button" data-testid="tour-next" (click)="s.next()">
          {{ s.isLast() ? 'Done' : 'Next' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .card {
      width: 320px;
      max-width: calc(100vw - 16px);
      padding: var(--tk-space-4);
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
    .eyebrow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--tk-space-1-5);
    }
    .count {
      font-size: var(--tk-text-sm);
      line-height: var(--tk-leading-sm);
      font-weight: var(--tk-weight-medium);
      color: var(--tk-accent-fg);
    }
    .keys {
      display: inline-flex;
      gap: 2px;
    }
    .title {
      margin: 0 0 var(--tk-space-1);
      font-size: var(--tk-text-md);
      line-height: var(--tk-leading-md);
      font-weight: var(--tk-weight-semibold);
    }
    .body {
      margin: 0;
      font-size: var(--tk-text-base);
      line-height: var(--tk-leading-base);
      color: var(--tk-text-muted);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--tk-space-2);
      margin-top: var(--tk-space-4);
    }
    .actions [mat-button] {
      margin-left: calc(-1 * var(--tk-space-2));
      color: var(--tk-text-muted);
    }
    .spacer {
      flex: 1;
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
