import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { highlightSegments } from '@shared/util/highlight';

/// Text with emphasised ranges (search matches). Rendered with text bindings only, so markup in
/// the text is shown literally and never interpreted.
@Component({
  selector: 'tk-highlighted-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (s of segments(); track $index) {
    @if (s.mark) {
      <mark>{{ s.text }}</mark>
    } @else {
      <span>{{ s.text }}</span>
    }
  }`,
  styles: `
    mark {
      background: var(--tk-warning-bg);
      color: var(--tk-text);
      font-weight: var(--tk-weight-medium);
      border-radius: 2px;
      padding: 0 1px;
    }
    :host(.plain) mark {
      background: none;
      font-weight: var(--tk-weight-semibold);
      padding: 0;
    }
  `,
})
export class HighlightedTextComponent {
  readonly text = input.required<string>();
  readonly ranges = input<readonly { start: number; length: number }[]>([]);

  protected readonly segments = computed(() => highlightSegments(this.text(), this.ranges()));
}
