import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { TicketType, TICKET_TYPE_LABELS } from '@shared/domain/enums';
import { TICKET_TYPE_OPTIONS } from '@shared/domain/picker-options';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';

export interface QuickCreate {
  title: string;
  type: TicketType;
  open: boolean;
}

const LAST_TYPE_KEY = 'tk-quick-create-type';

/// Inline create row (backlog.html "qc"): type selector, title input, Enter creates and keeps the
/// row open for the next ticket, Shift+Enter creates and opens it, Esc closes.
@Component({
  selector: 'tk-quick-create-row',
  imports: [TypeIconComponent, IconComponent, InlinePickerDirective, KbdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'quick-create' },
  template: `
    <button
      type="button"
      class="type"
      [tkInlinePicker]="typeOptions"
      [pickerValue]="type()"
      pickerPlaceholder="Ticket type…"
      [attr.aria-label]="'Type: ' + typeLabels[type()]"
      data-testid="quick-create-type"
      (picked)="setType($event)"
    >
      <tk-type-icon [type]="type()" [size]="14" />
      <tk-icon name="tablerChevronDown" [size]="12" />
    </button>
    <input
      #input
      type="text"
      placeholder="Ticket title"
      aria-label="New ticket title"
      maxlength="255"
      data-testid="quick-create-input"
      [disabled]="busy()"
      [value]="title()"
      (input)="title.set(input.value)"
      (keydown)="onKeydown($event)"
      (blur)="onBlur()"
    />
    <span class="hints">
      <tk-kbd>↵</tk-kbd>create<span class="sep">·</span><tk-kbd>⇧↵</tk-kbd>create &amp; open<span class="sep">·</span><tk-kbd>Esc</tk-kbd>
    </span>
  `,
  styles: `
    :host {
      height: calc(var(--tk-row-h) - 2px);
      margin: 1px 12px 1px 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px 0 4px;
      border: 1px solid var(--tk-accent);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
      box-shadow: 0 0 0 3px var(--tk-accent-subtle);
    }
    .type {
      height: 22px;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0 4px 0 6px;
      border: 0;
      border-radius: var(--tk-radius-sm);
      background: none;
      color: var(--tk-text-subtle);
      cursor: pointer;
    }
    .type:hover {
      background: var(--tk-bg-hover);
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
    }
    input::placeholder {
      color: var(--tk-text-subtle);
    }
    .hints {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      white-space: nowrap;
    }
    .sep {
      color: var(--tk-text-disabled);
    }
  `,
})
export class QuickCreateRowComponent {
  readonly busy = input(false);
  readonly submitted = output<QuickCreate>();
  readonly closed = output<void>();

  protected readonly typeOptions = TICKET_TYPE_OPTIONS;
  protected readonly typeLabels = TICKET_TYPE_LABELS;
  protected readonly title = signal('');
  protected readonly type = signal<TicketType>(readLastType());
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  constructor() {
    afterNextRender(() => this.focus());
  }

  focus(): void {
    this.input().nativeElement.focus();
  }

  reset(): void {
    this.title.set('');
    queueMicrotask(() => this.focus());
  }

  protected setType(type: TicketType): void {
    this.type.set(type);
    try {
      localStorage.setItem(LAST_TYPE_KEY, type);
    } catch {
      return;
    }
    queueMicrotask(() => this.focus());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const title = this.title().trim();
      if (title) this.submitted.emit({ title, type: this.type(), open: event.shiftKey });
    }
  }

  protected onBlur(): void {
    if (!this.title().trim() && !this.busy()) setTimeout(() => {
      if (!this.title().trim() && document.activeElement !== this.input().nativeElement && !document.querySelector('[data-testid="inline-picker"]')) this.closed.emit();
    }, 150);
  }
}

function readLastType(): TicketType {
  try {
    const value = localStorage.getItem(LAST_TYPE_KEY);
    return value && value in TICKET_TYPE_LABELS ? (value as TicketType) : 'UserStory';
  } catch {
    return 'UserStory';
  }
}
