import { DestroyRef, Directive, effect, ElementRef, inject, input } from '@angular/core';
import { TourAnchorRegistry } from './tour-anchor.registry';

/// Marks an element a tour step can point at: `<button tkTourAnchor="backlog.quick-create">`.
/// Renders `data-tour` and registers the element in `TourAnchorRegistry` while it is in the DOM.
/// Bind null to expose the anchor on one element of a list only (`[tkTourAnchor]="first ? 'x' : null"`).
/// Every variant of a view exposes the same anchor ids (D-129). Kept apart from `data-testid`.
@Directive({
  selector: '[tkTourAnchor]',
  host: { '[attr.data-tour]': 'tkTourAnchor() || null' },
})
export class TourAnchorDirective {
  readonly tkTourAnchor = input.required<string | null>();

  constructor() {
    const registry = inject(TourAnchorRegistry);
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let unregister: (() => void) | null = null;
    effect(() => {
      const id = this.tkTourAnchor();
      unregister?.();
      unregister = id ? registry.register(id, element) : null;
    });
    inject(DestroyRef).onDestroy(() => unregister?.());
  }
}
