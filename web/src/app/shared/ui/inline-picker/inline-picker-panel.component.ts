import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
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
import { SeverityBadgeComponent } from '../domain/domain-badges';
import { PriorityIconComponent } from '../domain/priority-icon.component';
import { StatusIconComponent } from '../domain/status-icon.component';
import { TypeIconComponent } from '../domain/type-icon.component';
import { IconComponent } from '../icon/icon.component';
import { KbdComponent } from '../kbd/kbd.component';
import {
  filterOptions,
  PICKER_SHORTCUT_AVAILABLE,
  PickerOption,
  PickerOptionTemplate,
} from './picker-option';

let nextPanelId = 0;

/// Command-menu style listbox rendered in a CDK overlay by `InlinePickerDirective`.
@Component({
  selector: 'tk-inline-picker-panel',
  imports: [
    NgTemplateOutlet,
    IconComponent,
    KbdComponent,
    StatusIconComponent,
    TypeIconComponent,
    PriorityIconComponent,
    SeverityBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-popover', 'data-testid': 'inline-picker' },
  template: `
    <div class="search">
      <tk-icon name="tablerSearch" [size]="14" />
      <input
        #input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="activeId()"
        [attr.aria-label]="placeholder()"
        [placeholder]="placeholder()"
        (input)="onQuery(input.value)"
        (keydown)="onKeydown($event)"
      />
      @if (shownShortcut(); as key) {
        <tk-kbd>{{ key }}</tk-kbd>
      }
    </div>
    <div class="list" role="listbox" [id]="listId" [attr.aria-label]="placeholder()">
      @for (option of filtered(); track $index; let i = $index) {
        <div
          class="option"
          role="option"
          [id]="listId + '-' + i"
          [class.active]="i === active()"
          [class.disabled]="option.disabled"
          [attr.aria-selected]="option.value === selected()"
          [attr.aria-disabled]="option.disabled || null"
          (mouseenter)="active.set(i)"
          (mousedown)="$event.preventDefault()"
          tabindex="-1"
          (click)="choose(option)"
          (keydown.enter)="choose(option)"
        >
          @if (optionTemplate(); as tpl) {
            <ng-container
              [ngTemplateOutlet]="tpl"
              [ngTemplateOutletContext]="{
                $implicit: option,
                selected: option.value === selected(),
              }"
            />
          } @else {
            @if (option.icon && option.icon.kind !== 'severity') {
              <span class="lead" aria-hidden="true">
                @switch (option.icon.kind) {
                  @case ('status') {
                    <tk-status-icon [status]="$any(option.icon).status" />
                  }
                  @case ('type') {
                    <tk-type-icon [type]="$any(option.icon).type" [size]="14" />
                  }
                  @case ('priority') {
                    <tk-priority-icon [priority]="$any(option.icon).priority" [showTitle]="false" />
                  }
                  @case ('icon') {
                    <tk-icon class="glyph" [name]="$any(option.icon).name" [size]="14" />
                  }
                }
              </span>
            }
            @if (option.icon?.kind === 'severity') {
              <tk-severity-badge [severity]="$any(option.icon).severity" />
            } @else {
              <span class="label">{{ option.label }}</span>
            }
          }
          @if (option.value === selected()) {
            <tk-icon class="check" name="tablerCheck" [size]="14" />
          }
          @if (!query() && i < 9) {
            <span class="digit">{{ i + 1 }}</span>
          }
        </div>
      } @empty {
        <div class="empty">No matches</div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 248px;
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
    input::placeholder {
      color: var(--tk-text-subtle);
    }
    .list {
      max-height: 288px;
      overflow-y: auto;
    }
    .option {
      height: 28px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border-radius: var(--tk-radius-sm);
      cursor: pointer;
      white-space: nowrap;
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
    .lead {
      display: inline-flex;
      align-items: center;
      flex: none;
    }
    .glyph {
      color: var(--tk-text-subtle);
    }
    .check {
      margin-left: auto;
      color: var(--tk-accent-fg);
    }
    .digit {
      margin-left: auto;
      width: 12px;
      text-align: center;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
      font-variant-numeric: tabular-nums;
    }
    .check + .digit {
      margin-left: 0;
    }
    .empty {
      padding: 6px 8px;
      color: var(--tk-text-subtle);
    }
  `,
})
export class InlinePickerPanelComponent<T> {
  readonly options = input.required<readonly PickerOption<T>[]>();
  readonly selected = input<T | null>(null);
  readonly placeholder = input('Filter…');
  readonly shortcut = input<string | null>(null);
  readonly optionTemplate = input<PickerOptionTemplate<T> | null>(null);

  readonly picked = output<T>();
  readonly dismissed = output<void>();

  private readonly shortcutAvailable = inject(PICKER_SHORTCUT_AVAILABLE);
  protected readonly shownShortcut = computed(() => {
    const key = this.shortcut();
    return key && this.shortcutAvailable(key) ? key : null;
  });
  protected readonly listId = `tk-picker-${nextPanelId++}`;
  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly filtered = computed(() => filterOptions(this.options(), this.query()));
  protected readonly activeId = computed(() =>
    this.filtered().length ? `${this.listId}-${this.active()}` : null,
  );

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  constructor() {
    afterNextRender(() => {
      this.input().nativeElement.focus();
      const index = this.filtered().findIndex((o) => o.value === this.selected());
      if (index >= 0) this.active.set(index);
    });
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.active.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.filtered().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count) this.active.set((this.active() + 1) % count);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (count) this.active.set((this.active() - 1 + count) % count);
        return;
      case 'Home':
        event.preventDefault();
        this.active.set(0);
        return;
      case 'End':
        event.preventDefault();
        this.active.set(Math.max(0, count - 1));
        return;
      case 'Enter': {
        event.preventDefault();
        const option = this.filtered()[this.active()];
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
        return;
    }
    if (!this.query() && /^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey) {
      const option = this.filtered()[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        this.choose(option);
      }
    }
  }

  protected choose(option: PickerOption<T>): void {
    if (option.disabled) return;
    this.picked.emit(option.value);
  }
}
