import {
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  createRepositionScrollStrategy,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
  ComponentRef,
  DestroyRef,
  Directive,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { PickerOption, PickerOptionTemplate } from '../inline-picker/picker-option';
import { SearchPickerPanelComponent } from './search-picker-panel.component';

export type SearchFn<T> = (query: string) => Promise<readonly PickerOption<T>[]>;

/// Like `tkInlinePicker`, but the options come from an async search (debounced) as the user types,
/// for pickers over large sets such as tickets.
///
/// `<button [tkSearchPicker]="findTickets" (picked)="setParent($event)">`
@Directive({
  selector: '[tkSearchPicker]',
  exportAs: 'tkSearchPicker',
  host: { 'aria-haspopup': 'listbox', '[attr.aria-expanded]': 'isOpen()', '(click)': 'toggle()' },
})
export class SearchPickerDirective<T> {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tkSearchPicker = input.required<SearchFn<T>>();
  readonly pickerPlaceholder = input('Search…');
  readonly pickerShortcut = input<string | null>(null);
  readonly pickerOptionTemplate = input<PickerOptionTemplate<T> | null>(null);
  readonly pickerDisabled = input(false);
  /// A note under the search box while nothing is typed, for example that the list is cut.
  readonly pickerHint = input<string | null>(null);

  readonly picked = output<T>();

  readonly isOpen = signal(false);
  private overlayRef: OverlayRef | null = null;
  private readonly panel = signal<ComponentRef<SearchPickerPanelComponent<T>> | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.overlayRef?.dispose());
    effect(() => this.panel()?.setInput('hint', this.pickerHint()));
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  /// Opens the picker under the host, or under `origin` (for example a focused card) when given.
  open(origin?: Element): void {
    if (this.isOpen() || this.pickerDisabled()) return;
    const overlayRef = createOverlayRef(this.injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(this.injector, origin ?? this.host)
        .withPositions([
          { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
          { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
          { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
        ])
        .withPush(true)
        .withViewportMargin(8),
      scrollStrategy: createRepositionScrollStrategy(this.injector),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });
    const panel = overlayRef.attach(
      new ComponentPortal(SearchPickerPanelComponent<T>, null, this.injector),
    );
    panel.setInput('search', this.tkSearchPicker());
    panel.setInput('placeholder', this.pickerPlaceholder());
    panel.setInput('shortcut', this.pickerShortcut());
    panel.setInput('optionTemplate', this.pickerOptionTemplate());
    panel.setInput('hint', this.pickerHint());
    this.panel.set(panel);
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
    this.panel.set(null);
    this.isOpen.set(false);
    this.host.nativeElement.focus();
  }
}
