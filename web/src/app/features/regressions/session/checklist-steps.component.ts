import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { IconComponent } from '@shared/ui/icon/icon.component';

/// Numbered snapshot steps with a per-step check-off to follow along while testing. The checks are a
/// local aid only and reset when the item changes (layout-and-screens §3.8).
@Component({
  selector: 'tk-checklist-steps',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steps().length === 0) {
      <div class="none">No steps.</div>
    } @else {
      <ol data-testid="item-steps">
        @for (step of steps(); track $index) {
          <li [class.checked]="checked().has($index)">
            <button
              type="button"
              class="check"
              [attr.aria-pressed]="checked().has($index)"
              [attr.aria-label]="'Mark step ' + ($index + 1) + ' done'"
              (click)="toggle($index)"
            >
              @if (checked().has($index)) {
                <tk-icon name="tablerCheck" [size]="12" />
              }
            </button>
            <span class="n tnum">{{ $index + 1 }}.</span>
            <span class="txt">{{ step }}</span>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    ol {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--tk-border-subtle);
      line-height: 1.5;
    }
    li:last-child {
      border-bottom: 0;
    }
    li.checked .txt {
      color: var(--tk-text-muted);
    }
    .check {
      width: 16px;
      height: 16px;
      flex: none;
      display: grid;
      place-items: center;
      margin-top: 3px;
      padding: 0;
      border: 1px solid var(--tk-border-strong);
      border-radius: var(--tk-radius-sm);
      background: var(--tk-surface);
      color: var(--tk-text-on-solid);
      cursor: pointer;
    }
    .check[aria-pressed='true'] {
      border-color: var(--tk-success);
      background: var(--tk-success);
    }
    .n {
      width: 22px;
      flex: none;
      color: var(--tk-text-muted);
      text-align: right;
    }
    .txt {
      flex: 1;
      white-space: pre-wrap;
    }
    .none {
      color: var(--tk-text-subtle);
    }
  `,
})
export class ChecklistStepsComponent {
  readonly steps = input.required<readonly string[]>();
  /// Changing the key (the item id) clears the checks.
  readonly resetKey = input<string | null>(null);

  protected readonly checked = signal<ReadonlySet<number>>(new Set());

  constructor() {
    effect(() => {
      this.resetKey();
      this.checked.set(new Set());
    });
  }

  protected toggle(index: number): void {
    this.checked.update((set) => {
      const next = new Set(set);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
}
