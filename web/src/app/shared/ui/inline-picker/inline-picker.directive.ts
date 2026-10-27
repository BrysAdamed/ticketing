import {
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  createRepositionScrollStrategy,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { InlinePickerPanelComponent } from './inline-picker-panel.component';
import { PickerOption, PickerOptionTemplate } from './picker-option';

/// Turns any element into the trigger of an inline property picker (status, priority,
/// assignee, …): a CDK overlay listbox with a filter input, arrow-key navigation, type-ahead
/// filtering and 1–9 digit shortcuts.
///
/// `<button [tkInlinePicker]="statusOptions" [pickerValue]="ticket.status"
///          (picked)="setStatus($event)">…</button>`
@Directive({
  selector: '[tkInlinePicker]',
  exportAs: 'tkInlinePicker',
  host: {
    'aria-haspopup': 'listbox',
    '[attr.aria-expanded]': 'isOpen()',
    '(click)': 'toggle()',
  },
})
export class InlinePickerDirective<T> {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tkInlinePicker = input.required<readonly PickerOption<T>[]>();
  readonly pickerValue = input<T | null>(null);
  readonly pickerPlaceholder = input('Filter…');
  readonly pickerShortcut = input<string | null>(null);
  readonly pickerOptionTemplate = input<PickerOptionTemplate<T> | null>(null);
  readonly pickerDisabled = input(false);
  /// Loads the options when the picker opens (instead of the bound list), e.g. boards to move to.
  readonly pickerLoad = input<(() => Promise<readonly PickerOption<T>[]>) | null>(null);

  readonly picked = output<T>();

  readonly isOpen = signal(false);
  private overlayRef: OverlayRef | null = null;
  private loading = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.overlayRef?.dispose());
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  /// Opens the picker under the host, or under `origin` (for example a focused card) when given.
  /// `options` replaces the bound options for this opening (for options loaded on demand).
  open(origin?: Element, options?: readonly PickerOption<T>[]): void {
    if (this.isOpen() || this.loading || this.pickerDisabled()) return;
    const load = this.pickerLoad();
    if (!options && load) {
      this.loading = true;
      void load()
        .then((loaded) => {
          this.loading = false;
          this.open(origin, loaded);
        })
        .catch(() => (this.loading = false));
      return;
    }
    const overlayRef = createOverlayRef(this.injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(this.injector, origin ?? this.host)
        .withPositions([
          { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
          { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
        ])
        .withPush(true)
        .withViewportMargin(8),
      scrollStrategy: createRepositionScrollStrategy(this.injector),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });
    const panel = overlayRef.attach(
      new ComponentPortal(InlinePickerPanelComponent<T>, null, this.injector),
    );
    panel.setInput('options', options ?? this.tkInlinePicker());
    panel.setInput('selected', this.pickerValue());
    panel.setInput('placeholder', this.pickerPlaceholder());
    panel.setInput('shortcut', this.pickerShortcut());
    panel.setInput('optionTemplate', this.pickerOptionTemplate());
    panel.instance.picked.subscribe((value) => {
      this.close();
      this.picked.emit(value);
    });
    panel.instance.dismissed.subscribe(() => this.close());
    overlayRef.backdropClick().subscribe(() => this.close());
    this.overlayRef = overlayRef;
    this.isOpen.set(true);
  }

  close(): void {
    if (!this.overlayRef) return;
    this.overlayRef.dispose();
    this.overlayRef = null;
    this.isOpen.set(false);
    this.host.nativeElement.focus();
  }
}
