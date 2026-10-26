import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  untracked,
  ViewContainerRef,
} from '@angular/core';
import { FLAG_ON, FeatureFlagService } from './feature-flag.service';

/// Renders its template when a flag evaluates to the given variant (default `on`).
///
/// `<section *tkFeature="'board.swimlanes'">…</section>`
/// `<x *tkFeature="'ticket-view.v2'; variant: 'b'; else legacy" />`
@Directive({ selector: '[tkFeature]' })
export class FeatureDirective {
  private readonly flags = inject(FeatureFlagService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);

  readonly tkFeature = input.required<string>();
  readonly tkFeatureVariant = input<string>(FLAG_ON);
  readonly tkFeatureElse = input<TemplateRef<unknown> | null>(null);

  private shown: TemplateRef<unknown> | null = null;

  constructor() {
    effect(() => {
      const matches = this.flags.variant(this.tkFeature()) === this.tkFeatureVariant();
      const next = matches ? this.template : this.tkFeatureElse();
      if (next === this.shown) return;
      untracked(() => {
        this.container.clear();
        if (next) this.container.createEmbeddedView(next);
      });
      this.shown = next;
    });
  }
}
