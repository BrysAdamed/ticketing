import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PeekService } from '@core/layout/peek/peek';
import { Progress, Ticket, TicketRef } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { TicketType } from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';

export interface NewChild {
  title: string;
  type: TicketType;
}

/// "Sub-tickets 2/4" section (ticket-detail.html): progress bar by status category, compact child
/// rows, and Add (create a new child inline, or adopt an existing ticket of the project).
@Component({
  selector: 'tk-ticket-children',
  imports: [
    RouterLink,
    AvatarComponent,
    StatusIconComponent,
    TypeIconComponent,
    IconComponent,
    SearchPickerDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sec', 'data-testid': 'ticket-children' },
  template: `
    <div class="sec-h">
      <h2>Sub-tickets</h2>
      @if (progress(); as p) {
        @if (p.total > 0) {
          <span class="n tnum">{{ p.done }}/{{ p.total }}</span>
          <span class="prog" [attr.aria-label]="p.done + ' of ' + p.total + ' done'" role="img">
            <i class="done" [style.width.%]="(100 * p.done) / p.total"></i>
            <i class="wip" [style.width.%]="(100 * p.inProgress) / p.total"></i>
          </span>
        }
      }
      @if (canEdit()) {
        <span class="right">
          <button type="button" class="add" data-testid="children-add" (click)="startAdding()">
            <tk-icon name="tablerPlus" [size]="14" />New
          </button>
          <button
            type="button"
            class="add"
            data-testid="children-adopt"
            [tkSearchPicker]="search()"
            pickerPlaceholder="Find a ticket to add…"
            (picked)="adopt.emit($event)"
          >
            <tk-icon name="tablerSubtask" [size]="14" />Add existing
          </button>
        </span>
      }
    </div>
    <div class="box">
      @for (child of children(); track child.id) {
        <a
          class="lrow"
          [class.done]="child.status === 'Done'"
          [routerLink]="[]"
          [queryParams]="{ peek: child.key }"
          queryParamsHandling="merge"
          [attr.data-testid]="'child-' + child.key"
        >
          <tk-status-icon [status]="child.status" />
          <span class="key tnum">{{ child.key }}</span>
          <tk-type-icon [type]="child.type" [size]="14" />
          <span class="t">{{ child.title }}</span>
          <tk-avatar [userId]="child.assignee?.id" [name]="child.assignee?.displayName" />
        </a>
      }
      @if (adding()) {
        <div class="lrow new">
          <tk-type-icon [type]="childType()" [size]="14" />
          <input
            #title
            class="new-input"
            placeholder="Sub-ticket title — Enter to create, Esc to cancel"
            aria-label="Sub-ticket title"
            data-testid="child-new-input"
            (keydown.enter)="create(title.value); title.value = ''"
            (keydown.escape)="$event.stopPropagation(); adding.set(false)"
            (blur)="!title.value && adding.set(false)"
          />
        </div>
      }
      @if (children().length === 0 && !adding()) {
        <div class="empty">No sub-tickets.</div>
      }
    </div>
  `,
  styleUrl: './ticket-section.scss',
})
export class TicketChildrenComponent {
  private readonly api = inject(TicketsApi);
  protected readonly peek = inject(PeekService);

  readonly ticket = input.required<Ticket>();
  readonly canEdit = input(false);

  readonly created = output<NewChild>();
  readonly adopt = output<TicketRef>();

  protected readonly adding = signal(false);
  private readonly newInput = viewChild<ElementRef<HTMLInputElement>>('title');
  protected readonly children = computed(() => this.ticket().children ?? []);
  protected readonly progress = computed<Progress | null>(() => this.ticket().childProgress);
  protected readonly childType = computed<TicketType>(() =>
    this.ticket().type === 'Epic' ? 'UserStory' : 'Technical',
  );
  protected readonly search = computed(() => {
    const t = this.ticket();
    const existing = new Set((t.children ?? []).map((c) => c.id));
    return async (query: string): Promise<PickerOption<TicketRef>[]> =>
      (await firstValueFrom(this.api.find(t.projectKey, query)))
        .filter(
          (x) => x.id !== t.id && x.id !== t.parent?.id && !existing.has(x.id) && x.type !== 'Epic',
        )
        .map((x) => ({ value: x, label: `${x.key} ${x.title}` }));
  });

  protected startAdding(): void {
    this.adding.set(true);
    setTimeout(() => this.newInput()?.nativeElement.focus());
  }

  protected create(title: string): void {
    const text = title.trim();
    if (text) this.created.emit({ title: text, type: this.childType() });
  }
}
