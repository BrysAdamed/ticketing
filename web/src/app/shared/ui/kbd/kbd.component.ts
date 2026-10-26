import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/// Keyboard key hint. `tone="on-solid"` for use inside a primary (accent) button.
@Component({
  selector: 'tk-kbd',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone()' },
  template: `<kbd><ng-content /></kbd>`,
  styles: `
    :host {
      display: inline-flex;
    }
    kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border: 1px solid var(--tk-border);
      border-bottom-width: 2px;
      border-radius: var(--tk-radius-xs);
      font-family: var(--tk-font-sans);
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      line-height: 1;
      color: var(--tk-text-subtle);
      background: var(--tk-surface);
      white-space: nowrap;
    }
    :host([data-tone='on-solid']) kbd {
      background: rgb(255 255 255 / 0.18);
      border-color: transparent;
      color: inherit;
    }
  `,
})
export class KbdComponent {
  readonly tone = input<'default' | 'on-solid'>('default');
}
