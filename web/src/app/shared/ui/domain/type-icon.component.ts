import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TICKET_TYPE_LABELS, TicketType } from '@shared/domain/enums';
import { IconComponent, IconSize } from '../icon/icon.component';

export const TICKET_TYPE_ICONS: Record<TicketType, string> = {
  Epic: 'tablerBolt',
  Spike: 'tablerFlask',
  UserStory: 'tablerBookmark',
  Technical: 'tablerTool',
  Bug: 'tablerBug',
};

/// Ticket type glyph in the type color, optionally followed by the type name.
@Component({
  selector: 'tk-type-icon',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': 'showLabel() ? null : "img"',
    '[attr.aria-label]': 'showLabel() ? null : "Type: " + label()',
  },
  template: `
    <tk-icon [name]="icon()" [size]="size()" [style.color]="color()" />
    @if (showLabel()) {
      <span>{{ label() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
      white-space: nowrap;
    }
  `,
})
export class TypeIconComponent {
  readonly type = input.required<TicketType>();
  readonly size = input<IconSize>(16);
  readonly showLabel = input(false);

  protected readonly icon = computed(() => TICKET_TYPE_ICONS[this.type()]);
  protected readonly label = computed(() => TICKET_TYPE_LABELS[this.type()]);
  protected readonly color = computed(() => `var(--tk-type-${this.type().toLowerCase()})`);
}
