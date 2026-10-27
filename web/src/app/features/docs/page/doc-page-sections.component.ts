import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  Type,
} from '@angular/core';
import {
  DOC_PAGE_SECTIONS,
  DocPageSection,
  DocPageSectionPlacement,
} from '@core/docs/doc-extensions';
import { Doc } from '@core/docs/doc.models';

/// Renders the registered page sections of one placement (`provideDocPageSection`), each lazily
/// loaded and re-created when the doc key changes.
@Component({
  selector: 'tk-doc-page-sections',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (section of sections(); track section.id) {
      @if (components()[section.id]; as component) {
        @for (key of [doc().key]; track key) {
          <div class="section" [attr.data-testid]="'doc-section-' + section.id">
            <ng-container *ngComponentOutlet="component; inputs: { doc: doc() }" />
          </div>
        }
      }
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    :host ::ng-deep .section:has(> .tk-section-empty) {
      display: none;
    }
  `,
})
export class DocPageSectionsComponent {
  private readonly all = inject(DOC_PAGE_SECTIONS);

  readonly doc = input.required<Doc>();
  readonly placement = input.required<DocPageSectionPlacement>();

  private readonly kind = computed(() => this.doc().kind);
  protected readonly components = signal<Readonly<Record<string, Type<unknown>>>>({});
  protected readonly sections = computed<readonly DocPageSection[]>(() =>
    this.all
      .filter(
        (section) =>
          section.placement === this.placement() &&
          (!section.kinds || section.kinds.includes(this.kind())),
      )
      .sort((a, b) => a.order - b.order),
  );

  constructor() {
    effect(() => {
      for (const section of this.sections())
        void section
          .loadComponent()
          .then((component) =>
            this.components.update((map) =>
              map[section.id] ? map : { ...map, [section.id]: component },
            ),
          );
    });
  }
}
