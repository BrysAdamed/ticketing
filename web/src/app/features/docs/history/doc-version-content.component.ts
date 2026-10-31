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
  untracked,
} from '@angular/core';
import { Doc, DocVersion } from '@core/docs/doc.models';
import { ViewRegistry } from '@core/views/view-registry';
import { DOC_CONTENT_VIEWS } from '../docs.views';
import { DocMarkdownComponent } from '../page/doc-markdown.component';

/// The doc as of an older version, read-only: a page as its title and rendered markdown; a
/// diagram through its kind's content view, given the doc with that version's title and content
/// and no write permissions.
@Component({
  selector: 'tk-doc-version-content',
  imports: [NgComponentOutlet, DocMarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (doc().kind === 'Page') {
      <h1 class="ptitle" data-testid="doc-version-title">{{ version().title }}</h1>
      @if (version().content) {
        <tk-doc-markdown
          data-testid="doc-version-content"
          [source]="version().content"
          [docKey]="doc().key"
          [references]="version().references"
          [embeds]="version().embeds"
          [mentions]="version().mentions"
        />
      } @else {
        <p class="empty">This version is empty.</p>
      }
    } @else if (view(); as component) {
      <ng-container *ngComponentOutlet="component; inputs: { doc: asOfVersion() }" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .ptitle {
      margin: 0 0 20px;
      font-size: var(--tk-text-2xl);
      line-height: var(--tk-leading-2xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
      overflow-wrap: anywhere;
    }
    tk-doc-markdown {
      display: block;
    }
    .empty {
      color: var(--tk-text-muted);
    }
  `,
})
export class DocVersionContentComponent {
  private readonly registry = inject(ViewRegistry);

  readonly doc = input.required<Doc>();
  readonly version = input.required<DocVersion>();

  protected readonly view = signal<Type<unknown> | null>(null);
  protected readonly asOfVersion = computed<Doc>(() => {
    const version = this.version();
    return {
      ...this.doc(),
      title: version.title,
      content: version.content,
      snapshotUrl: version.snapshotUrl ?? null,
      version: version.number,
      updatedBy: version.author,
      updatedAt: version.createdAt,
      permissions: { canEdit: false, canDelete: false },
      editors: [],
      myDraft: null,
      references: version.references,
      embeds: version.embeds,
    };
  });

  constructor() {
    effect(() => {
      const kind = this.doc().kind;
      if (kind === 'Page') return;
      untracked(
        () => void this.registry.resolve(DOC_CONTENT_VIEWS[kind]).then((c) => this.view.set(c)),
      );
    });
  }
}
