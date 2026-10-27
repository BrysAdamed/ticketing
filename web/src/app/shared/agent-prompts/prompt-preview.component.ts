import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/// A rendered prompt split at `splitAt`: the part being edited and, below a divider, the part added
/// by someone else, greyed and labelled `mutedLabel`. `muted` says which side is greyed: `after`
/// (a type template followed by the guardrails) or `before` (the guardrails editor, after a sample
/// type prompt).
@Component({
  selector: 'tk-prompt-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'prompt-preview', '[attr.aria-busy]': 'loading()' },
  template: `
    @if (prompt(); as text) {
      @if (muted() === 'before' && parts().muted) {
        <pre class="muted" data-testid="prompt-preview-muted">{{ parts().muted }}</pre>
        <div class="divider">
          <span>{{ mutedLabel() }}</span>
        </div>
      }
      <pre class="main" data-testid="prompt-preview-text">{{ parts().main }}</pre>
      @if (muted() === 'after' && parts().muted) {
        <div class="divider">
          <span>{{ mutedLabel() }}</span>
        </div>
        <pre class="muted" data-testid="prompt-preview-muted">{{ parts().muted }}</pre>
      }
    } @else {
      <p class="empty tk-subtle" data-testid="prompt-preview-empty">{{ emptyText() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      transition: opacity var(--tk-duration-base);
    }
    :host([aria-busy='true']) {
      opacity: 0.6;
    }
    pre {
      margin: 0;
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
      line-height: 20px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .main {
      color: var(--tk-text);
    }
    .muted {
      color: var(--tk-text-subtle);
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0;
      font-size: var(--tk-text-xs);
      color: var(--tk-text-subtle);
    }
    .divider::before,
    .divider::after {
      content: '';
      flex: 1;
      border-top: 1px dashed var(--tk-border-strong);
    }
    .empty {
      margin: 0;
      font-size: var(--tk-text-sm);
    }
  `,
})
export class PromptPreviewComponent {
  readonly prompt = input<string | null>(null);
  readonly splitAt = input<number | null>(null);
  readonly muted = input<'after' | 'before'>('after');
  readonly mutedLabel = input('Added to every prompt by your Admin');
  readonly loading = input(false);
  readonly emptyText = input('Nothing to preview.');

  protected readonly parts = computed(() => {
    const text = this.prompt() ?? '';
    const split = this.splitAt();
    if (split === null || split < 0 || split > text.length) return { main: text, muted: '' };
    const head = text.slice(0, split).trimEnd();
    const tail = text.slice(split);
    return this.muted() === 'after' ? { main: head, muted: tail } : { main: tail, muted: head };
  });
}
