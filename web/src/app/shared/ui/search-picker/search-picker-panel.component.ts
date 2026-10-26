import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { PickerOption, PickerOptionTemplate } from '../inline-picker/picker-option';

const DEBOUNCE_MS = 150;
let nextPanelId = 0;

@Component({
  selector: 'tk-search-picker-panel',
  imports: [NgTemplateOutlet, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-popover', 'data-testid': 'search-picker' },
  template: `
    <div class="search">
      <tk-icon name="tablerSearch" [size]="14" />
      <input
        #input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        data-testid="search-picker-input"
        [attr.aria-controls]="listId"
        [attr.aria-label]="placeholder()"
        [placeholder]="placeholder()"
        (input)="onQuery(input.value)"
        (keydown)="onKeydown($event)"
      />
    </div>
    <div class="list" role="listbox" [id]="listId" [attr.aria-label]="placeholder()" [attr.aria-busy]="loading()">
      @for (option of options(); track $index; let i = $index) {
        <div
          class="option"
          role="option"
          tabindex="-1"
          [class.active]="i === active()"
          [class.disabled]="option.disabled"
          [attr.aria-disabled]="option.disabled || null"
          (mouseenter)="active.set(i)"
          (mousedown)="$event.preventDefault()"
          (click)="choose(option)"
          (keydown.enter)="choose(option)"
        >
          @if (optionTemplate(); as tpl) {
            <ng-container [ngTemplateOutlet]="tpl" [ngTemplateOutletContext]="{ $implicit: option, selected: false }" />
          } @else {
            <span class="label">{{ option.label }}</span>
          }
        </div>
      } @empty {
        <div class="empty">{{ loading() ? 'Searching…' : 'No matches' }}</div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 360px;
      padding: 4px;
    }
    .search {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      margin: -4px -4px 4px;
      border-bottom: 1px solid var(--tk-border);
      color: var(--tk-text-subtle);
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
    .list {
      max-height: 320px;
      overflow-y: auto;
    }
    .option {
      height: 30px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border-radius: var(--tk-radius-sm);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
    }
    .option.active {
      background: var(--tk-bg-hover);
    }
    .option.disabled {
      color: var(--tk-text-disabled);
      cursor: default;
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty {
      padding: 6px 8px;
      color: var(--tk-text-subtle);
    }
  `,
})
export class SearchPickerPanelComponent<T> {
  readonly search = input.required<(query: string) => Promise<readonly PickerOption<T>[]>>();
  readonly placeholder = input('Search…');
  readonly optionTemplate = input<PickerOptionTemplate<T> | null>(null);

  readonly picked = output<T>();
  readonly dismissed = output<void>();

  protected readonly listId = `tk-search-picker-${nextPanelId++}`;
  protected readonly options = signal<readonly PickerOption<T>[]>([]);
  protected readonly loading = signal(true);
  protected readonly active = signal(0);

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private token = 0;

  constructor() {
    afterNextRender(() => {
      this.input().nativeElement.focus();
      void this.run('');
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  protected onQuery(value: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.loading.set(true);
    this.timer = setTimeout(() => void this.run(value), DEBOUNCE_MS);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count) this.active.set((this.active() + 1) % count);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (count) this.active.set((this.active() - 1 + count) % count);
        return;
      case 'Enter': {
        event.preventDefault();
        const option = this.options()[this.active()];
        if (option) this.choose(option);
        return;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.dismissed.emit();
        return;
      case 'Tab':
        this.dismissed.emit();
    }
  }

  protected choose(option: PickerOption<T>): void {
    if (!option.disabled) this.picked.emit(option.value);
  }

  private async run(query: string): Promise<void> {
    const token = ++this.token;
    try {
      const options = await this.search()(query.trim());
      if (token !== this.token) return;
      this.options.set(options);
      this.active.set(0);
    } catch {
      if (token === this.token) this.options.set([]);
    } finally {
      if (token === this.token) this.loading.set(false);
    }
  }
}
