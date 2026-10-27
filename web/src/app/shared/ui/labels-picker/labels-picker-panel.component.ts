import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { LabelChipComponent } from '../domain/label-chip.component';

let nextPanelId = 0;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,49}$/;

export interface LabelToggle {
  label: string;
  add: boolean;
}

/// Popover listing the current labels (checked) and suggestions; typing filters and offers to
/// create a new label. Enter toggles the active option and keeps the panel open.
@Component({
  selector: 'tk-labels-picker-panel',
  imports: [IconComponent, LabelChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-popover', 'data-testid': 'labels-picker' },
  template: `
    <div class="search">
      <tk-icon name="tablerSearch" [size]="14" />
      <input
        #input
        type="text"
        role="combobox"
        aria-label="Filter or create labels"
        aria-autocomplete="list"
        aria-expanded="true"
        [attr.aria-controls]="listId"
        placeholder="Add labels…"
        data-testid="labels-picker-input"
        [value]="query()"
        (input)="onQuery(input.value)"
        (keydown)="onKeydown($event)"
      />
    </div>
    <div class="list" role="listbox" [id]="listId" aria-label="Labels" aria-multiselectable="true">
      @for (option of options(); track option.label; let i = $index) {
        <div
          class="option"
          role="option"
          tabindex="-1"
          [class.active]="i === active()"
          [attr.aria-selected]="option.selected"
          [attr.data-testid]="'label-option-' + option.label"
          (mouseenter)="active.set(i)"
          (mousedown)="$event.preventDefault()"
          (click)="toggle(option.label, option.selected)"
          (keydown.enter)="toggle(option.label, option.selected)"
        >
          <span class="box" [class.on]="option.selected">
            @if (option.selected) {
              <tk-icon name="tablerCheck" [size]="12" />
            }
          </span>
          @if (option.isNew) {
            <span class="create">Create</span>
          }
          <tk-label-chip [label]="option.label" />
        </div>
      } @empty {
        <div class="empty">
          {{ query() ? 'Labels use a-z, 0-9, ".", "_" or "-"' : 'No labels yet' }}
        </div>
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
    }
    .option.active {
      background: var(--tk-bg-hover);
    }
    .box {
      width: 14px;
      height: 14px;
      border: 1px solid var(--tk-border-input-hover);
      border-radius: var(--tk-radius-xs);
      display: grid;
      place-items: center;
      flex: none;
      color: var(--tk-text-on-solid);
    }
    .box.on {
      background: var(--tk-accent);
      border-color: var(--tk-accent);
    }
    .create {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .empty {
      padding: 6px 8px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class LabelsPickerPanelComponent {
  readonly selected = input.required<readonly string[]>();
  readonly suggestions = input<readonly string[]>([]);

  readonly toggled = output<LabelToggle>();
  readonly queryChange = output<string>();
  readonly dismissed = output<void>();

  protected readonly listId = `tk-labels-picker-${nextPanelId++}`;
  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly options = computed(() => {
    const q = this.query().trim().toLowerCase();
    const selected = new Set(this.selected());
    const all = [...new Set([...this.selected(), ...this.suggestions()])];
    const matches = all
      .filter((label) => !q || label.includes(q))
      .map((label) => ({ label, selected: selected.has(label), isNew: false }));
    if (q && LABEL_PATTERN.test(q) && !all.includes(q))
      matches.unshift({ label: q, selected: false, isNew: true });
    return matches;
  });

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  constructor() {
    afterNextRender(() => this.input().nativeElement.focus());
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.active.set(0);
    this.queryChange.emit(value.trim().toLowerCase());
  }

  protected toggle(label: string, selected: boolean): void {
    this.toggled.emit({ label, add: !selected });
    this.query.set('');
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
        if (option) this.toggle(option.label, option.selected);
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
}
