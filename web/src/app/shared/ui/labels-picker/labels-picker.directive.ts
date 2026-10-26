import {
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  createRepositionScrollStrategy,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ComponentRef, DestroyRef, Directive, effect, ElementRef, inject, Injector, input, output, signal } from '@angular/core';
import { LabelsPickerPanelComponent, LabelToggle } from './labels-picker-panel.component';

/// Opens the labels picker below the host element. Suggestions come from `labelSuggestions`, a
/// function of the typed prefix (for example the project's field hints).
///
/// `<button [tkLabelsPicker]="ticket.labels" [labelSuggestions]="hints" (labelToggled)="toggle($event)">`
@Directive({
  selector: '[tkLabelsPicker]',
  exportAs: 'tkLabelsPicker',
  host: { 'aria-haspopup': 'listbox', '[attr.aria-expanded]': 'isOpen()', '(click)': 'toggle()' },
})
export class LabelsPickerDirective {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tkLabelsPicker = input.required<readonly string[]>();
  readonly labelSuggestions = input<(prefix: string) => Promise<readonly string[]>>(() => Promise.resolve([]));
  readonly labelsDisabled = input(false);

  readonly labelToggled = output<LabelToggle>();

  readonly isOpen = signal(false);
  private overlayRef: OverlayRef | null = null;
  private panel: ComponentRef<LabelsPickerPanelComponent> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.overlayRef?.dispose());
    effect(() => this.panel?.setInput('selected', this.tkLabelsPicker()));
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen() || this.labelsDisabled()) return;
    const overlayRef = createOverlayRef(this.injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(this.injector, this.host)
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
    const panel = overlayRef.attach(new ComponentPortal(LabelsPickerPanelComponent, null, this.injector));
    panel.setInput('selected', this.tkLabelsPicker());
    const load = (prefix: string) =>
      void this.labelSuggestions()(prefix).then((labels) => {
        if (this.panel === panel) panel.setInput('suggestions', labels);
      });
    load('');
    panel.instance.queryChange.subscribe(load);
    panel.instance.toggled.subscribe((toggle) => this.labelToggled.emit(toggle));
    panel.instance.dismissed.subscribe(() => this.close());
    overlayRef.backdropClick().subscribe(() => this.close());
    this.overlayRef = overlayRef;
    this.panel = panel;
    this.isOpen.set(true);
  }

  close(): void {
    if (!this.overlayRef) return;
    this.overlayRef.dispose();
    this.overlayRef = null;
    this.panel = null;
    this.isOpen.set(false);
    this.host.nativeElement.focus();
  }
}
