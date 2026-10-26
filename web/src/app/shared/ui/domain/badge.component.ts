import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type BadgeTone =
  'solid-danger' | 'red' | 'amber' | 'green' | 'blue' | 'violet' | 'teal' | 'gray' | 'muted';

/// Base badge anatomy (design-system §8): 20px, radius sm, xs/500 text, tint only, optional
/// leading 6px dot or 12px icon. Domain badges are thin wrappers around it.
@Component({
  selector: 'tk-badge',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone()' },
  template: `
    @if (icon(); as name) {
      <tk-icon [name]="name" [size]="12" />
    } @else if (dot()) {
      <span class="dot"></span>
    }
    <ng-content />
  `,
  styles: `
    :host {
      height: 20px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 6px;
      border-radius: var(--tk-radius-sm);
      font-size: var(--tk-text-xs);
      line-height: var(--tk-leading-xs);
      font-weight: var(--tk-weight-medium);
      white-space: nowrap;
      flex: none;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    :host([data-tone='solid-danger']) {
      background: var(--tk-severity-critical);
      color: var(--tk-text-on-solid);
    }
    :host([data-tone='red']) {
      background: var(--tk-red-bg);
      color: var(--tk-red-fg);
    }
    :host([data-tone='amber']) {
      background: var(--tk-amber-bg);
      color: var(--tk-amber-fg);
    }
    :host([data-tone='green']) {
      background: var(--tk-green-bg);
      color: var(--tk-green-fg);
    }
    :host([data-tone='blue']) {
      background: var(--tk-blue-bg);
      color: var(--tk-blue-fg);
    }
    :host([data-tone='violet']) {
      background: var(--tk-violet-bg);
      color: var(--tk-violet-fg);
    }
    :host([data-tone='teal']) {
      background: var(--tk-teal-bg);
      color: var(--tk-teal-fg);
    }
    :host([data-tone='gray']) {
      background: var(--tk-gray-bg);
      color: var(--tk-gray-fg);
    }
    :host([data-tone='muted']) {
      background: var(--tk-gray-bg);
      color: var(--tk-text-subtle);
    }
  `,
})
export class BadgeComponent {
  readonly tone = input<BadgeTone>('gray');
  readonly icon = input<string | null>(null);
  readonly dot = input(false);
}
