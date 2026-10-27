import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';

const ALL = '';

/// The dashboard's single version filter (I-23): a picker over the project's versions (most
/// recently used first) with "All versions" on top, plus a clear button while a version is set.
@Component({
  selector: 'tk-version-filter',
  imports: [IconComponent, InlinePickerDirective, MatTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="trigger"
      [class.active]="version() !== null"
      [tkInlinePicker]="options()"
      [pickerValue]="version() ?? all"
      pickerPlaceholder="Filter versions…"
      (picked)="changed.emit($event === all ? null : $event)"
      data-testid="dashboard-version-filter"
      aria-label="Version filter"
    >
      <tk-icon name="tablerFlag" [size]="14" />
      @if (version(); as v) {
        <span
          >Version <strong>{{ v }}</strong></span
        >
      } @else {
        <span>All versions</span>
      }
      <tk-icon name="tablerChevronDown" [size]="14" />
    </button>
    @if (version() !== null) {
      <button
        type="button"
        class="clear tk-icon-btn"
        aria-label="Clear version filter"
        matTooltip="Clear version filter"
        data-testid="dashboard-version-clear"
        (click)="changed.emit(null)"
      >
        <tk-icon name="tablerX" [size]="14" />
      </button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    .trigger {
      height: var(--tk-control-h);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
      color: var(--tk-text-muted);
      font: inherit;
      cursor: pointer;
    }
    .trigger:hover {
      border-color: var(--tk-border-input-hover);
      color: var(--tk-text);
    }
    .trigger:focus-visible {
      outline: 2px solid var(--tk-focus);
      outline-offset: 2px;
    }
    .trigger.active {
      background: var(--tk-accent-subtle);
      border-color: var(--tk-accent-border);
      color: var(--tk-text);
    }
    strong {
      font-weight: var(--tk-weight-semibold);
    }
  `,
})
export class VersionFilterComponent {
  readonly version = input.required<string | null>();
  readonly versions = input.required<readonly string[]>();
  readonly changed = output<string | null>();

  protected readonly all = ALL;
  protected readonly options = computed<PickerOption<string>[]>(() => {
    const versions = [...this.versions()];
    const current = this.version();
    if (current !== null && !versions.includes(current)) versions.unshift(current);
    return [
      { value: ALL, label: 'All versions' },
      ...versions.map((v) => ({ value: v, label: v })),
    ];
  });
}
