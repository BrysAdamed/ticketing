import { DestroyRef, Directive, effect, ElementRef, inject, input } from '@angular/core';
import { TourAnchorRegistry } from './tour-anchor.registry';

/// Marks an element a tour step can point at: `<button tkTourAnchor="backlog.new-ticket">`.
/// Renders `data-tour` and registers the element in `TourAnchorRegistry` while it is in the DOM.
/// Every variant of a view exposes the same anchor ids (D-129). Kept apart from `data-testid`.
@Directive({
  selector: '[tkTourAnchor]',
  host: { '[attr.data-tour]': 'tkTourAnchor()' },
})
export class TourAnchorDirective {
  readonly tkTourAnchor = input.required<string>();

  constructor() {
    const registry = inject(TourAnchorRegistry);
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let unregister: (() => void) | null = null;
    effect(() => {
      unregister?.();
      unregister = registry.register(this.tkTourAnchor(), element);
    });
    inject(DestroyRef).onDestroy(() => unregister?.());
  }
}
