import { afterNextRender, Directive, ElementRef, inject, input } from '@angular/core';

/// Focuses an inline input once it is rendered and selects its text (inline create and rename).
@Directive({ selector: 'input[tkAutofocusSelect]' })
export class AutofocusSelectDirective {
  readonly tkAutofocusSelect = input(true);

  constructor() {
    const element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (!this.tkAutofocusSelect()) return;
      element.focus();
      element.select();
    });
  }
}
