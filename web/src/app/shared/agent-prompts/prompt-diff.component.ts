import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { diffStats, lineDiff } from './line-diff';

/// Side-by-side line diff of two prompt texts: `left` (older or reference) and `right` (newer).
@Component({
  selector: 'tk-prompt-diff',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'prompt-diff' },
  template: `
    <div class="head">
      <span class="label" data-testid="prompt-diff-left-label">{{ leftLabel() }}</span>
      <span class="label" data-testid="prompt-diff-right-label">{{ rightLabel() }}</span>
    </div>
    @if (identical()) {
      <p class="same" data-testid="prompt-diff-identical">The two texts are identical.</p>
    } @else {
      <p class="stats tk-subtle" data-testid="prompt-diff-stats">
        {{ stats().removed }} {{ stats().removed === 1 ? 'line' : 'lines' }} removed ·
        {{ stats().added }} {{ stats().added === 1 ? 'line' : 'lines' }} added
      </p>
    }
    <div
      class="grid"
      role="table"
      [attr.aria-label]="leftLabel() + ' compared with ' + rightLabel()"
    >
      @for (row of rows(); track $index) {
        <div class="row" role="row" [class]="row.kind">
          <span class="num" role="cell">{{ row.left?.number ?? '' }}</span>
          <span class="text left" role="cell">{{ row.left?.text ?? '' }}</span>
          <span class="num" role="cell">{{ row.right?.number ?? '' }}</span>
          <span class="text right" role="cell">{{ row.right?.text ?? '' }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .head,
    .row {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) 36px minmax(0, 1fr);
    }
    .head .label {
      grid-column: span 2;
      padding: 6px 8px;
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-semibold);
      color: var(--tk-text-muted);
    }
    .same,
    .stats {
      margin: 0 0 8px;
      font-size: var(--tk-text-sm);
    }
    .grid {
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
      overflow: hidden;
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
      line-height: 20px;
    }
    .num {
      padding: 0 6px;
      text-align: right;
      color: var(--tk-text-subtle);
      background: var(--tk-bg-subtle);
      user-select: none;
    }
    .text {
      padding: 0 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      min-height: 20px;
    }
    .text.left {
      border-right: 1px solid var(--tk-border);
    }
    .removed .left,
    .changed .left {
      background: var(--tk-danger-bg);
    }
    .added .right,
    .changed .right {
      background: var(--tk-success-bg);
    }
  `,
})
export class PromptDiffComponent {
  readonly left = input.required<string>();
  readonly right = input.required<string>();
  readonly leftLabel = input('Before');
  readonly rightLabel = input('After');

  protected readonly rows = computed(() => lineDiff(this.left(), this.right()));
  protected readonly stats = computed(() => diffStats(this.rows()));
  protected readonly identical = computed(() => this.rows().every((r) => r.kind === 'same'));
}
