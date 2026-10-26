import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Ticket, TicketLink, TicketRef } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import {
  TICKET_LINK_TYPE_INVERSE_LABELS,
  TICKET_LINK_TYPE_LABELS,
  TicketLinkType,
} from '@shared/domain/enums';
import { TICKET_KEY_PATTERN } from '@shared/domain/keys';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';

export interface NewLink {
  targetKey: string;
  type: TicketLinkType;
}

interface LinkKind {
  type: TicketLinkType;
  /// True when this ticket is the target ("is blocked by"): the new link is created from the other ticket.
  inverse: boolean;
}

const KIND_OPTIONS: PickerOption<LinkKind>[] = [
  { value: { type: 'Blocks', inverse: false }, label: 'blocks' },
  { value: { type: 'Blocks', inverse: true }, label: 'is blocked by' },
  { value: { type: 'RelatesTo', inverse: false }, label: 'relates to' },
  { value: { type: 'Duplicates', inverse: false }, label: 'duplicates' },
  { value: { type: 'Duplicates', inverse: true }, label: 'is duplicated by' },
];

/// Links section (I-05): grouped by how they read from this ticket. Linking searches this project by
/// key or title; any readable ticket key from another project can be typed in full.
@Component({
  selector: 'tk-ticket-links',
  imports: [MatTooltip, RouterLink, AvatarComponent, StatusIconComponent, TypeIconComponent, IconComponent, InlinePickerDirective, SearchPickerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sec', 'data-testid': 'ticket-links' },
  template: `
    <div class="sec-h">
      <h2>Links</h2>
      @if (links().length) {
        <span class="n tnum">{{ links().length }}</span>
      }
      @if (canEdit()) {
        <span class="right">
          <button
            type="button"
            class="add"
            data-testid="links-kind"
            [tkInlinePicker]="kindOptions"
            [pickerValue]="kind()"
            pickerPlaceholder="Link type…"
            (picked)="kind.set($event)"
          >
            {{ kindLabel() }}<tk-icon name="tablerChevronDown" [size]="12" />
          </button>
          <button
            type="button"
            class="add"
            data-testid="links-add"
            [tkSearchPicker]="search()"
            pickerPlaceholder="Ticket key or title…"
            (picked)="add($event)"
          >
            <tk-icon name="tablerLink" [size]="14" />Link
          </button>
        </span>
      }
    </div>
    @if (links().length) {
      <div class="box">
        @for (link of links(); track link.id) {
          <div class="lrow" [class.done]="link.ticket.status === 'Done'" [attr.data-testid]="'link-' + link.ticket.key">
            <span class="rel">{{ link.label }}</span>
            <tk-status-icon [status]="link.ticket.status" />
            <a class="key tnum" [routerLink]="['/tickets', link.ticket.key]">{{ link.ticket.key }}</a>
            <tk-type-icon [type]="link.ticket.type" [size]="14" />
            <a class="t" [routerLink]="[]" [queryParams]="{ peek: link.ticket.key }" queryParamsHandling="merge">{{ link.ticket.title }}</a>
            <tk-avatar [userId]="link.ticket.assignee?.id" [name]="link.ticket.assignee?.displayName" />
            @if (canEdit()) {
              <button type="button" class="tk-icon-btn tk-icon-btn-sm remove" aria-label="Remove link" matTooltip="Remove link" (click)="removed.emit(link)">
                <tk-icon name="tablerX" [size]="14" />
              </button>
            }
          </div>
        }
      </div>
    }
  `,
  styleUrl: './ticket-section.scss',
})
export class TicketLinksComponent {
  private readonly api = inject(TicketsApi);

  readonly ticket = input.required<Ticket>();
  readonly canEdit = input(false);

  readonly added = output<NewLink & { fromKey: string }>();
  readonly removed = output<TicketLink>();

  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly kind = signal<LinkKind>(KIND_OPTIONS[2].value);
  protected readonly kindLabel = computed(() =>
    this.kind().inverse ? TICKET_LINK_TYPE_INVERSE_LABELS[this.kind().type] : TICKET_LINK_TYPE_LABELS[this.kind().type],
  );
  protected readonly links = computed(() => this.ticket().links ?? []);
  protected readonly search = computed(() => {
    const t = this.ticket();
    return async (query: string): Promise<PickerOption<string>[]> => {
      const typed = query.trim().toUpperCase();
      const found = await firstValueFrom(this.api.find(t.projectKey, query));
      const options: PickerOption<string>[] = found.filter((x) => x.id !== t.id).map((x: TicketRef) => ({ value: x.key, label: `${x.key} ${x.title}` }));
      if (TICKET_KEY_PATTERN.test(typed) && typed !== t.key && !options.some((o) => o.value === typed)) {
        options.unshift({ value: typed, label: `Link ${typed}` });
      }
      return options;
    };
  });

  protected add(otherKey: string): void {
    const kind = this.kind();
    const self = this.ticket().key;
    this.added.emit(kind.inverse ? { fromKey: otherKey, targetKey: self, type: kind.type } : { fromKey: self, targetKey: otherKey, type: kind.type });
  }
}
